import type { ReactNode } from 'react'
import { useAccount, useDisconnect } from 'wagmi'
import { ExternalLink } from 'lucide-react'
import type { NavProps } from '@/App'
import { buildAddressExplorerUrl, getUsdc } from '@/onchain-facts'
import { CHAIN, CHAIN_ID, FAUCET_URL, USDC_ADDRESS, VAULT_ADDRESS } from '@/lib/vault'
import { AddressChip, PageHeader } from '../ui'

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm" style={{ borderBottom: '1px solid var(--border)' }}>
      <span style={{ color: 'var(--subtle)' }}>{label}</span>
      <span className="font-medium">{children}</span>
    </div>
  )
}

export function Settings(_props: NavProps) {
  const { address, chainId, connector, isConnected } = useAccount()
  const { disconnect } = useDisconnect()
  const usdc = getUsdc(CHAIN_ID)

  return (
    <>
      <PageHeader title="Settings" subtitle="Wallet connection and the configuration this prototype runs on." />
      <div className="grid gap-4 lg:grid-cols-2">
        <section className="card p-5">
          <h2 className="display mb-1 text-lg font-semibold">Wallet</h2>
          <Row label="Status">{isConnected ? `Connected via ${connector?.name ?? 'wallet'}` : 'Not connected'}</Row>
          <Row label="Address">{address ? <AddressChip address={address} /> : 'None'}</Row>
          <Row label="Network">{chainId === CHAIN_ID ? CHAIN.name : isConnected ? `Chain ${chainId} (switch needed)` : CHAIN.name}</Row>
          {isConnected && (
            <button type="button" className="btn btn-ghost mt-4" onClick={() => disconnect()}>Disconnect wallet</button>
          )}
        </section>

        <section className="card p-5">
          <h2 className="display mb-1 text-lg font-semibold">Network and contracts</h2>
          <Row label="Chain ID">{CHAIN_ID}</Row>
          <Row label="Vault contract"><AddressChip address={VAULT_ADDRESS} /></Row>
          <Row label="USDC (ERC-20)"><AddressChip address={USDC_ADDRESS} /></Row>
          <Row label="USDC decimals">{usdc?.decimals ?? 6}</Row>
          <Row label="Explorer">
            <a className="inline-flex items-center gap-1" style={{ color: 'var(--accent)' }} href={buildAddressExplorerUrl(CHAIN_ID, VAULT_ADDRESS)} target="_blank" rel="noopener noreferrer">
              View vault <ExternalLink className="size-3.5" />
            </a>
          </Row>
          <p className="mt-4 text-xs" style={{ color: 'var(--subtle)' }}>
            On Arc, USDC is also the gas token. Balances here use the 6-decimal USDC view, so gas and spendable USDC come from one pool.
          </p>
        </section>

        <section className="card p-5 lg:col-span-2">
          <h2 className="display mb-2 text-lg font-semibold">About this prototype</h2>
          <p className="text-pretty text-sm" style={{ color: 'var(--muted)' }}>
            Nazvex is a testnet prototype. It uses test USDC only and is not suitable for real funds. Contracts have had a limited automated review and need an independent security audit before any mainnet use.
          </p>
          <a className="btn btn-ghost mt-4 inline-flex" href={FAUCET_URL} target="_blank" rel="noopener noreferrer">
            Get test USDC <ExternalLink className="size-3.5" />
          </a>
        </section>
      </div>
    </>
  )
}
