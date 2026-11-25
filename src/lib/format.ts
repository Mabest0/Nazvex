import { formatUnitsExact } from '@/onchain-money'

/** Raw 6-decimal USDC to a display string with at least two decimals. */
export function fmtUsdc(raw: bigint): string {
  const [whole, frac = ''] = formatUnitsExact(raw, 6).split('.')
  const trimmed = frac.replace(/0+$/, '').padEnd(2, '0')
  return `${BigInt(whole).toLocaleString('en-US')}.${trimmed}`
}

export function shortAddr(addr: string): string {
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`
}

export function sameAddr(a?: string, b?: string): boolean {
  return !!a && !!b && a.toLowerCase() === b.toLowerCase()
}

export function nowSec(): number {
  return Math.floor(Date.now() / 1000)
}

export function timeAgo(sec: bigint | number, now = nowSec()): string {
  const diff = Math.max(0, now - Number(sec))
  if (diff < 60) return 'just now'
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}

export function timeUntil(sec: bigint | number, now = nowSec()): string {
  const diff = Number(sec) - now
  if (diff <= 0) return 'expired'
  if (diff < 3600) return `${Math.max(1, Math.floor(diff / 60))}m left`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h left`
  return `${Math.floor(diff / 86400)}d left`
}

export function fmtDate(sec: bigint | number): string {
  return new Date(Number(sec) * 1000).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function pct(part: bigint, whole: bigint): number {
  if (whole <= 0n) return 0
  return Math.min(100, Number((part * 10000n) / whole) / 100)
}

export function parseOnchainError(error: unknown): string | null {
  const message = (error instanceof Error ? error.message : typeof error === 'string' ? error : '').toLowerCase()
  const code = (error as { code?: number } | null)?.code
  if (code === 4001 || message.includes('user rejected') || message.includes('user denied')) return null
  if (message.includes('insufficient funds') || message.includes('exceeds balance')) {
    return 'Insufficient balance for this transaction or gas.'
  }
  const known: Array<[string, string]> = [
    ['notagentowner', 'Only the agent owner can do this.'],
    ['notagentwallet', 'Switch to this agent\u2019s wallet to submit requests.'],
    ['approvalexpired', 'This approval request has expired.'],
    ['agentrevoked', 'This agent has been revoked.'],
    ['invalidpolicy', 'Policy is invalid: check limits and expiry.'],
    ['insufficientbalance', 'Not enough balance in the agent vault.'],
    ['toomanyrecipients', 'Recipient list is full.'],
    ['recipientunchanged', 'Nothing to change for that recipient.'],
    ['zeroaddress', 'Address cannot be empty.'],
    ['invalidrecipient', 'That recipient address is not allowed.'],
    ['invalidagentstatus', 'The agent is not in the right state for this action.'],
    ['requestnotpending', 'This request is no longer pending.'],
    ['purposetoolong', 'Purpose is too long (140 bytes max).'],
    ['invalidamount', 'Enter an amount greater than zero.'],
    ['invalidname', 'Agent name must be 1 to 48 characters.'],
  ]
  for (const [needle, text] of known) if (message.includes(needle)) return text
  if (message.includes('reverted')) return 'Transaction reverted. Check the inputs and try again.'
  if (message.includes('network') || message.includes('timeout')) return 'Network issue. Check your connection and retry.'
  return 'Something went wrong. Please try again.'
}
