# Deploy NazvexVault from your own wallet (Remix)

This puts your own address on the explorer as the contract's creator. It uses your browser wallet and Remix, a free browser tool for compiling and deploying contracts. You need a little Arc Testnet USDC in the wallet for gas.

The source in `docs/remix/NazvexVault.flat.sol` is the same contract as `contracts/NazvexVault.sol`, joined into one file so Remix needs no other downloads. It compiles to the same code as the repo version (checked), and all 99 tests pass on the repo version.

## Before you start

- Wallet network: **Arc Testnet**, chain ID `5042002`, RPC `https://rpc.testnet.arc.io`, currency USDC, explorer `https://explorer.testnet.arc.io`.
- Get test USDC for gas from the **Get test USDC** button in Arc Studio, or https://faucet.circle.com.
- Use the wallet you want shown as the creator.

## Steps

1. Open https://remix.ethereum.org.
2. In the file explorer, create a new file named `NazvexVault.sol`, and paste in the full contents of `docs/remix/NazvexVault.flat.sol`.
3. Open the **Solidity compiler** tab and set:
   - Compiler: **0.8.28**
   - Open **Advanced Configurations**, set **EVM version** to **cancun**
   - Tick **Enable optimization** and set it to **200**
4. Click **Compile NazvexVault.sol**. It should finish with a green tick.
5. Open the **Deploy & run transactions** tab:
   - Environment: **Injected Provider - MetaMask** (or your wallet)
   - Confirm the network shows **Arc Testnet** (chain `5042002`)
   - Contract: choose **NazvexVault**
   - Next to **Deploy**, enter the constructor value `0x3600000000000000000000000000000000000000` (this is USDC on Arc)
6. Click **Deploy** and approve in your wallet.
7. When it confirms, copy two things:
   - the **contract address** (under "Deployed Contracts")
   - the **transaction hash** (in the Remix terminal, or from your wallet's activity)
8. Send both to me. I'll switch the app to your new contract, verify it on the explorer, and update the docs.

## What to check afterward

- The explorer page `https://explorer.testnet.arc.io/address/<your address>` shows **your wallet** as the creator.
- The contract is verified, and the app shows your agents under the new vault.

## Notes

- This is a new, empty vault. Agent #1 and its test USDC stay on the old vault. Withdraw them from the old contract's explorer page: open `0x81706229562ddbace8d475ad3f8fdc22c05e4a04`, then **Contract**, **Write contract**, and call `withdrawFromAgent` with agent id `1` and an amount in raw USDC (`3400000` is 3.4 USDC).
- Don't change the constructor value. It must be the USDC address above, or the vault won't work with USDC.
- Testnet only. Get an independent audit before any real funds.
