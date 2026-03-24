# Hedera Creator Toolkit

A cyberpunk-themed dashboard for creating and managing NFT collections on Hedera Hashgraph.

## 🎨 Features

### Active Tools
- ✅ **Art Generator** - Generate NFT collections with automatic IPFS upload
- ✅ **Create Collection** - Create NFT collections with custom royalties
- ✅ **Mint NFTs** - Batch mint up to 10 NFTs per transaction
- ✅ **Create Token** - Create a new fungible token
- ✅ **Update Token** - Update fungible token Icon/Metadata
- ✅ **Add Liquidity** - Create and add to liquidity pools
- ✅ **Burn NFTs** - Permanently burn tokens from collections
- ✅ **Airdrop Tool** - Distribute tokens & NFTs to multiple wallets
- ✅ **Snapshot Tool** - Capture holder accounts for any token
- ✅ **Token Swap** - Migrate holders between tokens
- ✅ **Token Viewer** - Viewer details of any token on Hedera (keys, holders, etc.).
- ✅ **Domain Registration** - Register .hedera, .slime, .gib, .tigers, & .buds domains

## 📁 Project Structure

```
hedera-creator-toolkit/
├── frontend/                        # TypeScript + Vite admin dashboard
│   ├── src/
│   │   ├── components/              # All tool UI components
│   │   │   ├── ArtGenerator.ts      # NFT art generation tool
│   │   │   ├── CreateCollection.ts  # NFT collection creation
│   │   │   ├── MintNFTs.ts          # Batch NFT minting
│   │   │   ├── CreateToken.ts       # Fungible token creation
│   │   │   ├── UpdateTokenIcon.ts   # Token icon/metadata update
│   │   │   ├── AddLiquidity.ts      # Liquidity pool management
│   │   │   ├── BurnTool.ts          # NFT burning
│   │   │   ├── AirdropTool.ts       # Token & NFT airdrop
│   │   │   ├── SnapshotTool.ts      # Holder snapshot capture
│   │   │   ├── SwapTool.ts          # Token swap / migration
│   │   │   ├── TokenViewer.ts       # Token detail viewer
│   │   │   ├── StakingTool.ts       # Soft-staking program manager
│   │   │   └── DomainTool.ts        # Hedera domain registration
│   │   ├── services/
│   │   │   └── WalletConnectService.ts  # WalletConnect v2 integration
│   │   ├── styles/
│   │   │   └── main.css             # Cyberpunk/terminal theme
│   │   ├── config.ts                # API endpoints & network config
│   │   └── main.ts                  # App entry point & router
│   ├── index.html
│   └── package.json
├── backend/
│   ├── api-server/                  # Express API (deployed on Railway)
│   │   ├── server.ts                # Express app & route registration
│   │   ├── db.ts                    # PostgreSQL pool & schema migrations
│   │   └── routes/
│   │       ├── staking.ts           # Soft-staking programs & drip engine
│   │       ├── swap.ts              # Token swap programs
│   │       ├── domains.ts           # Domain registration (.hedera, .slime, etc.)
│   │       ├── generate.ts          # AI art generation
│   │       ├── mint-nfts.ts         # Server-side NFT minting
│   │       ├── pin-nft-metadata.ts  # Pinata IPFS pinning
│   │       └── ...                  # Additional route handlers
│   ├── 1-collection-management/     # Standalone collection scripts
│   ├── 2-nft-minting/               # Standalone minting scripts
│   ├── 3-metadata-tools/            # Metadata cleaning & IPFS upload scripts
│   ├── 4-utilities/                 # Mirror Node query utilities
│   ├── 5-art-generator/             # Art generation utilities
│   └── package.json
├── fees/
│   └── staking.md                   # Staking fee documentation
└── package.json                     # Root workspace
```

## 🎯 Mission

The Hedera Creator Toolkit exists to remove every technical barrier between a creator and the Hedera network. Today, launching an NFT collection, distributing rewards to holders, registering an on-chain domain, or running a token swap requires deep SDK knowledge, custom scripting, and significant development time. This toolkit consolidates all of that into a single, polished, open-source dashboard — free to use, self-hostable, and built entirely on Hedera's native token service.

The goal is to grow the Hedera creator ecosystem by giving artists, project founders, and community builders the same capabilities that previously required a dedicated developer.

---

## 🔧 Tech Stack & Architecture

| Layer | Technology |
|---|---|
| Frontend | TypeScript, Vite, WalletConnect v2 |
| Backend API | Node.js, Express, Hedera SDK |
| Database | PostgreSQL (Railway) |
| IPFS | Pinata |
| Wallet | HashPack, Blade, MetaMask (via WalletConnect) |
| Deployment | Railway (API), Vercel/static host (frontend) |
| Network | Hedera Mainnet |

The frontend is a fully client-side TypeScript application — wallets connect via WalletConnect v2 and all transactions are signed locally by the user. The backend API handles computationally heavy operations (art generation, batch minting, staking drip distribution) and maintains program state in PostgreSQL. No private keys are ever transmitted to or stored by the server.

---

## 🚀 Live Deployment

The toolkit is actively deployed and in production use on Hedera Mainnet:

- **Admin Dashboard** — Used by project creators to configure collections, staking programs, token swaps, and domain registrations
- **Staking API** — Live at Railway, processing automated reward distributions via scheduled cron drips for multiple active NFT projects
- **Domain Registry** — On-chain domain registration operational for `.hedera`, `.slime`, `.gib`, `.tigers`, and `.buds` TLDs

---

## 🌐 Ecosystem Impact

- **Lowers the barrier to entry** for Hedera creators who have no Solidity or SDK experience
- **Drives HTS adoption** — every tool (collections, tokens, swaps, staking, airdrops) is built exclusively on Hedera Token Service
- **Supports cross-project infrastructure** — the staking and swap APIs are multi-tenant; any Hedera project can create and manage programs through the same backend
- **On-chain domain system** — brings human-readable identity to Hedera wallets without requiring a separate protocol
- **Open source** — fully available for the community to fork, self-host, or build upon

---

## 🗺️ Roadmap

- [ ] **Staking Analytics Dashboard** — Holder earnings history, distribution charts, per-program stats
- [ ] **Frictionless Airdrop (HIP-904)** — Eliminate the token association requirement for airdrops using Hedera's pending airdrop standard
- [ ] **Mobile-responsive UI** — Full dashboard experience on mobile wallets
- [ ] **Multi-sig Treasury Support** — Allow staking/swap programs to be governed by threshold keys
- [ ] **Public Creator Profiles** — Discoverable project pages linked to on-chain domain registrations
- [ ] **Scheduled Minting** — Queue and schedule NFT mints with time-based release

---

## 📖 Additional Resources

- **Hedera Docs:** https://docs.hedera.com
- **Hedera Token Service:** https://docs.hedera.com/hedera/sdks-and-apis/sdks/token-service
- **Mirror Node API:** https://docs.hedera.com/hedera/sdks-and-apis/rest-api
- **HashScan Explorer:** https://hashscan.io
- **Pinata IPFS:** https://docs.pinata.cloud

---

## 📝 License

MIT License — open source, free to use, fork, and build upon.

---

**Built on Hedera. Built for creators. 🚀**
