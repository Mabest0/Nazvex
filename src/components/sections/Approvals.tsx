import { Check, CheckCheck, X } from 'lucide-react'
import type { NavProps } from '@/App'
import { nexoraVaultAbi } from '@/contracts/nexoraVaultAbi'
import { useNexora } from '@/hooks/NexoraProvider'
import { useTx } from '@/hooks/useTx'
import { fmtUsdc, sameAddr, timeAgo, timeUntil } from '@/lib/format'
import { AgentStatus, RequestStatus, VAULT_ADDRESS, type Agent, type PayRequest } from '@/lib/vault'
import { AddressChip, ConnectGate, Empty, PageHeader, Spinner } from '../ui'

interface PolicyCheck {
  label: string
  ok: boolean
}

function policyChecks(agent: Agent | undefined, r: PayRequest, allowed: string[], now: number): PolicyCheck[] {
  if (!agent) return []
  const exp = Number(agent.policy.expiresAt)
  return [
    { label: 'Agent is active', ok: agent.status === AgentStatus.Active },
    { label: 'Budget has not expired', ok: exp === 0 || exp > now },
    { label: `Within per-transaction limit (${fmtUsdc(agent.policy.maxPerTx)})`, ok: r.amount <= agent.policy.maxPerTx },
    { label: `Within daily limit (${fmtUsdc(agent.remainingToday)} left today)`, ok: r.amount <= agent.remainingToday },
    { label: 'Recipient is on the allowlist', ok: allowed.some((a) => sameAddr(a, r.to)) },
    { label: `Vault balance covers it (${fmtUsdc(agent.balance)})`, ok: agent.balance >= r.amount },
  ]
}

export function Approvals({ go }: NavProps) {
  const { agents, requests, recipients, now } = useNexora()
  const tx = useTx()
  const pending = requests.filter((r) => r.status === RequestStatus.Pending)

  const decide = (r: PayRequest, fn: 'approveRequest' | 'declineRequest') =>
    tx.run(fn === 'approveRequest' ? `Approve #${r.id}` : `Decline #${r.id}`, () =>
      tx.write({ address: VAULT_ADDRESS, abi: nexoraVaultAbi, functionName: fn, args: [r.id] }),
    )

  return (
    <>
      <PageHeader title="Approvals" subtitle="Requests above an agent's approval threshold wait here. Approval never overrides hard limits: the contract re-checks everything when you approve." />
      <ConnectGate>
        {pending.length === 0 ? (
          <Empty icon={<CheckCheck className="size-6" />} title="Nothing waiting" body="When an agent requests more than its approval threshold, the request appears here for your decision." action={<button type="button" className="btn btn-ghost" onClick={() => go('transactions')}>Open Transactions</button>} />
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {pending.map((r) => {
              const agent = agents.find((a) => a.id === r.agentId)
              const checks = policyChecks(agent, r, recipients[r.agentId.toString()] ?? [], now)
              const expired = Number(r.expiresAt) <= now
              const allOk = checks.every((c) => c.ok)
              return (
                <article key={r.id.toString()} className="card flex flex-col gap-4 p-5">
                  <header className="flex items-start justify-between gap-3">
                    <div>
                      <div className="label">Request #{r.id.toString()}</div>
                      <h3 className="display mt-1 text-2xl font-bold tabular-nums">{fmtUsdc(r.amount)} <span className="text-sm font-medium" style={{ color: 'var(--subtle)' }}>USDC</span></h3>
                    </div>
                    <span className={`pill ${expired ? '' : 'pill-warn'}`}>{expired ? 'Expired' : timeUntil(r.expiresAt, now)}</span>
                  </header>
                  <dl className="grid gap-2 text-sm">
                    <div className="flex justify-between gap-3"><dt style={{ color: 'var(--subtle)' }}>Agent</dt><dd className="font-medium">{agent?.name ?? `#${r.agentId}`}</dd></div>
                    <div className="flex justify-between gap-3"><dt style={{ color: 'var(--subtle)' }}>Recipient</dt><dd><AddressChip address={r.to} /></dd></div>
                    <div className="flex justify-between gap-3"><dt style={{ color: 'var(--subtle)' }}>Purpose</dt><dd className="text-right">{r.purpose || 'Not provided'}</dd></div>
                    <div className="flex justify-between gap-3"><dt style={{ color: 'var(--subtle)' }}>Requested</dt><dd>{timeAgo(r.createdAt, now)}</dd></div>
                  </dl>
                  <ul className="card-inner flex flex-col gap-1.5 p-3 text-xs">
                    {checks.map((c) => (
                      <li key={c.label} className="flex items-center gap-2" style={{ color: c.ok ? 'var(--muted)' : 'var(--danger)' }}>
                        {c.ok ? <Check className="size-3.5" style={{ color: 'var(--success)' }} /> : <X className="size-3.5" />} {c.label}
                      </li>
                    ))}
                  </ul>
                  {agent && (
                    <p className="text-xs" style={{ color: 'var(--subtle)' }}>
                      {allOk && !expired
                        ? `If approved, the vault balance drops from ${fmtUsdc(agent.balance)} to ${fmtUsdc(agent.balance - r.amount)} USDC.`
                        : expired
                          ? 'This request can no longer be approved. Decline it to clear it.'
                          : 'A policy check now fails. Approving will record the request as blocked and move no funds.'}
                    </p>
                  )}
                  <div className="mt-auto flex gap-2">
                    <button type="button" className="btn btn-danger flex-1" disabled={tx.busy} onClick={() => void decide(r, 'declineRequest')}>Decline</button>
                    <button type="button" className="btn btn-primary flex-1" disabled={tx.busy || expired} onClick={() => void decide(r, 'approveRequest')}>
                      {tx.busy ? <Spinner /> : 'Approve and execute'}
                    </button>
                  </div>
                </article>
              )
            })}
          </div>
        )}
      </ConnectGate>
    </>
  )
}
