import { useMemo, useRef, useState, useEffect } from 'react'
import { erc20Abi } from 'viem'
import { toast } from 'sonner'
import { Bot, Check, Send, Sparkles } from 'lucide-react'
import type { NavProps } from '@/App'
import { nexoraVaultAbi } from '@/contracts/nexoraVaultAbi'
import { useNexora } from '@/hooks/NexoraProvider'
import { useTx } from '@/hooks/useTx'
import { answer, SUGGESTIONS, type Proposal, type Reply } from '@/lib/assistant'
import { fmtUsdc, pct } from '@/lib/format'
import { spendByDay } from '@/lib/monitoring'
import { USDC_ADDRESS, VAULT_ADDRESS } from '@/lib/vault'
import { ConnectGate, PageHeader, ProgressBar, Spinner, toneFor } from '../ui'

interface Message {
  role: 'user' | 'assistant'
  text: string
  lines?: string[]
  proposal?: Proposal
  state?: 'open' | 'done' | 'dismissed'
}

const WELCOME: Message = {
  role: 'assistant',
  text: 'Ask about spending, balances, pending or blocked requests. I can also prepare budget and limit changes, but you confirm every one in your wallet and the contract enforces the policy.',
}

export function Intelligence(_props: NavProps) {
  const { agents, requests, now, usdcBalance, allowance } = useNexora()
  const tx = useTx()
  const [messages, setMessages] = useState<Message[]>([WELCOME])
  const [input, setInput] = useState('')
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [messages])

  const days = useMemo(() => spendByDay(requests, 7, now), [requests, now])
  const maxDay = days.reduce((m, d) => (d.amount > m ? d.amount : m), 0n)

  const ask = (text: string) => {
    const q = text.trim()
    if (!q) return
    const reply: Reply = answer(q, { agents, requests, now })
    setMessages((m) => [
      ...m,
      { role: 'user', text: q },
      { role: 'assistant', text: reply.text, lines: reply.lines, proposal: reply.proposal, state: reply.proposal ? 'open' : undefined },
    ])
    setInput('')
  }

  const setState = (index: number, state: Message['state']) =>
    setMessages((m) => m.map((msg, i) => (i === index ? { ...msg, state } : msg)))

  const confirm = async (index: number, p: Proposal) => {
    let ok = false
    if (p.kind === 'setPolicy') {
      ok = !!(await tx.run('Update policy', () => tx.write({ address: VAULT_ADDRESS, abi: nexoraVaultAbi, functionName: 'setPolicy', args: [p.agent.id, p.policy] })))
    } else if (p.kind === 'fund') {
      if (usdcBalance < p.amount) {
        toast.error('Your wallet does not hold enough USDC for this.')
        return
      }
      if (allowance < p.amount) {
        const approved = await tx.run('Approve USDC', () => tx.write({ address: USDC_ADDRESS, abi: erc20Abi, functionName: 'approve', args: [VAULT_ADDRESS, p.amount] }))
        if (!approved) return
      }
      ok = !!(await tx.run(p.summary, () => tx.write({ address: VAULT_ADDRESS, abi: nexoraVaultAbi, functionName: 'fundAgent', args: [p.agent.id, p.amount] })))
    } else if (p.kind === 'withdraw') {
      ok = !!(await tx.run(p.summary, () => tx.write({ address: VAULT_ADDRESS, abi: nexoraVaultAbi, functionName: 'withdrawFromAgent', args: [p.agent.id, p.amount] })))
    } else {
      const fn = p.kind === 'pause' ? 'pauseAgent' : 'resumeAgent'
      ok = !!(await tx.run(p.summary, () => tx.write({ address: VAULT_ADDRESS, abi: nexoraVaultAbi, functionName: fn, args: [p.agent.id] })))
    }
    if (ok) setState(index, 'done')
  }

  return (
    <>
      <PageHeader title="Intelligence" subtitle="Plain-language answers from your recorded onchain activity, plus spending insights." />
      <ConnectGate>
        <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
          <section className="card flex h-[34rem] flex-col overflow-hidden">
            <div className="flex items-center gap-2 border-b px-5 py-3.5" style={{ borderColor: 'var(--border)' }}>
              <Sparkles className="size-4" style={{ color: 'var(--accent)' }} />
              <span className="display font-semibold">Financial assistant</span>
              <span className="pill ml-auto">Read-only answers</span>
            </div>
            <div className="flex-1 space-y-3 overflow-y-auto px-5 py-4">
              {messages.map((m, i) => (
                <div key={i} className={m.role === 'user' ? 'flex justify-end' : 'flex'}>
                  <div
                    className="max-w-[88%] rounded-2xl px-4 py-2.5 text-sm"
                    style={m.role === 'user' ? { background: 'var(--accent)', color: '#0d1b2f' } : { background: 'rgba(255,255,255,0.07)' }}
                  >
                    <p className="text-pretty">{m.text}</p>
                    {m.lines && (
                      <ul className="mt-2 space-y-1 text-xs" style={{ color: 'var(--muted)' }}>
                        {m.lines.map((l) => <li key={l}>{l}</li>)}
                      </ul>
                    )}
                    {m.proposal && (
                      <div className="mt-3 rounded-xl p-3" style={{ background: 'rgba(13,27,47,0.6)', border: '1px solid var(--border)' }}>
                        <div className="label">Proposed action</div>
                        <div className="mt-1 font-semibold">{m.proposal.summary}</div>
                        {m.state === 'open' && (
                          <div className="mt-3 flex gap-2">
                            <button type="button" className="btn btn-primary btn-sm" disabled={tx.busy} onClick={() => m.proposal && void confirm(i, m.proposal)}>
                              {tx.busy ? <Spinner /> : 'Confirm in wallet'}
                            </button>
                            <button type="button" className="btn btn-ghost btn-sm" disabled={tx.busy} onClick={() => setState(i, 'dismissed')}>Dismiss</button>
                          </div>
                        )}
                        {m.state === 'done' && <div className="mt-2 flex items-center gap-1.5 text-xs" style={{ color: 'var(--success)' }}><Check className="size-3.5" /> Confirmed onchain</div>}
                        {m.state === 'dismissed' && <div className="mt-2 text-xs" style={{ color: 'var(--subtle)' }}>Dismissed</div>}
                      </div>
                    )}
                  </div>
                </div>
              ))}
              <div ref={endRef} />
            </div>
            <div className="border-t p-4" style={{ borderColor: 'var(--border)' }}>
              <div className="mb-3 flex gap-1.5 overflow-x-auto pb-1">
                {SUGGESTIONS.map((s) => (
                  <button key={s} type="button" className="pill shrink-0 cursor-pointer hover:bg-white/10" onClick={() => ask(s)}>{s}</button>
                ))}
              </div>
              <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); ask(input) }}>
                <input className="input" value={input} placeholder="How much has ResearchBot spent this week?" onChange={(e) => setInput(e.target.value)} />
                <button type="submit" aria-label="Send" className="btn btn-primary" disabled={!input.trim()}><Send className="size-4" /></button>
              </form>
            </div>
          </section>

          <div className="grid content-start gap-4">
            <section className="card p-5">
              <h2 className="display text-lg font-semibold">Spending, last 7 days</h2>
              <div className="mt-4 flex h-32 items-end gap-2">
                {days.map((d, i) => (
                  <div key={i} className="flex flex-1 flex-col items-center gap-1.5">
                    <div className="flex h-24 w-full items-end">
                      <div
                        className="w-full rounded-t-md transition-[height] duration-500"
                        title={`${fmtUsdc(d.amount)} USDC`}
                        style={{ height: maxDay > 0n ? `${Math.max(4, Number((d.amount * 100n) / maxDay))}%` : '4%', background: d.amount > 0n ? 'var(--accent)' : 'rgba(255,255,255,0.1)' }}
                      />
                    </div>
                    <span className="text-[10px]" style={{ color: 'var(--subtle)' }}>{d.label}</span>
                  </div>
                ))}
              </div>
              <p className="mt-3 text-xs" style={{ color: 'var(--subtle)' }}>Executed payments by UTC day.</p>
            </section>
            <section className="card p-5">
              <h2 className="display mb-4 text-lg font-semibold">Budget usage</h2>
              {agents.length === 0 ? (
                <p className="flex items-center gap-2 text-sm" style={{ color: 'var(--subtle)' }}><Bot className="size-4" /> No agents yet.</p>
              ) : (
                <ul className="flex flex-col gap-4">
                  {agents.map((a) => {
                    const used = pct(a.totalSpent, a.totalFunded)
                    return (
                      <li key={a.id.toString()}>
                        <div className="mb-1.5 flex justify-between text-sm"><span className="font-medium">{a.name}</span><span className="tabular-nums" style={{ color: 'var(--muted)' }}>{Math.round(used)}%</span></div>
                        <ProgressBar value={used} tone={toneFor(used)} />
                      </li>
                    )
                  })}
                </ul>
              )}
            </section>
            <p className="px-1 text-xs" style={{ color: 'var(--subtle)' }}>
              This assistant uses rules over your recorded onchain data. It holds no keys and cannot sign: every action is a proposal you confirm, and the vault contract checks it independently.
            </p>
          </div>
        </div>
      </ConnectGate>
    </>
  )
}
