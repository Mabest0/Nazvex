// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {NexoraVaultTestBase} from "./NexoraVault.Base.t.sol";
import {NexoraVault} from "../NexoraVault.sol";

contract NexoraVaultFuzzTest is NexoraVaultTestBase {
    function _sumBalances(uint256 n) internal view returns (uint256 s) {
        for (uint256 i = 1; i <= n; ++i) s += vault.getAgent(i).balance;
    }

    function _assertConserved() internal view {
        assertEq(usdc.balanceOf(address(vault)), _sumBalances(vault.agentCount()));
    }

    /// PROPERTY: vault token balance == sum of agent balances after any mix of operations.
    function testFuzz_BalanceConservation(
        uint256[4] memory fundAmts,
        uint256[6] memory payAmts,
        uint8[6] memory targets,
        uint256 wd1,
        uint256 wd2
    ) public {
        uint256 id1 = _register();
        vm.prank(owner2);
        uint256 id2 = vault.registerAgent("B", newWallet, _policy(), _recips());

        vm.prank(owner);
        vault.fundAgent(id1, bound(fundAmts[0], 1, 4e11));
        vm.prank(owner2);
        vault.fundAgent(id2, bound(fundAmts[1], 1, 4e11));
        _assertConserved();
        vm.prank(owner);
        vault.fundAgent(id1, bound(fundAmts[2], 1, 4e11));
        vm.prank(owner2);
        vault.fundAgent(id2, bound(fundAmts[3], 1, 4e11));
        _assertConserved();

        for (uint256 i; i < 6; ++i) {
            uint256 amt = bound(payAmts[i], 1, 12e6);
            address to = targets[i] % 3 == 0 ? recipient2 : recipient; // recipient2 is unlisted
            bool first = targets[i] % 2 == 0;
            vm.prank(first ? agentWallet : newWallet);
            (uint256 reqId, NexoraVault.RequestStatus st) = vault.requestPayment(first ? id1 : id2, to, amt, "");
            if (st == NexoraVault.RequestStatus.Pending) {
                vm.prank(first ? owner : owner2);
                vault.approveRequest(reqId);
            }
            _assertConserved();
        }

        wd1 = bound(wd1, 0, vault.getAgent(id1).balance);
        wd2 = bound(wd2, 0, vault.getAgent(id2).balance);
        vm.prank(owner);
        vault.withdrawFromAgent(id1, wd1);
        vm.prank(owner2);
        vault.withdrawFromAgent(id2, wd2);
        _assertConserved();

        // accounting identity per agent: funded == balance + spent + withdrawn
        NexoraVault.AgentView memory a1 = vault.getAgent(id1);
        assertEq(a1.totalFunded, a1.balance + a1.totalSpent + wd1);
        NexoraVault.AgentView memory a2 = vault.getAgent(id2);
        assertEq(a2.totalFunded, a2.balance + a2.totalSpent + wd2);
        // recipients got exactly what the agents spent
        assertEq(usdc.balanceOf(recipient) + usdc.balanceOf(recipient2), a1.totalSpent + a2.totalSpent);
        assertEq(usdc.balanceOf(recipient2), 0); // unlisted recipient never paid
    }

    /// PROPERTY: payments executed within one UTC day never exceed dailyLimit.
    function testFuzz_DailyLimitNeverExceeded(uint256[8] memory amts, uint32[8] memory dts) public {
        uint256 id = _registerFunded(10_000e6);
        uint256 curDay = block.timestamp / 1 days;
        uint256 daySum;
        uint256 lastBal = usdc.balanceOf(recipient);

        for (uint256 i; i < 8; ++i) {
            vm.warp(block.timestamp + bound(dts[i], 0, 20 hours));
            uint256 day = block.timestamp / 1 days;
            if (day != curDay) {
                curDay = day;
                daySum = 0;
            }
            uint256 amt = bound(amts[i], 1, MAX_TX);
            (uint256 reqId, NexoraVault.RequestStatus st) = _req(id, recipient, amt);
            if (st == NexoraVault.RequestStatus.Pending) {
                vm.prank(owner);
                vault.approveRequest(reqId);
            }
            uint256 nowBal = usdc.balanceOf(recipient);
            daySum += nowBal - lastBal;
            lastBal = nowBal;

            assertLe(daySum, DAILY, "executed volume in UTC day exceeds limit");
            NexoraVault.AgentView memory a = vault.getAgent(id);
            assertLe(a.spentToday, DAILY);
            assertEq(a.spentToday, daySum);
            assertEq(a.remainingToday, DAILY - daySum);
        }
    }

    /// PROPERTY: previewPayment always predicts the outcome requestPayment records.
    function testFuzz_PreviewMatchesOutcome(uint256 amt, uint256 prefund, uint8 mode) public {
        uint256 id = _registerFunded(bound(prefund, 1, 30e6));
        amt = bound(amt, 1, 25e6);
        address to = mode % 4 == 0 ? recipient2 : recipient;
        if (mode % 5 == 0) {
            vm.prank(owner);
            vault.pauseAgent(id);
        }
        (NexoraVault.BlockReason reason, bool needs) = vault.previewPayment(id, to, amt);
        (uint256 reqId, NexoraVault.RequestStatus st) = _req(id, to, amt);
        if (reason != NexoraVault.BlockReason.None) {
            assertEq(uint8(st), uint8(NexoraVault.RequestStatus.Blocked));
            assertEq(uint8(_reason(reqId)), uint8(reason));
        } else if (needs) {
            assertEq(uint8(st), uint8(NexoraVault.RequestStatus.Pending));
        } else {
            assertEq(uint8(st), uint8(NexoraVault.RequestStatus.Executed));
        }
    }
}
