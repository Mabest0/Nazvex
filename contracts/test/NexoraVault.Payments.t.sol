// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {NexoraVaultTestBase} from "./NexoraVault.Base.t.sol";
import {NexoraVault} from "../NexoraVault.sol";

contract NexoraVaultPaymentsTest is NexoraVaultTestBase {
    NexoraVault.RequestStatus internal constant EXECUTED = NexoraVault.RequestStatus.Executed;
    NexoraVault.RequestStatus internal constant BLOCKED = NexoraVault.RequestStatus.Blocked;
    NexoraVault.RequestStatus internal constant PENDING = NexoraVault.RequestStatus.Pending;

    /// @dev Make a request expected to be Blocked with `reason`; assert no funds moved and no revert.
    function _assertBlocked(uint256 id, address to, uint256 amt, NexoraVault.BlockReason reason)
        internal
        returns (uint256 reqId)
    {
        uint256 vaultBal = usdc.balanceOf(address(vault));
        uint256 toBal = usdc.balanceOf(to);
        NexoraVault.AgentView memory before_ = vault.getAgent(id);
        uint256 expectedId = vault.requestCount() + 1;

        vm.expectEmit(true, true, true, true, address(vault));
        emit NexoraVault.PaymentBlocked(expectedId, id, to, amt, reason);
        NexoraVault.RequestStatus st;
        (reqId, st) = _req(id, to, amt);

        assertEq(reqId, expectedId);
        assertEq(uint8(st), uint8(BLOCKED));
        NexoraVault.PaymentRequest memory r = vault.getRequest(reqId);
        assertEq(uint8(r.status), uint8(BLOCKED));
        assertEq(uint8(r.reason), uint8(reason));
        assertEq(r.resolvedAt, uint64(block.timestamp));
        assertEq(usdc.balanceOf(address(vault)), vaultBal);
        assertEq(usdc.balanceOf(to), toBal);
        NexoraVault.AgentView memory after_ = vault.getAgent(id);
        assertEq(after_.balance, before_.balance);
        assertEq(after_.totalSpent, before_.totalSpent);
        assertEq(after_.spentToday, before_.spentToday);
    }

    // ---------------------------------------------------------------- execute
    function test_Request_ExecutesImmediately() public {
        uint256 id = _registerFunded(100e6);
        vm.expectEmit(true, true, true, true, address(vault));
        emit NexoraVault.PaymentExecuted(1, id, recipient, 5e6);
        vm.prank(agentWallet);
        (uint256 reqId, NexoraVault.RequestStatus st) = vault.requestPayment(id, recipient, 5e6, "invoice");
        assertEq(reqId, 1);
        assertEq(uint8(st), uint8(EXECUTED));
        assertEq(usdc.balanceOf(recipient), 5e6);
        assertEq(usdc.balanceOf(address(vault)), 95e6);
        NexoraVault.AgentView memory a = vault.getAgent(id);
        assertEq(a.balance, 95e6);
        assertEq(a.totalSpent, 5e6);
        assertEq(a.totalFunded, 100e6);
        assertEq(a.spentToday, 5e6);
        assertEq(a.remainingToday, DAILY - 5e6);
        NexoraVault.PaymentRequest memory r = vault.getRequest(reqId);
        assertEq(r.id, 1);
        assertEq(r.agentId, id);
        assertEq(r.to, recipient);
        assertEq(r.amount, 5e6);
        assertEq(r.purpose, "invoice");
        assertEq(uint8(r.status), uint8(EXECUTED));
        assertEq(uint8(r.reason), 0);
        assertEq(r.createdAt, uint64(T0));
        assertEq(r.resolvedAt, uint64(T0));
    }

    function test_Request_AtThresholdAndMaxBoundaries() public {
        uint256 id = _registerFunded(100e6);
        (, NexoraVault.RequestStatus st) = _req(id, recipient, THRESHOLD); // == threshold executes
        assertEq(uint8(st), uint8(EXECUTED));
        // tighten so max == threshold == 10 (pending never possible), pay == max
        (, st) = _req(id, recipient, THRESHOLD + 1); // 9 > threshold -> pending
        assertEq(uint8(st), uint8(PENDING));
    }

    function test_Request_InputReverts() public {
        uint256 id = _registerFunded(100e6);
        vm.prank(stranger);
        vm.expectRevert(NexoraVault.NotAgentWallet.selector);
        vault.requestPayment(id, recipient, 1e6, "");
        vm.prank(owner);
        vm.expectRevert(NexoraVault.NotAgentWallet.selector);
        vault.requestPayment(id, recipient, 1e6, "");
        vm.startPrank(agentWallet);
        vm.expectRevert(NexoraVault.InvalidAmount.selector);
        vault.requestPayment(id, recipient, 0, "");
        vm.expectRevert(NexoraVault.ZeroAddress.selector);
        vault.requestPayment(id, address(0), 1e6, "");
        vm.expectRevert(NexoraVault.UnknownAgent.selector);
        vault.requestPayment(7, recipient, 1e6, "");
        vm.expectRevert(NexoraVault.PurposeTooLong.selector);
        vault.requestPayment(id, recipient, 1e6, string(new bytes(141)));
        vm.stopPrank();
        assertEq(vault.requestCount(), 0); // invalid inputs are not recorded
    }

    function test_Request_PurposeAtLimitOk() public {
        uint256 id = _registerFunded(100e6);
        bytes memory p = new bytes(140);
        for (uint256 i; i < 140; ++i) p[i] = "p";
        vm.prank(agentWallet);
        (, NexoraVault.RequestStatus st) = vault.requestPayment(id, recipient, 1e6, string(p));
        assertEq(uint8(st), uint8(EXECUTED));
    }

    function test_Request_OtherAgentsWalletCannotRequest() public {
        uint256 id = _registerFunded(100e6);
        vm.prank(owner2);
        vault.registerAgent("B", newWallet, _policy(), _recips());
        vm.prank(newWallet);
        vm.expectRevert(NexoraVault.NotAgentWallet.selector);
        vault.requestPayment(id, recipient, 1e6, "");
    }

    // ---------------------------------------------------------------- each BlockReason
    function test_Block_AgentPaused() public {
        uint256 id = _registerFunded(100e6);
        vm.prank(owner);
        vault.pauseAgent(id);
        _assertBlocked(id, recipient, 1e6, NexoraVault.BlockReason.AgentNotActive);
    }

    function test_Block_AgentRevoked() public {
        uint256 id = _registerFunded(100e6);
        vm.prank(owner);
        vault.revokeAgent(id);
        _assertBlocked(id, recipient, 1e6, NexoraVault.BlockReason.AgentNotActive);
    }

    function test_Block_BudgetExpired() public {
        vm.prank(owner);
        uint256 id =
            vault.registerAgent("A", agentWallet, NexoraVault.Policy(MAX_TX, DAILY, THRESHOLD, uint64(T0 + 1 hours)), _recips());
        vm.prank(owner);
        vault.fundAgent(id, 100e6);
        (, NexoraVault.RequestStatus st) = _req(id, recipient, 1e6); // before expiry executes
        assertEq(uint8(st), uint8(EXECUTED));
        vm.warp(T0 + 1 hours - 1);
        (, st) = _req(id, recipient, 1e6);
        assertEq(uint8(st), uint8(EXECUTED));
        vm.warp(T0 + 1 hours); // exactly at expiry -> expired
        _assertBlocked(id, recipient, 1e6, NexoraVault.BlockReason.BudgetExpired);
    }

    function test_Block_ExceedsPerTx() public {
        uint256 id = _registerFunded(100e6);
        _assertBlocked(id, recipient, MAX_TX + 1, NexoraVault.BlockReason.ExceedsPerTxLimit);
    }

    function test_Block_ExceedsDaily() public {
        uint256 id = _registerFunded(100e6);
        _req(id, recipient, 7e6);
        _req(id, recipient, 7e6);
        _assertBlocked(id, recipient, 7e6, NexoraVault.BlockReason.ExceedsDailyLimit);
        // exact fill is allowed
        (, NexoraVault.RequestStatus st) = _req(id, recipient, 6e6);
        assertEq(uint8(st), uint8(EXECUTED));
        assertEq(vault.getAgent(id).remainingToday, 0);
        _assertBlocked(id, recipient, 1, NexoraVault.BlockReason.ExceedsDailyLimit);
    }

    function test_Block_RecipientNotAllowed() public {
        uint256 id = _registerFunded(100e6);
        _assertBlocked(id, recipient2, 1e6, NexoraVault.BlockReason.RecipientNotAllowed);
    }

    function test_Block_RemovedRecipient() public {
        uint256 id = _registerFunded(100e6);
        vm.prank(owner);
        vault.removeRecipient(id, recipient);
        _assertBlocked(id, recipient, 1e6, NexoraVault.BlockReason.RecipientNotAllowed);
    }

    function test_Block_InsufficientBalance() public {
        uint256 id = _registerFunded(3e6);
        _assertBlocked(id, recipient, 5e6, NexoraVault.BlockReason.InsufficientBalance);
        // balance exactly equal succeeds
        (, NexoraVault.RequestStatus st) = _req(id, recipient, 3e6);
        assertEq(uint8(st), uint8(EXECUTED));
        assertEq(vault.getAgent(id).balance, 0);
    }

    function test_Block_PrecedenceOrder() public {
        // inactive > perTx > recipient > balance
        uint256 id = _register(); // unfunded
        _assertBlocked(id, recipient2, MAX_TX + 1, NexoraVault.BlockReason.ExceedsPerTxLimit);
        _assertBlocked(id, recipient2, 1e6, NexoraVault.BlockReason.RecipientNotAllowed);
        _assertBlocked(id, recipient, 1e6, NexoraVault.BlockReason.InsufficientBalance);
        vm.prank(owner);
        vault.pauseAgent(id);
        _assertBlocked(id, recipient2, MAX_TX + 1, NexoraVault.BlockReason.AgentNotActive);
    }

    function test_Block_ReducedDailyLimitBelowSpent() public {
        uint256 id = _registerFunded(100e6);
        _req(id, recipient, 7e6);
        _req(id, recipient, 7e6); // spent 14
        vm.prank(owner);
        vault.setPolicy(id, NexoraVault.Policy(10e6, 10e6, 8e6, 0)); // daily 10 < spent 14
        assertEq(vault.getAgent(id).remainingToday, 0);
        _assertBlocked(id, recipient, 1, NexoraVault.BlockReason.ExceedsDailyLimit);
    }

    function test_Block_DoesNotCountTowardsDailyOrCreateFunds() public {
        uint256 id = _registerFunded(100e6);
        _assertBlocked(id, recipient2, 5e6, NexoraVault.BlockReason.RecipientNotAllowed);
        assertEq(vault.getAgent(id).spentToday, 0);
        assertEq(vault.getAgent(id).totalSpent, 0);
    }

    // ---------------------------------------------------------------- daily rollover
    function test_Daily_RolloverAtUtcMidnight() public {
        uint256 id = _registerFunded(200e6);
        _req(id, recipient, 7e6);
        _req(id, recipient, 7e6);
        _req(id, recipient, 6e6); // 20 == limit
        uint256 nextDay = (block.timestamp / 1 days + 1) * 1 days;
        vm.warp(nextDay - 1);
        _assertBlocked(id, recipient, 1e6, NexoraVault.BlockReason.ExceedsDailyLimit);
        assertEq(vault.getAgent(id).spentToday, 20e6);

        vm.warp(nextDay);
        NexoraVault.AgentView memory a = vault.getAgent(id);
        assertEq(a.spentToday, 0); // view reflects new day lazily
        assertEq(a.remainingToday, DAILY);
        (, NexoraVault.RequestStatus st) = _req(id, recipient, 7e6);
        assertEq(uint8(st), uint8(EXECUTED));
        assertEq(vault.getAgent(id).spentToday, 7e6);
        assertEq(vault.getAgent(id).totalSpent, 27e6);
    }

    function test_Daily_NotARollingWindow() public {
        // fixed UTC buckets: spending late in the day, then early next day is fine
        uint256 id = _registerFunded(200e6);
        vm.warp((T0 / 1 days) * 1 days + 1 days - 10);
        _req(id, recipient, 7e6);
        _req(id, recipient, 7e6);
        _req(id, recipient, 6e6);
        vm.warp(block.timestamp + 20); // 10 seconds into next day
        (, NexoraVault.RequestStatus st) = _req(id, recipient, 7e6);
        assertEq(uint8(st), uint8(EXECUTED));
    }

    function test_Daily_MultipleDaysSkipped() public {
        uint256 id = _registerFunded(200e6);
        _req(id, recipient, 7e6);
        vm.warp(T0 + 10 days);
        assertEq(vault.getAgent(id).spentToday, 0);
        (, NexoraVault.RequestStatus st) = _req(id, recipient, 7e6);
        assertEq(uint8(st), uint8(EXECUTED));
        assertEq(vault.getAgent(id).spentToday, 7e6);
    }

    // ---------------------------------------------------------------- previewPayment
    function _assertPreviewMatches(uint256 id, address to, uint256 amt) internal {
        (NexoraVault.BlockReason reason, bool needsApproval) = vault.previewPayment(id, to, amt);
        (uint256 reqId, NexoraVault.RequestStatus st) = _req(id, to, amt);
        if (reason != NexoraVault.BlockReason.None) {
            assertEq(uint8(st), uint8(BLOCKED));
            assertEq(uint8(_reason(reqId)), uint8(reason));
            assertFalse(needsApproval);
        } else if (needsApproval) {
            assertEq(uint8(st), uint8(PENDING));
        } else {
            assertEq(uint8(st), uint8(EXECUTED));
        }
    }

    function test_Preview_MatchesActualOutcome() public {
        uint256 id = _registerFunded(40e6);
        _assertPreviewMatches(id, recipient, 5e6); // executed
        _assertPreviewMatches(id, recipient, 9e6); // pending
        _assertPreviewMatches(id, recipient, 15e6); // per-tx
        _assertPreviewMatches(id, recipient2, 1e6); // recipient
        _assertPreviewMatches(id, recipient, 8e6); // executed (13 spent)
        _assertPreviewMatches(id, recipient, 8e6); // 21 > 20 daily
        _assertPreviewMatches(id, recipient, 10e6); // daily
        vm.prank(owner);
        vault.withdrawFromAgent(id, 40e6 - 13e6);
        _assertPreviewMatches(id, recipient, 1e6); // insufficient
        vm.prank(owner);
        vault.pauseAgent(id);
        _assertPreviewMatches(id, recipient, 1e6); // not active
    }

    function test_Preview_ReportsEachState() public {
        uint256 id = _registerFunded(100e6);
        (NexoraVault.BlockReason r, bool n) = vault.previewPayment(id, recipient, 5e6);
        assertEq(uint8(r), 0);
        assertFalse(n);
        (r, n) = vault.previewPayment(id, recipient, 9e6);
        assertEq(uint8(r), 0);
        assertTrue(n);
        (r, n) = vault.previewPayment(id, recipient, 11e6);
        assertEq(uint8(r), uint8(NexoraVault.BlockReason.ExceedsPerTxLimit));
        assertFalse(n);
        // preview does not change state
        assertEq(vault.requestCount(), 0);
    }

    // ---------------------------------------------------------------- views
    function test_AgentRequestIds_InOrderPerAgent() public {
        uint256 a = _registerFunded(100e6);
        vm.prank(owner2);
        uint256 b = vault.registerAgent("B", newWallet, _policy(), _recips());
        _req(a, recipient, 1e6); // 1
        vm.prank(newWallet);
        vault.requestPayment(b, recipient, 1e6, ""); // 2 (blocked: no balance)
        _req(a, recipient2, 1e6); // 3 blocked
        _req(a, recipient, 9e6); // 4 pending
        uint256[] memory ia = vault.getAgentRequestIds(a);
        assertEq(ia.length, 3);
        assertEq(ia[0], 1);
        assertEq(ia[1], 3);
        assertEq(ia[2], 4);
        uint256[] memory ib = vault.getAgentRequestIds(b);
        assertEq(ib.length, 1);
        assertEq(ib[0], 2);
        assertEq(vault.requestCount(), 4);
    }

    function test_GetRecipients_ReflectsAddRemove() public {
        uint256 id = _register();
        vm.startPrank(owner);
        vault.addRecipient(id, recipient2);
        vault.removeRecipient(id, recipient);
        vm.stopPrank();
        address[] memory r = vault.getRecipients(id);
        assertEq(r.length, 1);
        assertEq(r[0], recipient2);
        assertFalse(vault.isRecipientAllowed(id, recipient));
    }

    // ---------------------------------------------------------------- demo scenarios
    function test_Demo_5UsdcWithinLimitsExecutes() public {
        uint256 id = _registerFunded(100e6);
        (, NexoraVault.RequestStatus st) = _req(id, recipient, 5 * U);
        assertEq(uint8(st), uint8(EXECUTED));
        assertEq(usdc.balanceOf(recipient), 5 * U);
    }

    function test_Demo_15UsdcWithMax10Blocked() public {
        uint256 id = _registerFunded(100e6);
        _assertBlocked(id, recipient, 15 * U, NexoraVault.BlockReason.ExceedsPerTxLimit);
    }

    function test_Demo_UnlistedRecipientBlocked() public {
        uint256 id = _registerFunded(100e6);
        _assertBlocked(id, stranger, 5 * U, NexoraVault.BlockReason.RecipientNotAllowed);
    }

    function test_Demo_AboveThresholdStaysPending() public {
        uint256 id = _registerFunded(100e6);
        (uint256 reqId, NexoraVault.RequestStatus st) = _req(id, recipient, 9 * U);
        assertEq(uint8(st), uint8(PENDING));
        assertEq(usdc.balanceOf(recipient), 0);
        assertEq(vault.getAgent(id).balance, 100e6);
        assertEq(uint8(_status(reqId)), uint8(PENDING));
    }

    function test_Demo_RevokedAgentBlocked() public {
        uint256 id = _registerFunded(100e6);
        vm.prank(owner);
        vault.revokeAgent(id);
        _assertBlocked(id, recipient, 5 * U, NexoraVault.BlockReason.AgentNotActive);
    }

    function test_Demo_InsufficientBalanceNoFalseSuccess() public {
        uint256 id = _registerFunded(2 * U);
        uint256 reqId = _assertBlocked(id, recipient, 5 * U, NexoraVault.BlockReason.InsufficientBalance);
        assertTrue(_status(reqId) != EXECUTED);
        assertEq(usdc.balanceOf(recipient), 0);
        assertEq(vault.getAgent(id).balance, 2 * U);
    }
}
