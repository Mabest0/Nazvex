import { isAddress, type Address } from 'viem'
import { arcTestnet } from 'viem/chains'
import { getUsdc, requireChain } from '@/onchain-facts'

export const CHAIN_ID = arcTestnet.id
export const CHAIN = requireChain(CHAIN_ID)
export const VAULT_ADDRESS = import.meta.env.VITE_NAZVEX_VAULT_ADDRESS as Address
export const CONFIG_OK = isAddress(String(VAULT_ADDRESS ?? ''))
export const VAULT_DEPLOY_TX = import.meta.env.VITE_NAZVEX_VAULT_DEPLOY_TX as string | undefined

const usdcFact = getUsdc(CHAIN_ID)
if (!usdcFact) throw new Error('USDC is not registered for Arc Testnet')
export const USDC_ADDRESS = usdcFact.address as Address

export const AgentStatus = { Active: 0, Paused: 1, Revoked: 2 } as const
export const RequestStatus = { Pending: 0, Executed: 1, Blocked: 2, Declined: 3, Cancelled: 4 } as const

export const REQUEST_STATUS_LABEL = ['Pending', 'Executed', 'Blocked', 'Declined', 'Cancelled'] as const
export const AGENT_STATUS_LABEL = ['Active', 'Paused', 'Revoked'] as const

export const BLOCK_REASON_LABEL = [
  'None',
  'Agent is not active',
  'Budget expired',
  'Exceeds per-transaction limit',
  'Exceeds daily limit',
  'Recipient not on allowlist',
  'Insufficient vault balance',
] as const

export interface Policy {
  maxPerTx: bigint
  dailyLimit: bigint
  approvalThreshold: bigint
  expiresAt: bigint
}

export interface Agent {
  id: bigint
  owner: Address
  wallet: Address
  name: string
  status: number
  balance: bigint
  totalFunded: bigint
  totalSpent: bigint
  spentToday: bigint
  remainingToday: bigint
  createdAt: bigint
  policy: Policy
}

export interface PayRequest {
  id: bigint
  agentId: bigint
  to: Address
  amount: bigint
  purpose: string
  status: number
  reason: number
  createdAt: bigint
  resolvedAt: bigint
  expiresAt: bigint
}

export const FAUCET_URL = 'https://faucet.circle.com'
