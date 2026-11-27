import { useMemo, type ReactNode } from 'react'
import { ConnectKitButton } from 'connectkit'
import { useAccount, useSwitchChain } from 'wagmi'
import {
  Bot,
  CheckCheck,
  LayoutDashboard,
  ReceiptText,
  Settings as SettingsIcon,
  ShieldAlert,
  SlidersHorizontal,
  Sparkles,
  Wallet,
} from 'lucide-react'
import { Logo } from './Logo'
import { useNazvex } from '@/hooks/NazvexProvider'
import { computeAlerts } from '@/lib/monitoring'
import { CHAIN, CHAIN_ID, RequestStatus } from '@/lib/vault'

export type SectionId =
  | 'overview'
  | 'agents'
  | 'wallets'
  | 'controls'
  | 'transactions'
  | 'approvals'
  | 'intelligence'
  | 'security'
  | 'settings'

const NAV: Array<{ id: SectionId; label: string; icon: typeof Bot }> = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'agents', label: 'My Agents', icon: Bot },
  { id: 'wallets', label: 'Agent Wallets', icon: Wallet },
  { id: 'controls', label: 'Financial Controls', icon: SlidersHorizontal },
  { id: 'transactions', label: 'Transactions', icon: ReceiptText },
  { id: 'approvals', label: 'Approvals', icon: CheckCheck },
  { id: 'intelligence', label: 'Intelligence', icon: Sparkles },
  { id: 'security', label: 'Security Center', icon: ShieldAlert },
  { id: 'settings', label: 'Settings', icon: SettingsIcon },
]

export function Shell({ section, onNavigate, children }: { section: SectionId; onNavigate: (s: SectionId) => void; children: ReactNode }) {
  const { chainId, isConnected } = useAccount()
  const { switchChain, isPending } = useSwitchChain()
  const { agents, requests, now } = useNazvex()

  const pendingCount = useMemo(
    () => requests.filter((r) => r.status === RequestStatus.Pending && Number(r.expiresAt) > now).length,
    [requests, now],
  )
  const alertCount = useMemo(
    () => computeAlerts(agents, requests, now).filter((a) => a.severity !== 'info').length,
    [agents, requests, now],
  )
  const badge = (id: SectionId) => (id === 'approvals' ? pendingCount : id === 'security' ? alertCount : 0)
  const wrongChain = isConnected && chainId !== CHAIN_ID

  return (
    <div className="min-h-dvh">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r px-4 py-6 lg:flex" style={{ borderColor: 'var(--border)', background: '#0d1b2f' }}>
        <div className="px-2">
          <Logo />
          <p className="mt-2 text-xs" style={{ color: 'var(--subtle)' }}>
            Financial control for AI agents
          </p>
        </div>
        <nav className="mt-8 flex flex-col gap-1">
          {NAV.map(({ id, label, icon: Icon }) => {
            const active = id === section
            const count = badge(id)
            return (
              <button
                key={id}
                type="button"
                onClick={() => onNavigate(id)}
                className="flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm font-medium transition-colors hover:bg-white/5"
                style={{ background: active ? 'rgba(172,198,233,0.14)' : undefined, color: active ? 'var(--ink)' : 'var(--muted)' }}
              >
                <Icon className="size-[18px]" style={{ color: active ? 'var(--accent)' : 'var(--subtle)' }} />
                <span className="flex-1 text-left">{label}</span>
                {count > 0 && (
                  <span className="rounded-full px-2 py-0.5 text-[11px] font-bold tabular-nums" style={{ background: 'var(--warn)', color: '#0d1b2f' }}>
                    {count}
                  </span>
                )}
              </button>
            )
          })}
        </nav>
        <div className="mt-auto card-inner p-3 text-xs" style={{ color: 'var(--subtle)' }}>
          Policies are enforced by the vault contract. The AI assistant and this dashboard can never move funds on their own.
        </div>
      </aside>

      <div className="lg:pl-64">
        <header className="sticky top-0 z-20 border-b px-4 py-3 sm:px-8" style={{ borderColor: 'var(--border)', background: 'rgba(13,27,47,0.8)', backdropFilter: 'blur(16px)' }}>
          <div className="flex items-center justify-between gap-3">
            <div className="lg:hidden">
              <Logo />
            </div>
            <div className="hidden items-center gap-2 lg:flex">
              <span className="pill pill-accent">
                <span className="size-1.5 rounded-full" style={{ background: 'var(--success)' }} />
                {CHAIN.name}
              </span>
              <span className="pill">Testnet prototype, test USDC only</span>
            </div>
            <ConnectKitButton showBalance={false} />
          </div>
          <nav className="-mx-4 mt-3 flex gap-1.5 overflow-x-auto px-4 pb-1 lg:hidden">
            {NAV.map(({ id, label }) => {
              const active = id === section
              const count = badge(id)
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => onNavigate(id)}
                  className="flex min-h-10 shrink-0 items-center gap-1.5 rounded-full px-3.5 text-xs font-semibold"
                  style={{ background: active ? 'var(--accent)' : 'rgba(255,255,255,0.06)', color: active ? '#0d1b2f' : 'var(--muted)' }}
                >
                  {label}
                  {count > 0 && <span className="rounded-full px-1.5 text-[10px]" style={{ background: 'var(--warn)', color: '#0d1b2f' }}>{count}</span>}
                </button>
              )
            })}
          </nav>
        </header>

        {wrongChain && (
          <div className="mx-4 mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl px-4 py-3 text-sm sm:mx-8" style={{ background: 'rgba(233,196,106,0.1)', border: '1px solid rgba(233,196,106,0.35)', color: 'var(--warn)' }}>
            Your wallet is on a different network. Nazvex runs on {CHAIN.name}.
            <button type="button" className="btn btn-primary btn-sm" disabled={isPending} onClick={() => switchChain({ chainId: CHAIN_ID })}>
              Switch to {CHAIN.name}
            </button>
          </div>
        )}

        <main className="mx-auto w-full max-w-6xl px-4 pb-24 pt-6 sm:px-8 sm:pt-8">{children}</main>
      </div>
    </div>
  )
}
