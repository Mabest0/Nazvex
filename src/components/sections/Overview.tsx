import { ArrowRight, Bot, Check, Circle } from 'lucide-react'
import type { NavProps } from '@/App'
import { useNexora } from '@/hooks/NexoraProvider'
import { fmtUsdc, timeAgo, toneFor } from '@/lib/format'
import { pct } from '@/lib/format'
import { AgentStatus, BLOCK_REASON_LABEL, RequestStatus } from '@/lib/vault'
import { AgentStatusPill, ConnectGate, Empty, PageHeader, ProgressBar, RequestStatusPill, Stat } from '../ui'

export function Overview({ go }: NavProps) {
  const { agents, requests, usdcBalance, loading, now } = useNexora()

  const allocated = agents.reduce((s, a) => s + a.totalFunded, 0n)
  const spent = agents.reduce((s, a) => s + a.totalSpent, 0n)
  const remaining = agents.reduce((s, a) => s + a.balance, 0n)
  const active = agents.filter((a) => a.status === AgentStatus.Active).length
  const pending = requests.filter((r) => r.status === RequestStatus.Pending && Number(r.expiresAt) > now).length
  const blocked = requests.filter((r) => r.status === RequestStatus.Blocked).length
  const executed = requests.filter((r) => r.status === RequestStatus.Executed).length

  const milestones = [
    { label: 'Wallet connected to Arc Testnet', done: true },
    { label: 'Test USDC in your wallet', done: usdcBalance > 0n },
    { label: 'Register three agents', done: agents.length >= 3 },
    { label: 'Allocate budgets', done: agents.filter((a) => a.totalFunded > 0n).length >= 1 },
    { label: 'A payment executed under policy', done: executed > 0 },
    { label: 'A request blocked by policy', done: blocked > 0 },
  ]

  return (
    <>
      <PageHeader
        title="Overview"
        subtitle="Budgets, spending and activity across every agent you control."
        action={
          <button type="button" className="btn btn-primary" onClick={() => go('agents')}>
            <Bot className="size-4" /> Manage agents
          </button>
        }
      />
      <ConnectGate>
        {agents.length === 0 && !loading ? (
          <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
            <Empty
              icon={<Bot className="size-6" />}
              title="Register your first agent"
              body="Give an agent a funded vault, a spending policy and an approved recipient list. The contract enforces every rule."
              action={
                <button type="button" className="btn btn-primary" onClick={() => go('agents')}>
                  Register an agent
                </button>
              }
            />
            <Checklist items={milestones} />
          </div>
        ) : (
          <div className="grid gap-4">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Stat label="Remaining in vaults" usdc value={fmtUsdc(remaining)} sub={`${active} active of ${agents.length} agents`} />
              <Stat label="Total allocated" usdc value={fmtUsdc(allocated)} sub="Funded to agents so far" />
              <Stat label="Total spent" usdc value={fmtUsdc(spent)} sub={`${executed} executed payments`} />
              <Stat label="Wallet balance" usdc value={fmtUsdc(usdcBalance)} sub="Your connected wallet" />
            </div>

            <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
              <section className="card p-5">
                <div className="mb-4 flex items-center justify-between">
                  <h2 className="display text-lg font-semibold">Agent budgets</h2>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => go('agents')}>
                    All agents <ArrowRight className="size-3.5" />
                  </button>
                </div>
                <div className="flex flex-col gap-3">
                  {agents.map((a) => {
                    const used = pct(a.totalSpent, a.totalFunded)
                    return (
                      <button key={a.id.toString()} type="button" onClick={() => go('controls', a.id)} className="card-inner p-4 text-left transition-colors hover:bg-white/5">
                        <div className="flex items-center justify-between gap-3">
                          <span className="font-semibold">{a.name}</span>
                          <AgentStatusPill status={a.status} />
                        </div>
                        <div className="mt-3">
                          <ProgressBar value={used} tone={toneFor(used)} />
                        </div>
                        <div className="mt-2 flex justify-between text-xs tabular-nums" style={{ color: 'var(--muted)' }}>
                          <span>{fmtUsdc(a.totalSpent)} spent of {fmtUsdc(a.totalFunded)}</span>
                          <span>{fmtUsdc(a.balance)} left</span>
                        </div>
                      </button>
                    )
                  })}
                </div>
              </section>

              <div className="grid content-start gap-4">
                <section className="card p-5">
                  <h2 className="display mb-3 text-lg font-semibold">Needs attention</h2>
                  <div className="grid grid-cols-2 gap-3">
                    <button type="button" onClick={() => go('approvals')} className="card-inner p-4 text-left hover:bg-white/5">
                      <div className="display text-3xl font-bold tabular-nums" style={{ color: pending ? 'var(--warn)' : undefined }}>{pending}</div>
                      <div className="mt-1 text-xs" style={{ color: 'var(--subtle)' }}>Awaiting approval</div>
                    </button>
                    <button type="button" onClick={() => go('security')} className="card-inner p-4 text-left hover:bg-white/5">
                      <div className="display text-3xl font-bold tabular-nums" style={{ color: blocked ? 'var(--danger)' : undefined }}>{blocked}</div>
                      <div className="mt-1 text-xs" style={{ color: 'var(--subtle)' }}>Blocked by policy</div>
                    </button>
                  </div>
                </section>

                <section className="card p-5">
                  <div className="mb-3 flex items-center justify-between">
                    <h2 className="display text-lg font-semibold">Recent activity</h2>
                    <button type="button" className="text-xs font-semibold" style={{ color: 'var(--accent)' }} onClick={() => go('transactions')}>
                      View all
                    </button>
                  </div>
                  {requests.length === 0 ? (
                    <p className="text-sm" style={{ color: 'var(--subtle)' }}>
                      No payment requests yet. Agents submit them from the Transactions page.
                    </p>
                  ) : (
                    <ul className="flex flex-col gap-2.5">
                      {requests.slice(0, 5).map((r) => (
                        <li key={r.id.toString()} className="flex items-center justify-between gap-3 text-sm">
                          <div className="min-w-0">
                            <div className="truncate font-medium tabular-nums">{fmtUsdc(r.amount)} USDC</div>
                            <div className="truncate text-xs" style={{ color: 'var(--subtle)' }}>
                              {agents.find((a) => a.id === r.agentId)?.name ?? `Agent #${r.agentId}`} · {timeAgo(r.createdAt, now)}
                              {r.status === RequestStatus.Blocked ? ` · ${BLOCK_REASON_LABEL[r.reason]}` : ''}
                            </div>
                          </div>
                          <RequestStatusPill status={r.status} expired={Number(r.expiresAt) <= now} />
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
                {agents.length < 3 && <Checklist items={milestones} />}
              </div>
            </div>
          </div>
        )}
      </ConnectGate>
    </>
  )
}

function Checklist({ items }: { items: Array<{ label: string; done: boolean }> }) {
  return (
    <section className="card p-5">
      <h2 className="display mb-3 text-lg font-semibold">First milestone</h2>
      <ul className="flex flex-col gap-2.5">
        {items.map((i) => (
          <li key={i.label} className="flex items-center gap-2.5 text-sm" style={{ color: i.done ? 'var(--ink)' : 'var(--subtle)' }}>
            {i.done ? <Check className="size-4" style={{ color: 'var(--success)' }} /> : <Circle className="size-4" />}
            {i.label}
          </li>
        ))}
      </ul>
    </section>
  )
}
