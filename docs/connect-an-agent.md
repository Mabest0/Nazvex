# Connect an agent to Nazvex

Any program with its own wallet can request payments from its Nazvex vault. The vault contract applies the owner's policy to every request, so the agent can ask for money but never go beyond its limits.

This guide uses the agent client in `scripts/agent-request.ts`. It works on Arc Testnet with test USDC.

## How the pieces fit

- **Owner:** registers the agent in the Nazvex app, funds its vault and sets the policy. The owner approves anything above the approval threshold.
- **Agent wallet:** the address the owner entered when registering the agent. Only this wallet can submit requests for that agent.
- **Agent software:** your bot or service. It holds the agent wallet's key and calls the client.
- **Vault contract:** checks the request and pays, holds it for approval, or blocks it and records why.

## Set up

1. In Nazvex, **register an agent** and set its wallet to a new address you control for the agent. Use a fresh wallet made for this agent, not your own.
2. **Fund the agent's vault** from Agent Wallets. This is the agent's spending budget.
3. Send a small amount of USDC to the **agent wallet itself**. On Arc, USDC is the gas token, so the agent needs a little to pay for its transactions.
4. Give the agent software its key as an environment variable. Never put it in a prompt, a chat or a file in the repository:

```bash
export AGENT_PRIVATE_KEY=0x...   # the agent wallet's key
```

The vault address is read from `VITE_NEXORA_VAULT_ADDRESS`, which is already set in `.env` and `.env.production`. Set `AGENT_RPC_URL` only if you want a different RPC endpoint.

## Commands

### See the agent's policy and balance

```bash
bun run agent status --agent 1
```

Shows the agent's status, vault balance, what is left to spend today, the per-payment limit, whether owner approval is needed, the budget expiry and the allowed recipients. Agents should call this before planning a payment.

### Request a payment

```bash
bun run agent request --agent 1 --to 0xRecipient... --amount 3 --purpose "API credits"
```

The amount is in USDC (for example `3` or `2.5`). The purpose is saved onchain and shown to the owner, so keep it short and honest (140 bytes at most).

The result is one of three outcomes:

| Output | Meaning | What the agent should do |
| --- | --- | --- |
| `EXECUTED` | Within policy. The USDC was sent. | Continue the task. |
| `PENDING` | Above the approval threshold. Waiting for the owner for up to 2 days. | Wait with `agent wait --request <id>`, or let `agent watch` tell you. Do not assume it was paid. |
| `BLOCKED` | The policy rejected it. Nothing was sent. The reason is recorded. | Do not retry the same request. Change the plan or ask the owner. |

Block reasons: agent not active, budget expired, exceeds per-transaction limit, exceeds daily limit, recipient not on allowlist, insufficient vault balance.

### Check a pending request

```bash
bun run agent result --request 7
```

Prints `Pending`, `Executed`, `Blocked`, `Declined` or `Cancelled` for the request number printed when you submitted it. Prefer `wait` or `watch` below over polling this yourself.

### Wait for the owner's decision

```bash
bun run agent wait --request 7 --timeout 600
```

Blocks until request 7 is decided, then prints the outcome and exits. The exit code is `0` if it was paid and `2` for any other outcome (blocked, declined, cancelled or expired), so a script can branch on it. Use `--timeout <seconds>` to stop waiting; without it the command waits as long as the request is pending (up to the 2-day approval window).

### Live updates: watch an agent

```bash
bun run agent watch --agent 1
```

Stays running and prints one line whenever something happens to the agent:

| Event | Meaning |
| --- | --- |
| `request_pending` | A request is waiting for the owner. |
| `request_executed` | A request was paid, immediately or after the owner approved it. |
| `request_blocked` | A request was rejected by the policy, with the reason. |
| `request_declined` | The owner said no. |
| `request_cancelled` | The request was cancelled by the agent. |
| `agent_status_changed` | The agent was paused, resumed or revoked. |
| `policy_updated` | The owner changed the limits. |
| `agent_funded`, `agent_withdrawn` | The owner added or took back budget. |
| `agent_wallet_changed` | The agent's wallet was rotated. |

Options:

- `--webhook https://your-service/nazvex` sends every event to your service as a JSON `POST` and retries up to four times. Use `https`, or `http` for `localhost` only.
- `--json` prints one JSON object per line instead of text.
- `--interval 5` sets how often to check, in seconds (default 5, minimum 2).
- `--lookback 5000` also replays the last 5,000 blocks on start. Without it, the watcher starts from now, or from where it stopped last time.

The watcher saves its position in `~/.nazvex/`, so after a restart it picks up where it left off and does not repeat or miss events. It never scans from the beginning of the chain. If it is far behind, it prints "Catching up" and works through the gap in batches.

**Webhook body**

```json
{
  "event": "request_executed",
  "agentId": "1",
  "requestId": "7",
  "amount": "3000000",
  "to": "0x...",
  "blockNumber": "74102430",
  "txHash": "0x...",
  "at": "2026-11-25T21:47:20.000Z"
}
```

Amounts are raw 6-decimal USDC (`3000000` is 3 USDC). `at` is the time of the block. The header `x-nazvex-event` carries the event name.

**Verify webhooks.** Set `AGENT_WEBHOOK_SECRET` before starting the watcher, and every request carries an `x-nazvex-signature: sha256=<hex>` header, an HMAC-SHA256 of the raw body. Check it before trusting the call:

```ts
import { createHmac, timingSafeEqual } from 'node:crypto'

export function verify(rawBody: string, header: string, secret: string): boolean {
  const expected = `sha256=${createHmac('sha256', secret).update(rawBody).digest('hex')}`
  return header.length === expected.length && timingSafeEqual(Buffer.from(header), Buffer.from(expected))
}
```

Webhooks may be delivered more than once, for example after a restart or a retry, so treat `txHash` plus `event` as the unique key.

### Machine-readable output

Add `--json` to any command and read one line of JSON. Errors come back as `{"ok":false,"error":"..."}` with a non-zero exit code.

```bash
bun run agent request --agent 1 --to 0x... --amount 3 --purpose "data feed" --json
# {"ok":true,"outcome":"executed","requestId":"8","txHash":"0x..."}
```

## Plugging it into agent software

**Node or Bun:** run it as a subprocess and parse the JSON.

```ts
import { execFileSync } from 'node:child_process'

export function requestPayment(agent: number, to: string, amount: string, purpose: string) {
  const out = execFileSync(
    'bun',
    ['run', 'agent', 'request', '--agent', String(agent), '--to', to, '--amount', amount, '--purpose', purpose, '--json'],
    { encoding: 'utf8', env: process.env },
  )
  return JSON.parse(out.trim().split('\n').pop()!)
}
```

**Python:** the same approach.

```python
import json, subprocess

def request_payment(agent, to, amount, purpose):
    result = subprocess.run(
        ["bun", "run", "agent", "request", "--agent", str(agent), "--to", to,
         "--amount", str(amount), "--purpose", purpose, "--json"],
        capture_output=True, text=True,
    )
    return json.loads(result.stdout.strip().splitlines()[-1])
```

**Agent frameworks with tool calling:** expose the client as a tool. The model fills in the arguments, and your code runs the command with the key from the environment.

```json
{
  "name": "request_payment",
  "description": "Ask the Nazvex vault to pay a recipient. The vault may pay, hold the request for owner approval, or block it. Never assume success: read the outcome.",
  "parameters": {
    "type": "object",
    "properties": {
      "to": { "type": "string", "description": "Recipient address (must be on the allowlist)" },
      "amount": { "type": "string", "description": "USDC amount, e.g. 2.5" },
      "purpose": { "type": "string", "description": "Short reason, shown to the owner" }
    },
    "required": ["to", "amount", "purpose"]
  }
}
```

Keep the agent id and the key in your code, not in the tool arguments, so the model cannot choose which agent it acts as.

## Safety notes

- **The key stays in the agent's runtime.** The AI model must never see it, and nothing in Nazvex stores it.
- **A leaked key is limited.** The most an attacker can do is spend within the agent's policy. The owner can pause or revoke the agent at once from My Agents, or rotate the wallet in Financial Controls.
- **Use one wallet per agent.** Do not reuse the owner's wallet or share a wallet between agents.
- **Treat BLOCKED as final.** Repeated blocked requests are flagged to the owner in the Security Center.
- Testnet only. Do not use this setup with real funds before an independent security audit.
