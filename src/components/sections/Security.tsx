import { useMemo } from 'react'
import { AlertTriangle, Info, OctagonAlert, ShieldCheck } from 'lucide-react'
import type { NavProps } from '@/App'
import { useNexora } from '@/hooks/NexoraProvider'
import { timeAgo } from '@/lib/format'
import { computeAlerts, THRESHOLDS, type Severity } from '@/lib/monitoring'
import { AgentStatusPill, ConnectGate, Empty, PageHeader } from '../ui'

const TONE: Record<Severity, { color: string; icon: typeof Info; label: string }> = {
  critical: { color: 'var(--danger)', icon: OctagonAlert, label: 'High priority' },
  warn: { color: 'var(--warn)', icon: AlertTriangle, label: 'Review' },
  info: { color: 'var(--accent)', icon: Info, label: 'Notice' },
}

export function Security({ go }: NavProps) {
  const { agents, requests, now } = useNexora()
  const alerts = useMemo(() => computeAlerts(agents, requests, now), [agents, requests, now])

  return (
    <>
      <PageHeader
        title="Security Center"
        subtitle="Policy violations and unusual activity signals from transparent rules. Signals are prompts to review, not proof of fraud."
      />
      <ConnectGate>
        {agents.length === 0 ? (
          <Empty icon={<ShieldCheck className="size-6" />} title="Nothing to monitor yet" body="Alerts appear here once you have registered agents and they start submitting requests." action={<button type="button" className="btn btn-primary" onClick={() => go('agents')}>Register an agent</button>} />
        ) : (
          <div className="grid gap-4 lg:grid-cols-[1.5fr_1fr]">
            <section className="card p-5">
              <h2 className="display mb-4 text-lg font-semibold">Signals</h2>
              {alerts.length === 0 ? (
                <div className="flex items-center gap-3 py-8 text-sm" style={{ color: 'var(--muted)' }}>
                  <ShieldCheck className="size-6" style={{ color: 'var(--success)' }} /> No signals. All agents are operating within their policies.
                </div>
              ) : (
                <ul className="flex flex-col gap-2.5">
                  {alerts.map((a) => {
                    const tone = TONE[a.severity]
                    const Icon = tone.icon
                    return (
                      <li key={a.id} className="card-inner flex gap-3 p-3.5">
                        <Icon className="mt-0.5 size-5 shrink-0" style={{ color: tone.color }} />
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <span className="text-sm font-semibold">{a.title}</span>
                            <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: tone.color }}>{tone.label}</span>
                          </div>
                          <p className="mt-1 text-pretty text-xs" style={{ color: 'var(--muted)' }}>{a.detail}</p>
                          {a.at && <div className="mt-1 text-[11px]" style={{ color: 'var(--subtle)' }}>{timeAgo(a.at, now)}</div>}
                        </div>
                      </li>
                    )
                  })}
                </ul>
              )}
            </section>

            <div className="grid content-start gap-4">
              <section className="card p-5">
                <h2 className="display mb-3 text-lg font-semibold">Agent status</h2>
                <ul className="flex flex-col gap-2.5">
                  {agents.map((a) => (
                    <li key={a.id.toString()} className="flex items-center justify-between text-sm">
                      <button type="button" className="font-medium hover:underline" onClick={() => go('controls', a.id)}>{a.name}</button>
                      <AgentStatusPill status={a.status} />
                    </li>
                  ))}
                </ul>
              </section>
              <section className="card p-5">
                <h2 className="display mb-3 text-lg font-semibold">Detection rules</h2>
                <ul className="flex flex-col gap-2 text-xs" style={{ color: 'var(--muted)' }}>
                  <li>{THRESHOLDS.repeatedBlocks}+ blocked requests from one agent in 24 hours</li>
                  <li>{THRESHOLDS.burstCount}+ requests from one agent within 10 minutes</li>
                  <li>Budget usage at {THRESHOLDS.budgetWarnPct}% (review) and {THRESHOLDS.budgetCriticalPct}% (high priority)</li>
                  <li>Requests waiting for approval more than 24 hours</li>
                  <li>Budgets expired or expiring within 24 hours</li>
                  <li>Any request blocked by the contract, including recipients outside the allowlist</li>
                </ul>
              </section>
            </div>
          </div>
        )}
      </ConnectGate>
    </>
  )
}
