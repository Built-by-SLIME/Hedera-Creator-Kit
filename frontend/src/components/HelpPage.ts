/**
 * Help Page Component
 * Terminal-style help page — tool descriptions, fee transparency, and upcoming video guides
 */

export class HelpPage {
  static render(): string {
    return `
      <div class="terminal-window">
        ${this.renderChrome()}
        ${this.renderContent()}
        ${this.renderStatusBar()}
      </div>
    `
  }

  private static renderChrome(): string {
    return `
      <div class="window-chrome">
        <div class="window-controls">
          <div class="window-dot close"></div>
          <div class="window-dot minimize"></div>
          <div class="window-dot maximize"></div>
        </div>
        <div class="window-title">hedera-creator-kit -- help</div>
      </div>
    `
  }

  private static renderContent(): string {
    return `
      <div class="terminal-content" id="help-content">
        ${this.lines().map(l => `<div class="terminal-line terminal-${l.type}">${l.content}</div>`).join('')}
      </div>
      <div class="terminal-input-area">
        <span class="input-prompt">hedera-creator-kit@hedera:~$</span>
        <input
          type="text"
          class="terminal-input"
          id="help-input"
          placeholder="Type &quot;back&quot; or press Enter to return home..."
          autocomplete="off"
          spellcheck="false"
        />
      </div>
    `
  }

  private static lines(): { type: string; content: string }[] {
    return [
      { type: 'output', content: '' },
      { type: 'success', content: '╔════════════════════════════════════════════════════════════╗' },
      { type: 'success', content: '║   HEDERA CREATOR KIT  -  Help & Documentation              ║' },
      { type: 'success', content: '╚════════════════════════════════════════════════════════════╝' },
      { type: 'output', content: '' },

      // --- FEES ---
      { type: 'warning', content: '  ── FEES ──────────────────────────────────────────────────' },
      { type: 'output', content: '' },
      { type: 'output', content: '  Most tools are free to use. The costs below may apply' },
      { type: 'output', content: '  depending on the operation:' },
      { type: 'output', content: '' },
      { type: 'output', content: '  • Network fees   Hedera transaction fees paid in HBAR' },
      { type: 'output', content: '                   (typically fractions of a cent per tx)' },
      { type: 'output', content: '  • SaucerSwap     New pool creation carries a one-time fee' },
      { type: 'output', content: '                   charged by SaucerSwap (currently ~$50 in HBAR)' },
      { type: 'output', content: '  • Domain names   Fees charged by Hedera Creator Kit per year:' },
      { type: 'output', content: '' },
      { type: 'output', content: '    Standard (no emoji)        Premium (with emoji)' },
      { type: 'output', content: '    1 letter  — $100/yr        1 letter  — $250/yr' },
      { type: 'output', content: '    2 letters — $50/yr         2 letters — $150/yr' },
      { type: 'output', content: '    3+ letters — $10/yr        3 letters — $25/yr' },
      { type: 'output', content: '' },

      // --- TOOLS ---
      { type: 'warning', content: '  ── TOOLS ─────────────────────────────────────────────────' },
      { type: 'output', content: '' },

      { type: 'success', content: '  [1]  Art Generator' },
      { type: 'output', content: '       Generate layered NFT artwork from trait files.' },
      { type: 'output', content: '       Upload trait layers, configure rarity, and produce' },
      { type: 'output', content: '       a ready-to-mint image set and metadata JSON.' },
      { type: 'output', content: '' },

      { type: 'success', content: '  [2]  Create Collection' },
      { type: 'output', content: '       Deploy a new NFT collection (HTS token) on Hedera.' },
      { type: 'output', content: '       Set the name, symbol, supply type, royalties, and' },
      { type: 'output', content: '       treasury account — all in one transaction.' },
      { type: 'output', content: '' },

      { type: 'success', content: '  [3]  Mint NFTs' },
      { type: 'output', content: '       Batch mint NFTs into an existing collection.' },
      { type: 'output', content: '       Upload metadata and mint up to 10 NFTs per transaction.' },
      { type: 'output', content: '' },

      { type: 'success', content: '  [4]  Create Token' },
      { type: 'output', content: '       Create a new fungible (HTS) token on Hedera.' },
      { type: 'output', content: '       Configure name, symbol, decimals, initial supply,' },
      { type: 'output', content: '       and key permissions in a single step.' },
      { type: 'output', content: '' },

      { type: 'success', content: '  [5]  Update Token Icon' },
      { type: 'output', content: '       Update the icon and metadata for an existing HTS token.' },
      { type: 'output', content: '       Pins the new image to IPFS and updates on-chain metadata.' },
      { type: 'output', content: '' },

      { type: 'success', content: '  [6]  Add Liquidity' },
      { type: 'output', content: '       Add liquidity to a SaucerSwap V1 pool.' },
      { type: 'output', content: '       Supports HBAR/HTS and HTS/HTS pairs — create a new' },
      { type: 'output', content: '       pool or add to an existing one at the current ratio.' },
      { type: 'output', content: '' },

      { type: 'success', content: '  [7]  Token Viewer' },
      { type: 'output', content: '       Look up any Hedera token by ID.' },
      { type: 'output', content: '       View supply, decimals, treasury, keys, fees, and more.' },
      { type: 'output', content: '' },

      { type: 'success', content: '  [8]  Snapshot Tool' },
      { type: 'output', content: '       Capture a full holder list for any HTS token or NFT.' },
      { type: 'output', content: '       Filter by minimum balance, serial number range, or date.' },
      { type: 'output', content: '       Export results as CSV or copy account IDs directly.' },
      { type: 'output', content: '' },

      { type: 'success', content: '  [9]  Airdrop Tool' },
      { type: 'output', content: '       Distribute tokens or NFTs to a list of wallet addresses.' },
      { type: 'output', content: '       Paste in account IDs (e.g. from a snapshot) and send' },
      { type: 'output', content: '       a batch transfer in one go.' },
      { type: 'output', content: '' },

      { type: 'output', content: '  [10] Swap Tool                                    Coming Soon' },
      { type: 'output', content: '       Migrate existing holders from one token to a new token.' },
      { type: 'output', content: '' },

      { type: 'success', content: '  [11] Burn Tool' },
      { type: 'output', content: '       Permanently burn fungible tokens or NFTs from a wallet.' },
      { type: 'output', content: '       Reduces circulating supply on-chain — irreversible.' },
      { type: 'output', content: '' },

      { type: 'output', content: '  [12] Staking Tool                                 Coming Soon' },
      { type: 'output', content: '       Set up on-chain rewards for token holders.' },
      { type: 'output', content: '' },

      { type: 'output', content: '  [13] Domain Registration                          Coming Soon' },
      { type: 'output', content: '       Register .hbar domains via Kabuto Name Service (KNS).' },
      { type: 'output', content: '' },

      // --- VIDEOS ---
      { type: 'warning', content: '  ── INSTRUCTIONAL VIDEOS ────────────────────────────────────' },
      { type: 'output', content: '' },
      { type: 'output', content: '  Step-by-step video guides for each tool are coming soon.' },
      { type: 'output', content: '  Check back here for embedded walkthroughs and tutorials.' },
      { type: 'output', content: '' },

      // --- NAVIGATION ---
      { type: 'warning', content: '  ── COMMANDS ──────────────────────────────────────────────' },
      { type: 'output', content: '' },
      { type: 'output', content: '  back / home    Return to the main menu' },
      { type: 'output', content: '  clear          Clear the terminal' },
      { type: 'output', content: '  <number>       Go directly to a tool (e.g. "8")' },
      { type: 'output', content: '' },
    ]
  }

  static init(): void {
    const input = document.getElementById('help-input') as HTMLInputElement
    if (!input) return

    input.focus()

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const cmd = input.value.trim().toLowerCase()
        input.value = ''

        if (!cmd || cmd === 'back' || cmd === 'home' || cmd === 'menu') {
          window.dispatchEvent(new CustomEvent('navigate-to-tool', { detail: { toolId: 'home' } }))
          return
        }

        if (cmd === 'clear') {
          window.dispatchEvent(new CustomEvent('navigate-to-tool', { detail: { toolId: 'home' } }))
          return
        }

        // Number shortcut — go directly to tool
        if (/^([1-9]|1[0-3])$/.test(cmd)) {
          window.dispatchEvent(new CustomEvent('navigate-to-tool', { detail: { toolId: `tool-${cmd}` } }))
          return
        }
      }
    })
  }

  private static renderStatusBar(): string {
    return `
      <div class="status-bar">
        <div class="status-left">
          <span class="status-item">Not Connected</span>
        </div>
        <div class="status-center">
          <span class="status-item">Built by SLIME</span>
        </div>
        <div class="status-right">
          <span class="status-item">HEDERA CREATOR KIT v1.0</span>
          <span class="status-item">MAINNET</span>
        </div>
      </div>
    `
  }
}
