# Deploy NazvexVault from your own wallet

## On a phone: one-tap deploy page (easiest)

The app has a built-in deploy page at `/?deploy=1`. It deploys NazvexVault from the wallet you connect, so that wallet is the creator.

1. Push the latest commits and let your host redeploy the site.
2. On your phone, open your wallet app (MetaMask or Coinbase Wallet) and use its built-in **Browser**.
3. Go to `https://<your-site>/?deploy=1`.
4. Tap **Connect wallet** and choose your wallet. The page switches it to Arc Testnet.
5. Make sure the wallet has a little test USDC for gas.
6. Tap **Deploy NazvexVault** and confirm in your wallet.
7. Copy the **contract address** and **transaction hash** it shows, and send them to Arc Studio chat.

## On a computer: Remix

This puts your own address on the explorer as the contract's creator. It uses your browser wallet and Remix, a free browser tool for compiling and deploying contracts. You need a little Arc Testnet USDC in the wallet for gas.

Use `docs/remix/NazvexVault.remix.sol` (about 470 lines). It is the same contract as `contracts/NazvexVault.sol`, with the library imports pinned to the exact version the tests ran on, so Remix downloads them itself. It compiles to the same code as the repo version (checked), and all 99 tests pass on the repo version.

If Remix can't download the libraries, use `docs/remix/NazvexVault.flat.sol` instead. It is the same contract in one 5,000-line file with nothing to download.

**Fastest way to load it (only if the GitHub repo is public and pushed):** open this link and Remix loads the file for you, with nothing to copy:

`https://remix.ethereum.org/#url=https://github.com/Mabest0/Nazvex/blob/main/docs/remix/NazvexVault.remix.sol`

## Before you start

- Wallet network: **Arc Testnet**, chain ID `5042002`, RPC `https://rpc.testnet.arc.io`, currency USDC, explorer `https://explorer.testnet.arc.io`.
- Get test USDC for gas from the **Get test USDC** button in Arc Studio, or https://faucet.circle.com.
- Use the wallet you want shown as the creator.

## Steps

1. Open https://remix.ethereum.org.
2. Load the file: use the link above, or create a new file named `NazvexVault.sol` in Remix and paste in the full contents of `docs/remix/NazvexVault.remix.sol`.
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
