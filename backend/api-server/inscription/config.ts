// @ts-nocheck — vendored inscription core (HCS-1/HCS-6), source: SLIME new-tools shared/core
// Settings a host site can change without touching the rest of the code.
// Set them before the tool's script runs:
//     <script>window.SLIME_TRACE_CONFIG = { mirror: { mainnet: "/api/mirror/mainnet" } }</script>
// or call configure({...}) from your own code. Everything is optional; left alone, the tool talks straight
// to the public mirror nodes and IPFS gateways, exactly as the single-file version does.

// The live settings object: { mirror: { <network>: base address }, ipfs: { gateway, only, headStart (ms) },
// theme: { button }, preview: { url } }. Read it anywhere; change it with configure() or by assigning to its fields.
export const config = {
  /* Mirror node addresses of your own, per network: a proxy on your server, or a keyed provider.
     Each is a base address that answers the mirror node REST API under /api/v1 (with or without "/api/v1" on
     the end; a path on your own site such as "/api/mirror/mainnet" works too). A network left out uses the
     public nodes. The "Mirror node" box on the page still overrides this for the visit. */
  mirror: {},
  ipfs: {
    /* An IPFS gateway of your own, written like the public ones: the file's id and path are added to the
       end, e.g. "https://files.example.com/ipfs/". It is asked along with the public gateways. */
    gateway: "",
    /* true: ask only your gateway, never the public ones. */
    only: false,
    /* Milliseconds your gateway gets to answer before the public ones are asked as well. 0 asks everyone
       at once (whoever has the file first wins). */
    headStart: 0,
  },
  theme: {
    /* false: hide the Theme button and leave <html data-theme> alone, for a host page with its own switch. */
    button: true,
  },
  preview: {
    /* Where HTML pieces run when "Run in sandbox" is pressed: the address of the previewer page (preview/, on a
       domain of its own), e.g. "https://preview.example.net/piece-frame.html". Empty on a hosted page: pieces
       aren't run (the page's script policy would stop them). "local": run them in this page, for a host without
       that policy. The single-file build always runs them in the page. */
    url: "",
  },
};

/** Merge settings into the config. Safe to call at any time; requests made afterwards use the new values. */
export function configure(settings) {
  const s = settings || {};
  if (s.mirror) Object.assign(config.mirror, s.mirror);
  if (s.ipfs) Object.assign(config.ipfs, s.ipfs);
  if (s.theme) Object.assign(config.theme, s.theme);
  if (s.preview) Object.assign(config.preview, s.preview);
  return config;
}

try {
  configure(globalThis.SLIME_TRACE_CONFIG);
} catch {}
