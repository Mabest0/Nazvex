import { useState, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { ConnectKitButton } from 'connectkit'
import { Check, Copy, ExternalLink, Loader2, Wallet, X } from 'lucide-react'
import { TokenUSDC } from '@web3icons/react'
import { buildAddressExplorerUrl } from '@/onchain-facts'
import { shortAddr } from '@/lib/format'
import { CHAIN_ID, AGENT_STATUS_LABEL, REQUEST_STATUS_LABEL, AgentStatus, RequestStatus } from '@/lib/vault'
import { useNexora } from '@/hooks/NexoraProvider'

export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="display text-balance text-3xl font-bold" style={{ color: 'var(--ink)' }}>
          {title}
        </h1>
        {subtitle && (
          <p className="mt-1 max-w-xl text-pretty text-sm" style={{ color: 'var(--subtle)' }}>
            {subtitle}
          </p>
        )}
      </div>
      {action}
    </div>
  )
}

export function Stat({ label, value, sub, usdc }: { label: string; value: ReactNode; sub?: ReactNode; usdc?: boolean }) {
  return (
    <div className="card p-5">
      <div className="label">{label}</div>
      <div className="mt-2 flex items-baseline gap-1.5">
        <span className="display text-3xl font-bold tabular-nums">{value}</span>
        {usdc && (
          <span className="flex items-center gap-1 text-sm font-medium" style={{ color: 'var(--subtle)' }}>
            <TokenUSDC variant="branded" size={14} /> USDC
          </span>
        )}
      </div>
      {sub && (
        <div className="mt-1.5 text-xs" style={{ color: 'var(--muted)' }}>
          {sub}
        </div>
      )}
    </div>
  )
}

export function AgentStatusPill({ status }: { status: number }) {
  const tone =
    status === AgentStatus.Active ? 'pill-success' : status === AgentStatus.Paused ? 'pill-warn' : 'pill-danger'
  return <span className={`pill ${tone}`}>{AGENT_STATUS_LABEL[status] ?? 'Unknown'}</span>
}

export function RequestStatusPill({ status, expired }: { status: number; expired?: boolean }) {
  if (status === RequestStatus.Pending && expired) return <span className="pill">Expired</span>
  const tone =
    status === RequestStatus.Executed
      ? 'pill-success'
      : status === RequestStatus.Pending
        ? 'pill-warn'
        : status === RequestStatus.Blocked
          ? 'pill-danger'
          : ''
  return <span className={`pill ${tone}`}>{REQUEST_STATUS_LABEL[status] ?? 'Unknown'}</span>
}

export function ProgressBar({ value, tone = 'accent' }: { value: number; tone?: 'accent' | 'warn' | 'danger' }) {
  const color = tone === 'danger' ? 'var(--danger)' : tone === 'warn' ? 'var(--warn)' : 'var(--accent)'
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full" style={{ background: 'rgba(255,255,255,0.08)' }}>
      <div className="h-full rounded-full transition-[width] duration-500" style={{ width: `${value}%`, background: color }} />
    </div>
  )
}

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      <div className="mt-1.5">{children}</div>
      {hint && (
        <span className="mt-1 block text-xs" style={{ color: 'var(--subtle)' }}>
          {hint}
        </span>
      )}
    </label>
  )
}

export function AmountInput({
  value,
  onChange,
  placeholder = '0.00',
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
}) {
  return (
    <div className="relative">
      <input
        className="input tabular-nums pr-16"
        inputMode="decimal"
        value={value}
        placeholder={placeholder}
        onChange={(e) => {
          const v = e.target.value
          if (v === '' || /^\d*\.?\d{0,6}$/.test(v)) onChange(v)
        }}
      />
      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs font-semibold" style={{ color: 'var(--subtle)' }}>
        USDC
      </span>
    </div>
  )
}

export function Spinner({ className = 'size-4' }: { className?: string }) {
  return <Loader2 className={`${className} animate-spin`} />
}

export function Empty({ icon, title, body, action, note }: { icon: ReactNode; title: string; body: string; action?: ReactNode; note?: string }) {
  return (
    <div className="card flex flex-col items-center px-6 py-14 text-center">
      <div className="flex size-12 items-center justify-center rounded-2xl" style={{ background: 'rgba(172,198,233,0.12)', color: 'var(--accent)' }}>
        {icon}
      </div>
      <h3 className="display mt-4 text-lg font-semibold">{title}</h3>
      <p className="mt-1 max-w-sm text-pretty text-sm" style={{ color: 'var(--subtle)' }}>
        {body}
      </p>
      {action && <div className="mt-5">{action}</div>}
      {note && (
        <p className="mt-4 max-w-sm text-pretty text-xs" style={{ color: 'var(--subtle)' }}>
          {note}
        </p>
      )}
    </div>
  )
}

export function AddressChip({ address, label }: { address: string; label?: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <span className="inline-flex items-center gap-1.5">
      {label && <span style={{ color: 'var(--subtle)' }}>{label}</span>}
      <span className="mono text-xs" style={{ color: 'var(--ink-2)' }}>
        {shortAddr(address)}
      </span>
      <button
        type="button"
        aria-label="Copy address"
        className="rounded p-1 hover:bg-white/10"
        onClick={() => {
          void navigator.clipboard.writeText(address).then(() => {
            setCopied(true)
            setTimeout(() => setCopied(false), 1200)
          })
        }}
      >
        {copied ? <Check className="size-3.5" style={{ color: 'var(--success)' }} /> : <Copy className="size-3.5" style={{ color: 'var(--subtle)' }} />}
      </button>
      <a
        aria-label="View on explorer"
        className="rounded p-1 hover:bg-white/10"
        href={buildAddressExplorerUrl(CHAIN_ID, address)}
        target="_blank"
        rel="noopener noreferrer"
      >
        <ExternalLink className="size-3.5" style={{ color: 'var(--subtle)' }} />
      </a>
    </span>
  )
}

export function Modal({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
        >
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
          <motion.section
            role="dialog"
            aria-modal="true"
            aria-label={title}
            className="relative max-h-[92dvh] w-full max-w-lg overflow-y-auto rounded-t-3xl sm:rounded-3xl"
            style={{ background: '#122d45', border: '1px solid var(--border)', boxShadow: '0 30px 80px rgba(0,0,0,0.5)' }}
            initial={{ y: 40, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 40, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 380, damping: 34 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 pb-2 pt-5">
              <h2 className="display text-xl font-semibold">{title}</h2>
              <button type="button" aria-label="Close" className="rounded-lg p-2 hover:bg-white/10" onClick={onClose}>
                <X className="size-4" />
              </button>
            </div>
            <div className="px-5 pb-6 pt-2">{children}</div>
          </motion.section>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

/** Wraps a section that needs a connected wallet. */
export function ConnectGate({ children }: { children: ReactNode }) {
  const { isConnected } = useNexora()
  if (isConnected) return <>{children}</>
  return (
    <Empty
      icon={<Wallet className="size-6" />}
      title="Connect your wallet"
      body="Connect a wallet on Arc Testnet to create agents, fund budgets and review their activity."
      action={
        <ConnectKitButton.Custom>
          {({ show }) => (
            <button type="button" className="btn btn-primary" onClick={show}>
              Connect wallet
            </button>
          )}
        </ConnectKitButton.Custom>
      }
      note={window.self !== window.top ? 'Wallet not connecting in this preview? Some browser extensions cannot connect inside an embedded preview. Try Coinbase Wallet in the picker, or open the deployed app in its own tab.' : undefined}
    />
  )
}
