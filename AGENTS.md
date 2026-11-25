# Nazvex

> Built with Arc Studio - money-powered apps in minutes

This is the **project memory** - what Arc Studio remembers about building this app. It helps future agents (or humans) understand and extend the project.

---

## What This App Does

Nazvex is a financial control layer for AI agents on Arc Testnet. Owners register agents, fund per-agent vault balances with test USDC and set contract-enforced policies (per-tx limit, UTC-day limit, recipient allowlist, approval threshold, budget expiry, pause/revoke). Agents submit payment requests from their own wallet; the vault executes, holds for owner approval, or records a Blocked request with a reason. The AI assistant is rule-based over onchain data and only produces proposals the owner signs.

## Tech Stack

- Frontend: React 18, Vite, TypeScript, Tailwind CSS
- Web3: wagmi v2, viem v2, ConnectKit
- Contracts: Solidity 0.8.28 + Foundry. Sources in `contracts/`, unit tests in `contracts/test/*.t.sol`. Build with `bun run contracts:build` (`forge build`), test with `bun run contracts:test` (`forge test`).
- Wallet: injected (MetaMask, etc.)
- Chain: Arc Testnet (Chain ID: 5042002, imported from `viem/chains`)
- Token: USDC (6 decimals) (Address: 0x3600000000000000000000000000000000000000, Chain: Arc Testnet)
- Toasts: Sonner

## Key Files

- `src/App.tsx` - Main application logic
- `src/components/` - UI components
- `src/config.ts` - wagmi config (chains, connectors, transports)

## Share links

- Starter apps already ship `getShareBase`, `buildShareLink` and `installShareSync` in `src/lib/share.ts`; import them instead of rewriting them.
- Keep shareable state in the URL path or query, not in the `#fragment`.
- Never put a secret (private key, claim secret, seed phrase, session token, API key) in the URL path or query, encoded or not: every in-app path and query is mirrored to the visitor's studio.arc.io address bar and browser history and reaches servers. A bearer claim secret goes only in the `#fragment` appended to the share link (`` `${await buildShareLink('/claim')}#${secret}` ``) and is read from `location.hash` on load. A link to the app's own share URL shown inside the app must be copy-only or open in a new tab with `target="_blank" rel="noopener noreferrer"`.
- Build every link a user copies or sends with `buildShareLink()` from `src/lib/share.ts`.
- Keep the `installShareSync()` call in `src/main.tsx` when editing it; it keeps the Studio address bar in step with in-app navigation.
- Navigate inside the app with relative links.

## To Run

```bash
bun install
bun run dev
```


## Deployed contracts

- NexoraVault (contract name kept as deployed; the product is Nazvex) (Arc Testnet, chain 5042002): `0x81706229562ddbace8d475ad3f8fdc22c05e4a04`
  - Deploy tx: `0xde55764de8a60db6a8877ca82c075464d016e5f69b2eb16ee8d57fe6c51949c9`
  - Constructor arg: USDC `0x3600000000000000000000000000000000000000`
  - Address lives in `.env` as `VITE_NEXORA_VAULT_ADDRESS`; ABI in `src/contracts/nexoraVaultAbi.ts` (regenerate from `contracts/out/NexoraVault.sol/NexoraVault.json` after contract changes).

## Decisions

- One singleton vault (registry + budget vault merged) instead of two contracts. No global admin; each agent has its own owner.
- All data is read from the chain (no backend or database). The assistant is deterministic; swap `src/lib/assistant.ts` for an LLM behind a server route if a key is added, keeping the proposal and confirm flow.
- Blocked payment requests are stored onchain (tx succeeds, no funds move). The UI decodes the receipt to show the real outcome.
- Daily limit = fixed UTC-day buckets. Approvals expire after 2 days and re-run all hard limits on approve.
