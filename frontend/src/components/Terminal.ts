/**
 * Terminal Component
 * Full terminal UI with command input, history, and interactive menu
 */

import WalletConnectService from '../services/WalletConnectService'

interface TerminalLine {
  type: 'prompt' | 'command' | 'output' | 'success' | 'error' | 'warning'
  content: string
}

interface Tool {
  id: string
  number: number
  title: string
  description: string
  icon: string
  status: 'active' | 'coming-soon'
  accessRequired?: string
}

interface WalletData {
  connected: boolean
  accountId: string | null
  hbarBalance: string
  network: string
  hasSlime: boolean | null  // null = not checked yet
}

export class Terminal {
  private static history: TerminalLine[] = []
  private static commandHistory: string[] = []
  private static historyIndex: number = -1
  // @ts-expect-error reserved for future use
  private static _currentInput: string = ''

  private static walletSubscribed: boolean = false
  private static walletData: WalletData = {
    connected: false,
    accountId: null,
    hbarBalance: '0',
    network: 'MAINNET',
    hasSlime: null
  }

  private static tools: Tool[] = [
    { id: 'art-generator', number: 1, title: 'Art Generator', description: 'Generate NFT artwork', icon: '◆', status: 'active', accessRequired: 'Shittles NFT' },
    { id: 'create-collection', number: 2, title: 'Create Collection', description: 'Create a new NFT collection', icon: '◆', status: 'active', accessRequired: 'SLIME NFT' },
    { id: 'mint-nfts', number: 3, title: 'Mint NFTs', description: 'Batch mint NFTs (up to 10)', icon: '◆', status: 'active', accessRequired: 'BRainz NFT' },
    { id: 'create-token', number: 4, title: 'Create Token', description: 'Create a new fungible token', icon: '◆', status: 'active', accessRequired: 'SLIME NFT' },
    { id: 'update-token-icon', number: 5, title: 'Update Token Icon', description: 'Update token metadata/icon', icon: '◆', status: 'active', accessRequired: 'SLIME NFT' },
    { id: 'add-liquidity', number: 6, title: 'Add Liquidity', description: 'Add liquidity to fungible token', icon: '◆', status: 'active', accessRequired: 'SLIME NFT' },
    { id: 'token-viewer', number: 7, title: 'Token Viewer', description: 'View token information', icon: '◆', status: 'active', accessRequired: 'SLIME NFT' },
    { id: 'snapshot', number: 8, title: 'Snapshot Tool', description: 'Capture holder accounts', icon: '◆', status: 'active', accessRequired: 'BRainz NFT' },
    { id: 'airdrop', number: 9, title: 'Airdrop Tool', description: 'Distribute tokens to wallets', icon: '◆', status: 'active', accessRequired: 'SLIME NFT' },
    { id: 'swap', number: 10, title: 'Swap Tool', description: 'Migrate holders to new token', icon: '◆', status: 'active', accessRequired: 'SLIME NFT' },
    { id: 'burn', number: 11, title: 'Burn Tool', description: 'Permanently burn tokens/NFTs', icon: '◆', status: 'active', accessRequired: 'SLIME NFT' },
    { id: 'staking', number: 12, title: 'Staking Tool', description: 'Rewards for holders', icon: '◆', status: 'coming-soon', accessRequired: 'SLIME NFT' },
    { id: 'domain-registration', number: 13, title: 'Domain Registration', description: 'Register .hedera / .slime / .gib domains', icon: '◆', status: 'active', accessRequired: 'SLIME NFT' }
  ]

  private static isTokenGateVerified(): boolean {
    return this.walletData.connected && this.walletData.hasSlime === true
  }

  static render(): string {
    // Security: only inject tool HTML into the DOM after SLIME ownership is verified.
    // If not verified, return ONLY the gate overlay — tools are never present in the DOM.
    if (!this.isTokenGateVerified()) {
      return this.renderTokenGateOverlay()
    }

    return `
      <div class="terminal-window">
        ${this.renderWindowChrome()}
        ${this.renderTerminalContent()}
        ${this.renderInputArea()}
        ${this.renderStatusBar()}
      </div>
    `
  }

  private static renderTokenGateOverlay(): string {
    let statusContent = ''

    if (!this.walletData.connected) {
      // State 1: Not connected — show connect button
      statusContent = `
        <button class="token-gate-connect-btn" id="token-gate-connect-btn">
          ⚡ CONNECT WALLET
        </button>
      `
    } else if (this.walletData.hasSlime === null) {
      // State 2: Connected, verifying SLIME
      statusContent = `
        <div class="token-gate-status verifying">
          <span class="token-gate-spinner">⟳</span> Verifying SLIME NFT ownership...
        </div>
      `
    } else if (this.walletData.hasSlime === false) {
      // State 3: Connected, no SLIME found
      statusContent = `
        <div class="token-gate-status error">
          ✗ No SLIME NFT found in wallet <strong>${this.walletData.accountId}</strong>
        </div>
        <div class="token-gate-status error" style="margin-top: 0.75rem;">
          A <strong>SLIME NFT</strong> is required to access the Creator Kit tools.
        </div>
        <div class="token-gate-status" style="margin-top: 1rem;">
          <a href="https://sentx.io/nft-marketplace/0.0.9474754" target="_blank" rel="noopener">
            → Get a SLIME on SentX
          </a>
        </div>
        <button class="token-gate-connect-btn" id="token-gate-disconnect-btn" style="margin-top: 1.5rem; background: transparent; border: 1px solid var(--terminal-purple); color: var(--terminal-purple);">
          ↻ DISCONNECT & TRY ANOTHER WALLET
        </button>
      `
    }

    return `
      <div class="token-gate-overlay" id="token-gate-overlay">
        <div class="token-gate-card">
          <div class="token-gate-icon">🔒</div>
          <div class="token-gate-title">Token-Gated Access</div>
          <div class="token-gate-subtitle">
            The Hedera Creator Kit is exclusively available to<br/>
            <strong>SLIME NFT</strong> holders (Token ID: 0.0.9474754).
          </div>
          <hr class="token-gate-divider" />
          ${statusContent}
        </div>
      </div>
    `
  }

  private static renderWindowChrome(): string {
    return `
      <div class="window-chrome">
        <div class="window-controls">
          <div class="window-dot close"></div>
          <div class="window-dot minimize"></div>
          <div class="window-dot maximize"></div>
        </div>
        <div class="window-title">hedera-creator-kit</div>
      </div>
    `
  }

  private static renderTerminalContent(): string {
    // Always show the clean welcome screen — no command history on the homepage
    const welcome = this.getWelcomeScreen()

    return `
      <div class="terminal-content" id="terminal-content">
        ${welcome.map(line => this.renderLine(line)).join('')}
      </div>
    `
  }

  private static renderLine(line: TerminalLine): string {
    const className = `terminal-${line.type}`
    return `<div class="terminal-line ${className}">${line.content}</div>`
  }

  private static getWelcomeScreen(): TerminalLine[] {
    const lines: TerminalLine[] = [
      { type: 'output', content: this.getASCIIArt() },
      { type: 'success', content: '╔════════════════════════════════════════════════════════════╗' },
      { type: 'success', content: '║   Hi!                                                      ║' },
      { type: 'success', content: '║   What are we working on today?                            ║' },
      { type: 'success', content: '╚════════════════════════════════════════════════════════════╝' },
      { type: 'output', content: '' }
    ]

    lines.push({ type: 'output', content: 'Type "help" for available commands or select a tool below:' })
    lines.push({ type: 'output', content: '' })
    lines.push(...this.getToolsList())
    lines.push({ type: 'output', content: '' })
    lines.push({ type: 'prompt', content: 'Type a number (1-13) or tool name to begin...' })

    return lines
  }

  private static getASCIIArt(): string {
    return `
 ██╗  ██╗███████╗██████╗ ███████╗██████╗  █████╗     ██████╗██████╗ ███████╗ █████╗ ████████╗ ██████╗ ██████╗     ██╗  ██╗██╗████████╗
 ██║  ██║██╔════╝██╔══██╗██╔════╝██╔══██╗██╔══██╗   ██╔════╝██╔══██╗██╔════╝██╔══██╗╚══██╔══╝██╔═══██╗██╔══██╗    ██║ ██╔╝██║╚══██╔══╝
 ███████║█████╗  ██║  ██║█████╗  ██████╔╝███████║   ██║     ██████╔╝█████╗  ███████║   ██║   ██║   ██║██████╔╝    █████╔╝ ██║   ██║
 ██╔══██║██╔══╝  ██║  ██║██╔══╝  ██╔══██╗██╔══██║   ██║     ██╔══██╗██╔══╝  ██╔══██║   ██║   ██║   ██║██╔══██╗    ██╔═██╗ ██║   ██║
 ██║  ██║███████╗██████╔╝███████╗██║  ██║██║  ██║   ╚██████╗██║  ██║███████╗██║  ██║   ██║   ╚██████╔╝██║  ██║    ██║  ██╗██║   ██║
 ╚═╝  ╚═╝╚══════╝╚═════╝ ╚══════╝╚═╝  ╚═╝╚═╝  ╚═╝    ╚═════╝╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝   ╚═╝    ╚═════╝ ╚═╝  ╚═╝    ╚═╝  ╚═╝╚═╝   ╚═╝
    `
  }

  private static getToolsList(): TerminalLine[] {
    const lines: TerminalLine[] = []

    this.tools.forEach(tool => {
      const prefix = `  [${tool.number}]`.padEnd(6)
      const desc = tool.status === 'coming-soon' ? `${tool.description}  (coming soon)` : tool.description
      const line = `${prefix} ${tool.icon} ${tool.title.padEnd(25)} ${desc}`
      lines.push({ type: 'output', content: line })
    })

    return lines
  }

  private static renderInputArea(): string {
    const promptUser = this.walletData.connected && this.walletData.accountId
      ? this.walletData.accountId
      : 'hedera-creator-kit'

    return `
      <div class="terminal-input-area">
        <span class="input-prompt">${promptUser}@hedera:~$</span>
        <input
          type="text"
          class="terminal-input"
          id="terminal-input"
          placeholder="Type a command..."
          autocomplete="off"
          spellcheck="false"
        />
      </div>
    `
  }

  private static renderStatusBar(): string {
    if (!this.walletData.connected) {
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
            <span class="status-item">${this.walletData.network}</span>
          </div>
        </div>
      `
    }

    return `
      <div class="status-bar">
        <div class="status-left">
          <span class="status-item">
            <span class="status-indicator"></span>
            <span class="status-value">${this.walletData.accountId}</span>
          </span>
          <span class="status-item">
            <span class="status-highlight">${this.walletData.hbarBalance} ℏ</span>
          </span>
        </div>
        <div class="status-center">
          <span class="status-item">Built by SLIME</span>
        </div>
        <div class="status-right">
          <span class="status-item">HEDERA CREATOR KIT v1.0</span>
          <span class="status-item">${this.walletData.network}</span>
        </div>
      </div>
    `
  }

  static init(): void {
    // Subscribe to wallet state changes (only once)
    if (!this.walletSubscribed) {
      this.walletSubscribed = true
      WalletConnectService.subscribe((state) => {
        this.walletData.connected = state.connected
        this.walletData.accountId = state.accountId
        this.walletData.network = state.network
        this.walletData.hbarBalance = state.hbarBalance || '0'
        this.walletData.hasSlime = state.hasSlime
        this.refresh()
      })

      // Check for existing WalletConnect sessions on first init
      WalletConnectService.init().catch((err: unknown) => {
        console.error('WalletConnect init error:', err)
      })
    }

    // Wire up the token-gate connect button
    const connectBtn = document.getElementById('token-gate-connect-btn')
    if (connectBtn) {
      connectBtn.addEventListener('click', () => {
        this.connectWallet()
      })
    }

    // Wire up the token-gate disconnect button
    const disconnectBtn = document.getElementById('token-gate-disconnect-btn')
    if (disconnectBtn) {
      disconnectBtn.addEventListener('click', async () => {
        await WalletConnectService.disconnect()
        // Refresh page to clear all state
        window.location.reload()
      })
    }

    const input = document.getElementById('terminal-input') as HTMLInputElement
    if (!input) return

    // Handle command submission
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        const command = input.value.trim()
        if (command) {
          this.handleCommand(command)
          this.commandHistory.push(command)
          this.historyIndex = this.commandHistory.length
          input.value = ''
        }
      }

      // Command history navigation
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        if (this.historyIndex > 0) {
          this.historyIndex--
          input.value = this.commandHistory[this.historyIndex]
        }
      }

      if (e.key === 'ArrowDown') {
        e.preventDefault()
        if (this.historyIndex < this.commandHistory.length - 1) {
          this.historyIndex++
          input.value = this.commandHistory[this.historyIndex]
        } else {
          this.historyIndex = this.commandHistory.length
          input.value = ''
        }
      }
    })

    // Auto-focus input (only if no overlay blocking)
    if (this.isTokenGateVerified()) {
      input.focus()
    }

    // Keep input focused when clicking anywhere in terminal
    document.querySelector('.terminal-content')?.addEventListener('click', () => {
      if (this.isTokenGateVerified()) {
        input.focus()
      }
    })
  }

  private static handleCommand(command: string): void {
    const cmd = command.toLowerCase().trim()

    // Check for number input (1-13) — navigate to tool, no history
    if (/^([1-9]|1[0-3])$/.test(cmd)) {
      const toolNumber = parseInt(cmd)
      const tool = this.tools.find(t => t.number === toolNumber)
      if (tool) {
        this.openTool(tool)
        return
      }
    }

    // Command routing
    switch (cmd) {
      case 'clear':
        this.clearScreen()
        return
      case 'help':
        this.navigateToTool('help')
        return
      case 'tools':
      case 'list':
      case 'wallet':
        // These are informational — just refresh the homepage (no history text)
        this.refresh()
        return
      default:
        // Fuzzy search for tool names
        const matchedTool = this.findToolByName(cmd)
        if (matchedTool) {
          this.openTool(matchedTool)
        } else {
          // Unknown command — just refresh, no error text on homepage
          this.refresh()
        }
        return
    }
  }

  private static findToolByName(search: string): Tool | null {
    const searchLower = search.toLowerCase()
    return this.tools.find(tool =>
      tool.title.toLowerCase().includes(searchLower) ||
      tool.id.includes(searchLower)
    ) || null
  }

  // @ts-expect-error reserved for future use
  private static _showHelp(): void {
    this.history.push({ type: 'success', content: '═══ AVAILABLE COMMANDS ═══' })
    this.history.push({ type: 'output', content: '' })
    this.history.push({ type: 'output', content: '  help              Show this help message' })
    this.history.push({ type: 'output', content: '  wallet            Show wallet information' })
    this.history.push({ type: 'output', content: '  tools, list       List all available tools' })
    this.history.push({ type: 'output', content: '  clear             Clear the terminal' })
    this.history.push({ type: 'output', content: '  <number>          Open tool by number' })
    this.history.push({ type: 'output', content: '  <tool name>       Open tool by name (e.g., "mint")' })
    this.history.push({ type: 'output', content: '' })
  }

  private static async connectWallet(): Promise<void> {
    if (this.walletData.connected) {
      return
    }

    // Security: The WalletConnect modal sits above the token-gate overlay via CSS
    // z-index (99999 vs 10000), so we no longer need to manually hide the overlay.
    // Removing the hide logic closes the bypass window where tools were briefly exposed.
    try {
      await WalletConnectService.connect()
    } catch (error: any) {
      console.error('WalletConnect error:', error)
    }

    // If still not verified, re-render the gate overlay
    if (!this.isTokenGateVerified()) {
      this.refresh()
    }
  }

  // @ts-expect-error reserved for future use
  private static _showWallet(): void {
    if (!this.walletData.connected) {
      this.history.push({ type: 'warning', content: 'No wallet connected. Type "connect" to connect.' })
      return
    }

    this.history.push({ type: 'success', content: '═══ WALLET INFO ═══' })
    this.history.push({ type: 'output', content: `  Account ID: ${this.walletData.accountId}` })
    this.history.push({ type: 'output', content: `  Balance:    ${this.walletData.hbarBalance} ℏ` })
    this.history.push({ type: 'output', content: `  Network:    ${this.walletData.network}` })
  }

  // @ts-expect-error reserved for future use
  private static _listTools(): void {
    this.history.push({ type: 'success', content: '═══ AVAILABLE TOOLS ═══' })
    this.history.push({ type: 'output', content: '' })
    this.history.push(...this.getToolsList())
  }

  private static openTool(tool: Tool): void {
    if (tool.status === 'coming-soon') {
      // Show "Coming Soon" message
      this.history.push({ type: 'output', content: '' })
      this.history.push({ type: 'warning', content: `⚠ ${tool.title} - Coming Soon` })
      this.history.push({ type: 'output', content: 'This tool is currently under development.' })
      this.history.push({ type: 'output', content: '' })
      this.refresh()
      return
    }

    // Navigate to tool page
    this.navigateToTool(tool.id)
  }

  private static navigateToTool(toolId: string): void {
    // Trigger navigation event
    window.dispatchEvent(new CustomEvent('navigate-to-tool', { detail: { toolId } }))
  }

  private static clearScreen(): void {
    this.history = []
    this.refresh()
  }

  private static refresh(): void {
    const app = document.querySelector<HTMLDivElement>('#app')!
    app.innerHTML = this.render()
    this.init()

    // Scroll to bottom
    const content = document.getElementById('terminal-content')
    if (content) {
      content.scrollTop = content.scrollHeight
    }
  }
}

