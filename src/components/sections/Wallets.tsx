import { useState } from 'react'
import { erc20Abi } from 'viem'
import { ArrowDownToLine, ArrowUpFromLine, Vault } from 'lucide-react'
import type { NavProps } from '@/App'
import { nexoraVaultAbi } from '@/contracts/nexoraVaultAbi'
import { useNexora } from '@/hooks/NexoraProvider'
import { useTx } from '@/hooks/useTx'
import { fmtUsdc } from '@/lib/format'
import { formatUnitsExact, parseUsdc } from '@/onchain-money'
import { AgentStatus, FAUCET_URL, USDC_ADDRESS, VAULT_ADDRESS, VAULT_DEPLOY_TX, CHAIN_ID, type Agent } from '@/lib/vault'
import { buildTxExplorerUrl } from '@/onchain-facts'
import { AddressChip, AgentStatusPill, AmountInput, ConnectGate, Empty, Modal, PageHeader, Spinner } from '../ui'

type Mode = 'fund' | 'withdraw'

function safeParse(v: string): bigint | null {
  try {
    return v.trim() ? parseUsdc(v.trim()) : null
  } catch {
    return null
  }
}

export function Wallets({ go, focusAgent }: NavProps) {
  const { agents, usdcBalance, allowance, loading } = useNexora()
  const [action, setAction] = useState<{ mode: Mode; agent: Agent } | null>(null)
  const [amount, setAmount] = useState('')
  const tx = useTx()

  const raw = safeParse(amount)
  const limit = action ? (action.mode === 'fund' ? usdcBalance : action.agent.balance) : 0n
  const tooMuch = raw !== null && raw > limit
  const valid = raw !== null && raw > 0n && !tooMuch

  const close = () => {
    setAction(null)
    setAmount('')
  }

  const submit = async () => {
    if (!action || !raw || !valid) return
    const { mode, agent } = action
    if (mode === 'fund') {
      if (allowance < raw) {
        const approved = await tx.run('Approve USDC', () =>
          tx.write({ address: USDC_ADDRESS, abi: erc20Abi, functionName: 'approve', args: [VAULT_ADDRESS, raw] }),
        )
        if (!approved) return
      }
      const done = await tx.run(`Fund ${agent.name}`, () =>
        tx.write({ address: VAULT_ADDRESS, abi: nexoraVaultAbi, functionName: 'fundAgent', args: [agent.id, raw] }),
      )
      if (done) close()
    } else {
      const done = await tx.run(`Withdraw from ${agent.name}`, () =>
        tx.write({ address: VAULT_ADDRESS, abi: nexoraVaultAbi, functionName: 'withdrawFromAgent', args: [agent.id, raw] }),
      )
      if (done) close()
    }
  }

  const needsApproval = action?.mode === 'fund' && raw !== null && allowance < raw

  return (
    <>
      <PageHeader title="Agent Wallets" subtitle="Each agent spends from its own vault balance. You can withdraw unspent funds at any time, even after pausing or revoking." />
      <ConnectGate>
        <div className="grid gap-4">
          <section className="card flex flex-wrap items-center justify-between gap-4 p-5">
            <div className="flex items-center gap-3">
              <div className="flex size-11 items-center justify-center rounded-2xl" style={{ background: 'rgba(172,198,233,0.12)', color: 'var(--accent)' }}>
                <Vault className="size-5" />
              </div>
              <div>
                <div className="label">Your wallet</div>
                <div className="display text-2xl font-bold tabular-nums">{fmtUsdc(usdcBalance)} <span className="text-sm font-medium" style={{ color: 'var(--subtle)' }}>USDC</span></div>
              </div>
            </div>
            <a className="btn btn-ghost btn-sm" href={FAUCET_URL} target="_blank" rel="noopener noreferrer">Need test USDC?</a>
          </section>

          {loading ? (
            <div className="flex justify-center py-16"><Spinner className="size-6" /></div>
          ) : agents.length === 0 ? (
            <Empty icon={<Vault className="size-6" />} title="No agent vaults yet" body="Register an agent first, then allocate test USDC to its vault." action={<button type="button" className="btn btn-primary" onClick={() => go('agents')}>Register an agent</button>} />
          ) : (
            <div className="grid gap-3">
              {agents.map((a) => (
                <article
                  key={a.id.toString()}
                  className="card flex flex-wrap items-center justify-between gap-4 p-5"
                  style={focusAgent === a.id ? { borderColor: 'var(--border-strong)' } : undefined}
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="display text-lg font-semibold">{a.name}</h3>
                      <AgentStatusPill status={a.status} />
                    </div>
                    <div className="mt-1.5 text-xs"><AddressChip address={a.wallet} label="Agent wallet" /></div>
                  </div>
                  <div className="text-right">
                    <div className="label">Vault balance</div>
                    <div className="display text-2xl font-bold tabular-nums">{fmtUsdc(a.balance)}</div>
                    <div className="text-xs" style={{ color: 'var(--subtle)' }}>{fmtUsdc(a.totalFunded)} funded in total</div>
                  </div>
                  <div className="flex gap-2">
                    <button type="button" className="btn btn-primary btn-sm" disabled={a.status === AgentStatus.Revoked} onClick={() => setAction({ mode: 'fund', agent: a })}>
                      <ArrowDownToLine className="size-3.5" /> Fund
                    </button>
                    <button type="button" className="btn btn-ghost btn-sm" disabled={a.balance === 0n} onClick={() => setAction({ mode: 'withdraw', agent: a })}>
                      <ArrowUpFromLine className="size-3.5" /> Withdraw
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}

          <section className="card p-5">
            <div className="label">Vault contract</div>
            <div className="mt-2 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
              <AddressChip address={VAULT_ADDRESS} />
              {VAULT_DEPLOY_TX && (
                <a className="text-xs font-semibold" style={{ color: 'var(--accent)' }} href={buildTxExplorerUrl(CHAIN_ID, VAULT_DEPLOY_TX)} target="_blank" rel="noopener noreferrer">
                  Deployment transaction
                </a>
              )}
            </div>
          </section>
        </div>
      </ConnectGate>

      <Modal open={!!action} onClose={close} title={action ? `${action.mode === 'fund' ? 'Fund' : 'Withdraw from'} ${action.agent.name}` : ''}>
        {action && (
          <div className="grid gap-4">
            <div className="card-inner p-4">
              <AmountInput value={amount} onChange={setAmount} />
              <div className="mt-2 flex items-center justify-between text-xs" style={{ color: 'var(--subtle)' }}>
                <span>{action.mode === 'fund' ? 'Wallet balance' : 'Vault balance'}: {fmtUsdc(limit)}</span>
                <button type="button" className="font-semibold" style={{ color: 'var(--accent)' }} onClick={() => setAmount(formatUnitsExact(limit, 6))}>Max</button>
              </div>
              <div className="mt-3 flex gap-2">
                {['5', '10', '25', '50'].map((v) => (
                  <button key={v} type="button" className="pill cursor-pointer hover:bg-white/10" onClick={() => setAmount(v)}>{v}</button>
                ))}
              </div>
            </div>
            {tooMuch && <p className="text-xs" style={{ color: 'var(--danger)' }}>Amount is more than the available balance.</p>}
            {needsApproval && <p className="text-xs" style={{ color: 'var(--subtle)' }}>Two wallet prompts: first approve USDC for the vault, then fund the agent.</p>}
            {action.mode === 'withdraw' && <p className="text-xs" style={{ color: 'var(--subtle)' }}>Funds return to your wallet.</p>}
            <button type="button" className="btn btn-primary w-full" disabled={!valid || tx.busy} onClick={() => void submit()}>
              {tx.phase === 'wallet' ? <><Spinner /> Confirm in wallet...</> : tx.phase === 'confirming' ? <><Spinner /> Confirming...</> : action.mode === 'fund' ? 'Allocate USDC' : 'Withdraw USDC'}
            </button>
          </div>
        )}
      </Modal>
    </>
  )
}
