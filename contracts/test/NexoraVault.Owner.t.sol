// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {NexoraVaultTestBase} from "./NexoraVault.Base.t.sol";
import {NexoraVault} from "../NexoraVault.sol";

contract NexoraVaultOwnerTest is NexoraVaultTestBase {
    // ---------------------------------------------------------------- constructor
    function test_Constructor_SetsUsdc() public view {
        assertEq(address(vault.usdc()), address(usdc));
        assertEq(vault.agentCount(), 0);
        assertEq(vault.requestCount(), 0);
    }

    function test_Constructor_RevertsOnZeroToken() public {
        vm.expectRevert(NexoraVault.ZeroAddress.selector);
        new NexoraVault(address(0));
    }

    // ---------------------------------------------------------------- registerAgent
    function test_Register_Valid() public {
        vm.expectEmit(true, true, false, true, address(vault));
        emit NexoraVault.AgentRegistered(1, owner, agentWallet, "Agent");
        vm.expectEmit(true, true, false, true, address(vault));
        emit NexoraVault.RecipientUpdated(1, recipient, true);
        uint256 id = _register();
        assertEq(id, 1);
        NexoraVault.AgentView memory a = vault.getAgent(id);
        assertEq(a.owner, owner);
        assertEq(a.wallet, agentWallet);
        assertEq(a.name, "Agent");
        assertEq(uint8(a.status), uint8(NexoraVault.AgentStatus.Active));
        assertEq(a.balance, 0);
        assertEq(a.createdAt, uint64(T0));
        assertEq(a.policy.maxPerTx, MAX_TX);
        assertEq(a.policy.dailyLimit, DAILY);
        assertEq(a.policy.approvalThreshold, THRESHOLD);
        assertEq(a.remainingToday, DAILY);
        assertTrue(vault.isRecipientAllowed(id, recipient));
        assertEq(vault.agentCount(), 1);
    }

    function test_Register_EdgeValidInputs() public {
        // name exactly 48 bytes, threshold == maxPerTx, daily == maxPerTx, threshold 0, no recipients
        bytes memory n = new bytes(48);
        for (uint256 i; i < 48; ++i) n[i] = "a";
        NexoraVault.Policy memory p = NexoraVault.Policy(5e6, 5e6, 5e6, uint64(T0 + 1));
        vm.prank(owner);
        vault.registerAgent(string(n), agentWallet, p, new address[](0));
        p.approvalThreshold = 0;
        vm.prank(owner);
        vault.registerAgent("x", agentWallet, p, new address[](0));
        assertEq(vault.agentCount(), 2);
    }

    function test_Register_RevertsEmptyName() public {
        vm.prank(owner);
        vm.expectRevert(NexoraVault.InvalidName.selector);
        vault.registerAgent("", agentWallet, _policy(), _recips());
    }

    function test_Register_RevertsNameTooLong() public {
        bytes memory n = new bytes(49);
        for (uint256 i; i < 49; ++i) n[i] = "a";
        vm.prank(owner);
        vm.expectRevert(NexoraVault.InvalidName.selector);
        vault.registerAgent(string(n), agentWallet, _policy(), _recips());
    }

    function test_Register_RevertsZeroWallet() public {
        vm.prank(owner);
        vm.expectRevert(NexoraVault.ZeroAddress.selector);
        vault.registerAgent("A", address(0), _policy(), _recips());
    }

    function test_Register_RevertsInvalidPolicies() public {
        NexoraVault.Policy memory p = _policy();
        p.maxPerTx = 0;
        _expectRegisterInvalidPolicy(p);
        p = _policy();
        p.dailyLimit = MAX_TX - 1; // daily < maxPerTx
        _expectRegisterInvalidPolicy(p);
        p = _policy();
        p.approvalThreshold = MAX_TX + 1; // threshold > maxPerTx
        _expectRegisterInvalidPolicy(p);
        p = _policy();
        p.expiresAt = uint64(block.timestamp); // not in the future
        _expectRegisterInvalidPolicy(p);
        p.expiresAt = uint64(block.timestamp - 1);
        _expectRegisterInvalidPolicy(p);
    }

    function _expectRegisterInvalidPolicy(NexoraVault.Policy memory p) internal {
        vm.prank(owner);
        vm.expectRevert(NexoraVault.InvalidPolicy.selector);
        vault.registerAgent("A", agentWallet, p, _recips());
    }

    function test_Register_TooManyRecipients() public {
        address[] memory r = new address[](51);
        for (uint256 i; i < 51; ++i) r[i] = address(uint160(0x1000 + i));
        vm.prank(owner);
        vm.expectRevert(NexoraVault.TooManyRecipients.selector);
        vault.registerAgent("A", agentWallet, _policy(), r);
    }

    function test_Register_ExactlyMaxRecipients() public {
        address[] memory r = new address[](50);
        for (uint256 i; i < 50; ++i) r[i] = address(uint160(0x1000 + i));
        vm.prank(owner);
        uint256 id = vault.registerAgent("A", agentWallet, _policy(), r);
        assertEq(vault.getRecipients(id).length, 50);
    }

    function test_Register_InvalidRecipients() public {
        address[] memory r = new address[](1);
        r[0] = address(0);
        vm.prank(owner);
        vm.expectRevert(NexoraVault.InvalidRecipient.selector);
        vault.registerAgent("A", agentWallet, _policy(), r);
        r[0] = address(vault);
        vm.prank(owner);
        vm.expectRevert(NexoraVault.InvalidRecipient.selector);
        vault.registerAgent("A", agentWallet, _policy(), r);
    }

    function test_Register_DuplicateRecipientReverts() public {
        address[] memory r = new address[](2);
        r[0] = recipient;
        r[1] = recipient;
        vm.prank(owner);
        vm.expectRevert(NexoraVault.RecipientUnchanged.selector);
        vault.registerAgent("A", agentWallet, _policy(), r);
        assertEq(vault.agentCount(), 0);
    }

    // ---------------------------------------------------------------- fundAgent
    function test_Fund_Happy() public {
        uint256 id = _register();
        vm.expectEmit(true, true, false, true, address(vault));
        emit NexoraVault.AgentFunded(id, owner, 50e6);
        vm.prank(owner);
        vault.fundAgent(id, 50e6);
        NexoraVault.AgentView memory a = vault.getAgent(id);
        assertEq(a.balance, 50e6);
        assertEq(a.totalFunded, 50e6);
        assertEq(usdc.balanceOf(address(vault)), 50e6);
    }

    function test_Fund_WhilePausedOk() public {
        uint256 id = _register();
        vm.startPrank(owner);
        vault.pauseAgent(id);
        vault.fundAgent(id, 1e6);
        vm.stopPrank();
        assertEq(vault.getAgent(id).balance, 1e6);
    }

    function test_Fund_Reverts() public {
        uint256 id = _register();
        vm.prank(owner);
        vm.expectRevert(NexoraVault.InvalidAmount.selector);
        vault.fundAgent(id, 0);
        vm.prank(stranger);
        vm.expectRevert(NexoraVault.NotAgentOwner.selector);
        vault.fundAgent(id, 1e6);
        vm.prank(owner);
        vm.expectRevert(NexoraVault.UnknownAgent.selector);
        vault.fundAgent(99, 1e6);
        vm.prank(owner);
        vm.expectRevert(NexoraVault.UnknownAgent.selector);
        vault.fundAgent(0, 1e6);
        vm.startPrank(owner);
        vault.revokeAgent(id);
        vm.expectRevert(NexoraVault.AgentRevoked.selector);
        vault.fundAgent(id, 1e6);
        vm.stopPrank();
    }

    function test_Fund_RevertsWithoutAllowance() public {
        uint256 id = _register();
        usdc.mint(stranger, 10e6);
        // stranger isn't owner => NotAgentOwner; use owner with revoked allowance
        vm.startPrank(owner);
        usdc.approve(address(vault), 0);
        vm.expectRevert();
        vault.fundAgent(id, 1e6);
        vm.stopPrank();
    }

    function test_DirectTransferDoesNotCreditAgent() public {
        uint256 id = _register();
        vm.prank(owner);
        usdc.transfer(address(vault), 5e6);
        assertEq(vault.getAgent(id).balance, 0);
    }

    // ---------------------------------------------------------------- withdrawFromAgent
    function test_Withdraw_Happy() public {
        uint256 id = _registerFunded(50e6);
        uint256 before_ = usdc.balanceOf(owner);
        vm.expectEmit(true, true, false, true, address(vault));
        emit NexoraVault.AgentWithdrawn(id, owner, 20e6);
        vm.prank(owner);
        vault.withdrawFromAgent(id, 20e6);
        assertEq(usdc.balanceOf(owner), before_ + 20e6);
        assertEq(vault.getAgent(id).balance, 30e6);
        assertEq(usdc.balanceOf(address(vault)), 30e6);
    }

    function test_Withdraw_RevertsInsufficient() public {
        uint256 id = _registerFunded(5e6);
        vm.prank(owner);
        vm.expectRevert(NexoraVault.InsufficientBalance.selector);
        vault.withdrawFromAgent(id, 5e6 + 1);
    }

    function test_Withdraw_RevertsNonOwner() public {
        uint256 id = _registerFunded(5e6);
        vm.prank(stranger);
        vm.expectRevert(NexoraVault.NotAgentOwner.selector);
        vault.withdrawFromAgent(id, 1);
        vm.prank(agentWallet);
        vm.expectRevert(NexoraVault.NotAgentOwner.selector);
        vault.withdrawFromAgent(id, 1);
        vm.prank(owner2);
        vm.expectRevert(NexoraVault.NotAgentOwner.selector);
        vault.withdrawFromAgent(id, 1);
    }

    function test_Withdraw_WhenPaused() public {
        uint256 id = _registerFunded(10e6);
        vm.startPrank(owner);
        vault.pauseAgent(id);
        vault.withdrawFromAgent(id, 10e6);
        vm.stopPrank();
        assertEq(vault.getAgent(id).balance, 0);
    }

    function test_Withdraw_WhenRevoked() public {
        uint256 id = _registerFunded(10e6);
        vm.startPrank(owner);
        vault.revokeAgent(id);
        vault.withdrawFromAgent(id, 10e6);
        vm.stopPrank();
        assertEq(vault.getAgent(id).balance, 0);
    }

    function test_Withdraw_WhenPolicyExpired() public {
        vm.prank(owner);
        uint256 id =
            vault.registerAgent("A", agentWallet, NexoraVault.Policy(MAX_TX, DAILY, THRESHOLD, uint64(T0 + 1 hours)), _recips());
        vm.prank(owner);
        vault.fundAgent(id, 10e6);
        vm.warp(T0 + 2 hours);
        vm.prank(owner);
        vault.withdrawFromAgent(id, 10e6);
        assertEq(vault.getAgent(id).balance, 0);
    }

    // ---------------------------------------------------------------- setPolicy
    function test_SetPolicy_Happy() public {
        uint256 id = _register();
        NexoraVault.Policy memory p = NexoraVault.Policy(3e6, 6e6, 2e6, uint64(T0 + 30 days));
        vm.expectEmit(true, false, false, true, address(vault));
        emit NexoraVault.PolicyUpdated(id, 3e6, 6e6, 2e6, uint64(T0 + 30 days));
        vm.prank(owner);
        vault.setPolicy(id, p);
        NexoraVault.Policy memory got = vault.getAgent(id).policy;
        assertEq(got.maxPerTx, 3e6);
        assertEq(got.dailyLimit, 6e6);
        assertEq(got.approvalThreshold, 2e6);
        assertEq(got.expiresAt, uint64(T0 + 30 days));
    }

    function test_SetPolicy_Reverts() public {
        uint256 id = _register();
        NexoraVault.Policy memory p = _policy();
        vm.prank(stranger);
        vm.expectRevert(NexoraVault.NotAgentOwner.selector);
        vault.setPolicy(id, p);
        p.maxPerTx = 0;
        vm.prank(owner);
        vm.expectRevert(NexoraVault.InvalidPolicy.selector);
        vault.setPolicy(id, p);
        p = _policy();
        p.expiresAt = uint64(T0);
        vm.prank(owner);
        vm.expectRevert(NexoraVault.InvalidPolicy.selector);
        vault.setPolicy(id, p);
        vm.startPrank(owner);
        vault.revokeAgent(id);
        vm.expectRevert(NexoraVault.AgentRevoked.selector);
        vault.setPolicy(id, _policy());
        vm.stopPrank();
    }

    function test_SetPolicy_DoesNotResetDailySpend() public {
        uint256 id = _registerFunded(100e6);
        _req(id, recipient, 5e6);
        vm.prank(owner);
        vault.setPolicy(id, _policy());
        assertEq(vault.getAgent(id).spentToday, 5e6);
    }

    // ---------------------------------------------------------------- recipients
    function test_AddRemoveRecipient() public {
        uint256 id = _register();
        vm.expectEmit(true, true, false, true, address(vault));
        emit NexoraVault.RecipientUpdated(id, recipient2, true);
        vm.prank(owner);
        vault.addRecipient(id, recipient2);
        assertTrue(vault.isRecipientAllowed(id, recipient2));
        assertEq(vault.getRecipients(id).length, 2);

        vm.expectEmit(true, true, false, true, address(vault));
        emit NexoraVault.RecipientUpdated(id, recipient2, false);
        vm.prank(owner);
        vault.removeRecipient(id, recipient2);
        assertFalse(vault.isRecipientAllowed(id, recipient2));
        assertEq(vault.getRecipients(id).length, 1);
        assertEq(vault.getRecipients(id)[0], recipient);
    }

    function test_AddRecipient_Reverts() public {
        uint256 id = _register();
        vm.prank(stranger);
        vm.expectRevert(NexoraVault.NotAgentOwner.selector);
        vault.addRecipient(id, recipient2);
        vm.startPrank(owner);
        vm.expectRevert(NexoraVault.RecipientUnchanged.selector);
        vault.addRecipient(id, recipient);
        vm.expectRevert(NexoraVault.InvalidRecipient.selector);
        vault.addRecipient(id, address(0));
        vm.expectRevert(NexoraVault.InvalidRecipient.selector);
        vault.addRecipient(id, address(vault));
        vault.revokeAgent(id);
        vm.expectRevert(NexoraVault.AgentRevoked.selector);
        vault.addRecipient(id, recipient2);
        vm.stopPrank();
    }

    function test_AddRecipient_CapAtFifty() public {
        uint256 id = _register(); // 1 recipient
        vm.startPrank(owner);
        for (uint256 i; i < 49; ++i) vault.addRecipient(id, address(uint160(0x2000 + i)));
        vm.expectRevert(NexoraVault.TooManyRecipients.selector);
        vault.addRecipient(id, address(0x9999));
        vm.stopPrank();
        assertEq(vault.getRecipients(id).length, 50);
    }

    function test_RemoveRecipient_Reverts() public {
        uint256 id = _register();
        vm.prank(stranger);
        vm.expectRevert(NexoraVault.NotAgentOwner.selector);
        vault.removeRecipient(id, recipient);
        vm.startPrank(owner);
        vm.expectRevert(NexoraVault.RecipientUnchanged.selector);
        vault.removeRecipient(id, recipient2);
        vm.expectRevert(NexoraVault.InvalidRecipient.selector);
        vault.removeRecipient(id, address(0));
        vault.revokeAgent(id);
        vm.expectRevert(NexoraVault.AgentRevoked.selector);
        vault.removeRecipient(id, recipient);
        vm.stopPrank();
    }

    // ---------------------------------------------------------------- setAgentWallet
    function test_SetAgentWallet_Happy() public {
        uint256 id = _registerFunded(10e6);
        vm.expectEmit(true, false, false, true, address(vault));
        emit NexoraVault.AgentWalletUpdated(id, newWallet);
        vm.prank(owner);
        vault.setAgentWallet(id, newWallet);
        assertEq(vault.getAgent(id).wallet, newWallet);
        // old wallet loses authority, new wallet gains it
        vm.prank(agentWallet);
        vm.expectRevert(NexoraVault.NotAgentWallet.selector);
        vault.requestPayment(id, recipient, 1e6, "");
        vm.prank(newWallet);
        (, NexoraVault.RequestStatus st) = vault.requestPayment(id, recipient, 1e6, "");
        assertEq(uint8(st), uint8(NexoraVault.RequestStatus.Executed));
    }

    function test_SetAgentWallet_Reverts() public {
        uint256 id = _register();
        vm.prank(stranger);
        vm.expectRevert(NexoraVault.NotAgentOwner.selector);
        vault.setAgentWallet(id, newWallet);
        vm.startPrank(owner);
        vm.expectRevert(NexoraVault.ZeroAddress.selector);
        vault.setAgentWallet(id, address(0));
        vault.revokeAgent(id);
        vm.expectRevert(NexoraVault.AgentRevoked.selector);
        vault.setAgentWallet(id, newWallet);
        vm.stopPrank();
    }

    // ---------------------------------------------------------------- status
    function test_PauseResumeRevoke_Happy() public {
        uint256 id = _register();
        vm.expectEmit(true, false, false, true, address(vault));
        emit NexoraVault.AgentStatusChanged(id, NexoraVault.AgentStatus.Paused);
        vm.prank(owner);
        vault.pauseAgent(id);
        assertEq(uint8(vault.getAgent(id).status), uint8(NexoraVault.AgentStatus.Paused));

        vm.expectEmit(true, false, false, true, address(vault));
        emit NexoraVault.AgentStatusChanged(id, NexoraVault.AgentStatus.Active);
        vm.prank(owner);
        vault.resumeAgent(id);
        assertEq(uint8(vault.getAgent(id).status), uint8(NexoraVault.AgentStatus.Active));

        vm.expectEmit(true, false, false, true, address(vault));
        emit NexoraVault.AgentStatusChanged(id, NexoraVault.AgentStatus.Revoked);
        vm.prank(owner);
        vault.revokeAgent(id);
        assertEq(uint8(vault.getAgent(id).status), uint8(NexoraVault.AgentStatus.Revoked));
    }

    function test_RevokeFromPaused() public {
        uint256 id = _register();
        vm.startPrank(owner);
        vault.pauseAgent(id);
        vault.revokeAgent(id);
        vm.stopPrank();
        assertEq(uint8(vault.getAgent(id).status), uint8(NexoraVault.AgentStatus.Revoked));
    }

    function test_Status_InvalidTransitions() public {
        uint256 id = _register();
        vm.startPrank(owner);
        vm.expectRevert(NexoraVault.InvalidAgentStatus.selector);
        vault.resumeAgent(id); // active -> resume
        vault.pauseAgent(id);
        vm.expectRevert(NexoraVault.InvalidAgentStatus.selector);
        vault.pauseAgent(id); // double pause
        vault.revokeAgent(id);
        vm.expectRevert(NexoraVault.InvalidAgentStatus.selector);
        vault.pauseAgent(id);
        vm.expectRevert(NexoraVault.InvalidAgentStatus.selector);
        vault.resumeAgent(id); // revoked never resumes
        vm.expectRevert(NexoraVault.AgentRevoked.selector);
        vault.revokeAgent(id);
        vm.stopPrank();
    }

    function test_Status_NonOwnerReverts() public {
        uint256 id = _register();
        vm.startPrank(agentWallet);
        vm.expectRevert(NexoraVault.NotAgentOwner.selector);
        vault.pauseAgent(id);
        vm.expectRevert(NexoraVault.NotAgentOwner.selector);
        vault.resumeAgent(id);
        vm.expectRevert(NexoraVault.NotAgentOwner.selector);
        vault.revokeAgent(id);
        vm.stopPrank();
    }

    // ---------------------------------------------------------------- views
    function test_OwnerAgentIds_Isolated() public {
        _register();
        vm.prank(owner2);
        vault.registerAgent("B", agentWallet, _policy(), _recips());
        _register();
        uint256[] memory ids = vault.getOwnerAgentIds(owner);
        assertEq(ids.length, 2);
        assertEq(ids[0], 1);
        assertEq(ids[1], 3);
        uint256[] memory ids2 = vault.getOwnerAgentIds(owner2);
        assertEq(ids2.length, 1);
        assertEq(ids2[0], 2);
        assertEq(vault.getOwnerAgentIds(stranger).length, 0);
    }

    function test_UnknownAgentViewsRevert() public {
        vm.expectRevert(NexoraVault.UnknownAgent.selector);
        vault.getAgent(1);
        vm.expectRevert(NexoraVault.UnknownAgent.selector);
        vault.getRecipients(1);
        vm.expectRevert(NexoraVault.UnknownAgent.selector);
        vault.getAgentRequestIds(1);
        vm.expectRevert(NexoraVault.UnknownAgent.selector);
        vault.previewPayment(1, recipient, 1);
        vm.expectRevert(NexoraVault.UnknownRequest.selector);
        vault.getRequest(1);
    }

    function test_AgentsAreIsolated() public {
        uint256 a = _registerFunded(10e6);
        vm.prank(owner2);
        uint256 b = vault.registerAgent("B", agentWallet, _policy(), _recips());
        assertEq(vault.getAgent(b).balance, 0);
        // agent B has no balance: payment from B is blocked even though A has funds
        vm.prank(agentWallet);
        (, NexoraVault.RequestStatus st) = vault.requestPayment(b, recipient, 1e6, "");
        assertEq(uint8(st), uint8(NexoraVault.RequestStatus.Blocked));
        assertEq(vault.getAgent(a).balance, 10e6);
        // owner cannot touch owner2's agent
        vm.prank(owner);
        vm.expectRevert(NexoraVault.NotAgentOwner.selector);
        vault.pauseAgent(b);
    }
}
