/**
 * Terminal Component
 * Full terminal UI with command input, history, and interactive menu
 */

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
  accountId: string
  hbarBalance: string
  network: string
}

export class Terminal {
  private static history: TerminalLine[] = []
  private static commandHistory: string[] = []
  private static historyIndex: number = -1
  private static currentInput: string = ''

  private static walletData: WalletData = {
    connected: false,
    accountId: '0.0.1234567',
    hbarBalance: '1,247.83',
    network: 'TESTNET'
  }

  private static tools: Tool[] = [
    { id: 'art-generator', number: 1, title: 'Art Generator', description: 'Generate NFT artwork', icon: '◆', status: 'coming-soon', accessRequired: 'Shittles NFT' },
    { id: 'create-collection', number: 2, title: 'Create Collection', description: 'Create a new NFT collection', icon: '◆', status: 'active', accessRequired: 'SLIME NFT' },
    { id: 'mint-nfts', number: 3, title: 'Mint NFTs', description: 'Batch mint NFTs (up to 10)', icon: '◆', status: 'active', accessRequired: 'BRainz NFT' },
    { id: 'create-token', number: 4, title: 'Create Token', description: 'Create a new fungible token', icon: '◆', status: 'coming-soon', accessRequired: 'SLIME NFT' },
    { id: 'update-token-icon', number: 5, title: 'Update Token Icon', description: 'Update token metadata/icon', icon: '◆', status: 'coming-soon', accessRequired: 'SLIME NFT' },
    { id: 'add-liquidity', number: 6, title: 'Add Liquidity', description: 'Add liquidity to DEX', icon: '◆', status: 'coming-soon', accessRequired: 'SLIME NFT' },
    { id: 'token-viewer', number: 7, title: 'Token Viewer', description: 'View token information', icon: '◆', status: 'active', accessRequired: 'SLIME NFT' },
    { id: 'snapshot', number: 8, title: 'Snapshot Tool', description: 'Capture holder accounts', icon: '◆', status: 'active', accessRequired: 'BRainz NFT' },
    { id: 'airdrop', number: 9, title: 'Airdrop Tool', description: 'Distribute tokens to wallets', icon: '◆', status: 'active', accessRequired: 'SLIME NFT' },
    { id: 'swap', number: 10, title: 'Swap Tool', description: 'Migrate holders to new token', icon: '◆', status: 'coming-soon', accessRequired: 'SLIME NFT' },
    { id: 'burn', number: 11, title: 'Burn Tool', description: 'Permanently burn tokens/NFTs', icon: '◆', status: 'active', accessRequired: 'SLIME NFT' },
    { id: 'staking', number: 12, title: 'Staking Tool', description: 'Rewards for holders', icon: '◆', status: 'coming-soon', accessRequired: 'SLIME NFT' },
    { id: 'domain-registration', number: 13, title: 'Domain Registration', description: 'Register HNS domains (.hbar)', icon: '◆', status: 'coming-soon', accessRequired: 'SLIME NFT' }
  ]

  static render(): string {
    return `
      <div class="terminal-window">
        ${this.renderWindowChrome()}
        ${this.renderTerminalContent()}
        ${this.renderInputArea()}
        ${this.renderStatusBar()}
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
    const output = this.history.length === 0 ? this.getWelcomeScreen() : this.history

    return `
      <div class="terminal-content" id="terminal-content">
        ${output.map(line => this.renderLine(line)).join('')}
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

    // Only show wallet warning if not connected
    if (!this.walletData.connected) {
      lines.push({ type: 'warning', content: '⚠  Wallet not connected. Type "connect" to connect your wallet.' })
      lines.push({ type: 'output', content: '' })
    }

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
      const line = `  [${tool.number}] ${tool.icon} ${tool.title.padEnd(25)} ${tool.description}`
      lines.push({ type: 'output', content: line })
    })

    return lines
  }

  private static renderInputArea(): string {
    return `
      <div class="terminal-input-area">
        <span class="input-prompt">user@hedera:~$</span>
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

    // Auto-focus input
    input.focus()

    // Keep input focused when clicking anywhere in terminal
    document.querySelector('.terminal-content')?.addEventListener('click', () => {
      input.focus()
    })
  }

  private static handleCommand(command: string): void {
    // Add command to history
    this.history.push({ type: 'prompt', content: `user@hedera:~$ ${command}` })

    const cmd = command.toLowerCase().trim()

    // Check for number input (1-13)
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
      case 'help':
        this.showHelp()
        break
      case 'connect':
        this.connectWallet()
        break
      case 'clear':
        this.clearScreen()
        return
      case 'tools':
      case 'list':
        this.listTools()
        break
      case 'wallet':
        this.showWallet()
        break
      default:
        // Fuzzy search for tool names
        const matchedTool = this.findToolByName(cmd)
        if (matchedTool) {
          this.openTool(matchedTool)
        } else {
          this.history.push({ type: 'error', content: `Command not found: ${command}` })
          this.history.push({ type: 'output', content: 'Type "help" for available commands' })
        }
    }

    this.refresh()
  }

  private static findToolByName(search: string): Tool | null {
    const searchLower = search.toLowerCase()
    return this.tools.find(tool =>
      tool.title.toLowerCase().includes(searchLower) ||
      tool.id.includes(searchLower)
    ) || null
  }

  private static showHelp(): void {
    this.history.push({ type: 'success', content: '═══ AVAILABLE COMMANDS ═══' })
    this.history.push({ type: 'output', content: '' })
    this.history.push({ type: 'output', content: '  help              Show this help message' })
    this.history.push({ type: 'output', content: '  connect           Connect your wallet' })
    this.history.push({ type: 'output', content: '  wallet            Show wallet information' })
    this.history.push({ type: 'output', content: '  tools, list       List all available tools' })
    this.history.push({ type: 'output', content: '  clear             Clear the terminal' })
    this.history.push({ type: 'output', content: '  <number>          Open tool by number' })
    this.history.push({ type: 'output', content: '  <tool name>       Open tool by name (e.g., "mint")' })
    this.history.push({ type: 'output', content: '' })
  }

  private static connectWallet(): void {
    if (this.walletData.connected) {
      this.history.push({ type: 'warning', content: 'Wallet already connected!' })
      return
    }

    this.history.push({ type: 'output', content: 'Connecting wallet...' })
    this.walletData.connected = true
    this.history.push({ type: 'success', content: `✓ Connected: ${this.walletData.accountId}` })
    this.history.push({ type: 'success', content: `✓ Balance: ${this.walletData.hbarBalance} ℏ` })
  }

  private static showWallet(): void {
    if (!this.walletData.connected) {
      this.history.push({ type: 'warning', content: 'No wallet connected. Type "connect" to connect.' })
      return
    }

    this.history.push({ type: 'success', content: '═══ WALLET INFO ═══' })
    this.history.push({ type: 'output', content: `  Account ID: ${this.walletData.accountId}` })
    this.history.push({ type: 'output', content: `  Balance:    ${this.walletData.hbarBalance} ℏ` })
    this.history.push({ type: 'output', content: `  Network:    ${this.walletData.network}` })
  }

  private static listTools(): void {
    this.history.push({ type: 'success', content: '═══ AVAILABLE TOOLS ═══' })
    this.history.push({ type: 'output', content: '' })
    this.history.push(...this.getToolsList())
  }

  private static openTool(tool: Tool): void {
    if (tool.status === 'coming-soon') {
      this.history.push({ type: 'warning', content: `⚠ ${tool.title} is coming soon!` })
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

