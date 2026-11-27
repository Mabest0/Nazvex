import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { erc20Abi, type Address } from 'viem'
import { useAccount, useReadContract, useReadContracts } from 'wagmi'
import { nazvexVaultAbi } from '@/contracts/nazvexVaultAbi'
import { CHAIN_ID, USDC_ADDRESS, VAULT_ADDRESS, type Agent, type PayRequest } from '@/lib/vault'
import { nowSec } from '@/lib/format'

const REFRESH_MS = 8000
const MAX_REQUESTS = 120

interface NazvexState {
  address?: Address
  isConnected: boolean
  agents: Agent[]
  requests: PayRequest[]
  recipients: Record<string, Address[]>
  usdcBalance: bigint
  allowance: bigint
  loading: boolean
  now: number
  refetchAll: () => Promise<void>
  agentById: (id: bigint) => Agent | undefined
}

const NazvexContext = createContext<NazvexState | null>(null)

const base = { address: VAULT_ADDRESS, abi: nazvexVaultAbi, chainId: CHAIN_ID } as const

export function NazvexProvider({ children }: { children: ReactNode }) {
  const { address, isConnected } = useAccount()
  const [now, setNow] = useState(nowSec())

  useEffect(() => {
    const t = setInterval(() => setNow(nowSec()), 20000)
    return () => clearInterval(t)
  }, [])

  const idsQ = useReadContract({
    ...base,
    functionName: 'getOwnerAgentIds',
    args: address ? [address] : undefined,
    query: { enabled: !!address, refetchInterval: REFRESH_MS },
  })
  const ids = useMemo(() => (idsQ.data ? [...idsQ.data] : []), [idsQ.data])
  const enabled = ids.length > 0

  const agentsQ = useReadContracts({
    contracts: ids.map((id) => ({ ...base, functionName: 'getAgent' as const, args: [id] as const })),
    query: { enabled, refetchInterval: REFRESH_MS },
  })
  const recipientsQ = useReadContracts({
    contracts: ids.map((id) => ({ ...base, functionName: 'getRecipients' as const, args: [id] as const })),
    query: { enabled, refetchInterval: REFRESH_MS },
  })
  const reqIdsQ = useReadContracts({
    contracts: ids.map((id) => ({ ...base, functionName: 'getAgentRequestIds' as const, args: [id] as const })),
    query: { enabled, refetchInterval: REFRESH_MS },
  })

  const requestIds = useMemo(() => {
    const all: bigint[] = []
    for (const r of reqIdsQ.data ?? []) if (r.status === 'success') all.push(...r.result)
    return all.sort((a, b) => (a > b ? -1 : a < b ? 1 : 0)).slice(0, MAX_REQUESTS)
  }, [reqIdsQ.data])

  const requestsQ = useReadContracts({
    contracts: requestIds.map((id) => ({ ...base, functionName: 'getRequest' as const, args: [id] as const })),
    query: { enabled: requestIds.length > 0, refetchInterval: REFRESH_MS },
  })

  const usdcQ = useReadContracts({
    contracts: address
      ? [
          { address: USDC_ADDRESS, abi: erc20Abi, chainId: CHAIN_ID, functionName: 'balanceOf', args: [address] },
          { address: USDC_ADDRESS, abi: erc20Abi, chainId: CHAIN_ID, functionName: 'allowance', args: [address, VAULT_ADDRESS] },
        ]
      : [],
    query: { enabled: !!address, refetchInterval: REFRESH_MS },
  })

  const agents = useMemo<Agent[]>(() => {
    const out: Agent[] = []
    for (const r of agentsQ.data ?? []) if (r.status === 'success') out.push(r.result)
    return out
  }, [agentsQ.data])

  const recipients = useMemo(() => {
    const map: Record<string, Address[]> = {}
    ids.forEach((id, i) => {
      const r = recipientsQ.data?.[i]
      map[id.toString()] = r && r.status === 'success' ? [...r.result] : []
    })
    return map
  }, [ids, recipientsQ.data])

  const requests = useMemo<PayRequest[]>(() => {
    const out: PayRequest[] = []
    for (const r of requestsQ.data ?? []) if (r.status === 'success') out.push(r.result)
    return out
  }, [requestsQ.data])

  const usdcBalance = usdcQ.data?.[0]?.status === 'success' ? (usdcQ.data[0].result) : 0n
  const allowance = usdcQ.data?.[1]?.status === 'success' ? (usdcQ.data[1].result) : 0n

  const { refetch: refetchIds } = idsQ
  const { refetch: refetchAgents } = agentsQ
  const { refetch: refetchRecipients } = recipientsQ
  const { refetch: refetchReqIds } = reqIdsQ
  const { refetch: refetchRequests } = requestsQ
  const { refetch: refetchUsdc } = usdcQ

  const refetchAll = useCallback(async () => {
    await refetchIds()
    await Promise.all([refetchAgents(), refetchRecipients(), refetchReqIds(), refetchUsdc()])
    await refetchRequests()
  }, [refetchIds, refetchAgents, refetchRecipients, refetchReqIds, refetchRequests, refetchUsdc])

  const agentById = useCallback((id: bigint) => agents.find((a) => a.id === id), [agents])

  const loading = !!address && (idsQ.isLoading || (enabled && agentsQ.isLoading))

  const value = useMemo<NazvexState>(
    () => ({ address, isConnected, agents, requests, recipients, usdcBalance, allowance, loading, now, refetchAll, agentById }),
    [address, isConnected, agents, requests, recipients, usdcBalance, allowance, loading, now, refetchAll, agentById],
  )

  return <NazvexContext.Provider value={value}>{children}</NazvexContext.Provider>
}

export function useNazvex(): NazvexState {
  const ctx = useContext(NazvexContext)
  if (!ctx) throw new Error('useNazvex must be used inside NazvexProvider')
  return ctx
}
