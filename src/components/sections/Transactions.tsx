import { useMemo, useState } from 'react'
import { isAddress } from 'viem'
import { useReadContract } from 'wagmi'
import { toast } from 'sonner'
import { Check, ReceiptText, Send, ShieldX, Hourglass } from 'lucide-react'
import type { NavProps } from '@/App'
import { nazvexVaultAbi } from '@/contracts/nazvexVaultAbi'
import { useNazvex } from '@/hooks/NazvexProvider'
import { paymentOutcome, useTx } from '@/hooks/useTx'
import { fmtUsdc, sameAddr, shortAddr, timeAgo } from '@/lib/format'
import { parseUsdc } from '@/onchain-money'
import {
  AGENT_STATUS_LABEL,
  BLOCK_REASON_LABEL,
  CHAIN_ID,
  REQUEST_STATUS_LABEL,
  RequestStatus,
  VAULT_ADDRESS,
} from '@/lib/vault'
import { AddressChip, AmountInput, ConnectGate, Empty, Field, PageHeader, RequestStatusPill, Spinner } from '../ui'

const FILTERS = ['All', ...REQUEST_STATUS_LABEL] as const

function safeParse(v: string): bigint | null {
  try {
    return v.trim() ? parseUsdc(v.trim()) : null
  } catch {
    return null
  }
}

function RequestForm({ focusAgent }: { focusAgent?: bigint }) {
  const { agents, recipients, address } = useNazvex()
  const tx = useTx()
  const [agentId, setAgentId] = useState<bigint | undefined>(focusAgent)
  const [to, setTo] = useState('')
  const [amount, setAmount] = useState('')
  const [purpose, setPurpose] = useState('')

  const agent = agents.find((a) => a.id === agentId) ?? agents.find((a) => sameAddr(a.wallet, address)) ?? agents[0]
  const isAgentWallet = !!agent && sameAddr(agent.wallet, address)
  const raw = safeParse(amount)
  const ready = !!agent && isAddress(to) && raw !== null && raw > 0n

  const preview = useReadContract({
    address: VAULT_ADDRESS,
    abi: nazvexVaultAbi,
    chainId: CHAIN_ID,
    functionName: 'previewPayment',
    args: ready && agent && raw ? [agent.id, to, raw] : undefined,
    query: { enabled: ready, refetchInterval: 8000 },
  })
  const reason = preview.data ? Number(preview.data[0]) : undefined
  const needsApproval = preview.data ? preview.data[1] : false

  const submit = async () => {
    if (!agent || !ready || !raw) return
    const result = await tx.run('Payment request', () =>
      tx.write({
        address: VAULT_ADDRESS,
        abi: nazvexVaultAbi,
        functionName: 'requestPayment',
        args: [agent.id, to, raw, purpose.trim()],
      }),
      { quiet: true },
    )
    if (!result) return
    const outcome = paymentOutcome(result.receipt)
    if (outcome?.kind === 'executed') toast.success(`Paid ${fmtUsdc(raw)} USDC. Confirmed onchain.`)
    else if (outcome?.kind === 'pending') toast.info('Request is pending your approval. Open Approvals to decide.')
    else if (outcome?.kind === 'blocked') toast.error(`Blocked by policy: ${BLOCK_REASON_LABEL[outcome.reason]}. No funds moved.`)
    setAmount('')
    setPurpose('')
  }

  return (
    <section className="card p-5">
      <h2 className="display text-lg font-semibold">Submit an agent payment request</h2>
      <p className="mb-4 mt-1 text-xs" style={{ color: 'var(--subtle)' }}>
        Requests must come from the agent&apos;s own wallet. Rejections are recorded onchain with the reason.
      </p>
      <div className="grid gap-4">
        <Field label="Agent">
          <select className="input" value={agent?.id.toString() ?? ''} onChange={(e) => setAgentId(BigInt(e.target.value))}>
            {agents.map((a) => (
              <option key={a.id.toString()} value={a.id.toString()}>
                {a.name} ({AGENT_STATUS_LABEL[a.status]}, {fmtUsdc(a.balance)} USDC)
              </option>
            ))}
          </select>
        </Field>
        {agent && !isAgentWallet && (
          <p className="rounded-xl px-3 py-2 text-xs" style={{ background: 'rgba(233,196,106,0.1)', color: 'var(--warn)' }}>
            This agent&apos;s wallet is {shortAddr(agent.wallet)}. Connect that wallet to submit requests for it.
          </p>
        )}
        <Field label="Recipient">
          <input className="input mono" list="allowlist" placeholder="0x..." value={to} onChange={(e) => setTo(e.target.value.trim())} />
          <datalist id="allowlist">
            {(agent ? recipients[agent.id.toString()] ?? [] : []).map((r) => <option key={r} value={r} />)}
          </datalist>
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Amount"><AmountInput value={amount} onChange={setAmount} /></Field>
          <Field label="Purpose"><input className="input" maxLength={140} placeholder="API credits for data feed" value={purpose} onChange={(e) => setPurpose(e.target.value)} /></Field>
        </div>

        {ready && (
          <div className="card-inner flex items-start gap-3 p-3 text-sm">
            {preview.isLoading || reason === undefined ? (
              <><Spinner className="mt-0.5 size-4" /> <span style={{ color: 'var(--subtle)' }}>Checking policy...</span></>
            ) : reason !== 0 ? (
              <><ShieldX className="mt-0.5 size-4 shrink-0" style={{ color: 'var(--danger)' }} /><span><strong style={{ color: 'var(--danger)' }}>Will be blocked:</strong> {BLOCK_REASON_LABEL[reason]}. Submitting records the rejection and moves no funds.</span></>
            ) : needsApproval ? (
              <><Hourglass className="mt-0.5 size-4 shrink-0" style={{ color: 'var(--warn)' }} /><span><strong style={{ color: 'var(--warn)' }}>Needs owner approval.</strong> It stays pending until you approve or decline.</span></>
            ) : (
              <><Check className="mt-0.5 size-4 shrink-0" style={{ color: 'var(--success)' }} /><span><strong style={{ color: 'var(--success)' }}>Within policy.</strong> It executes immediately.</span></>
            )}
          </div>
        )}

        <button type="button" className="btn btn-primary" disabled={!ready || !isAgentWallet || tx.busy} onClick={() => void submit()}>
          {tx.phase === 'wallet' ? <><Spinner /> Confirm in wallet...</> : tx.phase === 'confirming' ? <><Spinner /> Confirming...</> : <><Send className="size-4" /> {reason ? 'Submit anyway' : 'Submit request'}</>}
        </button>
      </div>
    </section>
  )
}

export function Transactions({ go, focusAgent }: NavProps) {
  const { agents, requests, now } = useNazvex()
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>('All')

  const rows = useMemo(
    () => requests.filter((r) => filter === 'All' || REQUEST_STATUS_LABEL[r.status] === filter),
    [requests, filter],
  )

  return (
    <>
      <PageHeader title="Transactions" subtitle="Every payment request and what the contract decided. A request is not a transaction until it shows Executed." />
      <ConnectGate>
        {agents.length === 0 ? (
          <Empty icon={<ReceiptText className="size-6" />} title="No agents yet" body="Register and fund an agent before submitting payment requests." action={<button type="button" className="btn btn-primary" onClick={() => go('agents')}>Register an agent</button>} />
        ) : (
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)]">
            <RequestForm focusAgent={focusAgent} />
            <section className="card p-5">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                <h2 className="display text-lg font-semibold">Activity</h2>
                <div className="flex flex-wrap gap-1.5">
                  {FILTERS.map((f) => (
                    <button key={f} type="button" onClick={() => setFilter(f)} className="pill cursor-pointer" style={filter === f ? { background: 'var(--accent)', color: '#0d1b2f', borderColor: 'transparent' } : undefined}>
                      {f}
                    </button>
                  ))}
                </div>
              </div>
              {rows.length === 0 ? (
                <p className="py-10 text-center text-sm" style={{ color: 'var(--subtle)' }}>No requests match this filter.</p>
              ) : (
                <ul className="flex flex-col gap-2.5">
                  {rows.map((r) => {
                    const agent = agents.find((a) => a.id === r.agentId)
                    const expired = r.status === RequestStatus.Pending && Number(r.expiresAt) <= now
                    return (
                      <li key={r.id.toString()} className="card-inner p-3.5">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="flex items-baseline gap-2">
                              <span className="display text-lg font-bold tabular-nums">{fmtUsdc(r.amount)}</span>
                              <span className="text-xs" style={{ color: 'var(--subtle)' }}>USDC to</span>
                              <AddressChip address={r.to} />
                            </div>
                            <div className="mt-1 truncate text-xs" style={{ color: 'var(--subtle)' }}>
                              #{r.id.toString()} · {agent?.name ?? `Agent #${r.agentId}`} · {timeAgo(r.createdAt, now)}
                              {r.purpose ? ` · ${r.purpose}` : ''}
                            </div>
                            {r.status === RequestStatus.Blocked && (
                              <div className="mt-1.5 text-xs font-medium" style={{ color: 'var(--danger)' }}>{BLOCK_REASON_LABEL[r.reason]}</div>
                            )}
                          </div>
                          <RequestStatusPill status={r.status} expired={expired} />
                        </div>
                      </li>
                    )
                  })}
                </ul>
              )}
            </section>
          </div>
        )}
      </ConnectGate>
    </>
  )
}
