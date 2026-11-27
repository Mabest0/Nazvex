// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {EnumerableSet} from "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";

/**
 * @title NazvexVault
 * @notice Multi-tenant USDC custody and contract-enforced spending policies for AI agents.
 * @dev No global admin, upgrade mechanism, or privileged backend exists. AI/backend software
 * cannot move custody funds directly: its designated agent wallet can only request payments
 * through the contract-enforced policy path. Owners can always withdraw their agent's balance,
 * even when paused, revoked, or expired. Owners control only their own agents. Wallet keys may
 * be shared, but balances and policies are isolated by agent ID. Amounts are raw 6-decimal USDC.
 * Intended Arc Testnet token: 0x3600000000000000000000000000000000000000, supplied at deployment.
 * Direct token transfers do not credit any agent. Only fundAgent credits custody balances.
 */
contract NazvexVault is ReentrancyGuard {
    using SafeERC20 for IERC20;
    using EnumerableSet for EnumerableSet.AddressSet;

    enum AgentStatus { Active, Paused, Revoked }
    enum RequestStatus { Pending, Executed, Blocked, Declined, Cancelled }
    enum BlockReason {
        None,
        AgentNotActive,
        BudgetExpired,
        ExceedsPerTxLimit,
        ExceedsDailyLimit,
        RecipientNotAllowed,
        InsufficientBalance
    }

    struct Policy {
        uint256 maxPerTx;
        uint256 dailyLimit;
        uint256 approvalThreshold;
        uint64 expiresAt;
    }

    struct AgentView {
        uint256 id;
        address owner;
        address wallet;
        string name;
        AgentStatus status;
        uint256 balance;
        uint256 totalFunded;
        uint256 totalSpent;
        uint256 spentToday;
        uint256 remainingToday;
        uint64 createdAt;
        Policy policy;
    }

    struct PaymentRequest {
        uint256 id;
        uint256 agentId;
        address to;
        uint256 amount;
        string purpose;
        RequestStatus status;
        BlockReason reason;
        uint64 createdAt;
        uint64 resolvedAt;
        uint64 expiresAt;
    }

    struct Agent {
        address owner;
        address wallet;
        string name;
        AgentStatus status;
        uint256 balance;
        uint256 totalFunded;
        uint256 totalSpent;
        uint256 spendDay;
        uint256 spentToday;
        uint64 createdAt;
        Policy policy;
    }

    uint256 public constant APPROVAL_TTL = 2 days;
    uint256 public constant MAX_RECIPIENTS = 50;
    uint256 public constant MAX_PURPOSE_BYTES = 140;
    uint256 public constant MAX_NAME_BYTES = 48;

    /// @notice The deployment-selected USDC ERC-20; amounts use its raw 6-decimal units.
    IERC20 public immutable usdc;

    uint256 private _agentCount;
    uint256 private _requestCount;
    mapping(uint256 => Agent) private _agents;
    mapping(uint256 => PaymentRequest) private _requests;
    mapping(uint256 => EnumerableSet.AddressSet) private _recipients;
    mapping(address => uint256[]) private _ownerAgentIds;
    mapping(uint256 => uint256[]) private _agentRequestIds;

    error ZeroAddress();
    error UnknownAgent();
    error UnknownRequest();
    error NotAgentOwner();
    error NotAgentWallet();
    error AgentRevoked();
    error InvalidName();
    error InvalidPolicy();
    error InvalidRecipient();
    error TooManyRecipients();
    error RecipientUnchanged();
    error InvalidAmount();
    error PurposeTooLong();
    error InsufficientBalance();
    error UnexpectedTokenAmount();
    error InvalidAgentStatus();
    error RequestNotPending();
    error ApprovalExpired();

    event AgentRegistered(uint256 indexed agentId, address indexed owner, address wallet, string name);
    event AgentFunded(uint256 indexed agentId, address indexed owner, uint256 amount);
    event AgentWithdrawn(uint256 indexed agentId, address indexed owner, uint256 amount);
    event PolicyUpdated(uint256 indexed agentId, uint256 maxPerTx, uint256 dailyLimit, uint256 approvalThreshold, uint64 expiresAt);
    event RecipientUpdated(uint256 indexed agentId, address indexed recipient, bool allowed);
    event AgentWalletUpdated(uint256 indexed agentId, address wallet);
    event AgentStatusChanged(uint256 indexed agentId, AgentStatus status);
    event PaymentRequested(uint256 indexed requestId, uint256 indexed agentId, address indexed to, uint256 amount, string purpose, uint64 expiresAt);
    event PaymentExecuted(uint256 indexed requestId, uint256 indexed agentId, address indexed to, uint256 amount);
    event PaymentBlocked(uint256 indexed requestId, uint256 indexed agentId, address indexed to, uint256 amount, BlockReason reason);
    event PaymentDeclined(uint256 indexed requestId, uint256 indexed agentId);
    event PaymentCancelled(uint256 indexed requestId, uint256 indexed agentId);

    /// @notice Configure the immutable USDC token without assigning any global authority.
    /// @param usdc_ USDC token address (Arc Testnet: 0x3600000000000000000000000000000000000000).
    constructor(address usdc_) {
        if (usdc_ == address(0)) revert ZeroAddress();
        usdc = IERC20(usdc_);
    }

    /// @notice Register a new isolated agent owned by the caller; IDs start at one.
    /// @dev Duplicate initial recipients revert, as with addRecipient.
    function registerAgent(
        string calldata name,
        address wallet,
        Policy calldata policy,
        address[] calldata recipients
    ) external nonReentrant returns (uint256 agentId) {
        if (bytes(name).length == 0 || bytes(name).length > MAX_NAME_BYTES) revert InvalidName();
        if (wallet == address(0)) revert ZeroAddress();
        _validatePolicy(policy);
        if (recipients.length > MAX_RECIPIENTS) revert TooManyRecipients();

        agentId = ++_agentCount;
        Agent storage agent = _agents[agentId];
        agent.owner = msg.sender;
        agent.wallet = wallet;
        agent.name = name;
        agent.status = AgentStatus.Active;
        agent.createdAt = uint64(block.timestamp);
        agent.policy = policy;
        _ownerAgentIds[msg.sender].push(agentId);
        emit AgentRegistered(agentId, msg.sender, wallet, name);
        for (uint256 i; i < recipients.length; ++i) {
            _validateRecipient(recipients[i]);
            if (!_recipients[agentId].add(recipients[i])) revert RecipientUnchanged();
            emit RecipientUpdated(agentId, recipients[i], true);
        }
    }

    /// @notice Fund a non-revoked agent from its owner, requiring the exact token amount received.
    function fundAgent(uint256 agentId, uint256 amount) external nonReentrant {
        Agent storage agent = _ownedAgent(agentId);
        _requireNotRevoked(agent);
        if (amount == 0) revert InvalidAmount();
        uint256 beforeBalance = usdc.balanceOf(address(this));
        usdc.safeTransferFrom(msg.sender, address(this), amount);
        uint256 afterBalance = usdc.balanceOf(address(this));
        if (afterBalance < beforeBalance || afterBalance - beforeBalance != amount) {
            revert UnexpectedTokenAmount();
        }
        agent.balance += amount;
        agent.totalFunded += amount;
        emit AgentFunded(agentId, msg.sender, amount);
    }

    /// @notice Withdraw an owner's funds in any agent status, regardless of policy expiration.
    function withdrawFromAgent(uint256 agentId, uint256 amount) external nonReentrant {
        Agent storage agent = _ownedAgent(agentId);
        if (amount > agent.balance) revert InsufficientBalance();
        agent.balance -= amount;
        emit AgentWithdrawn(agentId, agent.owner, amount);
        usdc.safeTransfer(agent.owner, amount);
    }

    /// @notice Replace a non-revoked agent's policy without resetting its daily spending.
    function setPolicy(uint256 agentId, Policy calldata policy) external nonReentrant {
        Agent storage agent = _ownedAgent(agentId);
        _requireNotRevoked(agent);
        _validatePolicy(policy);
        agent.policy = policy;
        emit PolicyUpdated(agentId, policy.maxPerTx, policy.dailyLimit, policy.approvalThreshold, policy.expiresAt);
    }

    /// @notice Add an allowed recipient to a non-revoked agent, subject to the recipient cap.
    function addRecipient(uint256 agentId, address recipient) external nonReentrant {
        Agent storage agent = _ownedAgent(agentId);
        _requireNotRevoked(agent);
        _validateRecipient(recipient);
        if (_recipients[agentId].contains(recipient)) revert RecipientUnchanged();
        if (_recipients[agentId].length() >= MAX_RECIPIENTS) revert TooManyRecipients();
        _recipients[agentId].add(recipient);
        emit RecipientUpdated(agentId, recipient, true);
    }

    /// @notice Remove an existing allowed recipient from a non-revoked agent.
    function removeRecipient(uint256 agentId, address recipient) external nonReentrant {
        Agent storage agent = _ownedAgent(agentId);
        _requireNotRevoked(agent);
        _validateRecipient(recipient);
        if (!_recipients[agentId].remove(recipient)) revert RecipientUnchanged();
        emit RecipientUpdated(agentId, recipient, false);
    }

    /// @notice Rotate a non-revoked agent's payment-request and cancellation wallet.
    function setAgentWallet(uint256 agentId, address wallet) external nonReentrant {
        Agent storage agent = _ownedAgent(agentId);
        _requireNotRevoked(agent);
        if (wallet == address(0)) revert ZeroAddress();
        agent.wallet = wallet;
        emit AgentWalletUpdated(agentId, wallet);
    }

    /// @notice Pause an Active agent; ownership withdrawals remain available.
    function pauseAgent(uint256 agentId) external nonReentrant {
        Agent storage agent = _ownedAgent(agentId);
        if (agent.status != AgentStatus.Active) revert InvalidAgentStatus();
        agent.status = AgentStatus.Paused;
        emit AgentStatusChanged(agentId, AgentStatus.Paused);
    }

    /// @notice Resume a Paused agent; a Revoked agent can never be resumed.
    function resumeAgent(uint256 agentId) external nonReentrant {
        Agent storage agent = _ownedAgent(agentId);
        if (agent.status != AgentStatus.Paused) revert InvalidAgentStatus();
        agent.status = AgentStatus.Active;
        emit AgentStatusChanged(agentId, AgentStatus.Active);
    }

    /// @notice Permanently revoke an Active or Paused agent without preventing withdrawals.
    function revokeAgent(uint256 agentId) external nonReentrant {
        Agent storage agent = _ownedAgent(agentId);
        _requireNotRevoked(agent);
        agent.status = AgentStatus.Revoked;
        emit AgentStatusChanged(agentId, AgentStatus.Revoked);
    }

    /// @notice Record a wallet payment attempt, blocking, queuing, or executing under current policy.
    /// @dev Pending requests reserve no balance or daily budget. Invalid inputs revert before recording.
    function requestPayment(uint256 agentId, address to, uint256 amount, string calldata purpose)
        external nonReentrant returns (uint256 requestId, RequestStatus status)
    {
        Agent storage agent = _getAgent(agentId);
        if (msg.sender != agent.wallet) revert NotAgentWallet();
        if (amount == 0) revert InvalidAmount();
        if (bytes(purpose).length > MAX_PURPOSE_BYTES) revert PurposeTooLong();
        if (to == address(0)) revert ZeroAddress();

        requestId = ++_requestCount;
        PaymentRequest storage request = _requests[requestId];
        request.id = requestId;
        request.agentId = agentId;
        request.to = to;
        request.amount = amount;
        request.purpose = purpose;
        request.createdAt = uint64(block.timestamp);
        _agentRequestIds[agentId].push(requestId);

        BlockReason reason = _checkPolicy(agentId, agent, to, amount);
        if (reason != BlockReason.None) {
            _blockRequest(request, reason);
        } else if (amount > agent.policy.approvalThreshold) {
            request.status = RequestStatus.Pending;
            request.expiresAt = uint64(block.timestamp + APPROVAL_TTL);
            emit PaymentRequested(requestId, agentId, to, amount, purpose, request.expiresAt);
        } else {
            _executeRequest(agent, request);
        }
        return (requestId, request.status);
    }

    /// @notice Approve an unexpired pending request, rechecking all hard policy limits before transfer.
    /// @dev Approval expires exactly at expiresAt; a policy rejection is recorded rather than reverted.
    function approveRequest(uint256 requestId) external nonReentrant {
        PaymentRequest storage request = _getRequest(requestId);
        Agent storage agent = _ownedAgent(request.agentId);
        _requirePending(request);
        if (block.timestamp >= request.expiresAt) revert ApprovalExpired();
        BlockReason reason = _checkPolicy(request.agentId, agent, request.to, request.amount);
        if (reason != BlockReason.None) {
            _blockRequest(request, reason);
            return;
        }
        _executeRequest(agent, request);
    }

    /// @notice Decline a pending request as its agent owner, including after its approval deadline.
    function declineRequest(uint256 requestId) external nonReentrant {
        PaymentRequest storage request = _getRequest(requestId);
        _ownedAgent(request.agentId);
        _requirePending(request);
        request.status = RequestStatus.Declined;
        request.resolvedAt = uint64(block.timestamp);
        emit PaymentDeclined(requestId, request.agentId);
    }

    /// @notice Cancel a pending request as the agent's current wallet, including after key rotation.
    function cancelRequest(uint256 requestId) external nonReentrant {
        PaymentRequest storage request = _getRequest(requestId);
        Agent storage agent = _getAgent(request.agentId);
        if (msg.sender != agent.wallet) revert NotAgentWallet();
        _requirePending(request);
        request.status = RequestStatus.Cancelled;
        request.resolvedAt = uint64(block.timestamp);
        emit PaymentCancelled(requestId, request.agentId);
    }

    /// @notice Return the number of registered agents.
    function agentCount() external view returns (uint256) {
        return _agentCount;
    }

    /// @notice Return the number of recorded payment attempts across all agents.
    function requestCount() external view returns (uint256) {
        return _requestCount;
    }

    /// @notice Return an agent with effective current-UTC-day spending and floored remaining budget.
    function getAgent(uint256 id) external view returns (AgentView memory result) {
        Agent storage agent = _getAgent(id);
        uint256 spent = _effectiveSpent(agent);
        result.id = id;
        result.owner = agent.owner;
        result.wallet = agent.wallet;
        result.name = agent.name;
        result.status = agent.status;
        result.balance = agent.balance;
        result.totalFunded = agent.totalFunded;
        result.totalSpent = agent.totalSpent;
        result.spentToday = spent;
        result.remainingToday = spent >= agent.policy.dailyLimit ? 0 : agent.policy.dailyLimit - spent;
        result.createdAt = agent.createdAt;
        result.policy = agent.policy;
    }

    /// @notice Return a recorded payment request; unknown IDs revert.
    function getRequest(uint256 id) external view returns (PaymentRequest memory) {
        return _getRequest(id);
    }

    /// @notice Return the agent's allowed recipient set in unspecified order.
    function getRecipients(uint256 agentId) external view returns (address[] memory) {
        _getAgent(agentId);
        return _recipients[agentId].values();
    }

    /// @notice Check membership in a known agent's recipient allowlist.
    function isRecipientAllowed(uint256 agentId, address addr) external view returns (bool) {
        _getAgent(agentId);
        return _recipients[agentId].contains(addr);
    }

    /// @notice Return all agent IDs registered by an owner, in registration order.
    function getOwnerAgentIds(address owner) external view returns (uint256[] memory) {
        return _ownerAgentIds[owner];
    }

    /// @notice Return all recorded payment request IDs for a known agent in creation order.
    function getAgentRequestIds(uint256 agentId) external view returns (uint256[] memory) {
        _getAgent(agentId);
        return _agentRequestIds[agentId];
    }

    /// @notice Preview policy checks without wallet authentication or request-input validation.
    /// @dev needsApproval is true only when the payment passes policy and exceeds the threshold.
    function previewPayment(uint256 agentId, address to, uint256 amount)
        external view returns (BlockReason reason, bool needsApproval)
    {
        Agent storage agent = _getAgent(agentId);
        reason = _checkPolicy(agentId, agent, to, amount);
        needsApproval = reason == BlockReason.None && amount > agent.policy.approvalThreshold;
    }

    function _getAgent(uint256 id) internal view returns (Agent storage agent) {
        if (id == 0 || id > _agentCount) revert UnknownAgent();
        return _agents[id];
    }

    function _getRequest(uint256 id) internal view returns (PaymentRequest storage request) {
        if (id == 0 || id > _requestCount) revert UnknownRequest();
        return _requests[id];
    }

    function _ownedAgent(uint256 id) internal view returns (Agent storage agent) {
        agent = _getAgent(id);
        if (msg.sender != agent.owner) revert NotAgentOwner();
    }

    function _requireNotRevoked(Agent storage agent) internal view {
        if (agent.status == AgentStatus.Revoked) revert AgentRevoked();
    }

    function _requirePending(PaymentRequest storage request) internal view {
        if (request.status != RequestStatus.Pending) revert RequestNotPending();
    }

    function _validatePolicy(Policy calldata policy) internal view {
        if (
            policy.maxPerTx == 0 || policy.dailyLimit < policy.maxPerTx
                || policy.approvalThreshold > policy.maxPerTx
                || (policy.expiresAt != 0 && policy.expiresAt <= block.timestamp)
        ) revert InvalidPolicy();
    }

    function _validateRecipient(address recipient) internal view {
        if (recipient == address(0) || recipient == address(this)) revert InvalidRecipient();
    }

    function _effectiveSpent(Agent storage agent) internal view returns (uint256) {
        // Fixed UTC day buckets, not rolling windows; reset lazily on an executed payment.
        return agent.spendDay == block.timestamp / 1 days ? agent.spentToday : 0;
    }

    function _checkPolicy(uint256 agentId, Agent storage agent, address to, uint256 amount)
        internal view returns (BlockReason)
    {
        if (agent.status != AgentStatus.Active) return BlockReason.AgentNotActive;
        Policy storage policy = agent.policy;
        if (policy.expiresAt != 0 && block.timestamp >= policy.expiresAt) return BlockReason.BudgetExpired;
        if (amount > policy.maxPerTx) return BlockReason.ExceedsPerTxLimit;
        uint256 spent = _effectiveSpent(agent);
        // Subtraction avoids overflow and preserves rejection semantics after a budget reduction.
        if (spent > policy.dailyLimit || amount > policy.dailyLimit - spent) {
            return BlockReason.ExceedsDailyLimit;
        }
        if (!_recipients[agentId].contains(to)) return BlockReason.RecipientNotAllowed;
        if (agent.balance < amount) return BlockReason.InsufficientBalance;
        return BlockReason.None;
    }

    function _blockRequest(PaymentRequest storage request, BlockReason reason) internal {
        request.status = RequestStatus.Blocked;
        request.reason = reason;
        request.resolvedAt = uint64(block.timestamp);
        emit PaymentBlocked(request.id, request.agentId, request.to, request.amount, reason);
    }

    function _executeRequest(Agent storage agent, PaymentRequest storage request) internal {
        uint256 day = block.timestamp / 1 days;
        if (agent.spendDay != day) {
            agent.spendDay = day;
            agent.spentToday = 0;
        }
        agent.balance -= request.amount;
        agent.totalSpent += request.amount;
        agent.spentToday += request.amount;
        request.status = RequestStatus.Executed;
        request.reason = BlockReason.None;
        request.resolvedAt = uint64(block.timestamp);
        emit PaymentExecuted(request.id, request.agentId, request.to, request.amount);
        usdc.safeTransfer(request.to, request.amount);
    }
}
