import { useCallback, useState } from 'react'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { CONFIG_OK } from '@/lib/vault'
import { NexoraProvider } from '@/hooks/NexoraProvider'
import { Shell, type SectionId } from '@/components/Shell'
import { Overview } from '@/components/sections/Overview'
import { Agents } from '@/components/sections/Agents'
import { Wallets } from '@/components/sections/Wallets'
import { Controls } from '@/components/sections/Controls'
import { Transactions } from '@/components/sections/Transactions'
import { Approvals } from '@/components/sections/Approvals'
import { Intelligence } from '@/components/sections/Intelligence'
import { Security } from '@/components/sections/Security'
import { Settings } from '@/components/sections/Settings'

export interface NavProps {
  go: (section: SectionId, agentId?: bigint) => void
  focusAgent?: bigint
}

function MissingConfig() {
  return (
    <div className="flex min-h-dvh items-center justify-center p-6">
      <div className="card max-w-md p-8 text-center">
        <h1 className="display text-2xl font-bold">Vault address missing</h1>
        <p className="mt-2 text-pretty text-sm" style={{ color: 'var(--subtle)' }}>
          Set <span className="mono">VITE_NEXORA_VAULT_ADDRESS</span> in the host&apos;s environment variables (or in <span className="mono">.env.production</span>) and rebuild.
        </p>
      </div>
    </div>
  )
}

export default function App() {
  const [section, setSection] = useState<SectionId>('overview')
  const [focusAgent, setFocusAgent] = useState<bigint | undefined>()

  const go = useCallback((next: SectionId, agentId?: bigint) => {
    setSection(next)
    setFocusAgent(agentId)
    window.scrollTo({ top: 0 })
  }, [])

  const nav: NavProps = { go, focusAgent }

  if (!CONFIG_OK) return <MissingConfig />

  return (
    <NexoraProvider>
      <Shell section={section} onNavigate={(s) => go(s)}>
        <ErrorBoundary key={section} label={section}>
        {section === 'overview' && <Overview {...nav} />}
        {section === 'agents' && <Agents {...nav} />}
        {section === 'wallets' && <Wallets {...nav} />}
        {section === 'controls' && <Controls {...nav} />}
        {section === 'transactions' && <Transactions {...nav} />}
        {section === 'approvals' && <Approvals {...nav} />}
        {section === 'intelligence' && <Intelligence {...nav} />}
        {section === 'security' && <Security {...nav} />}
        {section === 'settings' && <Settings {...nav} />}
        </ErrorBoundary>
      </Shell>
    </NexoraProvider>
  )
}
