import { fmtUsdc } from './format'
import {
  AgentStatus,
  BLOCK_REASON_LABEL,
  RequestStatus,
  type Agent,
  type PayRequest,
} from './vault'

export type Severity = 'critical' | 'warn' | 'info'

export interface Alert {
  id: string
  severity: Severity
  title: string
  detail: string
  agentId?: bigint
  at?: number
}

/** Transparent, deterministic thresholds. Alerts are signals for review, not proof of fraud. */
export const THRESHOLDS = {
  repeatedBlocks: 3,
  repeatedBlocksWindowSec: 24 * 3600,
  burstCount: 5,
  burstWindowSec: 10 * 60,
  budgetWarnPct: 80,
  budgetCriticalPct: 95,
  stalePendingSec: 24 * 3600,
  expiryWarnSec: 24 * 3600,
} as const

const RANK: Record<Severity, number> = { critical: 0, warn: 1, info: 2 }

export function computeAlerts(agents: Agent[], requests: PayRequest[], now: number): Alert[] {
  const alerts: Alert[] = []
  const nameOf = (id: bigint) => agents.find((a) => a.id === id)?.name ?? `Agent #${id}`

  for (const agent of agents) {
    const mine = requests.filter((r) => r.agentId === agent.id)
    const name = agent.name

    const recentBlocked = mine.filter(
      (r) =>
        r.status === RequestStatus.Blocked &&
        now - Number(r.createdAt) <= THRESHOLDS.repeatedBlocksWindowSec,
    )
    if (recentBlocked.length >= THRESHOLDS.repeatedBlocks) {
      alerts.push({
        id: `repeat-${agent.id}`,
        severity: 'critical',
        title: `${name}: repeated blocked attempts`,
        detail: `${recentBlocked.length} requests were blocked by policy in the last 24 hours. Review the agent's behavior.`,
        agentId: agent.id,
        at: Number(recentBlocked[0].createdAt),
      })
    }

    const burst = mine.filter((r) => now - Number(r.createdAt) <= THRESHOLDS.burstWindowSec)
    if (burst.length >= THRESHOLDS.burstCount) {
      alerts.push({
        id: `burst-${agent.id}`,
        severity: 'warn',
        title: `${name}: unusual request frequency`,
        detail: `${burst.length} payment requests in the last 10 minutes.`,
        agentId: agent.id,
        at: Number(burst[0].createdAt),
      })
    }

    if (agent.totalFunded > 0n) {
      const used = Number((agent.totalSpent * 10000n) / agent.totalFunded) / 100
      if (used >= THRESHOLDS.budgetWarnPct && agent.status !== AgentStatus.Revoked) {
        alerts.push({
          id: `budget-${agent.id}`,
          severity: used >= THRESHOLDS.budgetCriticalPct ? 'critical' : 'warn',
          title: `${name}: ${Math.round(used)}% of budget used`,
          detail: `${fmtUsdc(agent.totalSpent)} of ${fmtUsdc(agent.totalFunded)} USDC spent. ${fmtUsdc(agent.balance)} USDC remains.`,
          agentId: agent.id,
        })
      } else if (
        agent.balance < agent.policy.maxPerTx &&
        agent.status === AgentStatus.Active
      ) {
        alerts.push({
          id: `low-${agent.id}`,
          severity: 'info',
          title: `${name}: balance below per-transaction limit`,
          detail: `Vault balance is ${fmtUsdc(agent.balance)} USDC, less than the ${fmtUsdc(agent.policy.maxPerTx)} USDC limit.`,
          agentId: agent.id,
        })
      }
    }

    const exp = Number(agent.policy.expiresAt)
    if (agent.status !== AgentStatus.Revoked && exp > 0) {
      if (exp <= now) {
        alerts.push({
          id: `expired-${agent.id}`,
          severity: 'warn',
          title: `${name}: budget has expired`,
          detail: 'All new payments are blocked. Extend the expiry in Financial Controls or withdraw the balance.',
          agentId: agent.id,
        })
      } else if (exp - now <= THRESHOLDS.expiryWarnSec) {
        alerts.push({
          id: `expiring-${agent.id}`,
          severity: 'warn',
          title: `${name}: budget expires within 24 hours`,
          detail: 'Payments will be blocked after the expiry time.',
          agentId: agent.id,
        })
      }
    }

    if (agent.status === AgentStatus.Paused) {
      alerts.push({
        id: `paused-${agent.id}`,
        severity: 'info',
        title: `${name} is paused`,
        detail: 'Payment requests are blocked until you resume the agent.',
        agentId: agent.id,
      })
    }
    if (agent.status === AgentStatus.Revoked) {
      alerts.push({
        id: `revoked-${agent.id}`,
        severity: 'info',
        title: `${name} is revoked`,
        detail: 'Permanently disabled. Any remaining balance can still be withdrawn.',
        agentId: agent.id,
      })
    }
  }

  const blocked = requests
    .filter((r) => r.status === RequestStatus.Blocked && now - Number(r.createdAt) <= 7 * 86400)
    .slice(0, 10)
  for (const r of blocked) {
    const revokedAttempt = r.reason === 1
    alerts.push({
      id: `blocked-${r.id}`,
      severity: revokedAttempt ? 'critical' : 'warn',
      title: `${nameOf(r.agentId)}: ${BLOCK_REASON_LABEL[r.reason] ?? 'Blocked'}`,
      detail: `Request #${r.id} for ${fmtUsdc(r.amount)} USDC was blocked by the contract. Nothing was transferred.`,
      agentId: r.agentId,
      at: Number(r.createdAt),
    })
  }

  for (const r of requests) {
    if (r.status !== RequestStatus.Pending) continue
    const expired = Number(r.expiresAt) <= now
    const stale = now - Number(r.createdAt) >= THRESHOLDS.stalePendingSec
    alerts.push({
      id: `pending-${r.id}`,
      severity: expired ? 'info' : stale ? 'warn' : 'info',
      title: expired
        ? `Request #${r.id} expired without a decision`
        : `${nameOf(r.agentId)}: ${fmtUsdc(r.amount)} USDC awaiting your approval`,
      detail: expired
        ? 'It can no longer be approved. Decline it to clear the queue.'
        : stale
          ? 'Waiting more than 24 hours for an owner decision.'
          : 'Open Approvals to review and decide.',
      agentId: r.agentId,
      at: Number(r.createdAt),
    })
  }

  return alerts.sort((a, b) => RANK[a.severity] - RANK[b.severity] || (b.at ?? 0) - (a.at ?? 0))
}

/** Sum of executed payments for an agent (or all agents) since a timestamp. */
export function spentSince(requests: PayRequest[], since: number, agentId?: bigint): bigint {
  return requests
    .filter(
      (r) =>
        r.status === RequestStatus.Executed &&
        Number(r.resolvedAt) >= since &&
        (agentId === undefined || r.agentId === agentId),
    )
    .reduce((sum, r) => sum + r.amount, 0n)
}

export interface DayBucket {
  label: string
  amount: bigint
}

export function spendByDay(requests: PayRequest[], days: number, now: number): DayBucket[] {
  const startOfToday = Math.floor(now / 86400) * 86400
  const buckets: DayBucket[] = []
  for (let i = days - 1; i >= 0; i--) {
    const start = startOfToday - i * 86400
    const amount = requests
      .filter(
        (r) =>
          r.status === RequestStatus.Executed &&
          Number(r.resolvedAt) >= start &&
          Number(r.resolvedAt) < start + 86400,
      )
      .reduce((sum, r) => sum + r.amount, 0n)
    buckets.push({
      label: new Date(start * 1000).toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' }),
      amount,
    })
  }
  return buckets
}
