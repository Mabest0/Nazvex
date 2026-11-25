import { fmtUsdc, pct } from './format'
import { spentSince } from './monitoring'
import { parseUsdc } from '@/onchain-money'
import { AgentStatus, BLOCK_REASON_LABEL, RequestStatus, type Agent, type PayRequest, type Policy } from './vault'

export type Proposal =
  | { kind: 'setPolicy'; agent: Agent; policy: Policy; summary: string }
  | { kind: 'fund'; agent: Agent; amount: bigint; summary: string }
  | { kind: 'withdraw'; agent: Agent; amount: bigint; summary: string }
  | { kind: 'pause' | 'resume'; agent: Agent; summary: string }

export interface Reply {
  text: string
  lines?: string[]
  proposal?: Proposal
}

interface Ctx {
  agents: Agent[]
  requests: PayRequest[]
  now: number
}

export const SUGGESTIONS = [
  'Give me a summary',
  'Show all pending payment requests',
  'Which agent has used the most of its budget?',
  'Show blocked requests',
  'Prepare a budget change for PaymentBot',
]

function amountIn(q: string): bigint | null {
  const m = q.match(/(\d+(?:\.\d{1,6})?)/)
  if (!m) return null
  try {
    return parseUsdc(m[1])
  } catch {
    return null
  }
}

function findAgent(q: string, agents: Agent[]): Agent | undefined {
  const squashed = q.replace(/\s+/g, '')
  return agents.find((a) => squashed.includes(a.name.toLowerCase().replace(/\s+/g, '')))
}

const agentLine = (a: Agent) =>
  `${a.name}: ${fmtUsdc(a.balance)} USDC left, ${fmtUsdc(a.totalSpent)} of ${fmtUsdc(a.totalFunded)} spent`

export function answer(question: string, { agents, requests, now }: Ctx): Reply {
  const q = question.toLowerCase().trim()
  const agent = findAgent(q, agents)
  const amount = amountIn(q)

  if (agents.length === 0) {
    return { text: 'You have not registered any agents yet. Register one from My Agents and I can start answering questions about its activity.' }
  }

  // Controlled actions: always a structured proposal that the owner confirms.
  if (/\b(pause|freeze)\b/.test(q) && agent) {
    return { text: `I can pause ${agent.name}. Its payment requests will be blocked until you resume it.`, proposal: { kind: 'pause', agent, summary: `Pause ${agent.name}` } }
  }
  if (/\b(resume|unpause)\b/.test(q) && agent) {
    return { text: `I can resume ${agent.name}.`, proposal: { kind: 'resume', agent, summary: `Resume ${agent.name}` } }
  }
  if (/\bwithdraw\b/.test(q) && agent && amount) {
    return { text: `Proposal: return ${fmtUsdc(amount)} USDC from ${agent.name}'s vault to your wallet.`, proposal: { kind: 'withdraw', agent, amount, summary: `Withdraw ${fmtUsdc(amount)} USDC from ${agent.name}` } }
  }
  if (/(prepare|propose|change|set|update|raise|lower|increase|decrease|top ?up|add|fund|allocate)/.test(q) && /(budget|limit|daily|threshold|max|per.?t(x|ransaction)|fund|top ?up|allocate)/.test(q)) {
    if (!agent) return { text: 'Which agent? For example: "Set PaymentBot daily limit to 25".' }
    if (!amount) {
      return { text: `What should the change be for ${agent.name}? For example: "Increase ${agent.name} budget by 20", "Set ${agent.name} daily limit to 25", or "Set ${agent.name} max per transaction to 8".` }
    }
    const p = agent.policy
    if (/daily/.test(q)) return policyProposal(agent, { ...p, dailyLimit: amount }, `Set ${agent.name} daily limit to ${fmtUsdc(amount)} USDC`)
    if (/threshold|approval/.test(q)) return policyProposal(agent, { ...p, approvalThreshold: amount }, `Require approval above ${fmtUsdc(amount)} USDC for ${agent.name}`)
    if (/per.?t(x|ransaction)|max/.test(q)) {
      // Approvals stay disabled when the threshold tracked the old maximum.
      const threshold = p.approvalThreshold === p.maxPerTx ? amount : p.approvalThreshold
      return policyProposal(agent, { ...p, maxPerTx: amount, approvalThreshold: threshold }, `Set ${agent.name} max per transaction to ${fmtUsdc(amount)} USDC`)
    }
    return { text: `Proposal: allocate ${fmtUsdc(amount)} USDC from your wallet to ${agent.name}'s budget. You approve USDC and the funding transaction in your wallet.`, proposal: { kind: 'fund', agent, amount, summary: `Allocate ${fmtUsdc(amount)} USDC to ${agent.name}` } }
  }

  if (/pending|waiting|awaiting|approval/.test(q)) {
    const pending = requests.filter((r) => r.status === RequestStatus.Pending)
    if (pending.length === 0) return { text: 'No payment requests are waiting for approval.' }
    return {
      text: `${pending.length} request${pending.length > 1 ? 's' : ''} waiting for your decision. Open Approvals to review them.`,
      lines: pending.map((r) => `#${r.id}: ${nameOf(agents, r.agentId)} requests ${fmtUsdc(r.amount)} USDC${Number(r.expiresAt) <= now ? ' (expired)' : ''}`),
    }
  }

  if (/blocked|rejected|violation|denied/.test(q)) {
    const blocked = requests.filter((r) => r.status === RequestStatus.Blocked && (!agent || r.agentId === agent.id))
    if (blocked.length === 0) return { text: `No requests have been blocked${agent ? ` for ${agent.name}` : ''}.` }
    return {
      text: `${blocked.length} request${blocked.length > 1 ? 's were' : ' was'} blocked by the contract. No funds moved.`,
      lines: blocked.slice(0, 8).map((r) => `#${r.id}: ${nameOf(agents, r.agentId)}, ${fmtUsdc(r.amount)} USDC, ${BLOCK_REASON_LABEL[r.reason]}`),
    }
  }

  if (/(most|highest|biggest|largest).*(budget|used|spent|spend)|used the most/.test(q)) {
    const funded = agents.filter((a) => a.totalFunded > 0n)
    if (funded.length === 0) return { text: 'No agent has been funded yet, so there is no budget usage to compare.' }
    const ranked = [...funded].sort((a, b) => pct(b.totalSpent, b.totalFunded) - pct(a.totalSpent, a.totalFunded))
    return {
      text: `${ranked[0].name} has used the most of its budget (${Math.round(pct(ranked[0].totalSpent, ranked[0].totalFunded))}%).`,
      lines: ranked.map((a) => `${a.name}: ${Math.round(pct(a.totalSpent, a.totalFunded))}% used`),
    }
  }

  if (/spent|spend|spending/.test(q)) {
    const days = /today/.test(q) ? 0 : /month/.test(q) ? 30 : /week/.test(q) ? 7 : null
    const since = days === null ? 0 : days === 0 ? Math.floor(now / 86400) * 86400 : now - days * 86400
    const window = days === null ? 'in total' : days === 0 ? 'today (UTC)' : days === 7 ? 'in the last 7 days' : 'in the last 30 days'
    if (agent) return { text: `${agent.name} has spent ${fmtUsdc(spentSince(requests, since, agent.id))} USDC ${window}.` }
    return {
      text: `Across all agents you have spent ${fmtUsdc(spentSince(requests, since))} USDC ${window}.`,
      lines: agents.map((a) => `${a.name}: ${fmtUsdc(spentSince(requests, since, a.id))} USDC`),
    }
  }

  if (/balance|remaining|left|how much/.test(q)) {
    if (agent) return { text: agentLine(agent) + '.' }
    return { text: 'Here are the vault balances.', lines: agents.map(agentLine) }
  }

  if (/summary|overview|status|how are|report/.test(q)) {
    const executed = requests.filter((r) => r.status === RequestStatus.Executed).length
    const blocked = requests.filter((r) => r.status === RequestStatus.Blocked).length
    const pending = requests.filter((r) => r.status === RequestStatus.Pending && Number(r.expiresAt) > now).length
    const active = agents.filter((a) => a.status === AgentStatus.Active).length
    return {
      text: `${agents.length} agents (${active} active). ${executed} payments executed, ${blocked} blocked by policy, ${pending} awaiting approval.`,
      lines: agents.map(agentLine),
    }
  }

  return {
    text: 'I can answer questions about recorded spending, balances, pending and blocked requests, and prepare changes for you to confirm. Try one of the suggestions below.',
  }
}

function nameOf(agents: Agent[], id: bigint): string {
  return agents.find((a) => a.id === id)?.name ?? `Agent #${id}`
}

function policyProposal(agent: Agent, policy: Policy, summary: string): Reply {
  if (policy.dailyLimit < policy.maxPerTx) {
    return { text: `That would put the daily limit (${fmtUsdc(policy.dailyLimit)}) below the per-transaction maximum (${fmtUsdc(policy.maxPerTx)}). Adjust the other limit first.` }
  }
  if (policy.approvalThreshold > policy.maxPerTx) {
    return { text: `The approval threshold (${fmtUsdc(policy.approvalThreshold)}) cannot exceed the per-transaction maximum (${fmtUsdc(policy.maxPerTx)}).` }
  }
  if (policy.maxPerTx === 0n) return { text: 'The per-transaction maximum must be above zero.' }
  return {
    text: `Proposal for ${agent.name}: ${summary.replace(`${agent.name} `, '').toLowerCase()}. Nothing changes until you confirm and sign. The contract enforces the new limits.`,
    proposal: { kind: 'setPolicy', agent, policy, summary },
  }
}
