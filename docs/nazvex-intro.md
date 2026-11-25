# Nazvex

**Give AI agents a wallet with rules. Keep the keys to the rules yourself.**

Nazvex is a financial control layer for AI agents on Arc. You decide how much each agent can spend, who it can pay and what needs your sign-off. A smart contract enforces those rules on every payment, so an agent can prepare and request payments but can never go beyond the limits you set.

Live today as a testnet prototype using test USDC on Arc Testnet.

---

## The problem

AI agents are starting to buy services, pay other agents and manage budgets. Owners are left with two bad choices: hand an agent a wallet with no limits, or approve every payment by hand. Neither scales, and neither leaves a clear record of what happened.

## The idea

Put the rules where the money moves. Nazvex holds each agent's budget in a vault contract. The agent can ask to spend, and the contract decides: pay now, hold for the owner, or block and record why. Neither the dashboard, the backend nor the AI assistant can override it.

## How it works

1. **Register an agent.** Give it a name, a wallet address and a spending policy.
2. **Fund its vault.** Allocate test USDC to that agent only. Other agents can't touch it.
3. **The agent requests a payment.** Agent software sends a request from its own wallet with an amount, a recipient and a purpose, using the agent client or the dashboard.
4. **The contract decides.**
   - Within the rules: it pays immediately.
   - Above your approval threshold: it waits in your queue until you approve or decline.
   - Against the rules: it is blocked, nothing moves, and the reason is recorded onchain.
5. **You see everything.** Spending, approvals, blocked attempts and alerts, all in one dashboard.

## What you control

- **Per-transaction limit:** the most an agent can send in one payment.
- **Daily limit:** a cap on total spending per UTC day.
- **Approved recipients:** only addresses on the list can be paid.
- **Approval threshold:** payments above it need your approval. Approvals expire after 2 days, and the limits are checked again when you approve.
- **Budget expiry:** the budget can stop working after a date you choose.
- **Pause and revoke:** pause an agent temporarily, or revoke it permanently.
- **Withdraw any time:** you can pull unspent funds back to your wallet, even after pausing or revoking.

## The dashboard

- **Overview:** allocated, spent and remaining USDC, plus recent activity.
- **My Agents:** register, pause, resume and revoke.
- **Agent Wallets:** fund and withdraw, and see each agent's vault balance.
- **Financial Controls:** edit limits, recipients and expiry.
- **Transactions:** submit agent requests and see what the contract decided for each one. Every request shows as Executed, Pending, Blocked, Declined or Cancelled, so a request is never mistaken for a completed payment.
- **Approvals:** review pending requests with a policy checklist, then approve or decline.
- **Intelligence:** ask questions in plain language ("How much has ResearchBot spent this week?", "Which agent has used the most of its budget?"). The assistant can prepare changes, such as a new daily limit, but you confirm each one in your wallet.
- **Security Center:** alerts for blocked requests, repeated failures, bursts of requests, budgets nearly used up, stale approvals and expiring budgets. They are signals to review, not proof of fraud.
- **Settings:** wallet, network and contract details.

## Why it is safe by design

- The AI never holds keys and cannot sign anything. Its suggestions are proposals you confirm.
- The rules live in the contract. A bug or compromise in the app can't make the vault ignore them.
- Each agent has its own balance, so one agent can't spend another's budget.
- Rejections are recorded onchain with a reason, which gives you an auditable history.
- The vault has no admin or upgrade key. Only each agent's owner has any power over that agent.

## What has been checked

- The contract was reviewed with automated security tools and found no material issues.
- It passes 99 tests covering every action above, including the daily limit across a UTC day change, approval expiry, and a check that the vault's total balance always matches what agents are owed.
- Testnet only. It has not had an independent professional audit, which is required before any real funds.

## Demo in two minutes

1. Connect a wallet on Arc Testnet and get test USDC from the faucet.
2. Register **ResearchBot** (max 5 per payment, 15 per day) and fund it.
3. Request 3 USDC to an approved address: it **executes**.
4. Request 15 USDC: it is **blocked** for exceeding the limit.
5. Register **PaymentBot** with approval above 5, then request 9 USDC: it **waits for you**, and you approve it from the Approvals page.
6. Revoke an agent: any further request is blocked.

## Connect real agents

Any bot, service or agent framework can submit requests through the agent client:

```bash
bun run agent status  --agent 1
bun run agent request --agent 1 --to 0x... --amount 3 --purpose "API credits"
bun run agent result  --request 7
```

The agent keeps its own key, and the vault enforces the owner's policy no matter what the agent does. Full guide with Node, Python and tool-calling examples: `docs/connect-an-agent.md`.

## Built with

- **Arc Testnet:** USDC is both the gas and the money.
- **Smart contract:** Solidity, tested with Foundry.
- **App:** React, TypeScript and Tailwind, with wallet connection through wagmi and viem.

## Honest limits today

- Testnet and test USDC only. Not for real funds.
- The assistant uses fixed rules over your recorded data, not a language model, so it only understands the question styles listed in its suggestions.
- There is no backend or database yet. Everything is read straight from the chain.
- Agents connect today through a ready-made client (`bun run agent`, see `docs/connect-an-agent.md`) that submits requests from the agent's own wallet and reports whether each one executed, is pending or was blocked. Still to come: automatic notifications when you approve a request, which needs a small backend.
- Not yet covered: mainnet, crosschain payments, autonomous trading and advanced anomaly detection.

## One-line pitches

- *Short:* A spending account for AI agents where the rules are enforced by a smart contract.
- *Medium:* Nazvex lets you give each AI agent its own funded vault, set limits and approved recipients, and approve the big payments yourself, with every decision recorded onchain.
- *Plain:* Let your AI agents spend money without letting them spend your money.
