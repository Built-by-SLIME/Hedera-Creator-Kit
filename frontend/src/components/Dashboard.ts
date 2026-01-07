/**
 * Main Dashboard Component
 * Displays all available tools in a cyberpunk-themed grid
 */

interface Tool {
  id: string
  title: string
  description: string
  icon: string
  status: 'active' | 'coming-soon'
  accessRequired?: string
}

interface NFTHolding {
  name: string
  tokenId: string
  count: number
}

interface WalletData {
  connected: boolean
  accountId: string
  hbarBalance: string
  network: string
  nftHoldings: NFTHolding[]
}

export class Dashboard {
  private static walletData: WalletData = {
    connected: false,
    accountId: '0.0.1234567',
    hbarBalance: '1,247.83',
    network: 'TESTNET',
    nftHoldings: [
      { name: 'SLIME NFT', tokenId: '0.0.9474754', count: 3 },
      { name: 'BRainz NFT', tokenId: '0.0.XXXXXX', count: 1 },
      { name: 'Cringle NFT', tokenId: '0.0.XXXXXX', count: 5 },
      { name: 'Shittles NFT', tokenId: '0.0.XXXXXX', count: 0 }
    ]
  }

  private static tools: Tool[] = [
    {
      id: 'create-collection',
      title: 'Create Collection',
      description: 'Create a new NFT collection with custom royalties and settings',
      icon: '◈',
      status: 'active',
      accessRequired: 'SLIME NFT'
    },
    {
      id: 'mint-nfts',
      title: 'Mint NFTs',
      description: 'Batch mint NFTs to your collection (up to 10 per transaction)',
      icon: '◆',
      status: 'active',
      accessRequired: 'BRainz NFT'
    },
    {
      id: 'burn-nfts',
      title: 'Burn NFTs',
      description: 'Permanently burn NFTs from your collection',
      icon: '◇',
      status: 'active',
      accessRequired: 'SLIME NFT'
    },
    {
      id: 'token-viewer',
      title: 'Token Viewer',
      description: 'View token information',
      icon: '◉',
      status: 'coming-soon',
      accessRequired: 'SLIME NFT'
    },
    {
      id: 'art-generator',
      title: 'Art Generator',
      description: 'Generate NFT artwork from trait layers',
      icon: '◎',
      status: 'coming-soon',
      accessRequired: 'Shittles NFT'
    },
    {
      id: 'airdrop',
      title: 'Airdrop Tool',
      description: 'Distribute HTS tokens & NFTs to multiple wallets',
      icon: '◐',
      status: 'coming-soon',
      accessRequired: 'SLIME NFT'
    },
    {
      id: 'snapshot',
      title: 'Snapshot Tool',
      description: 'Capture holder accounts for any token',
      icon: '◑',
      status: 'coming-soon',
      accessRequired: 'BRainz NFT'
    },
    {
      id: 'swap',
      title: 'Token Swap',
      description: 'Migrate holders from one token to another',
      icon: '◒',
      status: 'coming-soon',
      accessRequired: 'SLIME NFT'
    },
    {
      id: 'wipe-delete',
      title: 'Wipe/Delete NFTs',
      description: 'Admin functions for collection management',
      icon: '◓',
      status: 'coming-soon',
      accessRequired: 'SLIME NFT'
    }
  ]

  private static collapsedSections: Set<string> = new Set()

  static render(): string {
    return `
      <header class="header">
        <div class="logo">
          <img src="/hedera-hbar-logo.svg" alt="H" style="width: 35px; height: 35px; margin-right: 0.75rem;" />
          <span>CREATOR KIT</span>
        </div>
        <div style="display: flex; align-items: center; gap: 1.5rem;">
          ${this.walletData.connected ? this.renderConnectedWallet() : this.renderConnectButton()}
          <div class="network-status">
            <span class="status-indicator"></span>
            <span>${this.walletData.network}</span>
          </div>
        </div>
      </header>

      <main class="container">
        <h1 class="page-title">CREATOR TOOLS</h1>
        <p class="page-subtitle">Select a tool to begin</p>

        <div class="main-layout">
          ${this.walletData.connected ? this.renderSidebar() : ''}
          <div class="tools-grid" style="${!this.walletData.connected ? 'grid-column: 1 / -1;' : ''}">
            ${this.tools.map(tool => this.renderToolCard(tool)).join('')}
          </div>
        </div>
      </main>
    `
  }

  private static renderConnectButton(): string {
    return `
      <button class="wallet-connect-btn" id="connect-wallet-btn">
        Connect Wallet
      </button>
    `
  }

  private static renderConnectedWallet(): string {
    return `
      <div style="color: var(--text-secondary); font-size: 0.875rem;">
        ${this.walletData.accountId}
      </div>
    `
  }

  private static renderSidebar(): string {
    return `
      <aside class="sidebar">
        ${this.renderWalletInfo()}
        ${this.renderNFTHoldings()}
      </aside>
    `
  }

  private static renderWalletInfo(): string {
    const isCollapsed = this.collapsedSections.has('wallet-info')
    return `
      <div class="info-section">
        <div class="section-header" data-section="wallet-info">
          <div class="section-title">
            <span class="section-toggle ${isCollapsed ? 'collapsed' : ''}">▼</span>
            <span>WALLET INFO</span>
          </div>
        </div>
        <div class="section-content ${isCollapsed ? 'collapsed' : ''}">
          <div class="info-row">
            <span class="info-label">Account ID</span>
            <span class="info-value highlight">${this.walletData.accountId}</span>
          </div>
          <div class="info-row">
            <span class="info-label">HBAR Balance</span>
            <span class="info-value">${this.walletData.hbarBalance} ℏ</span>
          </div>
          <div class="info-row">
            <span class="info-label">Network</span>
            <span class="info-value">${this.walletData.network}</span>
          </div>
        </div>
      </div>
    `
  }

  private static renderNFTHoldings(): string {
    const isCollapsed = this.collapsedSections.has('nft-holdings')
    return `
      <div class="info-section">
        <div class="section-header" data-section="nft-holdings">
          <div class="section-title">
            <span class="section-toggle ${isCollapsed ? 'collapsed' : ''}">▼</span>
            <span>NFT HOLDINGS</span>
          </div>
        </div>
        <div class="section-content ${isCollapsed ? 'collapsed' : ''}">
          ${this.walletData.nftHoldings.map(nft => `
            <div class="nft-item">
              <div>
                <div class="nft-name">${nft.name}</div>
                <div style="font-size: 0.75rem; color: var(--text-dim); margin-top: 0.25rem;">
                  ${nft.tokenId}
                </div>
              </div>
              <span class="nft-count ${nft.count === 0 ? 'zero' : ''}">
                ${nft.count} owned
              </span>
            </div>
          `).join('')}
        </div>
      </div>
    `
  }

  private static renderToolCard(tool: Tool): string {
    const hasAccess = this.checkAccess(tool.accessRequired)
    return `
      <div class="tool-card" data-tool-id="${tool.id}">
        <div class="tool-card-header">
          <span class="tool-icon">${tool.icon}</span>
          <h3 class="tool-title">${tool.title}</h3>
        </div>
        <p class="tool-description">${tool.description}</p>
        <div style="display: flex; flex-direction: column; gap: 0.5rem;">
          <span class="tool-status ${tool.status}">
            ${tool.status === 'active' ? '● ACTIVE' : '○ COMING SOON'}
          </span>
          ${this.walletData.connected && tool.accessRequired ? `
            <span class="access-badge ${hasAccess ? 'granted' : 'required'}">
              ${hasAccess ? '✓ ACCESS GRANTED' : '⚠ REQUIRES ' + tool.accessRequired}
            </span>
          ` : ''}
        </div>
      </div>
    `
  }

  private static checkAccess(requiredNFT?: string): boolean {
    if (!requiredNFT) return true
    const holding = this.walletData.nftHoldings.find(nft => nft.name === requiredNFT)
    return holding ? holding.count > 0 : false
  }

  static init(): void {
    // Add click handler to connect wallet button
    const connectBtn = document.getElementById('connect-wallet-btn')
    if (connectBtn) {
      connectBtn.addEventListener('click', () => this.connectWallet())
    }

    // Add click handlers to section headers for collapsing
    const sectionHeaders = document.querySelectorAll('.section-header')
    sectionHeaders.forEach(header => {
      header.addEventListener('click', (e) => {
        const sectionId = (e.currentTarget as HTMLElement).dataset.section
        if (sectionId) {
          this.toggleSection(sectionId)
        }
      })
    })

    // Add click handlers to tool cards
    const toolCards = document.querySelectorAll('.tool-card')
    toolCards.forEach(card => {
      card.addEventListener('click', (e) => {
        const toolId = (e.currentTarget as HTMLElement).dataset.toolId
        const tool = this.tools.find(t => t.id === toolId)

        if (tool?.status === 'active') {
          this.openTool(toolId!)
        } else {
          console.log(`Tool ${toolId} is coming soon`)
        }
      })
    })
  }

  private static connectWallet(): void {
    // Mock wallet connection - will be replaced with real WalletConnect later
    this.walletData.connected = true
    this.refresh()
  }

  private static toggleSection(sectionId: string): void {
    if (this.collapsedSections.has(sectionId)) {
      this.collapsedSections.delete(sectionId)
    } else {
      this.collapsedSections.add(sectionId)
    }
    this.refresh()
  }

  private static refresh(): void {
    const app = document.querySelector<HTMLDivElement>('#app')!
    app.innerHTML = this.render()
    this.init()
  }

  private static openTool(toolId: string): void {
    console.log(`Opening tool: ${toolId}`)
    // TODO: Navigate to tool interface
  }
}

