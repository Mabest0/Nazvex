/** Nazvex mark: an N drawn as a path between four nodes, a network of agents under one set of rules. */
export function LogoMark({ size = 36 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" fill="none" role="img" aria-label="Nazvex">
      <rect width="40" height="40" rx="11" fill="#acc6e9" />
      <path d="M12 29V11L28 29V11" stroke="#0d1b2f" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="12" cy="11" r="3.4" fill="#0d1b2f" />
      <circle cx="28" cy="29" r="3.4" fill="#0d1b2f" />
      <circle cx="12" cy="29" r="2.2" fill="#0d1b2f" />
      <circle cx="28" cy="11" r="2.2" fill="#0d1b2f" />
      <circle cx="12" cy="11" r="1.3" fill="#acc6e9" />
      <circle cx="28" cy="29" r="1.3" fill="#acc6e9" />
    </svg>
  )
}

export function Logo({ size = 36 }: { size?: number }) {
  return (
    <div className="flex items-center gap-2.5">
      <LogoMark size={size} />
      <span className="display text-xl font-bold tracking-tight">Nazvex</span>
    </div>
  )
}
