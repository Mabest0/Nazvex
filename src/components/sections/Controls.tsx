import { useState } from 'react'
import { isAddress, type Address } from 'viem'
import { Lock, Plus, SlidersHorizontal, Trash2 } from 'lucide-react'
import type { NavProps } from '@/App'
import { nazvexVaultAbi } from '@/contracts/nazvexVaultAbi'
import { useNazvex } from '@/hooks/NazvexProvider'
import { useTx } from '@/hooks/useTx'
import { fmtDate, nowSec, sameAddr } from '@/lib/format'
import { formatUnitsExact, parseUsdc } from '@/onchain-money'
import { AgentStatus, VAULT_ADDRESS, type Agent } from '@/lib/vault'
import { AddressChip, AgentStatusPill, AmountInput, ConnectGate, Empty, Field, PageHeader, Spinner } from '../ui'

function safeParse(v: string): bigint | null {
  try {
    return v.trim() ? parseUsdc(v.trim()) : null
  } catch {
    return null
  }
}

function PolicyForm({ agent }: { agent: Agent }) {
  const tx = useTx()
  const p = agent.policy
  const [max, setMax] = useState(formatUnitsExact(p.maxPerTx, 6))
  const [daily, setDaily] = useState(formatUnitsExact(p.dailyLimit, 6))
  const [threshold, setThreshold] = useState(p.approvalThreshold === p.maxPerTx ? '' : formatUnitsExact(p.approvalThreshold, 6))
  const [expiryMode, setExpiryMode] = useState<'keep' | 'never' | 'days'>('keep')
  const [days, setDays] = useState('30')

  const maxRaw = safeParse(max)
  const dailyRaw = safeParse(daily)
  const thresholdRaw = threshold.trim() ? safeParse(threshold) : maxRaw
  const daysNum = Number(days)
  const expiresAt =
    expiryMode === 'keep' ? p.expiresAt : expiryMode === 'never' ? 0n : BigInt(nowSec() + Math.max(1, daysNum) * 86400)

  const problem =
    !maxRaw || maxRaw <= 0n
      ? 'Set a per-transaction maximum'
      : !dailyRaw || dailyRaw < maxRaw
        ? 'Daily limit must be at least the per-transaction maximum'
        : thresholdRaw === null || thresholdRaw > maxRaw
          ? 'Approval threshold cannot exceed the per-transaction maximum'
          : expiryMode === 'days' && (!Number.isInteger(daysNum) || daysNum < 1)
            ? 'Expiry must be a whole number of days'
            : null

  const save = () => {
    if (problem || !maxRaw || !dailyRaw || thresholdRaw === null) return
    void tx.run('Update policy', () =>
      tx.write({
        address: VAULT_ADDRESS,
        abi: nazvexVaultAbi,
        functionName: 'setPolicy',
        args: [agent.id, { maxPerTx: maxRaw, dailyLimit: dailyRaw, approvalThreshold: thresholdRaw, expiresAt }],
      }),
    )
  }

  return (
    <section className="card p-5">
      <h2 className="display text-lg font-semibold">Spending policy</h2>
      <p className="mb-4 mt-1 text-xs" style={{ color: 'var(--subtle)' }}>Enforced by the vault contract on every payment. Daily limits reset at 00:00 UTC.</p>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Max per transaction"><AmountInput value={max} onChange={setMax} /></Field>
        <Field label="Daily limit"><AmountInput value={daily} onChange={setDaily} /></Field>
        <Field label="Require approval above" hint="Blank means no human approval."><AmountInput value={threshold} onChange={setThreshold} placeholder="none" /></Field>
        <Field label="Budget expiry" hint={p.expiresAt > 0n ? `Currently ${fmtDate(p.expiresAt)}` : 'Currently never'}>
          <div className="flex gap-2">
            <select className="input" value={expiryMode} onChange={(e) => setExpiryMode(e.target.value as typeof expiryMode)}>
              <option value="keep">Keep current</option>
              <option value="never">Never expires</option>
              <option value="days">In N days</option>
            </select>
            {expiryMode === 'days' && (
              <input className="input w-24 tabular-nums" inputMode="numeric" value={days} onChange={(e) => /^\d*$/.test(e.target.value) && setDays(e.target.value)} />
            )}
          </div>
        </Field>
      </div>
      {problem && <p className="mt-3 text-xs" style={{ color: 'var(--warn)' }}>{problem}</p>}
      <button type="button" className="btn btn-primary mt-5" disabled={!!problem || tx.busy} onClick={save}>
        {tx.busy ? <Spinner /> : 'Save policy'}
      </button>
    </section>
  )
}

function Allowlist({ agent, recipients }: { agent: Agent; recipients: Address[] }) {
  const tx = useTx()
  const [input, setInput] = useState('')
  const valid = isAddress(input) && !recipients.some((r) => sameAddr(r, input))

  const add = async () => {
    if (!valid) return
    const done = await tx.run('Add recipient', () =>
      tx.write({ address: VAULT_ADDRESS, abi: nazvexVaultAbi, functionName: 'addRecipient', args: [agent.id, input] }),
    )
    if (done) setInput('')
  }
  const remove = (r: Address) =>
    tx.run('Remove recipient', () =>
      tx.write({ address: VAULT_ADDRESS, abi: nazvexVaultAbi, functionName: 'removeRecipient', args: [agent.id, r] }),
    )

  return (
    <section className="card p-5">
      <h2 className="display text-lg font-semibold">Approved recipients</h2>
      <p className="mb-4 mt-1 text-xs" style={{ color: 'var(--subtle)' }}>Payments to any address not on this list are blocked.</p>
      <div className="flex gap-2">
        <input className="input mono" placeholder="0x..." value={input} onChange={(e) => setInput(e.target.value.trim())} />
        <button type="button" className="btn btn-primary" disabled={!valid || tx.busy} onClick={() => void add()}><Plus className="size-4" /> Add</button>
      </div>
      <ul className="mt-4 flex flex-col gap-2">
        {recipients.length === 0 && <li className="text-sm" style={{ color: 'var(--warn)' }}>No recipients. Every payment from this agent will be blocked.</li>}
        {recipients.map((r) => (
          <li key={r} className="card-inner flex items-center justify-between gap-3 px-3 py-2">
            <AddressChip address={r} />
            <button type="button" aria-label="Remove recipient" className="rounded-lg p-2 hover:bg-white/10" disabled={tx.busy} onClick={() => void remove(r)}>
              <Trash2 className="size-4" style={{ color: 'var(--danger)' }} />
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}

function WalletRotation({ agent }: { agent: Agent }) {
  const tx = useTx()
  const [wallet, setWallet] = useState('')
  const valid = isAddress(wallet) && !sameAddr(wallet, agent.wallet)
  return (
    <section className="card p-5">
      <h2 className="display text-lg font-semibold">Agent wallet</h2>
      <p className="mb-4 mt-1 text-xs" style={{ color: 'var(--subtle)' }}>Rotate the key allowed to submit payment requests for this agent.</p>
      <div className="mb-3 text-xs"><AddressChip address={agent.wallet} label="Current" /></div>
      <div className="flex gap-2">
        <input className="input mono" placeholder="New wallet 0x..." value={wallet} onChange={(e) => setWallet(e.target.value.trim())} />
        <button
          type="button"
          className="btn btn-ghost"
          disabled={!valid || tx.busy}
          onClick={() => void tx.run('Rotate agent wallet', () => tx.write({ address: VAULT_ADDRESS, abi: nazvexVaultAbi, functionName: 'setAgentWallet', args: [agent.id, wallet as Address] })).then((r) => r && setWallet(''))}
        >
          Update
        </button>
      </div>
    </section>
  )
}

export function Controls({ go, focusAgent }: NavProps) {
  const { agents, recipients } = useNazvex()
  const [selected, setSelected] = useState<bigint | undefined>(focusAgent)

  const agent = agents.find((a) => a.id === selected) ?? agents[0]
  const revoked = agent?.status === AgentStatus.Revoked

  return (
    <>
      <PageHeader title="Financial Controls" subtitle="Budgets, limits, recipients and approval rules. The contract checks them on every request, whatever the AI or backend says." />
      <ConnectGate>
        {!agent ? (
          <Empty icon={<SlidersHorizontal className="size-6" />} title="No agents to configure" body="Register an agent to set its policy." action={<button type="button" className="btn btn-primary" onClick={() => go('agents')}>Register an agent</button>} />
        ) : (
          <div className="grid gap-4">
            <div className="flex flex-wrap items-center gap-2">
              {agents.map((a) => (
                <button
                  key={a.id.toString()}
                  type="button"
                  onClick={() => setSelected(a.id)}
                  className="btn btn-sm"
                  style={a.id === agent.id ? { background: 'var(--accent)', color: '#0d1b2f' } : { background: 'rgba(255,255,255,0.06)', color: 'var(--muted)' }}
                >
                  {a.name}
                </button>
              ))}
              <span className="ml-auto"><AgentStatusPill status={agent.status} /></span>
            </div>
            {revoked ? (
              <div className="card flex items-center gap-3 p-5 text-sm" style={{ color: 'var(--muted)' }}>
                <Lock className="size-5" /> This agent is revoked, so its policy is locked. You can still withdraw its balance from Agent Wallets.
              </div>
            ) : (
              <div className="grid gap-4 lg:grid-cols-2">
                <PolicyForm key={agent.id.toString()} agent={agent} />
                <div className="grid content-start gap-4">
                  <Allowlist agent={agent} recipients={recipients[agent.id.toString()] ?? []} />
                  <WalletRotation key={`w-${agent.id}`} agent={agent} />
                </div>
              </div>
            )}
          </div>
        )}
      </ConnectGate>
    </>
  )
}
