/**
 * Airdrop Tool Component
 * Distribute NFTs or Fungible Tokens to multiple accounts
 */
import WalletConnectService from '../services/WalletConnectService'
import { MIRROR_NODE_URL } from '../config'
import {
  AccountId,
  Client,
  TransactionId,
  TokenId,
  NftId,
  TransferTransaction,
} from '@hashgraph/sdk'

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
  private static statusMessage: string = ''
  private static error: string | null = null
  private static successCount: number = 0
  private static failedCount: number = 0
  private static amountPerRecipient: string = ''
  private static serialsPerRecipient: number = 1
  private static availableSerials: number[] = []
  private static isFetchingSerials: boolean = false
  private static airdropComplete: boolean = false
  private static completedTxIds: string[] = []

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


        <div class="terminal-line" style="color: #f4a261; font-size: 0.8rem; margin-bottom: 0.25rem;">ⓘ Tokens with royalty fallback fees can only be airdropped from the treasury account.</div>
        <div class="terminal-line" style="color: #f4a261; font-size: 0.8rem; margin-bottom: 0.5rem;">ⓘ Unassociated recipients will receive tokens in their wallet envelope (pending claim).</div>
        ${this.statusMessage ? `<div class="terminal-line" style="color: #4ecdc4; font-size: 0.85rem; margin-bottom: 0.5rem;">${this.statusMessage}</div>` : ''}

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

        ${this.config.tokenType === 'FUNGIBLE' ? `
        <div class="input-group">
          <label for="amount-per-recipient">Amount Per Recipient <span style="color: #ff6b6b;">*</span></label>
          <input
            type="text"
            id="amount-per-recipient"
            class="token-input"
            placeholder="e.g., 100"
            autocomplete="off"
            value="${this.amountPerRecipient}"
          />
        </div>
        ` : ''}

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

      </div>
    `
  }

  private static renderRecipientsList(): string {
    if (this.airdropComplete) {
      return this.renderAirdropSuccess()
    }

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

        ${this.config.tokenType === 'NFT' ? `
        <div class="filter-divider"></div>
        <div style="display: flex; align-items: center; gap: 0.75rem; margin-bottom: 0.5rem;">
          <div class="input-group" style="margin-bottom: 0; flex: 0 0 auto;">
            <label for="serials-per-recipient">NFTs Per Recipient</label>
            <input
              type="number"
              id="serials-per-recipient"
              class="token-input"
              min="1"
              value="${this.serialsPerRecipient}"
              style="max-width: 100px;"
            />
          </div>
          <button id="randomize-serials-btn" class="terminal-button secondary" style="margin-top: 1.1rem;" ${this.isFetchingSerials ? 'disabled' : ''}>
            <span>${this.isFetchingSerials ? 'FETCHING SERIALS...' : '🎲 RANDOMIZE SERIALS'}</span>
          </button>
        </div>
        ${this.availableSerials.length > 0 ? `<div class="terminal-line" style="color: #4ecdc4; font-size: 0.8rem; margin-bottom: 0.5rem;">✓ ${this.availableSerials.length} serials available from your wallet</div>` : ''}
        ` : ''}

        <div class="filter-divider"></div>
        <div class="button-group">
          <button id="start-airdrop-btn" class="terminal-button" ${this.isProcessing ? 'disabled' : ''}>
            <span>${this.isProcessing ? 'PROCESSING...' : 'START AIRDROP'}</span>
          </button>
          <button id="clear-airdrop-btn" class="terminal-button secondary">
            <span>CLEAR ALL</span>
          </button>
        </div>
      </div>
    `
  }

  private static renderAirdropSuccess(): string {
    const network = WalletConnectService.getState().network?.toLowerCase() || 'mainnet'
    const tokenId = this.config.tokenId
    const airdropName = this.config.airdropName || 'Airdrop'
    const totalRecipients = this.config.recipients.length

    return `
      <div class="cc-right-content">
        <h4 class="section-title" style="font-size:0.95rem">🎉 Airdrop Complete!</h4>
        <div class="result-block">
          <label>Summary</label>
          <p style="font-size:0.85rem;color:var(--terminal-text);margin:0.25rem 0"><strong>${airdropName}</strong></p>
          <p style="font-size:0.82rem;color:#4ecdc4;margin:0.25rem 0">✓ ${this.successCount} of ${totalRecipients} recipients sent</p>
          ${this.failedCount > 0 ? `<p style="font-size:0.82rem;color:#ff6b6b;margin:0.25rem 0">✗ ${this.failedCount} failed</p>` : ''}
        </div>
        <div class="result-block" style="margin-top:0.75rem">
          <label>Token</label>
          <code class="cid-value" style="font-size:0.95rem">${tokenId}</code>
          <a class="cid-link" href="https://hashscan.io/${network}/token/${tokenId}" target="_blank" rel="noopener" style="display:block;margin-top:0.25rem;font-size:0.8rem">View Token on HashScan ↗</a>
        </div>
        ${this.completedTxIds.length > 0 ? `
        <div class="result-block" style="margin-top:0.75rem">
          <label>Transaction${this.completedTxIds.length > 1 ? 's' : ''}</label>
          ${this.completedTxIds.map((txId, i) => `
            <div style="margin-top:${i > 0 ? '0.5rem' : '0.25rem'}">
              <code class="cid-value" style="font-size:0.78rem;word-break:break-all">${txId}</code>
              <a class="cid-link" href="https://hashscan.io/${network}/transaction/${txId}" target="_blank" rel="noopener" style="display:block;margin-top:0.15rem;font-size:0.8rem">View on HashScan ↗</a>
            </div>
          `).join('')}
        </div>
        ` : ''}
        <div class="result-block" style="margin-top:0.75rem">
          <label>Type</label>
          <p style="font-size:0.82rem;color:var(--terminal-text);margin:0">${this.config.tokenType === 'NFT' ? 'NFT Airdrop' : 'Fungible Token Airdrop'}</p>
        </div>
        <div class="button-group" style="margin-top:1.25rem">
          <button id="new-airdrop-btn" class="terminal-button">
            <span>NEW AIRDROP</span>
          </button>
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
    // If it has serial numbers, show them
    if (recipient.serialNumbers && recipient.serialNumbers.length > 0) {
      if (recipient.serialNumbers.length <= 3) {
        return `#${recipient.serialNumbers.join(', #')}`
      }
      return `#${recipient.serialNumbers.slice(0, 3).join(', #')}... (${recipient.serialNumbers.length} total)`
    }

    // If it has an amount, it's a fungible token
    if (recipient.amount) {
      return recipient.amount
    }

    return this.config.tokenType === 'NFT' ? 'No serials assigned' : 'N/A'
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
    document.getElementById('new-airdrop-btn')?.addEventListener('click', () => this.clearAll())
    backLink?.addEventListener('click', () => this.goBack())

    // Save config on input changes
    tokenTypeSelect?.addEventListener('change', (e) => {
      const value = (e.target as HTMLSelectElement).value
      this.config.tokenType = value ? (value as 'NFT' | 'FUNGIBLE') : null
      this.refresh()
    })

    airdropNameInput?.addEventListener('input', (e) => {
      this.config.airdropName = (e.target as HTMLInputElement).value
    })

    tokenIdInput?.addEventListener('input', (e) => {
      this.config.tokenId = (e.target as HTMLInputElement).value
    })

    // Amount per recipient (fungible)
    const amountInput = document.getElementById('amount-per-recipient') as HTMLInputElement
    amountInput?.addEventListener('input', (e) => {
      this.amountPerRecipient = (e.target as HTMLInputElement).value
    })

    // Serials per recipient (NFT)
    const serialsInput = document.getElementById('serials-per-recipient') as HTMLInputElement
    serialsInput?.addEventListener('input', (e) => {
      const val = parseInt((e.target as HTMLInputElement).value)
      if (val >= 1) this.serialsPerRecipient = val
    })

    // Randomize serials button
    document.getElementById('randomize-serials-btn')?.addEventListener('click', () => this.randomizeSerials())

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
          match[2].trim() // balance - not used yet
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

    // Validate amount/serials are set for the token type
    if (this.config.tokenType === 'FUNGIBLE' && !this.amountPerRecipient.trim()) {
      alert('Please enter an amount per recipient first')
      return
    }

    const lines = text.split('\n').filter(line => line.trim())
    const recipients: AirdropRecipient[] = []

    for (const line of lines) {
      const accountId = line.trim()
      if (accountId.match(/^\d+\.\d+\.\d+$/)) {
        const recipient: AirdropRecipient = {
          accountId,
          status: 'pending'
        }
        // Assign amount for fungible tokens
        if (this.config.tokenType === 'FUNGIBLE') {
          recipient.amount = this.amountPerRecipient.trim()
        }
        recipients.push(recipient)
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

    if (!airdropName) { alert('Please enter an Airdrop Name'); return }
    if (!tokenType) { alert('Please select a Token Type'); return }
    if (!tokenId) { alert('Please enter a Token ID'); return }
    if (this.config.recipients.length === 0) { alert('Please add recipients first using the ADD RECIPIENTS button'); return }

    const ws = WalletConnectService.getState()
    if (!ws.connected || !ws.accountId) {
      alert('Please connect your wallet first. Return to home and type "connect".')
      return
    }

    const accountId = ws.accountId
    this.isProcessing = true
    this.statusMessage = 'Checking token info...'
    this.successCount = 0
    this.failedCount = 0
    this.error = null
    this.config.recipients.forEach(r => { r.status = 'pending'; r.error = undefined })
    this.refresh()

    try {
      // Fetch token info and check for fallback fees
      const tokenInfo = await this.fetchTokenInfo(tokenId)
      const hasFallbackFees = this.checkFallbackFees(tokenInfo)

      if (hasFallbackFees && tokenInfo.treasury_account_id !== accountId) {
        alert(`This token has royalty fallback fees.\nAirdrops can only be sent from the treasury account (${tokenInfo.treasury_account_id}).\nYour connected wallet is ${accountId}.`)
        this.isProcessing = false
        this.statusMessage = ''
        this.refresh()
        return
      }

      const decimals = parseInt(tokenInfo.decimals || '0')
      const BATCH_SIZE = 10
      const pendingRecipients = this.config.recipients.filter(r => r.status === 'pending')
      const batches: AirdropRecipient[][] = []

      for (let i = 0; i < pendingRecipients.length; i += BATCH_SIZE) {
        batches.push(pendingRecipients.slice(i, i + BATCH_SIZE))
      }

      const signer = WalletConnectService.getSigner(accountId)
      const acctId = AccountId.fromString(accountId)
      const tid = TokenId.fromString(tokenId)

      for (let batchIdx = 0; batchIdx < batches.length; batchIdx++) {
        const batch = batches[batchIdx]
        this.statusMessage = `Processing batch ${batchIdx + 1}/${batches.length} (${batch.length} recipients)... Waiting for wallet approval.`
        this.refresh()

        try {
          const tx = new TransferTransaction()

          for (const recipient of batch) {
            const recipAcct = AccountId.fromString(recipient.accountId)

            if (tokenType === 'NFT') {
              if (recipient.serialNumbers && recipient.serialNumbers.length > 0) {
                for (const serial of recipient.serialNumbers) {
                  tx.addNftTransfer(new NftId(tid, parseInt(serial)), acctId, recipAcct)
                }
              }
            } else {
              const amount = parseFloat(recipient.amount || '0')
              if (amount > 0) {
                const rawAmount = Math.round(amount * Math.pow(10, decimals))
                tx.addTokenTransfer(tid, acctId, -rawAmount)
                tx.addTokenTransfer(tid, recipAcct, rawAmount)
              }
            }
          }

          tx.setTransactionId(TransactionId.generate(acctId))
          tx.freezeWith(Client.forMainnet())
          const txResponse = await tx.executeWithSigner(signer)

          batch.forEach(r => { r.status = 'success'; this.successCount++ })

          if (txResponse?.transactionId) {
            this.completedTxIds.push(txResponse.transactionId.toString())
          }
        } catch (err: any) {
          console.error('Airdrop batch error:', err)
          batch.forEach(r => {
            r.status = 'failed'
            r.error = err.message || 'Transaction failed'
            this.failedCount++
          })
        }

        this.refresh()
      }

      this.statusMessage = `Airdrop "${airdropName}" complete! ${this.successCount} sent, ${this.failedCount} failed.`
      this.isProcessing = false
      this.airdropComplete = true
      this.refresh()
    } catch (err: any) {
      console.error('Airdrop error:', err)
      this.error = err.message || 'Airdrop failed'
      this.isProcessing = false
      this.statusMessage = ''
      alert(`Airdrop failed: ${this.error}`)
      this.refresh()
    }
  }

  private static async fetchTokenInfo(tokenId: string): Promise<any> {
    const res = await fetch(`${MIRROR_NODE_URL}/api/v1/tokens/${tokenId}`)
    if (!res.ok) throw new Error(`Token ${tokenId} not found on Hedera`)
    return res.json()
  }

  private static checkFallbackFees(tokenInfo: any): boolean {
    const royaltyFees = tokenInfo.custom_fees?.royalty_fees || []
    return royaltyFees.some((fee: any) => fee.fallback_fee != null)
  }

  private static async fetchAvailableSerials(tokenId: string, accountId: string): Promise<number[]> {
    const serials: number[] = []
    let nextLink: string | null = `/api/v1/tokens/${tokenId}/nfts?account.id=${accountId}&limit=100`

    while (nextLink) {
      const res: Response = await fetch(`${MIRROR_NODE_URL}${nextLink}`)
      if (!res.ok) throw new Error(`Failed to fetch NFTs for token ${tokenId}`)
      const data: any = await res.json()
      for (const nft of (data.nfts || [])) {
        serials.push(nft.serial_number)
      }
      nextLink = data.links?.next || null
    }

    return serials
  }

  private static async randomizeSerials(): Promise<void> {
    const ws = WalletConnectService.getState()
    if (!ws.connected || !ws.accountId) {
      alert('Please connect wallet first')
      return
    }
    if (!this.config.tokenId.trim()) {
      alert('Please enter a Token ID first')
      return
    }
    if (this.config.recipients.length === 0) {
      alert('Please add recipients first')
      return
    }

    this.isFetchingSerials = true
    this.statusMessage = 'Fetching available serials from your wallet...'
    this.refresh()

    try {
      const serials = await this.fetchAvailableSerials(this.config.tokenId, ws.accountId)
      this.availableSerials = serials

      if (serials.length === 0) {
        alert('No NFTs found for this token in your wallet.')
        this.isFetchingSerials = false
        this.statusMessage = ''
        this.refresh()
        return
      }

      // Shuffle serials (Fisher-Yates)
      const shuffled = [...serials]
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
      }

      // Check we have enough
      const needed = this.config.recipients.length * this.serialsPerRecipient
      if (shuffled.length < needed) {
        alert(`Not enough serials. Need ${needed} (${this.config.recipients.length} recipients × ${this.serialsPerRecipient} each), but only ${shuffled.length} available.`)
        this.isFetchingSerials = false
        this.statusMessage = ''
        this.refresh()
        return
      }

      // Distribute across recipients
      let serialIndex = 0
      for (const recipient of this.config.recipients) {
        recipient.serialNumbers = []
        for (let i = 0; i < this.serialsPerRecipient; i++) {
          recipient.serialNumbers.push(shuffled[serialIndex++].toString())
        }
      }

      this.statusMessage = `✓ Randomly assigned ${needed} serials across ${this.config.recipients.length} recipients`
      this.isFetchingSerials = false
      this.refresh()
    } catch (err: any) {
      alert(`Failed to fetch serials: ${err.message}`)
      this.isFetchingSerials = false
      this.statusMessage = ''
      this.refresh()
    }
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
    this.amountPerRecipient = ''
    this.serialsPerRecipient = 1
    this.availableSerials = []
    this.isFetchingSerials = false
    this.statusMessage = ''
    this.airdropComplete = false
    this.completedTxIds = []

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
    const ws = WalletConnectService.getState()
    const walletInfo = ws.connected ? `⬡ ${ws.accountId} | ${ws.hbarBalance || '0'} ℏ` : 'Not Connected'
    return `
      <div class="status-bar">
        <div class="status-left">
          <span class="status-item">${walletInfo}</span>
        </div>
        <div class="status-center">
          <span class="status-item">${this.statusMessage || 'Built by SLIME'}</span>
        </div>
        <div class="status-right">
          <span class="status-item">HEDERA CREATOR KIT v1.0</span>
          <span class="status-item">MAINNET</span>
        </div>
      </div>
    `
  }
}

