/**
 * Snapshot NFT holdings via the public API + Mirror Node
 */
const axios = require('axios');

const BACKEND_URL = 'https://hedera-nft-toolkit-production.up.railway.app';
const MIRROR_NODE_BASE = 'https://mainnet-public.mirrornode.hedera.com/api/v1';

const NFT_PROGRAMS = [
  { id: '8345ebe8-978a-493d-8fbd-86ebcb4c7266', name: 'SLIME', token: '0.0.9474754' },
  { id: 'f92d3051-8325-416e-bbab-c78e98c5b4df', name: 'Degen Ape Society', token: '0.0.10172732' },
];

async function fetchNftSerials(accountId, tokenId) {
  const serials = [];
  let nextLink = `/accounts/${accountId}/nfts?token.id=${tokenId}&limit=100`;

  while (nextLink) {
    const url = nextLink.startsWith('http') ? nextLink : `${MIRROR_NODE_BASE}${nextLink}`;
    const res = await axios.get(url);
    const nfts = res.data.nfts || [];
    for (const nft of nfts) {
      serials.push(nft.serial_number);
    }
    nextLink = res.data.links?.next || null;
  }

  return serials;
}

async function main() {
  const snapshot = {};
  const verbose = process.argv.includes('--verbose');

  for (const prog of NFT_PROGRAMS) {
    if (verbose) console.log(`\n[${prog.name}] Fetching participants...`);
    try {
      const participantsRes = await axios.get(`${BACKEND_URL}/api/staking-programs/${prog.id}/participants`);
      const participants = participantsRes.data.participants || [];

      const holdings = [];
      for (const p of participants) {
        const accountId = p.account_id;
        if (verbose) console.log(`  ${accountId}...`);
        try {
          const serials = await fetchNftSerials(accountId, prog.token);
          if (verbose) console.log(`    → ${serials.length} NFTs`);
          holdings.push({ account_id: accountId, serials });
        } catch (err) {
          if (verbose) console.log(`    ⚠ Error fetching serials: ${err.message}`);
          holdings.push({ account_id: accountId, serials: [], error: err.message });
        }
      }

      snapshot[prog.id] = {
        program_name: prog.name,
        stake_token_id: prog.token,
        holdings,
      };
    } catch (err) {
      if (verbose) console.log(`  ⚠ Error fetching participants: ${err.message}`);
      snapshot[prog.id] = {
        program_name: prog.name,
        stake_token_id: prog.token,
        error: err.message,
      };
    }
  }

  console.log(JSON.stringify(snapshot, null, 2));
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});

