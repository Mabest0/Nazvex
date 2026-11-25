// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {NexoraVaultTestBase, MockUSDC} from "./NexoraVault.Base.t.sol";
import {NexoraVault} from "../NexoraVault.sol";

/// @dev Drives bounded random actions. The handler is both owner and agent wallet of two agents.
contract NexoraVaultHandler is Test {
    NexoraVault public vault;
    MockUSDC public usdc;
    address public r1 = address(0xA11CE);
    address public r2 = address(0xB0B);
    address public unlisted = address(0xBAD);

    uint256 public constant DAILY = 20e6;
    uint256 public ghostFunded;
    uint256 public ghostWithdrawn;
    uint256 public ghostPaid; // sum of all executed payments seen by recipients
    mapping(uint256 => mapping(uint256 => uint256)) public executedOnDay; // agent => day => amount
    uint256[] public touchedDays;
    uint256[] public pendingIds;

    constructor(NexoraVault v, MockUSDC u) {
        vault = v;
        usdc = u;
        usdc.mint(address(this), type(uint128).max);
        usdc.approve(address(v), type(uint256).max);
        address[] memory rs = new address[](2);
        rs[0] = r1;
        rs[1] = r2;
        NexoraVault.Policy memory p = NexoraVault.Policy(10e6, DAILY, 8e6, 0);
        v.registerAgent("A", address(this), p, rs);
        v.registerAgent("B", address(this), p, rs);
    }

    function _agent(uint256 seed) internal pure returns (uint256) {
        return (seed % 2) + 1;
    }

    function fund(uint256 seed, uint256 amt) external {
        amt = bound(amt, 1, 100e6);
        vault.fundAgent(_agent(seed), amt);
        ghostFunded += amt;
    }

    function withdraw(uint256 seed, uint256 amt) external {
        uint256 id = _agent(seed);
        amt = bound(amt, 0, vault.getAgent(id).balance);
        vault.withdrawFromAgent(id, amt);
        ghostWithdrawn += amt;
    }

    function request(uint256 seed, uint256 amt, uint256 toSeed) external {
        uint256 id = _agent(seed);
        amt = bound(amt, 1, 15e6);
        address to = toSeed % 3 == 0 ? r1 : toSeed % 3 == 1 ? r2 : unlisted;
        (uint256 reqId, NexoraVault.RequestStatus st) = vault.requestPayment(id, to, amt, "");
        if (st == NexoraVault.RequestStatus.Executed) _record(id, amt);
        else if (st == NexoraVault.RequestStatus.Pending) pendingIds.push(reqId);
    }

    function approve(uint256 idx) external {
        if (pendingIds.length == 0) return;
        uint256 reqId = pendingIds[idx % pendingIds.length];
        NexoraVault.PaymentRequest memory r = vault.getRequest(reqId);
        if (r.status != NexoraVault.RequestStatus.Pending || block.timestamp >= r.expiresAt) return;
        vault.approveRequest(reqId);
        if (vault.getRequest(reqId).status == NexoraVault.RequestStatus.Executed) _record(r.agentId, r.amount);
    }

    function decline(uint256 idx) external {
        if (pendingIds.length == 0) return;
        uint256 reqId = pendingIds[idx % pendingIds.length];
        if (vault.getRequest(reqId).status != NexoraVault.RequestStatus.Pending) return;
        vault.declineRequest(reqId);
    }

    function toggle(uint256 seed, bool pause) external {
        uint256 id = _agent(seed);
        NexoraVault.AgentStatus s = vault.getAgent(id).status;
        if (pause && s == NexoraVault.AgentStatus.Active) vault.pauseAgent(id);
        else if (!pause && s == NexoraVault.AgentStatus.Paused) vault.resumeAgent(id);
    }

    function warp(uint256 dt) external {
        vm.warp(block.timestamp + bound(dt, 0, 18 hours));
    }

    function _record(uint256 id, uint256 amt) internal {
        uint256 day = block.timestamp / 1 days;
        executedOnDay[id][day] += amt;
        ghostPaid += amt;
        touchedDays.push(day);
    }

    function touchedLength() external view returns (uint256) {
        return touchedDays.length;
    }
}

contract NexoraVaultInvariantTest is NexoraVaultTestBase {
    NexoraVaultHandler internal handler;

    function setUp() public override {
        super.setUp();
        handler = new NexoraVaultHandler(vault, usdc);
        targetContract(address(handler));
    }

    /// vault token balance == sum of agent balances
    function invariant_VaultBalanceEqualsSumOfAgentBalances() public view {
        uint256 sum = vault.getAgent(1).balance + vault.getAgent(2).balance;
        assertEq(usdc.balanceOf(address(vault)), sum);
    }

    /// funded - withdrawn - paid == custody balance
    function invariant_FundsAccounting() public view {
        assertEq(handler.ghostFunded() - handler.ghostWithdrawn() - handler.ghostPaid(), usdc.balanceOf(address(vault)));
        assertEq(
            usdc.balanceOf(handler.r1()) + usdc.balanceOf(handler.r2()), handler.ghostPaid(), "paid only to recipients"
        );
        assertEq(usdc.balanceOf(handler.unlisted()), 0);
    }

    /// no agent ever executed more than the daily limit on any UTC day
    function invariant_DailyLimitNeverExceeded() public view {
        uint256 n = handler.touchedLength();
        for (uint256 i; i < n; ++i) {
            uint256 day = handler.touchedDays(i);
            assertLe(handler.executedOnDay(1, day), handler.DAILY());
            assertLe(handler.executedOnDay(2, day), handler.DAILY());
        }
        assertLe(vault.getAgent(1).spentToday, handler.DAILY());
        assertLe(vault.getAgent(2).spentToday, handler.DAILY());
    }

    /// totals agree per agent: totalFunded == balance + totalSpent + withdrawn
    function invariant_PerAgentTotals() public view {
        NexoraVault.AgentView memory a = vault.getAgent(1);
        NexoraVault.AgentView memory b = vault.getAgent(2);
        assertEq(a.totalFunded + b.totalFunded, handler.ghostFunded());
        assertEq(a.totalSpent + b.totalSpent, handler.ghostPaid());
    }
}
