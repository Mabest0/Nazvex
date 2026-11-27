import { useMemo, useState } from 'react'
import { isAddress, type Address } from 'viem'
import { useAccount } from 'wagmi'
import { toast } from 'sonner'
import { nazvexVaultAbi } from '@/contracts/nazvexVaultAbi'
import { useTx } from '@/hooks/useTx'
import { parseUsdc } from '@/onchain-money'
import { nowSec } from '@/lib/format'
import { VAULT_ADDRESS } from '@/lib/vault'
import { AmountInput, Field, Modal, Spinner } from './ui'

const PRESETS = [
  { name: 'ResearchBot', max: '5', daily: '15', threshold: '' },
  { name: 'PaymentBot', max: '10', daily: '30', threshold: '5' },
  { name: 'ProcureBot', max: '10', daily: '20', threshold: '' },
]

function tryParse(v: string): bigint | null {
  if (!v.trim()) return null
  try {
    return parseUsdc(v.trim())
  } catch {
    return null
  }
}

export function RegisterAgentModal({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const { address } = useAccount()
  const tx = useTx()
  const [name, setName] = useState('')
  const [wallet, setWallet] = useState('')
  const [max, setMax] = useState('')
  const [daily, setDaily] = useState('')
  const [threshold, setThreshold] = useState('')
  const [days, setDays] = useState('')
  const [recipientsText, setRecipientsText] = useState('')

  const recipients = useMemo(
    () => recipientsText.split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean),
    [recipientsText],
  )

  const maxRaw = tryParse(max)
  const dailyRaw = tryParse(daily)
  const thresholdRaw = threshold.trim() ? tryParse(threshold) : maxRaw
  const daysNum = days.trim() ? Number(days) : 0

  const problem = (() => {
    if (!name.trim() || new TextEncoder().encode(name.trim()).length > 48) return 'Name must be 1 to 48 characters'
    if (!isAddress(wallet)) return 'Enter a valid agent wallet address'
    if (!maxRaw || maxRaw <= 0n) return 'Set a per-transaction maximum'
    if (!dailyRaw || dailyRaw < maxRaw) return 'Daily limit must be at least the per-transaction maximum'
    if (thresholdRaw === null || thresholdRaw > maxRaw) return 'Approval threshold cannot exceed the per-transaction maximum'
    if (days.trim() && (!Number.isInteger(daysNum) || daysNum < 1)) return 'Expiry must be a whole number of days'
    if (recipients.some((r) => !isAddress(r))) return 'One of the recipient addresses is invalid'
    if (recipients.length > 50) return 'At most 50 recipients'
    return null
  })()

  const submit = async () => {
    if (problem || !maxRaw || !dailyRaw || thresholdRaw === null) return
    const result = await tx.run('Register agent', () =>
      tx.write({
        address: VAULT_ADDRESS,
        abi: nazvexVaultAbi,
        functionName: 'registerAgent',
        args: [
          name.trim(),
          wallet as Address,
          {
            maxPerTx: maxRaw,
            dailyLimit: dailyRaw,
            approvalThreshold: thresholdRaw,
            expiresAt: daysNum > 0 ? BigInt(nowSec() + daysNum * 86400) : 0n,
          },
          recipients as Address[],
        ],
      }),
    )
    if (result) {
      toast.success(`${name.trim()} is registered. Fund it from Agent Wallets.`)
      setName('')
      setMax('')
      setDaily('')
      setThreshold('')
      setDays('')
      setRecipientsText('')
      onDone()
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Register an agent">
      <div className="mb-4 flex flex-wrap gap-2">
        {PRESETS.map((p) => (
          <button
            key={p.name}
            type="button"
            className="pill pill-accent cursor-pointer hover:brightness-125"
            onClick={() => {
              setName(p.name)
              setMax(p.max)
              setDaily(p.daily)
              setThreshold(p.threshold)
            }}
          >
            {p.name}: {p.max} max, {p.daily} / day
          </button>
        ))}
      </div>
      <div className="grid gap-4">
        <Field label="Agent name">
          <input className="input" value={name} maxLength={48} placeholder="ResearchBot" onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field
          label="Agent wallet"
          hint="The only address allowed to submit payment requests. Use your own wallet to simulate the agent."
        >
          <div className="flex gap-2">
            <input className="input mono" value={wallet} placeholder="0x..." onChange={(e) => setWallet(e.target.value.trim())} />
            <button type="button" className="btn btn-ghost" disabled={!address} onClick={() => address && setWallet(address)}>
              Use mine
            </button>
          </div>
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Max per transaction"><AmountInput value={max} onChange={setMax} placeholder="5" /></Field>
          <Field label="Daily limit (UTC day)"><AmountInput value={daily} onChange={setDaily} placeholder="15" /></Field>
          <Field label="Approval above" hint="Blank means no human approval."><AmountInput value={threshold} onChange={setThreshold} placeholder="none" /></Field>
          <Field label="Budget expires in" hint="Blank means never.">
            <div className="relative">
              <input className="input pr-14 tabular-nums" inputMode="numeric" value={days} placeholder="never" onChange={(e) => /^\d*$/.test(e.target.value) && setDays(e.target.value)} />
              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs font-semibold" style={{ color: 'var(--subtle)' }}>days</span>
            </div>
          </Field>
        </div>
        <Field label="Approved recipients" hint="One address per line. Requests to any other address are blocked by the contract.">
          <textarea className="input mono min-h-24 py-3" value={recipientsText} placeholder="0x..." onChange={(e) => setRecipientsText(e.target.value)} />
        </Field>
        {problem && name.length + max.length + daily.length > 0 && (
          <p className="text-xs" style={{ color: 'var(--warn)' }}>{problem}</p>
        )}
        <button type="button" className="btn btn-primary w-full" disabled={!!problem || tx.busy} onClick={() => void submit()}>
          {tx.phase === 'wallet' ? <><Spinner /> Confirm in wallet...</> : tx.phase === 'confirming' ? <><Spinner /> Confirming...</> : 'Register agent'}
        </button>
      </div>
    </Modal>
  )
}
