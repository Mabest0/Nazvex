import { useState } from 'react'
import { ConnectKitButton } from 'connectkit'
import { useAccount, useDeployContract, usePublicClient, useSwitchChain } from 'wagmi'
import { Check, Copy, ExternalLink } from 'lucide-react'
import { nazvexVaultAbi } from '@/contracts/nazvexVaultAbi'
import { NAZVEX_VAULT_BYTECODE } from '@/lib/vaultBytecode'
import { parseOnchainError } from '@/lib/format'
import { CHAIN, CHAIN_ID, FAUCET_URL, USDC_ADDRESS } from '@/lib/vault'
import { buildAddressExplorerUrl } from '@/onchain-facts'
import { Spinner } from './ui'
import { LogoMark } from './Logo'

function CopyRow({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="card-inner p-3">
      <div className="label">{label}</div>
      <div className="mt-1 flex items-center gap-2">
        <span className="mono min-w-0 flex-1 break-all text-xs">{value}</span>
        <button
          type="button"
          className="btn btn-ghost btn-sm shrink-0"
          onClick={() => {
            void navigator.clipboard.writeText(value).then(() => {
              setCopied(true)
              setTimeout(() => setCopied(false), 1500)
            })
          }}
        >
          {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />} {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
    </div>
  )
}

/** One-tap deployment of NazvexVault from the connected wallet, so that wallet is the contract's creator. */
export function DeployVault() {
  const { address, chainId, isConnected } = useAccount()
  const { switchChainAsync } = useSwitchChain()
  const { deployContractAsync } = useDeployContract()
  const publicClient = usePublicClient({ chainId: CHAIN_ID })
  const [phase, setPhase] = useState<'idle' | 'wallet' | 'confirming'>('idle')
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<{ address: string; hash: string } | null>(null)

  const deploy = async () => {
    if (!publicClient) return
    setError(null)
    try {
      if (chainId !== CHAIN_ID) await switchChainAsync({ chainId: CHAIN_ID })
      setPhase('wallet')
      const hash = await deployContractAsync({
        abi: nazvexVaultAbi,
        bytecode: NAZVEX_VAULT_BYTECODE,
        args: [USDC_ADDRESS],
        chainId: CHAIN_ID,
      })
      setPhase('confirming')
      const receipt = await publicClient.waitForTransactionReceipt({ hash })
      if (receipt.status !== 'success' || !receipt.contractAddress) throw new Error('Deployment reverted')
      setResult({ address: receipt.contractAddress, hash })
    } catch (e) {
      setError(parseOnchainError(e) ?? 'Deployment cancelled.')
    } finally {
      setPhase('idle')
    }
  }

  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 p-4">
      <div className="flex items-center gap-2.5">
        <LogoMark size={36} />
        <span className="display text-xl font-bold">Nazvex</span>
      </div>
      <section className="card p-5">
        <h1 className="display text-2xl font-bold">Deploy your vault</h1>
        <p className="mt-1 text-pretty text-sm" style={{ color: 'var(--subtle)' }}>
          Deploys the NazvexVault contract on {CHAIN.name} from your own wallet, so your address shows as the creator.
        </p>

        {result ? (
          <div className="mt-5 grid gap-3">
            <div className="flex items-center gap-2 text-sm font-semibold" style={{ color: 'var(--success)' }}>
              <Check className="size-4" /> Deployed and confirmed
            </div>
            <CopyRow label="Contract address" value={result.address} />
            <CopyRow label="Transaction hash" value={result.hash} />
            <a className="btn btn-ghost" href={buildAddressExplorerUrl(CHAIN_ID, result.address)} target="_blank" rel="noopener noreferrer">
              View on explorer <ExternalLink className="size-3.5" />
            </a>
            <p className="text-xs" style={{ color: 'var(--subtle)' }}>
              Copy both values and send them to Arc Studio chat. They are public, so it is safe to share them.
            </p>
          </div>
        ) : (
          <div className="mt-5 grid gap-4">
            <ol className="grid gap-2 text-sm" style={{ color: 'var(--muted)' }}>
              <li>1. Connect the wallet you want shown as the creator.</li>
              <li>2. Make sure it has a little test USDC for gas (<a className="underline" href={FAUCET_URL} target="_blank" rel="noopener noreferrer">faucet</a>).</li>
              <li>3. Tap Deploy and confirm in your wallet.</li>
            </ol>
            <ConnectKitButton.Custom>
              {({ show, isConnected: connected }) =>
                connected ? null : (
                  <button type="button" className="btn btn-primary" onClick={show}>
                    Connect wallet
                  </button>
                )
              }
            </ConnectKitButton.Custom>
            {isConnected && address && (
              <div className="card-inner p-3 text-xs">
                <div className="label">Creator will be</div>
                <div className="mono mt-1 break-all">{address}</div>
              </div>
            )}
            {isConnected && (
              <button type="button" className="btn btn-primary" disabled={phase !== 'idle'} onClick={() => void deploy()}>
                {phase === 'wallet' ? <><Spinner /> Confirm in wallet...</> : phase === 'confirming' ? <><Spinner /> Confirming...</> : 'Deploy NazvexVault'}
              </button>
            )}
            {error && <p className="text-xs" style={{ color: 'var(--danger)' }}>{error}</p>}
            <p className="text-xs" style={{ color: 'var(--subtle)' }}>
              Constructor value: USDC on {CHAIN.name} ({USDC_ADDRESS}). Testnet only.
            </p>
          </div>
        )}
      </section>
    </div>
  )
}
