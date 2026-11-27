// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {NazvexVaultTestBase} from "./NazvexVault.Base.t.sol";
import {NazvexVault} from "../NazvexVault.sol";

contract NazvexVaultApprovalTest is NazvexVaultTestBase {
    uint256 internal id;

    function setUp() public override {
        super.setUp();
        id = _registerFunded(100e6);
    }

    function _pending(uint256 amt) internal returns (uint256 reqId) {
        NazvexVault.RequestStatus st;
        (reqId, st) = _req(id, recipient, amt);
        assertEq(uint8(st), uint8(NazvexVault.RequestStatus.Pending));
    }

    function _approve(uint256 reqId) internal {
        vm.prank(owner);
        vault.approveRequest(reqId);
    }

    function _assertBlockedByApproval(uint256 reqId, NazvexVault.BlockReason reason) internal {
        uint256 vaultBal = usdc.balanceOf(address(vault));
        uint256 bal = vault.getAgent(id).balance;
        uint256 recBal = usdc.balanceOf(recipient);
        uint256 amt = vault.getRequest(reqId).amount;
        vm.expectEmit(true, true, true, true, address(vault));
        emit NazvexVault.PaymentBlocked(reqId, id, recipient, amt, reason);
        _approve(reqId); // must not revert
        NazvexVault.PaymentRequest memory r = vault.getRequest(reqId);
        assertEq(uint8(r.status), uint8(NazvexVault.RequestStatus.Blocked));
        assertEq(uint8(r.reason), uint8(reason));
        assertEq(r.resolvedAt, uint64(block.timestamp));
        assertEq(usdc.balanceOf(address(vault)), vaultBal);
        assertEq(vault.getAgent(id).balance, bal);
        assertEq(usdc.balanceOf(recipient), recBal);
    }

    // ---------------------------------------------------------------- pending
    function test_Pending_RecordsAndReservesNothing() public {
        uint256 ts = block.timestamp;
        vm.expectEmit(true, true, true, true, address(vault));
        emit NazvexVault.PaymentRequested(1, id, recipient, 9e6, "big", uint64(ts + 2 days));
        vm.prank(agentWallet);
        (uint256 reqId, NazvexVault.RequestStatus st) = vault.requestPayment(id, recipient, 9e6, "big");
        assertEq(uint8(st), uint8(NazvexVault.RequestStatus.Pending));
        NazvexVault.PaymentRequest memory r = vault.getRequest(reqId);
        assertEq(r.expiresAt, uint64(ts + vault.APPROVAL_TTL()));
        assertEq(r.resolvedAt, 0);
        assertEq(vault.getAgent(id).balance, 100e6);
        assertEq(vault.getAgent(id).spentToday, 0);
        assertEq(usdc.balanceOf(recipient), 0);
    }

    // ---------------------------------------------------------------- approveRequest
    function test_Approve_ExecutesAndMovesFunds() public {
        uint256 reqId = _pending(9e6);
        vm.expectEmit(true, true, true, true, address(vault));
        emit NazvexVault.PaymentExecuted(reqId, id, recipient, 9e6);
        _approve(reqId);
        NazvexVault.PaymentRequest memory r = vault.getRequest(reqId);
        assertEq(uint8(r.status), uint8(NazvexVault.RequestStatus.Executed));
        assertEq(r.resolvedAt, uint64(block.timestamp));
        assertEq(usdc.balanceOf(recipient), 9e6);
        NazvexVault.AgentView memory a = vault.getAgent(id);
        assertEq(a.balance, 91e6);
        assertEq(a.totalSpent, 9e6);
        assertEq(a.spentToday, 9e6);
    }

    function test_Approve_AccessControl() public {
        uint256 reqId = _pending(9e6);
        vm.prank(stranger);
        vm.expectRevert(NazvexVault.NotAgentOwner.selector);
        vault.approveRequest(reqId);
        vm.prank(agentWallet);
        vm.expectRevert(NazvexVault.NotAgentOwner.selector);
        vault.approveRequest(reqId);
        vm.prank(owner2);
        vm.expectRevert(NazvexVault.NotAgentOwner.selector);
        vault.approveRequest(reqId);
        assertEq(uint8(_status(reqId)), uint8(NazvexVault.RequestStatus.Pending));
    }

    function test_Approve_UnknownAndNotPending() public {
        vm.prank(owner);
        vm.expectRevert(NazvexVault.UnknownRequest.selector);
        vault.approveRequest(1);
        vm.prank(owner);
        vm.expectRevert(NazvexVault.UnknownRequest.selector);
        vault.approveRequest(0);

        uint256 reqId = _pending(9e6);
        _approve(reqId);
        vm.prank(owner);
        vm.expectRevert(NazvexVault.RequestNotPending.selector);
        vault.approveRequest(reqId); // no double pay
        assertEq(usdc.balanceOf(recipient), 9e6);

        (uint256 execId,) = _req(id, recipient, 1e6); // executed immediately
        vm.prank(owner);
        vm.expectRevert(NazvexVault.RequestNotPending.selector);
        vault.approveRequest(execId);
    }

    function test_Approve_ExpiresAfterTtl() public {
        uint256 reqId = _pending(9e6);
        uint256 exp = vault.getRequest(reqId).expiresAt;
        vm.warp(exp);
        vm.prank(owner);
        vm.expectRevert(NazvexVault.ApprovalExpired.selector);
        vault.approveRequest(reqId);
        vm.warp(exp + 1 days);
        vm.prank(owner);
        vm.expectRevert(NazvexVault.ApprovalExpired.selector);
        vault.approveRequest(reqId);
        assertEq(uint8(_status(reqId)), uint8(NazvexVault.RequestStatus.Pending));
        assertEq(usdc.balanceOf(recipient), 0);
    }

    function test_Approve_OneSecondBeforeExpiryWorks() public {
        uint256 reqId = _pending(9e6);
        vm.warp(vault.getRequest(reqId).expiresAt - 1);
        _approve(reqId);
        assertEq(uint8(_status(reqId)), uint8(NazvexVault.RequestStatus.Executed));
    }

    function test_Approve_RecheckAgentRevoked() public {
        uint256 reqId = _pending(9e6);
        vm.prank(owner);
        vault.revokeAgent(id);
        _assertBlockedByApproval(reqId, NazvexVault.BlockReason.AgentNotActive);
    }

    function test_Approve_RecheckAgentPaused() public {
        uint256 reqId = _pending(9e6);
        vm.prank(owner);
        vault.pauseAgent(id);
        _assertBlockedByApproval(reqId, NazvexVault.BlockReason.AgentNotActive);
    }

    function test_Approve_RecheckRecipientRemoved() public {
        uint256 reqId = _pending(9e6);
        vm.prank(owner);
        vault.removeRecipient(id, recipient);
        _assertBlockedByApproval(reqId, NazvexVault.BlockReason.RecipientNotAllowed);
    }

    function test_Approve_RecheckPerTxReduced() public {
        uint256 reqId = _pending(9e6);
        vm.prank(owner);
        vault.setPolicy(id, NazvexVault.Policy(5e6, 20e6, 4e6, 0));
        _assertBlockedByApproval(reqId, NazvexVault.BlockReason.ExceedsPerTxLimit);
    }

    function test_Approve_RecheckInsufficientBalance() public {
        uint256 reqId = _pending(9e6);
        vm.prank(owner);
        vault.withdrawFromAgent(id, 95e6);
        _assertBlockedByApproval(reqId, NazvexVault.BlockReason.InsufficientBalance);
    }

    function test_Approve_RecheckDailyLimitConsumedMeanwhile() public {
        uint256 reqId = _pending(9e6);
        _req(id, recipient, 7e6);
        _req(id, recipient, 7e6); // 14 spent; 14 + 9 > 20
        uint256 before_ = usdc.balanceOf(recipient);
        vm.expectEmit(true, true, true, true, address(vault));
        emit NazvexVault.PaymentBlocked(reqId, id, recipient, 9e6, NazvexVault.BlockReason.ExceedsDailyLimit);
        _approve(reqId);
        assertEq(uint8(_status(reqId)), uint8(NazvexVault.RequestStatus.Blocked));
        assertEq(uint8(_reason(reqId)), uint8(NazvexVault.BlockReason.ExceedsDailyLimit));
        assertEq(usdc.balanceOf(recipient), before_);
        assertEq(vault.getAgent(id).spentToday, 14e6);
    }

    function test_Approve_RecheckBudgetExpired() public {
        vm.prank(owner);
        vault.setPolicy(id, NazvexVault.Policy(MAX_TX, DAILY, THRESHOLD, uint64(T0 + 1 hours)));
        uint256 reqId = _pending(9e6);
        vm.warp(T0 + 1 hours);
        _assertBlockedByApproval(reqId, NazvexVault.BlockReason.BudgetExpired);
    }

    function test_Approve_TwoPendingOverBalance_SecondBlocked() public {
        vm.startPrank(owner);
        vault.withdrawFromAgent(id, 100e6 - 10e6);
        vm.stopPrank();
        uint256 r1 = _pending(9e6);
        uint256 r2 = _pending(9e6);
        _approve(r1);
        assertEq(uint8(_status(r1)), uint8(NazvexVault.RequestStatus.Executed));
        _assertBlockedByApproval(r2, NazvexVault.BlockReason.InsufficientBalance);
        assertEq(vault.getAgent(id).balance, 1e6);
    }

    function test_Approve_OnNextDay_ResetsDailyAndExecutes() public {
        _req(id, recipient, 5e6);
        _req(id, recipient, 5e6); // 10 spent
        uint256 reqId = _pending(9e6); // 10 + 9 <= 20 so it is pending
        _req(id, recipient, 5e6); // 15 spent: approval today would exceed the daily limit
        vm.warp((block.timestamp / 1 days + 1) * 1 days); // next UTC day, still inside TTL
        _approve(reqId);
        assertEq(uint8(_status(reqId)), uint8(NazvexVault.RequestStatus.Executed));
        assertEq(vault.getAgent(id).spentToday, 9e6); // bucket was reset, only this payment counts
        assertEq(vault.getAgent(id).totalSpent, 24e6);
    }

    function test_Approve_SameDayDailyLimitStillEnforced() public {
        _req(id, recipient, 5e6);
        _req(id, recipient, 5e6);
        uint256 reqId = _pending(9e6);
        _req(id, recipient, 5e6);
        _assertBlockedByApproval(reqId, NazvexVault.BlockReason.ExceedsDailyLimit);
    }

    // ---------------------------------------------------------------- decline
    function test_Decline_Happy() public {
        uint256 reqId = _pending(9e6);
        vm.expectEmit(true, true, false, true, address(vault));
        emit NazvexVault.PaymentDeclined(reqId, id);
        vm.prank(owner);
        vault.declineRequest(reqId);
        NazvexVault.PaymentRequest memory r = vault.getRequest(reqId);
        assertEq(uint8(r.status), uint8(NazvexVault.RequestStatus.Declined));
        assertEq(r.resolvedAt, uint64(block.timestamp));
        assertEq(vault.getAgent(id).balance, 100e6);
        assertEq(usdc.balanceOf(recipient), 0);
    }

    function test_Decline_AfterExpiryAllowed() public {
        uint256 reqId = _pending(9e6);
        vm.warp(block.timestamp + 3 days);
        vm.prank(owner);
        vault.declineRequest(reqId);
        assertEq(uint8(_status(reqId)), uint8(NazvexVault.RequestStatus.Declined));
    }

    function test_Decline_Reverts() public {
        uint256 reqId = _pending(9e6);
        vm.prank(stranger);
        vm.expectRevert(NazvexVault.NotAgentOwner.selector);
        vault.declineRequest(reqId);
        vm.prank(agentWallet);
        vm.expectRevert(NazvexVault.NotAgentOwner.selector);
        vault.declineRequest(reqId);
        vm.prank(owner);
        vm.expectRevert(NazvexVault.UnknownRequest.selector);
        vault.declineRequest(42);
        vm.startPrank(owner);
        vault.declineRequest(reqId);
        vm.expectRevert(NazvexVault.RequestNotPending.selector);
        vault.declineRequest(reqId);
        vm.expectRevert(NazvexVault.RequestNotPending.selector);
        vault.approveRequest(reqId);
        vm.stopPrank();
    }

    // ---------------------------------------------------------------- cancel
    function test_Cancel_Happy() public {
        uint256 reqId = _pending(9e6);
        vm.expectEmit(true, true, false, true, address(vault));
        emit NazvexVault.PaymentCancelled(reqId, id);
        vm.prank(agentWallet);
        vault.cancelRequest(reqId);
        NazvexVault.PaymentRequest memory r = vault.getRequest(reqId);
        assertEq(uint8(r.status), uint8(NazvexVault.RequestStatus.Cancelled));
        assertEq(r.resolvedAt, uint64(block.timestamp));
        vm.prank(owner);
        vm.expectRevert(NazvexVault.RequestNotPending.selector);
        vault.approveRequest(reqId);
    }

    function test_Cancel_Reverts() public {
        uint256 reqId = _pending(9e6);
        vm.prank(stranger);
        vm.expectRevert(NazvexVault.NotAgentWallet.selector);
        vault.cancelRequest(reqId);
        vm.prank(owner); // owner is not the wallet
        vm.expectRevert(NazvexVault.NotAgentWallet.selector);
        vault.cancelRequest(reqId);
        vm.startPrank(agentWallet);
        vm.expectRevert(NazvexVault.UnknownRequest.selector);
        vault.cancelRequest(77);
        vault.cancelRequest(reqId);
        vm.expectRevert(NazvexVault.RequestNotPending.selector);
        vault.cancelRequest(reqId);
        vm.stopPrank();
    }

    function test_Cancel_AfterWalletRotation() public {
        uint256 reqId = _pending(9e6);
        vm.prank(owner);
        vault.setAgentWallet(id, newWallet);
        vm.prank(agentWallet);
        vm.expectRevert(NazvexVault.NotAgentWallet.selector);
        vault.cancelRequest(reqId);
        vm.prank(newWallet);
        vault.cancelRequest(reqId);
        assertEq(uint8(_status(reqId)), uint8(NazvexVault.RequestStatus.Cancelled));
    }

    function test_Cancel_NonPendingReverts() public {
        (uint256 execId,) = _req(id, recipient, 1e6);
        vm.prank(agentWallet);
        vm.expectRevert(NazvexVault.RequestNotPending.selector);
        vault.cancelRequest(execId);
    }

    function test_Cancel_OtherAgentsWalletCannot() public {
        uint256 reqId = _pending(9e6);
        vm.prank(owner2);
        vault.registerAgent("B", newWallet, _policy(), _recips());
        vm.prank(newWallet);
        vm.expectRevert(NazvexVault.NotAgentWallet.selector);
        vault.cancelRequest(reqId);
    }
}
