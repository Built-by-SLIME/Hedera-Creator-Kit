// @ts-nocheck — vendored inscription core (HCS-1/HCS-6), source: SLIME new-tools shared/core
// Asking the IPFS network whether anyone still hosts a file.

// Files the IPFS lookup said nobody hosts, after a first try in which no gateway could produce them: id -> what
// the gateways said. The later tries are skipped for these (they would only repeat the wait). A fresh start
// on the same file (Try again, reopening the NFT) forgets the entry and asks everything again.
export const UNHOSTED = new Map();

// After a failed first try: true when the gateways' answers and the lookup agree that the file is not on IPFS
// now. Only decided when at least one gateway looked and came up empty and none was merely busy or slow, and
// only if the lookup answers within a few seconds.
export async function nobodyHosts(ptr, errs) {
  const cid = "ipfs" === ptr.kind ? String(ptr.cid || "").split(/[/?#]/)[0] : "";
  const said = [...errs.values()];
  if (
    !cid ||
    !said.some((e) => /: HTTP (404|410|50[234])$/.test(e)) ||
    said.some((e) => /: (HTTP 429|timed out)$/.test(e))
  )
    return false;
  const n = await Promise.race([ipfsHostCount(cid), new Promise((go) => setTimeout(() => go(-1), 8000))]);
  return 0 === n;
}

// When no gateway returns an IPFS file, the useful question is whether the file still exists on the network
// at all. IPFS has a public lookup for that (delegated routing, the service browsers' IPFS tools use): it lists
// the nodes that currently say they host a given id. Every element with class "ipfshosts" and a data-cid is
// filled in with the answer, once.
export const IPFS_ROUTERS = ["https://delegated-ipfs.dev"];

// Answers from the lookup, kept for the visit so each id is asked once: id -> promise of the number of nodes
// hosting it (-1 when the lookup failed).
export const IPFS_HOSTS = new Map(); // id -> promise of the number of nodes hosting it, or -1 when the lookup failed

/**
 * Ask the IPFS lookup (IPFS_ROUTERS) how many nodes currently say they host an id. `cid` is the id alone,
 * without a path. Returns a promise of the number (0 when nobody does), or -1 when the lookup couldn't be
 * reached within 20 seconds. An answer is remembered in IPFS_HOSTS for the visit; a failed lookup is not, so
 * the next call asks again. Never rejects.
 */
export function ipfsHostCount(cid) {
  if (!IPFS_HOSTS.has(cid))
    IPFS_HOSTS.set(
      cid,
      (async () => {
        for (const base of IPFS_ROUTERS) {
          const ctrl = new AbortController();
          const timer = setTimeout(() => ctrl.abort(), 20000);
          try {
            const res = await fetch(`${base}/routing/v1/providers/${cid}`, {
              signal: ctrl.signal,
              headers: { accept: "application/json" },
              referrerPolicy: "no-referrer",
            });
            if (404 === res.status) return 0; // the lookup's way of saying "nobody"
            if (!res.ok) continue;
            const d = await res.json();
            return Array.isArray(d && d.Providers) ? d.Providers.length : 0;
          } catch (err) {
          } finally {
            clearTimeout(timer);
          }
        }
        IPFS_HOSTS.delete(cid); // couldn't ask: worth another go next time
        return -1;
      })(),
    );
  return IPFS_HOSTS.get(cid);
}
