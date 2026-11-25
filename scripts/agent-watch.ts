/**
 * Live updates for Nazvex agents: `watch` streams what happens to an agent, `wait` blocks until one
 * request is decided. Used by scripts/agent-request.ts (see docs/connect-an-agent.md).
 */
import { createHmac } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { formatUnits, parseEventLogs, type Address, type PublicClient } from 'viem'
import { nexoraVaultAbi } from '../src/contracts/nexoraVaultAbi'

const BATCH_BLOCKS = 2000n
const REASONS = ['None', 'Agent is not active', 'Budget expired', 'Exceeds per-transaction limit', 'Exceeds daily limit', 'Recipient not on allowlist', 'Insufficient vault balance']
const AGENT_STATUS = ['active', 'paused', 'revoked']
const REQUEST_STATUS = ['pending', 'executed', 'blocked', 'declined', 'cancelled']

export interface WatchContext {
  client: PublicClient
  vault: Address
  agentId: bigint
  json: boolean
  fail: (message: string) => never
  option: (name: string) => string | undefined
}

export interface AgentEvent {
  event: string
  agentId: string
  requestId?: string
  amount?: string
  to?: string
  reason?: string
  detail?: string
  blockNumber: string
  txHash: string
  at: string
}

const usdc = (raw: bigint) => `${formatUnits(raw, 6)} USDC`
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

function toAgentEvent(log: ReturnType<typeof parseEventLogs<typeof nexoraVaultAbi>>[number], at: string): AgentEvent | null {
  const base = {
    blockNumber: String(log.blockNumber),
    txHash: log.transactionHash,
    at,
  }
  switch (log.eventName) {
    case 'PaymentRequested':
      return { ...base, event: 'request_pending', agentId: String(log.args.agentId), requestId: String(log.args.requestId), amount: String(log.args.amount), to: log.args.to }
    case 'PaymentExecuted':
      return { ...base, event: 'request_executed', agentId: String(log.args.agentId), requestId: String(log.args.requestId), amount: String(log.args.amount), to: log.args.to }
    case 'PaymentBlocked':
      return { ...base, event: 'request_blocked', agentId: String(log.args.agentId), requestId: String(log.args.requestId), amount: String(log.args.amount), to: log.args.to, reason: REASONS[Number(log.args.reason)] }
    case 'PaymentDeclined':
      return { ...base, event: 'request_declined', agentId: String(log.args.agentId), requestId: String(log.args.requestId) }
    case 'PaymentCancelled':
      return { ...base, event: 'request_cancelled', agentId: String(log.args.agentId), requestId: String(log.args.requestId) }
    case 'AgentStatusChanged':
      return { ...base, event: 'agent_status_changed', agentId: String(log.args.agentId), detail: AGENT_STATUS[Number(log.args.status)] }
    case 'PolicyUpdated':
      return { ...base, event: 'policy_updated', agentId: String(log.args.agentId), detail: `max ${usdc(log.args.maxPerTx)}, daily ${usdc(log.args.dailyLimit)}, approval above ${usdc(log.args.approvalThreshold)}` }
    case 'AgentFunded':
      return { ...base, event: 'agent_funded', agentId: String(log.args.agentId), amount: String(log.args.amount) }
    case 'AgentWithdrawn':
      return { ...base, event: 'agent_withdrawn', agentId: String(log.args.agentId), amount: String(log.args.amount) }
    case 'AgentWalletUpdated':
      return { ...base, event: 'agent_wallet_changed', agentId: String(log.args.agentId), detail: log.args.wallet }
    default:
      return null
  }
}

function describe(e: AgentEvent): string {
  const money = e.amount ? ` ${usdc(BigInt(e.amount))}` : ''
  const req = e.requestId ? ` request #${e.requestId}` : ''
  switch (e.event) {
    case 'request_executed': return `EXECUTED${req}:${money} paid to ${e.to}`
    case 'request_pending': return `PENDING${req}:${money} waits for the owner's approval`
    case 'request_blocked': return `BLOCKED${req}:${money}. ${e.reason}. No funds moved.`
    case 'request_declined': return `DECLINED${req}: the owner said no`
    case 'request_cancelled': return `CANCELLED${req}`
    case 'agent_status_changed': return `AGENT ${String(e.detail).toUpperCase()}: payments ${e.detail === 'active' ? 'allowed again' : 'will be blocked'}`
    case 'policy_updated': return `POLICY UPDATED: ${e.detail}`
    case 'agent_funded': return `FUNDED:${money} added to the vault`
    case 'agent_withdrawn': return `WITHDRAWN:${money} taken back by the owner`
    case 'agent_wallet_changed': return `WALLET CHANGED to ${e.detail}`
    default: return e.event
  }
}

async function deliver(url: string, secret: string | undefined, e: AgentEvent): Promise<void> {
  const body = JSON.stringify(e)
  const headers: Record<string, string> = { 'content-type': 'application/json', 'x-nazvex-event': e.event }
  if (secret) headers['x-nazvex-signature'] = `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const res = await fetch(url, { method: 'POST', headers, body, signal: AbortSignal.timeout(10_000) })
      if (res.ok) return
      console.error(`Webhook answered ${res.status} (attempt ${attempt}/4)`)
    } catch (error) {
      console.error(`Webhook failed (attempt ${attempt}/4): ${error instanceof Error ? error.message : 'network error'}`)
    }
    await sleep(1000 * 2 ** attempt)
  }
  console.error(`Giving up on webhook for ${e.event} (tx ${e.txHash}). It is still printed above.`)
}

function checkWebhook(ctx: WatchContext, url: string): void {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return ctx.fail('--webhook must be a full URL, for example https://example.com/nazvex.')
  }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname)
  if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && local)) {
    ctx.fail('--webhook must use https (http is allowed only for localhost).')
  }
}

/** Streams events for one agent. Never starts from block 0: it starts at the chain head, a bounded lookback, or the saved position. */
export async function runWatch(ctx: WatchContext): Promise<void> {
  const webhook = ctx.option('webhook')
  const secret = process.env.AGENT_WEBHOOK_SECRET
  if (webhook) checkWebhook(ctx, webhook)
  const intervalMs = Math.max(2, Number(ctx.option('interval') ?? 5)) * 1000
  const lookback = BigInt(ctx.option('lookback') ?? 0)

  const dir = join(homedir(), '.nazvex')
  const stateFile = join(dir, `watch-${ctx.vault.toLowerCase()}-agent-${ctx.agentId}.json`)
  const head0 = await ctx.client.getBlockNumber()
  let next = head0 > lookback ? head0 - lookback + 1n : 0n
  try {
    const saved = JSON.parse(readFileSync(stateFile, 'utf8')) as { lastBlock?: string }
    if (saved.lastBlock && lookback === 0n) next = BigInt(saved.lastBlock) + 1n
  } catch {
    // First run: no saved position.
  }
  if (next > head0 + 1n) next = head0 + 1n

  console.error(`Watching agent #${ctx.agentId} from block ${next} (chain head ${head0}). Press Ctrl+C to stop.${webhook ? ' Sending events to your webhook.' : ''}`)

  const blockTimes = new Map<bigint, string>()
  const timeOf = async (n: bigint) => {
    const cached = blockTimes.get(n)
    if (cached) return cached
    const block = await ctx.client.getBlock({ blockNumber: n })
    const iso = new Date(Number(block.timestamp) * 1000).toISOString()
    blockTimes.set(n, iso)
    return iso
  }
  let warnedBehind = false
  let stop = false
  process.on('SIGINT', () => { stop = true })
  process.on('SIGTERM', () => { stop = true })

  while (!stop) {
    try {
      const head = await ctx.client.getBlockNumber()
      while (next <= head && !stop) {
        const to = next + BATCH_BLOCKS - 1n < head ? next + BATCH_BLOCKS - 1n : head
        if (head - next > BATCH_BLOCKS && !warnedBehind) {
          warnedBehind = true
          console.error(`Catching up: ${head - next} blocks behind the chain head. Events below may be older than now.`)
        }
        const raw = await ctx.client.getLogs({ address: ctx.vault, fromBlock: next, toBlock: to })
        const parsed = parseEventLogs({ abi: nexoraVaultAbi, logs: raw })
        for (const log of parsed) {
          if (!('agentId' in log.args) || String(log.args.agentId) !== String(ctx.agentId)) continue
          const event = toAgentEvent(log, await timeOf(log.blockNumber))
          if (!event) continue
          console.log(ctx.json ? JSON.stringify(event) : `[${event.at}] ${describe(event)}`)
          if (webhook) await deliver(webhook, secret, event)
        }
        mkdirSync(dir, { recursive: true })
        writeFileSync(stateFile, JSON.stringify({ lastBlock: String(to) }))
        next = to + 1n
      }
    } catch (error) {
      console.error(`Read failed, retrying: ${error instanceof Error ? error.message.split('\n')[0] : 'unknown error'}`)
    }
    await sleep(intervalMs)
  }
}

/** Blocks until a request leaves the Pending state, then prints and returns its outcome. */
export async function runWait(ctx: WatchContext, requestId: bigint): Promise<{ status: string; reason?: string }> {
  const intervalMs = Math.max(2, Number(ctx.option('interval') ?? 5)) * 1000
  const timeoutSec = Number(ctx.option('timeout') ?? 0)
  const started = Date.now()
  for (;;) {
    const r = await ctx.client.readContract({ address: ctx.vault, abi: nexoraVaultAbi, functionName: 'getRequest', args: [requestId] })
    const status = REQUEST_STATUS[r.status]
    const expired = r.status === 0 && BigInt(Math.floor(Date.now() / 1000)) >= r.expiresAt
    if (r.status !== 0 || expired) {
      const final = expired ? 'expired' : status
      const reason = r.status === 2 ? REASONS[r.reason] : undefined
      const text = `request #${r.id}: ${final.toUpperCase()}${reason ? ` (${reason})` : ''}. ${usdc(r.amount)} to ${r.to}`
      console.log(ctx.json ? JSON.stringify({ ok: true, requestId: String(r.id), status: final, reason, amount: String(r.amount), to: r.to }) : text)
      return { status: final, reason }
    }
    if (timeoutSec > 0 && (Date.now() - started) / 1000 >= timeoutSec) {
      return ctx.fail(`Still pending after ${timeoutSec}s. The owner has not decided yet.`)
    }
    await sleep(intervalMs)
  }
}
