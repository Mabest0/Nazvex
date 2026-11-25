# Nazvex

A financial control layer for AI agents on Arc Testnet. Owners register agents, fund each one with test USDC, set spending rules, approve sensitive payments and review everything an agent does. The rules are enforced by a smart contract, so neither the dashboard nor the AI assistant can move funds on its own.

Built with [Arc Studio](https://studio.arc.io)

## Features

- Register agents with their own wallet, vault balance and spending policy
- Per-transaction limit, daily limit, approved recipients, approval threshold and budget expiry
- Pause, resume or permanently revoke an agent; withdraw unspent funds at any time
- Payment requests that execute, wait for your approval, or are blocked with a recorded reason
- Approval queue, activity history, spending insights and a Security Center with transparent alert rules
- A plain-language assistant that answers questions and prepares changes for you to confirm

## Tech stack

React, Vite, TypeScript, Tailwind CSS, wagmi, viem, ConnectKit. Solidity and Foundry for the vault contract.

## Development

Prerequisites: [Bun](https://bun.sh), [Foundry](https://getfoundry.sh), a browser wallet on Arc Testnet with test USDC.

```bash
bun install
bun run dev
```

Other commands:

```bash
bun run check            # lint and typecheck
bun run contracts:build  # compile contracts
bun run contracts:test   # run contract tests
```

### Environment variables

- `VITE_NEXORA_VAULT_ADDRESS`: address of the deployed vault contract.
- `VITE_NEXORA_VAULT_DEPLOY_TX`: deployment transaction hash (optional, shown in the app).
- `RPC_PROXY_BASE_URL`, `RPC_PROXY_TOKEN`, `RPC_PROXY_CHAINS`: provisioned by Arc Studio, optional elsewhere.

## Testnet only

This prototype uses test USDC and is not suitable for real funds. Get an independent security audit before any mainnet use.
