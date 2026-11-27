// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {NazvexVault} from "../NazvexVault.sol";

/// @dev Minimal 6-decimal ERC-20 used as USDC in tests.
contract MockUSDC {
    string public name = "Mock USDC";
    string public symbol = "mUSDC";
    uint8 public constant decimals = 6;
    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    function mint(address to, uint256 amount) external {
        totalSupply += amount;
        balanceOf[to] += amount;
        emit Transfer(address(0), to, amount);
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        _move(msg.sender, to, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 a = allowance[from][msg.sender];
        require(a >= amount, "allowance");
        if (a != type(uint256).max) allowance[from][msg.sender] = a - amount;
        _move(from, to, amount);
        return true;
    }

    function _move(address from, address to, uint256 amount) internal {
        require(balanceOf[from] >= amount, "balance");
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        emit Transfer(from, to, amount);
    }
}

abstract contract NazvexVaultTestBase is Test {
    NazvexVault internal vault;
    MockUSDC internal usdc;

    address internal owner = makeAddr("owner");
    address internal owner2 = makeAddr("owner2");
    address internal agentWallet = makeAddr("agentWallet");
    address internal newWallet = makeAddr("newWallet");
    address internal recipient = makeAddr("recipient");
    address internal recipient2 = makeAddr("recipient2");
    address internal stranger = makeAddr("stranger");

    uint256 internal constant U = 1e6;
    uint256 internal constant T0 = 1000 days + 12 hours; // midday UTC

    uint256 internal constant MAX_TX = 10e6;
    uint256 internal constant DAILY = 20e6;
    uint256 internal constant THRESHOLD = 8e6;

    function setUp() public virtual {
        vm.warp(T0);
        usdc = new MockUSDC();
        vault = new NazvexVault(address(usdc));
        usdc.mint(owner, 1_000_000e6);
        usdc.mint(owner2, 1_000_000e6);
        vm.prank(owner);
        usdc.approve(address(vault), type(uint256).max);
        vm.prank(owner2);
        usdc.approve(address(vault), type(uint256).max);
    }

    function _policy() internal pure returns (NazvexVault.Policy memory p) {
        p = NazvexVault.Policy({maxPerTx: MAX_TX, dailyLimit: DAILY, approvalThreshold: THRESHOLD, expiresAt: 0});
    }

    function _recips() internal view returns (address[] memory r) {
        r = new address[](1);
        r[0] = recipient;
    }

    function _register() internal returns (uint256 id) {
        vm.prank(owner);
        id = vault.registerAgent("Agent", agentWallet, _policy(), _recips());
    }

    function _registerFunded(uint256 amount) internal returns (uint256 id) {
        id = _register();
        vm.prank(owner);
        vault.fundAgent(id, amount);
    }

    function _req(uint256 id, address to, uint256 amount)
        internal
        returns (uint256 reqId, NazvexVault.RequestStatus st)
    {
        vm.prank(agentWallet);
        (reqId, st) = vault.requestPayment(id, to, amount, "purpose");
    }

    function _status(uint256 reqId) internal view returns (NazvexVault.RequestStatus) {
        return vault.getRequest(reqId).status;
    }

    function _reason(uint256 reqId) internal view returns (NazvexVault.BlockReason) {
        return vault.getRequest(reqId).reason;
    }
}
