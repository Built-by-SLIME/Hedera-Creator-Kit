/**
 * Airdrop Tool Component
 * Distribute NFTs or Fungible Tokens to multiple accounts
 */

interface AirdropRecipient {
  accountId: string
  amount?: string
  serialNumbers?: string[]
  status?: 'pending' | 'success' | 'failed'
  error?: string
}

interface AirdropConfig {
  airdropName: string
  tokenId: string
  tokenType: 'NFT' | 'FUNGIBLE' | null
  recipients: AirdropRecipient[]
}

export class AirdropTool {
  private static config: AirdropConfig = {
    airdropName: '',
    tokenId: '',
    tokenType: null,
    recipients: []
  }
  private static isProcessing: boolean = false
  private static error: string | null = null
  private static successCount: number = 0
  private static failedCount: number = 0

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
        <div class="window-title">hedera-creator-kit</div>
      </div>
    `
  }

  private static renderContent(): string {
    return `
      <div class="terminal-content">
        <div class="airdrop-layout">
          <div class="airdrop-left">
            ${this.renderConfigForm()}
          </div>
          <div class="airdrop-right">
            ${this.renderRecipientsList()}
          </div>
        </div>
      </div>
    `
  }

  private static renderConfigForm(): string {
    return `
      <div class="airdrop-config-section">
        <h3 class="section-title">Airdrop Configuration</h3>

        <div class="back-link" id="airdrop-back-link">
          <span class="back-arrow">←</span>
          <span>Back</span>
        </div>

        <div class="terminal-line terminal-warning">⚠  Wallet not connected. Return to home and type "connect" to connect your wallet.</div>

        <div class="input-group">
          <label for="airdrop-name">Airdrop Name <span style="color: #ff6b6b;">*</span></label>
          <input
            type="text"
            id="airdrop-name"
            class="token-input"
            placeholder="e.g., Community Rewards Q1 2024"
            autocomplete="off"
            value="${this.config.airdropName}"
          />
        </div>

        <div class="input-group">
          <label for="token-type-select">Token Type <span style="color: #ff6b6b;">*</span></label>
          <select id="token-type-select" class="token-select">
            <option value="">Select Token Type</option>
            <option value="NFT" ${this.config.tokenType === 'NFT' ? 'selected' : ''}>NFT</option>
            <option value="FUNGIBLE" ${this.config.tokenType === 'FUNGIBLE' ? 'selected' : ''}>Fungible Token</option>
          </select>
        </div>

        <div class="input-group">
          <label for="airdrop-token-id">Token ID <span style="color: #ff6b6b;">*</span></label>
          <input
            type="text"
            id="airdrop-token-id"
            class="token-input"
            placeholder="0.0.123456"
            autocomplete="off"
            value="${this.config.tokenId}"
          />
        </div>

        <div class="filter-divider"></div>
        <h4 class="filter-subtitle">Add Recipients</h4>
        
        <div class="upload-section">
          <label for="csv-upload" class="upload-label">
            <span class="upload-icon">📁</span>
            <span>Upload CSV File</span>
            <input 
              type="file" 
              id="csv-upload" 
              accept=".csv"
              style="display: none;"
            />
          </label>
          <p class="upload-hint">Supports Snapshot Tool CSV format</p>
        </div>

        <div class="filter-divider"></div>

        <div class="manual-entry-section">
          <label for="manual-recipients">Or Enter Manually (one per line)</label>
          <textarea
            id="manual-recipients"
            class="recipients-textarea"
            placeholder="0.0.123456&#10;0.0.789012&#10;0.0.345678"
            rows="5"
          ></textarea>
          <button id="add-manual-btn" class="terminal-button secondary">
            <span>ADD RECIPIENTS</span>
          </button>
        </div>

        <div class="button-group">
          <button id="start-airdrop-btn" class="terminal-button" ${this.config.recipients.length === 0 ? 'disabled' : ''}>
            <span>START AIRDROP</span>
          </button>
          <button id="clear-airdrop-btn" class="terminal-button secondary">
            <span>CLEAR ALL</span>
          </button>
        </div>
      </div>
    `
  }

  private static renderRecipientsList(): string {
    if (this.config.recipients.length === 0) {
      return `
        <div class="empty-state">
          <p>No recipients added yet</p>
          <p class="hint">Upload a CSV or enter accounts manually</p>
        </div>
      `
    }

    return `
      <div class="recipients-section">
        <div class="recipients-header">
          <div class="recipients-title-group">
            <h3 class="section-title">Recipients (${this.config.recipients.length})</h3>
            ${this.config.tokenType ? `<span class="token-type-badge ${this.config.tokenType.toLowerCase()}">${this.config.tokenType}</span>` : ''}
          </div>
          <div class="recipients-stats">
            ${this.successCount > 0 ? `<span class="stat-success">✓ ${this.successCount} sent</span>` : ''}
            ${this.failedCount > 0 ? `<span class="stat-failed">✗ ${this.failedCount} failed</span>` : ''}
          </div>
        </div>

        <div class="recipients-table-container">
          <table class="recipients-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Account ID</th>
                <th>${this.getAmountColumnHeader()}</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              ${this.config.recipients.map((recipient, index) => `
                <tr class="${recipient.status || 'pending'}">
                  <td>${index + 1}</td>
                  <td class="account-id">${recipient.accountId}</td>
                  <td>${this.formatAmount(recipient)}</td>
                  <td class="status-cell">
                    ${this.renderStatus(recipient.status)}
                  </td>
                  <td class="action-cell">
                    <button class="delete-btn" data-index="${index}" title="Remove recipient">✕</button>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `
  }

  private static getAmountColumnHeader(): string {
    if (this.config.tokenType === 'NFT') {
      return 'Quantity'
    } else if (this.config.tokenType === 'FUNGIBLE') {
      return 'Amount'
    }
    return 'Amount/Quantity'
  }

  private static formatAmount(recipient: AirdropRecipient): string {
    // If it has serial numbers, it's an NFT
    if (recipient.serialNumbers && recipient.serialNumbers.length > 0) {
      const count = recipient.serialNumbers.length
      return `${count} NFT${count !== 1 ? 's' : ''}`
    }

    // If it has an amount, it's a fungible token
    if (recipient.amount) {
      return recipient.amount
    }

    return 'N/A'
  }

  private static renderStatus(status?: string): string {
    switch (status) {
      case 'success':
        return '<span class="status-badge success">✓ Sent</span>'
      case 'failed':
        return '<span class="status-badge failed">✗ Failed</span>'
      case 'pending':
      default:
        return '<span class="status-badge pending">⏳ Pending</span>'
    }
  }

  static init(): void {
    this.attachEventListeners()
  }

  private static attachEventListeners(): void {
    const csvUpload = document.getElementById('csv-upload') as HTMLInputElement
    const addManualBtn = document.getElementById('add-manual-btn')
    const startAirdropBtn = document.getElementById('start-airdrop-btn')
    const clearBtn = document.getElementById('clear-airdrop-btn')
    const backLink = document.getElementById('airdrop-back-link')
    const tokenTypeSelect = document.getElementById('token-type-select') as HTMLSelectElement
    const airdropNameInput = document.getElementById('airdrop-name') as HTMLInputElement
    const tokenIdInput = document.getElementById('airdrop-token-id') as HTMLInputElement

    csvUpload?.addEventListener('change', (e) => this.handleCSVUpload(e))
    addManualBtn?.addEventListener('click', () => this.addManualRecipients())
    startAirdropBtn?.addEventListener('click', () => this.startAirdrop())
    clearBtn?.addEventListener('click', () => this.clearAll())
    backLink?.addEventListener('click', () => this.goBack())

    // Save config on input changes
    tokenTypeSelect?.addEventListener('change', (e) => {
      const value = (e.target as HTMLSelectElement).value
      this.config.tokenType = value ? (value as 'NFT' | 'FUNGIBLE') : null
    })

    airdropNameInput?.addEventListener('input', (e) => {
      this.config.airdropName = (e.target as HTMLInputElement).value
    })

    tokenIdInput?.addEventListener('input', (e) => {
      this.config.tokenId = (e.target as HTMLInputElement).value
    })

    // Delete recipient buttons
    document.querySelectorAll('.delete-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const index = parseInt((e.target as HTMLElement).getAttribute('data-index') || '-1')
        if (index >= 0) this.removeRecipient(index)
      })
    })
  }

  private static handleCSVUpload(event: Event): void {
    const input = event.target as HTMLInputElement
    const file = input.files?.[0]

    if (!file) return

    const reader = new FileReader()
    reader.onload = (e) => {
      const text = e.target?.result as string
      this.parseCSV(text)
    }
    reader.readAsText(file)
  }

  private static parseCSV(csvText: string): void {
    const lines = csvText.split('\n').filter(line => line.trim())
    const recipients: AirdropRecipient[] = []

    // Detect token type from header
    const header = lines[0]?.toLowerCase() || ''
    const isNFT = header.includes('serial')

    // Skip header row
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim()
      if (!line) continue

      // Parse CSV line properly handling quoted fields
      const recipient: AirdropRecipient = {
        accountId: '',
        status: 'pending'
      }

      if (isNFT) {
        // NFT format: Account ID, Balance, "Serial Numbers"
        // Match: accountId, balance, "serials,serials,serials"
        const match = line.match(/^([^,]+),([^,]+),"([^"]*)"/)
        if (match) {
          const accountId = match[1].trim()
          const balance = match[2].trim()
          const serialsStr = match[3].trim()

          if (!accountId.match(/^\d+\.\d+\.\d+$/)) continue

          recipient.accountId = accountId

          if (serialsStr) {
            recipient.serialNumbers = serialsStr.split(',').map(s => s.trim()).filter(s => s)
          } else {
            // If no serials, use balance as count
            recipient.serialNumbers = []
          }
        } else {
          continue
        }
      } else {
        // Fungible token format: Account ID, Balance
        const parts = line.split(',')
        const accountId = parts[0]?.trim()

        if (!accountId || !accountId.match(/^\d+\.\d+\.\d+$/)) continue

        recipient.accountId = accountId

        if (parts[1]) {
          recipient.amount = parts[1].trim()
        }
      }

      recipients.push(recipient)
    }

    // Set token type if not already set
    if (recipients.length > 0 && !this.config.tokenType) {
      this.config.tokenType = isNFT ? 'NFT' : 'FUNGIBLE'
    }

    this.config.recipients = [...this.config.recipients, ...recipients]
    this.refresh()
  }

  private static addManualRecipients(): void {
    const textarea = document.getElementById('manual-recipients') as HTMLTextAreaElement
    const text = textarea.value.trim()

    if (!text) return

    const lines = text.split('\n').filter(line => line.trim())
    const recipients: AirdropRecipient[] = []

    for (const line of lines) {
      const accountId = line.trim()
      if (accountId.match(/^\d+\.\d+\.\d+$/)) {
        recipients.push({
          accountId,
          status: 'pending'
        })
      }
    }

    this.config.recipients = [...this.config.recipients, ...recipients]
    textarea.value = ''
    this.refresh()
  }

  private static removeRecipient(index: number): void {
    if (index < 0 || index >= this.config.recipients.length) return

    this.config.recipients.splice(index, 1)

    // Reset token type if no recipients left
    if (this.config.recipients.length === 0) {
      this.config.tokenType = null
    }

    this.refresh()
  }

  private static async startAirdrop(): Promise<void> {
    // Validate inputs
    const airdropName = this.config.airdropName.trim()
    const tokenType = this.config.tokenType
    const tokenId = this.config.tokenId.trim()

    if (!airdropName) {
      this.error = 'Please enter an Airdrop Name'
      alert(this.error)
      return
    }

    if (!tokenType) {
      this.error = 'Please select a Token Type'
      alert(this.error)
      return
    }

    if (!tokenId) {
      this.error = 'Please enter a Token ID'
      alert(this.error)
      return
    }

    if (this.config.recipients.length === 0) {
      this.error = 'Please add recipients'
      alert(this.error)
      return
    }

    // TODO: Check if wallet is connected
    // if (!walletConnected) {
    //   alert('Please connect your wallet first')
    //   return
    // }

    // TODO: Implement actual airdrop logic with Wallet Connect
    // This will use the connected wallet to sign and send transactions
    alert(`Airdrop "${airdropName}" ready to send!\n\nToken Type: ${tokenType}\nToken ID: ${tokenId}\nRecipients: ${this.config.recipients.length}\n\nWallet Connect integration coming soon.`)
  }

  private static clearAll(): void {
    this.config = {
      airdropName: '',
      tokenId: '',
      tokenType: null,
      recipients: []
    }
    this.successCount = 0
    this.failedCount = 0
    this.error = null

    this.refresh()
  }

  private static goBack(): void {
    window.location.reload()
  }

  private static refresh(): void {
    const app = document.querySelector<HTMLDivElement>('#app')!
    app.innerHTML = this.render()
    this.init()
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

