import { useState } from 'react'
import { Bot, Pause, Play, Plus, ShieldOff, SlidersHorizontal, Wallet } from 'lucide-react'
import type { NavProps } from '@/App'
import { nazvexVaultAbi } from '@/contracts/nazvexVaultAbi'
import { useNazvex } from '@/hooks/NazvexProvider'
import { useTx } from '@/hooks/useTx'
import { fmtDate, fmtUsdc, pct, toneFor } from '@/lib/format'
import { AgentStatus, VAULT_ADDRESS, type Agent } from '@/lib/vault'
import { RegisterAgentModal } from '../RegisterAgentModal'
import { AddressChip, AgentStatusPill, ConnectGate, Empty, Modal, PageHeader, ProgressBar, Spinner } from '../ui'

export function Agents({ go }: NavProps) {
  const { agents, loading } = useNazvex()
  const [registerOpen, setRegisterOpen] = useState(false)
  const [revoking, setRevoking] = useState<Agent | null>(null)
  const tx = useTx()

  const setStatus = (agent: Agent, fn: 'pauseAgent' | 'resumeAgent') =>
    tx.run(fn === 'pauseAgent' ? `Pause ${agent.name}` : `Resume ${agent.name}`, () =>
      tx.write({ address: VAULT_ADDRESS, abi: nazvexVaultAbi, functionName: fn, args: [agent.id] }),
    )

  const revoke = async () => {
    if (!revoking) return
    const done = await tx.run(`Revoke ${revoking.name}`, () =>
      tx.write({ address: VAULT_ADDRESS, abi: nazvexVaultAbi, functionName: 'revokeAgent', args: [revoking.id] }),
    )
    if (done) setRevoking(null)
  }

  return (
    <>
      <PageHeader
        title="My Agents"
        subtitle="Register agents, then pause or revoke them at any time. Revocation is permanent but your funds stay withdrawable."
        action={
          <button type="button" className="btn btn-primary" onClick={() => setRegisterOpen(true)}>
            <Plus className="size-4" /> Register agent
          </button>
        }
      />
      <ConnectGate>
        {loading ? (
          <div className="flex justify-center py-20"><Spinner className="size-6" /></div>
        ) : agents.length === 0 ? (
          <Empty
            icon={<Bot className="size-6" />}
            title="No agents yet"
            body="Register an agent with a wallet address, a spending policy and an approved recipient list."
            action={<button type="button" className="btn btn-primary" onClick={() => setRegisterOpen(true)}>Register your first agent</button>}
          />
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {agents.map((a) => {
              const todayPct = pct(a.spentToday, a.policy.dailyLimit)
              const usedPct = pct(a.totalSpent, a.totalFunded)
              const revoked = a.status === AgentStatus.Revoked
              return (
                <article key={a.id.toString()} className="card flex flex-col gap-4 p-5">
                  <header className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="display text-xl font-semibold">{a.name}</h3>
                      <div className="mt-1 text-xs" style={{ color: 'var(--subtle)' }}>
                        Agent #{a.id.toString()} · created {fmtDate(a.createdAt)}
                      </div>
                    </div>
                    <AgentStatusPill status={a.status} />
                  </header>
                  <div className="text-xs"><AddressChip address={a.wallet} label="Wallet" /></div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="card-inner p-3">
                      <div className="label">Vault balance</div>
                      <div className="display mt-1 text-xl font-bold tabular-nums">{fmtUsdc(a.balance)}</div>
                      <div className="mt-2"><ProgressBar value={usedPct} tone={toneFor(usedPct)} /></div>
                      <div className="mt-1 text-[11px]" style={{ color: 'var(--subtle)' }}>{fmtUsdc(a.totalSpent)} of {fmtUsdc(a.totalFunded)} used</div>
                    </div>
                    <div className="card-inner p-3">
                      <div className="label">Spent today</div>
                      <div className="display mt-1 text-xl font-bold tabular-nums">{fmtUsdc(a.spentToday)}</div>
                      <div className="mt-2"><ProgressBar value={todayPct} tone={toneFor(todayPct)} /></div>
                      <div className="mt-1 text-[11px]" style={{ color: 'var(--subtle)' }}>of {fmtUsdc(a.policy.dailyLimit)} daily limit</div>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => go('wallets', a.id)}><Wallet className="size-3.5" /> Fund</button>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => go('controls', a.id)}><SlidersHorizontal className="size-3.5" /> Controls</button>
                    {a.status === AgentStatus.Active && (
                      <button type="button" className="btn btn-ghost btn-sm" disabled={tx.busy} onClick={() => void setStatus(a, 'pauseAgent')}><Pause className="size-3.5" /> Pause</button>
                    )}
                    {a.status === AgentStatus.Paused && (
                      <button type="button" className="btn btn-ghost btn-sm" disabled={tx.busy} onClick={() => void setStatus(a, 'resumeAgent')}><Play className="size-3.5" /> Resume</button>
                    )}
                    {!revoked && (
                      <button type="button" className="btn btn-danger btn-sm" disabled={tx.busy} onClick={() => setRevoking(a)}><ShieldOff className="size-3.5" /> Revoke</button>
                    )}
                  </div>
                </article>
              )
            })}
          </div>
        )}
      </ConnectGate>

      <RegisterAgentModal open={registerOpen} onClose={() => setRegisterOpen(false)} onDone={() => setRegisterOpen(false)} />

      <Modal open={!!revoking} onClose={() => setRevoking(null)} title={`Revoke ${revoking?.name ?? 'agent'}?`}>
        <p className="text-sm" style={{ color: 'var(--muted)' }}>
          Revoking permanently disables this agent. Every future payment request is rejected by the contract. You can still withdraw its remaining vault balance.
        </p>
        <div className="mt-5 flex gap-2">
          <button type="button" className="btn btn-ghost flex-1" onClick={() => setRevoking(null)}>Cancel</button>
          <button type="button" className="btn btn-danger flex-1" disabled={tx.busy} onClick={() => void revoke()}>
            {tx.busy ? <Spinner /> : 'Revoke permanently'}
          </button>
        </div>
      </Modal>
    </>
  )
}
