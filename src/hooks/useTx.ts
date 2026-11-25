import { useCallback, useState } from 'react'
import { parseEventLogs, type Hash, type TransactionReceipt } from 'viem'
import { useAccount, usePublicClient, useSwitchChain, useWriteContract } from 'wagmi'
import { toast } from 'sonner'
import { nexoraVaultAbi } from '@/contracts/nexoraVaultAbi'
import { buildTxExplorerUrl } from '@/onchain-facts'
import { parseOnchainError } from '@/lib/format'
import { CHAIN_ID, VAULT_ADDRESS } from '@/lib/vault'
import { useNexora } from './NexoraProvider'

export type TxPhase = 'idle' | 'wallet' | 'confirming'

export interface TxResult {
  hash: Hash
  receipt: TransactionReceipt
}

export type PaymentOutcome =
  | { kind: 'executed'; requestId: bigint }
  | { kind: 'pending'; requestId: bigint }
  | { kind: 'blocked'; requestId: bigint; reason: number }

/** Reads what the contract decided for a submitted payment request from its receipt logs. */
export function paymentOutcome(receipt: TransactionReceipt): PaymentOutcome | null {
  const logs = receipt.logs.filter((l) => l.address.toLowerCase() === VAULT_ADDRESS.toLowerCase())
  const parsed = parseEventLogs({
    abi: nexoraVaultAbi,
    logs,
    eventName: ['PaymentExecuted', 'PaymentBlocked', 'PaymentRequested'],
  })
  const ev = parsed[0]
  if (!ev) return null
  if (ev.eventName === 'PaymentExecuted') return { kind: 'executed', requestId: ev.args.requestId }
  if (ev.eventName === 'PaymentRequested') return { kind: 'pending', requestId: ev.args.requestId }
  return { kind: 'blocked', requestId: ev.args.requestId, reason: Number(ev.args.reason) }
}

export function useTx() {
  const { chainId } = useAccount()
  const { switchChainAsync } = useSwitchChain()
  const { writeContractAsync } = useWriteContract()
  const publicClient = usePublicClient({ chainId: CHAIN_ID })
  const { refetchAll } = useNexora()
  const [phase, setPhase] = useState<TxPhase>('idle')

  const run = useCallback(
    async (label: string, send: () => Promise<Hash>, opts?: { quiet?: boolean }): Promise<TxResult | null> => {
      if (!publicClient) return null
      try {
        if (chainId !== CHAIN_ID) await switchChainAsync({ chainId: CHAIN_ID })
        setPhase('wallet')
        const hash = await send()
        setPhase('confirming')
        const receipt = await publicClient.waitForTransactionReceipt({ hash })
        if (receipt.status !== 'success') throw new Error('Transaction reverted')
        await refetchAll()
        if (!opts?.quiet) {
          toast.success(`${label} confirmed`, {
            action: {
              label: 'View',
              onClick: () => window.open(buildTxExplorerUrl(CHAIN_ID, hash), '_blank', 'noopener,noreferrer'),
            },
          })
        }
        return { hash, receipt }
      } catch (error) {
        const message = parseOnchainError(error)
        if (message) toast.error(`${label}: ${message}`)
        return null
      } finally {
        setPhase('idle')
      }
    },
    [publicClient, chainId, switchChainAsync, refetchAll],
  )

  return { run, write: writeContractAsync, phase, busy: phase !== 'idle' }
}
