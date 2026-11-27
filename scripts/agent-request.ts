/**
 * Nazvex agent client.
 *
 * Lets agent software (a bot, a service, an agent framework) read its policy and submit payment
 * requests to the Nazvex vault from the agent's own wallet. The vault contract decides the outcome:
 * executed, pending owner approval, or blocked with a recorded reason. This script never holds
 * owner powers and cannot move funds outside the policy.
 *
 * Usage (see docs/connect-an-agent.md):
 *   bun run agent status  --agent 1
 *   bun run agent request --agent 1 --to 0x... --amount 3 --purpose "API credits"
 *   bun run agent result  --request 7
 *   bun run agent wait    --request 7 [--timeout 600]      blocks until the owner decides
 *   bun run agent watch   --agent 1 [--webhook https://...] live events for the agent
 *
 * Environment:
 *   AGENT_PRIVATE_KEY           the agent wallet's key (required for `request`; never the owner's key)
 *   VITE_NAZVEX_VAULT_ADDRESS   vault address (already set in .env / .env.production)
 *   AGENT_RPC_URL               optional RPC endpoint; defaults to the public Arc Testnet RPC
 *   AGENT_WEBHOOK_SECRET        optional; signs webhook bodies (header x-nazvex-signature, HMAC-SHA256)
 */
import { parseArgs } from 'node:util'
import {
  createPublicClient,
  createWalletClient,
  formatUnits,
  http,
  isAddress,
  parseEventLogs,
  parseUnits,
  type Hex,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { arcTestnet } from 'viem/chains'
import { nazvexVaultAbi } from '../src/contracts/nazvexVaultAbi'
import { requireChain } from '../src/onchain-facts'
import { runWait, runWatch, type WatchContext } from './agent-watch'

const CHAIN = requireChain(arcTestnet.id)
const REASONS = [
  'None',
  'Agent is not active',
  'Budget expired',
  'Exceeds per-transaction limit',
  'Exceeds daily limit',
  'Recipient not on allowlist',
  'Insufficient vault balance',
]
const STATUSES = ['Pending', 'Executed', 'Blocked', 'Declined', 'Cancelled']
const AGENT_STATUS = ['Active', 'Paused', 'Revoked']

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    agent: { type: 'string' },
    to: { type: 'string' },
    amount: { type: 'string' },
    purpose: { type: 'string', default: '' },
    request: { type: 'string' },
    json: { type: 'boolean', default: false },
    webhook: { type: 'string' },
    interval: { type: 'string' },
    lookback: { type: 'string' },
    timeout: { type: 'string' },
  },
})

const vaultAddress = process.env.VITE_NAZVEX_VAULT_ADDRESS
if (!vaultAddress || !isAddress(vaultAddress)) fail('VITE_NAZVEX_VAULT_ADDRESS is missing or invalid.')
const vault = vaultAddress
// RPC order: explicit override, then the sandbox RPC proxy for this chain, then the public endpoint.
const proxyChains = (process.env.RPC_PROXY_CHAINS ?? '').split(',')
const rpcUrl =
  process.env.AGENT_RPC_URL ??
  process.env.RPC_URL_Arc_Testnet ??
  (process.env.RPC_PROXY_BASE_URL && proxyChains.includes('Arc_Testnet')
    ? `${process.env.RPC_PROXY_BASE_URL}/api/rpc/Arc_Testnet?_rpc_token=${process.env.RPC_PROXY_TOKEN}`
    : CHAIN.rpcUrls[0])
const publicClient = createPublicClient({ chain: arcTestnet, transport: http(rpcUrl) })
const usdc = (raw: bigint) => `${formatUnits(raw, 6)} USDC`

function fail(message: string): never {
  if (values.json) console.log(JSON.stringify({ ok: false, error: message }))
  else console.error(`Error: ${message}`)
  process.exit(1)
}

function out(text: string, data: Record<string, unknown>) {
  if (values.json) console.log(JSON.stringify({ ok: true, ...data }, (_k: string, v: unknown): unknown => (typeof v === 'bigint' ? v.toString() : v)))
  else console.log(text)
}

function agentId(): bigint {
  if (!values.agent || !/^\d+$/.test(values.agent)) fail('Pass --agent <id> (a whole number).')
  return BigInt(values.agent)
}

function friendly(error: unknown): string {
  const text = error instanceof Error ? `${error.name} ${error.message}` : String(error)
  const map: Array<[string, string]> = [
    ['NotAgentWallet', 'This key is not the registered wallet for that agent. Check AGENT_PRIVATE_KEY and --agent.'],
    ['UnknownAgent', 'That agent id does not exist.'],
    ['InvalidAmount', 'Amount must be greater than zero.'],
    ['PurposeTooLong', 'Purpose is too long (140 bytes max).'],
    ['ZeroAddress', 'Recipient address cannot be empty.'],
    ['insufficient funds', 'The agent wallet needs a little USDC to pay gas on Arc.'],
  ]
  for (const [needle, message] of map) if (text.includes(needle)) return message
  return text.split('\n')[0]
}

async function status() {
  const id = agentId()
  const a = await publicClient.readContract({ address: vault, abi: nazvexVaultAbi, functionName: 'getAgent', args: [id] })
  const recipients = await publicClient.readContract({ address: vault, abi: nazvexVaultAbi, functionName: 'getRecipients', args: [id] })
  const p = a.policy
  const approval = p.approvalThreshold === p.maxPerTx ? 'none' : `above ${usdc(p.approvalThreshold)}`
  out(
    [
      `${a.name} (agent #${a.id}) is ${AGENT_STATUS[a.status]}`,
      `Wallet:          ${a.wallet}`,
      `Vault balance:   ${usdc(a.balance)}`,
      `Left today:      ${usdc(a.remainingToday)} of ${usdc(p.dailyLimit)}`,
      `Max per payment: ${usdc(p.maxPerTx)}`,
      `Owner approval:  ${approval}`,
      `Budget expires:  ${p.expiresAt === 0n ? 'never' : new Date(Number(p.expiresAt) * 1000).toISOString()}`,
      `Allowed recipients (${recipients.length}): ${recipients.join(', ') || 'none'}`,
    ].join('\n'),
    { agentId: a.id, name: a.name, status: AGENT_STATUS[a.status], wallet: a.wallet, balance: a.balance, remainingToday: a.remainingToday, policy: p, recipients },
  )
}

async function request() {
  const id = agentId()
  const to = values.to
  if (!to || !isAddress(to)) fail('Pass --to <recipient address>.')
  if (!values.amount) fail('Pass --amount <USDC amount>, e.g. 3 or 2.5.')
  let amount: bigint
  try {
    amount = parseUnits(values.amount, 6)
  } catch {
    return fail('Amount must be a plain number with up to 6 decimals.')
  }
  const key = process.env.AGENT_PRIVATE_KEY
  if (!key || !/^0x[0-9a-fA-F]{64}$/.test(key)) fail('Set AGENT_PRIVATE_KEY (0x... 32-byte key of the agent wallet) in the environment.')
  const account = privateKeyToAccount(key as Hex)
  const wallet = createWalletClient({ account, chain: arcTestnet, transport: http(rpcUrl) })

  // Dry run first so wrong-wallet and bad-input errors come back with a clear message and no gas spent.
  const args = [id, to, amount, values.purpose ?? ''] as const
  try {
    await publicClient.simulateContract({ address: vault, abi: nazvexVaultAbi, functionName: 'requestPayment', args, account })
  } catch (error) {
    fail(friendly(error))
  }

  let hash: Hex
  try {
    hash = await wallet.writeContract({ address: vault, abi: nazvexVaultAbi, functionName: 'requestPayment', args })
  } catch (error) {
    return fail(friendly(error))
  }
  const receipt = await publicClient.waitForTransactionReceipt({ hash })
  if (receipt.status !== 'success') fail(`Transaction ${hash} reverted.`)

  const logs = parseEventLogs({
    abi: nazvexVaultAbi,
    logs: receipt.logs.filter((l) => l.address.toLowerCase() === vault.toLowerCase()),
    eventName: ['PaymentExecuted', 'PaymentBlocked', 'PaymentRequested'],
  })
  const ev = logs[0]
  const explorer = `${CHAIN.explorerBase.replace(/\/$/, '')}/tx/${hash}`
  if (!ev) return fail(`Confirmed (${hash}) but no payment event was found.`)
  if (ev.eventName === 'PaymentExecuted') {
    out(`EXECUTED  request #${ev.args.requestId}: paid ${usdc(amount)} to ${to}\n${explorer}`, { outcome: 'executed', requestId: ev.args.requestId, txHash: hash })
  } else if (ev.eventName === 'PaymentRequested') {
    out(`PENDING   request #${ev.args.requestId}: ${usdc(amount)} waits for the owner's approval (expires in 2 days)\n${explorer}`, { outcome: 'pending', requestId: ev.args.requestId, txHash: hash })
  } else {
    const reason = REASONS[Number(ev.args.reason)] ?? 'Unknown'
    out(`BLOCKED   request #${ev.args.requestId}: ${reason}. No funds moved.\n${explorer}`, { outcome: 'blocked', requestId: ev.args.requestId, reason, txHash: hash })
  }
}

async function result() {
  if (!values.request || !/^\d+$/.test(values.request)) fail('Pass --request <id>.')
  const r = await publicClient.readContract({ address: vault, abi: nazvexVaultAbi, functionName: 'getRequest', args: [BigInt(values.request)] })
  const state = STATUSES[r.status]
  const detail = r.status === 2 ? ` (${REASONS[r.reason]})` : ''
  out(`request #${r.id}: ${state}${detail}. ${usdc(r.amount)} to ${r.to}`, { requestId: r.id, status: state, reason: REASONS[r.reason], amount: r.amount, to: r.to })
}

function watchContext(): WatchContext {
  return {
    client: publicClient,
    vault,
    agentId: values.agent ? agentId() : 0n,
    json: values.json,
    fail,
    option: (name) => (values as Record<string, string | boolean | undefined>)[name] as string | undefined,
  }
}

async function wait() {
  if (!values.request || !/^\d+$/.test(values.request)) fail('Pass --request <id>.')
  const outcome = await runWait(watchContext(), BigInt(values.request))
  process.exit(outcome.status === 'executed' ? 0 : 2)
}

const command = positionals[0]
try {
  if (command === 'status') await status()
  else if (command === 'request') await request()
  else if (command === 'result') await result()
  else if (command === 'wait') await wait()
  else if (command === 'watch') {
    agentId()
    await runWatch(watchContext())
  }
  else fail('Usage: bun run agent <status|request|result|wait|watch> [options]. See docs/connect-an-agent.md.')
} catch (error) {
  fail(friendly(error))
}
