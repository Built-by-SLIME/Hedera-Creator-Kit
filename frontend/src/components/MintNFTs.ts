/**
 * Mint NFTs Component
 * Batch mint NFTs to an existing Hedera collection via TokenMintTransaction + WalletConnect signing
 * Supports CSV import (from Art Generator) and direct upload with IPFS pinning
 */
import WalletConnectService from '../services/WalletConnectService'
import { API_BASE_URL, MIRROR_NODE_URL, BACKEND_MINTER_ACCOUNT, getHederaClient } from '../config'
import JSZip from 'jszip'
import {
  AccountId,
  TransactionId,
  Hbar,
  TransferTransaction,
  PrivateKey,
} from '@hashgraph/sdk'

interface NftEntry {
  number: number;
  metadataCID: string;
  tokenURI: string;
  imageCID?: string;
  previewUrl?: string;
  status: 'pending' | 'minting' | 'minted' | 'error';
  serial?: number;
  error?: string;
}

interface TokenInfo {
  tokenId: string;
  name: string;
  symbol: string;
  totalSupply: number;
  maxSupply: number;
  supplyKey: string | null;
  type: string;
}

type MintMode = 'csv' | 'direct';
type MintStep = 'setup' | 'minting' | 'complete';



export class MintNFTs {
  // State
  private static step: MintStep = 'setup';
  private static mode: MintMode = 'csv';
  private static loading = false;
  private static error: string | null = null;
  private static statusMessage = '';

  // Token ID
  private static tokenIdInput = '';
  private static tokenInfo: TokenInfo | null = null;
  private static tokenValidated = false;
  private static tokenError: string | null = null;

  // Supply Key
  private static supplyKeyInput = '';
  private static supplyKeyRevealed = false;
  private static supplyKeyError: string | null = null;

  // CSV Import
  private static csvEntries: NftEntry[] = [];
  private static csvFileName = '';

  // Upload Images
  private static directEntries: NftEntry[] = [];
  private static uploadedImages: Array<{
    file: File; preview: string; name: string;
    targetNumber: number;
    status: 'pending' | 'pinning' | 'pinned' | 'error';
    description: string; creator: string;
    attributes: Array<{ trait_type: string; value: string }>;
  }> = [];
  private static directStartNumber = 0; // 0 = auto from totalSupply + 1
  private static sharedDescription = '';
  private static sharedCreator = '';
  private static sharedAttributes: Array<{ trait_type: string; value: string }> = [];
  private static isPinning = false;
  private static pinProgress = 0;
  private static mintCopies = 1;
  private static directCsvFile: File | null = null;
  private static directCsvFileName = '';
  private static directCsvMatched = false;
  private static directCsvError: string | null = null;

  // CSV offset for phased minting (e.g., 1500 to display #1501 from CSV row 1)
  private static csvOffset = 0;

  // Minting progress
  private static batchSize = 10;
  private static currentBatch = 0;
  private static totalBatches = 0;
  private static mintedSerials: Array<{ number: number; serial: number }> = [];
  private static mintErrors: Array<{ number: number; error: string }> = [];
  private static isMinting = false;

  // Async mint job state
  private static mintJobId: string | null = null;
  private static mintPollInterval: number | null = null;
  private static mintPollFailures = 0;
  private static readonly MAX_MINT_POLL_FAILURES = 5;



  // ─── RENDER ───────────────────────────────────────────────
  public static render(): string {
    const ws = WalletConnectService.getState();
    const connected = ws.connected && ws.accountId;

    return `
      <div class="terminal-window">
        <div class="window-chrome">
          <div class="window-dots"><span class="dot red"></span><span class="dot yellow"></span><span class="dot green"></span></div>
          <div class="window-title">HEDERA CREATOR KIT</div>
        </div>
        <div class="terminal-content">
          <div class="art-gen-layout">
            <div class="art-gen-left">
              <div class="art-gen-section">
                <div class="back-link" id="mint-back"><span class="back-arrow">←</span><span>Back to Home</span></div>
                <h3 class="section-title">◆ Mint NFTs</h3>
                <p class="cc-hip-badge">⬡ HIP-412 NFT Metadata Standard</p>
                ${!connected ? this.renderConnectPrompt() : this.renderContent()}
              </div>
            </div>
            <div class="art-gen-right" style="padding:1.25rem">
              ${this.renderRightPanel()}
            </div>
          </div>
        </div>
        <div class="status-bar">
          <span class="status-left">${ws.accountId ? `⬡ ${ws.accountId}` : '⬡ Not connected'}</span>
          <span class="status-right">${ws.hbarBalance ? `${ws.hbarBalance} ℏ` : ''} · Mainnet</span>
        </div>
      </div>`;
  }

  private static renderConnectPrompt(): string {
    return `<div class="error-state"><p class="error-message">Please connect your wallet to mint NFTs.</p></div>`;
  }

  private static renderContent(): string {
    if (this.step === 'complete') return this.renderComplete();
    if (this.step === 'minting') return this.renderMintingProgress();
    return this.renderSetup();
  }

  // ─── SETUP STEP ───────────────────────────────────────────
  private static renderSetup(): string {
    return `
      ${this.renderTokenIdSection()}
      ${this.tokenValidated ? this.renderModeSection() : ''}
      ${this.tokenValidated && this.mode === 'csv' ? this.renderCsvSection() : ''}
      ${this.tokenValidated && this.mode === 'direct' ? this.renderDirectSection() : ''}
      ${this.renderPreMintSummary()}
      ${this.renderMintButton()}
      ${this.error ? `<div class="error-state" style="text-align:left;padding:0.5rem 0"><p class="error-message">${this.error}</p></div>` : ''}
      ${this.statusMessage ? `<p style="color:var(--terminal-text-dim);font-size:0.85rem;margin-top:0.5rem">${this.statusMessage}</p>` : ''}
    `;
  }

  private static renderTokenIdSection(): string {
    return `
      <div class="filter-divider"></div>
      <div class="input-group">
        <label>Token ID <span class="cc-field-hint">e.g. 0.0.12345</span></label>
        <div style="display:flex;gap:0.5rem;align-items:flex-start">
          <input type="text" class="token-input" id="mint-token-id" placeholder="0.0.xxxxx" value="${this.escapeHtml(this.tokenIdInput)}" style="flex:1" />
          <button class="terminal-button small" id="mint-validate-token" ${this.loading ? 'disabled' : ''}>VALIDATE</button>
        </div>
        ${this.tokenError ? `<p style="color:#ff6b6b;font-size:0.8rem;margin:0.25rem 0 0">${this.tokenError}</p>` : ''}
        ${this.tokenValidated && this.tokenInfo ? `<p style="color:var(--accent-green);font-size:0.8rem;margin:0.25rem 0 0">✓ ${this.escapeHtml(this.tokenInfo.name)} (${this.escapeHtml(this.tokenInfo.symbol)}) — ${this.tokenInfo.totalSupply}/${this.tokenInfo.maxSupply} minted</p>` : ''}
        ${this.tokenValidated && this.tokenInfo ? `<p style="color:var(--terminal-text-dim);font-size:0.78rem;margin:0.35rem 0 0">➜ Next Hedera serial will be <strong>#${this.tokenInfo.totalSupply + 1}</strong></p>` : ''}
      </div>

      ${this.tokenValidated ? `
        <div class="input-group" style="margin-top:0.75rem">
          <label>Supply Private Key <span class="cc-field-hint">from collection creation</span></label>
          <div style="display:flex;gap:0.5rem;align-items:flex-start">
            <input type="${this.supplyKeyRevealed ? 'text' : 'password'}" class="token-input" id="mint-supply-key" placeholder="Paste your supply private key..." value="${this.escapeHtml(this.supplyKeyInput)}" style="flex:1;font-family:monospace;font-size:0.85rem" />
            <button class="terminal-button small" id="mint-toggle-supply-key" style="padding:0.4rem 0.6rem">${this.supplyKeyRevealed ? 'HIDE' : 'SHOW'}</button>
          </div>
          ${this.supplyKeyError ? `<p style="color:#ff6b6b;font-size:0.8rem;margin:0.25rem 0 0">${this.supplyKeyError}</p>` : ''}
          <p style="color:var(--terminal-text-dim);font-size:0.75rem;margin:0.25rem 0 0">This is the private key shown when you created the collection. Required for minting.</p>
        </div>
      ` : ''}
    `;
  }

  private static renderModeSection(): string {
    return `
      <div class="filter-divider"></div>
      <div class="input-group">
        <label>Mint Mode</label>
        <div class="mint-mode-tabs">
          <button class="mint-mode-tab ${this.mode === 'csv' ? 'active' : ''}" data-mode="csv">Import CSV</button>
          <button class="mint-mode-tab ${this.mode === 'direct' ? 'active' : ''}" data-mode="direct">Upload Images</button>
        </div>
        <p style="color:var(--terminal-text-dim);font-size:0.78rem;margin:0.35rem 0 0">
          ${this.mode === 'csv'
            ? 'Import a CSV with metadata CIDs or Token URIs (e.g. from Art Generator export)'
            : 'Upload images with shared metadata + copies, or upload images + CSV for unique per-image metadata'}
        </p>
      </div>
    `;
  }

  // ─── CSV IMPORT SECTION ───────────────────────────────────
  private static renderCsvSection(): string {
    return `
      <div class="filter-divider"></div>
      <h4 class="cc-sub-heading">CSV Import</h4>
      <div class="upload-zone" id="mint-csv-drop">
        <p style="margin:0;color:var(--terminal-text-dim);font-size:0.85rem">
          ${this.csvFileName
            ? `✓ <span style="color:var(--accent-green)">${this.escapeHtml(this.csvFileName)}</span> — ${this.csvEntries.length} NFTs loaded`
            : 'Drop CSV file here or click to browse'}
        </p>
        <input type="file" id="mint-csv-input" accept=".csv" style="display:none" />
      </div>
      <p style="color:var(--terminal-text-dim);font-size:0.75rem;margin:0.25rem 0 0">
        Expected format: <code style="color:var(--terminal-purple)">Token Number,Image CID,Metadata CID,Token URI</code>
      </p>
      ${this.csvEntries.length > 0 ? `
        <div class="input-row" style="margin-top:0.75rem">
          <div class="input-group">
            <label>Batch Size <span class="cc-field-hint">max 10 per transaction</span></label>
            <input type="number" class="token-input" id="mint-batch-size" min="1" max="10" value="${this.batchSize}" style="max-width:100px" />
          </div>
          <div class="input-group">
            <label>Number Offset <span class="cc-field-hint">e.g. 1500</span></label>
            <input type="number" class="token-input" id="mint-csv-offset" value="${this.csvOffset || ''}" placeholder="0" style="max-width:120px" />
          </div>
        </div>
        <p style="color:var(--terminal-text-dim);font-size:0.75rem;margin:0.25rem 0 0">Use offset to display CSV row #1 as serial #1501 (enter 1500). This does not change pinned metadata — make sure your metadata names are already correct.</p>
      ` : ''}
    `;
  }

  // ─── UPLOAD IMAGES SECTION ──────────────────────────────
  private static renderDirectSection(): string {
    const hasImages = this.uploadedImages.length > 0;
    const pendingCount = this.uploadedImages.filter(img => img.status === 'pending').length;
    const allPinned = hasImages && this.uploadedImages.every(img => img.status === 'pinned');
    const hasCsv = !!this.directCsvFile;

    return `
      <div class="filter-divider"></div>
      <h4 class="cc-sub-heading" style="margin:0">Upload Images</h4>
      <p style="color:var(--terminal-text-dim);font-size:0.78rem;margin:0.35rem 0 0.5rem">
        Upload a .zip of images or individual files. Shared metadata is applied to all copies.
        For unique metadata per image, also upload a CSV with a <code style="color:var(--terminal-purple)">filename</code> column.
      </p>

      <div class="upload-zone" id="mint-zip-drop">
        <p style="margin:0;color:var(--terminal-text-dim);font-size:0.85rem">
          ${hasImages
            ? `✓ <span style="color:var(--accent-green)">${this.uploadedImages.length} file(s) loaded</span> — drop more to add`
            : 'Drop a folder, .zip, images, or MP4 here, or click to browse'}
        </p>
        <p style="margin:0.25rem 0 0;color:var(--terminal-text-dim);font-size:0.75rem;opacity:0.7">
          Supports images (PNG, JPG, GIF, WEBP) and MP4 video.
        </p>
        <button class="terminal-button small" id="mint-folder-btn" style="margin-top:0.6rem;font-size:0.75rem;padding:0.3rem 0.7rem" onclick="event.stopPropagation()">📁 SELECT FOLDER</button>
        <input type="file" id="mint-zip-input" accept=".zip,image/*,video/mp4" multiple style="display:none" />
        <input type="file" id="mint-folder-input" webkitdirectory multiple style="display:none" />
      </div>

      ${hasImages ? `
        <button class="terminal-button secondary" id="mint-clear-images" style="font-size:0.8rem;padding:0.4rem 0.8rem;margin-top:0.5rem">CLEAR ALL</button>

        <div class="filter-divider"></div>
        <h4 class="cc-sub-heading">Naming</h4>
        <div class="input-row">
          <div class="input-group">
            <label>Start Number <span class="cc-field-hint">auto = next serial</span></label>
            <input type="number" class="token-input" id="mint-direct-start" min="1" value="${this.directStartNumber || ''}" placeholder="${this.tokenInfo ? this.tokenInfo.totalSupply + 1 : '1'}" style="max-width:120px" />
          </div>
          <div class="input-group" style="display:flex;align-items:flex-end">
            <button class="terminal-button secondary" id="mint-renumber-images" style="font-size:0.78rem;padding:0.4rem 0.8rem">RENUMBER ALL</button>
          </div>
        </div>
        <p style="color:var(--terminal-text-dim);font-size:0.75rem;margin:0.25rem 0 0">Names below are what will be pinned in the metadata JSON. Edit them before pinning.</p>
        ${this.renderImageNameList()}

        <div class="filter-divider"></div>
        <h4 class="cc-sub-heading">Metadata</h4>

        <!-- CSV for unique metadata (optional) -->
        <p style="color:var(--terminal-text-dim);font-size:0.78rem;margin:0 0 0.5rem">
          <strong style="color:var(--terminal-text)">Option A — Shared metadata</strong>: fill in below, every image gets the same metadata.
          <br><strong style="color:var(--terminal-text)">Option B — CSV with unique metadata</strong>: upload a CSV with a <code style="color:var(--terminal-purple)">filename</code> column to map metadata per image.
        </p>

        <div class="upload-zone" id="mint-direct-csv-drop" style="padding:0.6rem 0.8rem;margin-bottom:0.75rem">
          <p style="margin:0;color:var(--terminal-text-dim);font-size:0.82rem">
            ${this.directCsvFileName
              ? `✓ <span style="color:var(--accent-green)">${this.escapeHtml(this.directCsvFileName)}</span> — metadata CSV loaded`
              : '📄 Optional: drop a metadata CSV here, or click to browse'}
          </p>
          ${this.directCsvError ? `<p style="margin:0.25rem 0 0;color:#ff6b6b;font-size:0.75rem">${this.directCsvError}</p>` : ''}
          ${this.directCsvMatched ? `<p style="margin:0.25rem 0 0;color:var(--accent-green);font-size:0.75rem">✓ All ${this.uploadedImages.length} images matched to CSV rows</p>` : ''}
          <input type="file" id="mint-direct-csv-input" accept=".csv" style="display:none" />
        </div>
        <p style="margin:0 0 0.75rem;font-size:0.75rem;color:var(--terminal-text-dim)">
          Need a template? <a href="#" id="mint-download-csv-template" style="color:var(--terminal-purple);text-decoration:underline;cursor:pointer">Download CSV Template</a>
        </p>

        ${!hasCsv ? `
          <div class="input-group">
            <label>Description <span class="cc-field-hint">optional — applied to all</span></label>
            <input type="text" class="token-input" id="mint-shared-desc" placeholder="A unique NFT collection..." value="${this.escapeHtml(this.sharedDescription)}" />
          </div>
          <div class="input-group">
            <label>Creator <span class="cc-field-hint">optional — applied to all</span></label>
            <input type="text" class="token-input" id="mint-shared-creator" placeholder="Artist name" value="${this.escapeHtml(this.sharedCreator)}" />
          </div>
          ${this.renderAttributesSection()}
          <div class="input-group" style="margin-top:0.5rem">
            <label>Copies per Image <span class="cc-field-hint">default 1 — set higher for editions, tickets, etc.</span></label>
            <input type="number" class="token-input" id="mint-copies" min="1" max="10000" value="${this.mintCopies}" style="max-width:120px" />
          </div>
        ` : ''}

        ${!allPinned && pendingCount > 0 ? `
          <button class="terminal-button secondary" id="mint-pin-all" style="margin-top:0.75rem" ${this.loading || this.isPinning ? 'disabled' : ''}>
            ${this.isPinning ? `PINNING... (${this.pinProgress}/${this.uploadedImages.length})` : `PIN ${pendingCount} FILE(S) TO IPFS`}
          </button>
        ` : ''}
        ${allPinned ? `
          <p style="color:var(--accent-green);font-size:0.85rem;margin-top:0.75rem">✓ All ${this.uploadedImages.length} file(s) pinned and queued</p>
        ` : ''}
      ` : ''}

      ${this.directEntries.length > 0 ? `
        <div style="margin-top:0.75rem">
          <p style="color:var(--accent-green);font-size:0.85rem">✓ ${this.directEntries.length} NFT(s) queued for minting</p>
        </div>
        <div class="input-group" style="margin-top:0.5rem">
          <label>Batch Size <span class="cc-field-hint">max 10 per transaction</span></label>
          <input type="number" class="token-input" id="mint-batch-size" min="1" max="10" value="${this.batchSize}" style="max-width:100px" />
        </div>
      ` : ''}
    `;
  }

  private static renderImageNameList(): string {
    if (this.uploadedImages.length === 0) return '';
    return `
      <div style="margin-top:0.75rem;display:flex;flex-direction:column;gap:0.4rem">
        ${this.uploadedImages.map((img, i) => `
          <div class="cc-royalty-row" data-index="${i}" style="align-items:center">
            <div style="width:40px;height:40px;border-radius:4px;overflow:hidden;flex-shrink:0;background:rgba(255,255,255,0.05)">
              ${img.file.type === 'video/mp4'
                ? `<video src="${img.preview}" class="mint-queue-thumb" muted autoplay loop playsinline style="width:100%;height:100%;object-fit:cover"></video>`
                : `<img src="${img.preview}" class="mint-queue-thumb" style="width:100%;height:100%;object-fit:cover" />`
              }
            </div>
            <div class="input-group" style="flex:1;margin:0">
              <input type="text" class="token-input mint-upload-name" data-index="${i}" value="${this.escapeHtml(img.name)}" style="font-size:0.85rem" />
            </div>
            <span style="color:var(--terminal-text-dim);font-size:0.75rem;white-space:nowrap">#${img.targetNumber}</span>
            <button class="cc-royalty-remove mint-upload-remove" data-index="${i}" title="Remove">✕</button>
          </div>
        `).join('')}
      </div>
    `;
  }

  private static renderAttributesSection(): string {
    const rows = this.sharedAttributes.map((attr, i) => `
      <div class="cc-royalty-row" data-index="${i}">
        <div class="input-group" style="flex:1"><label>Trait</label><input type="text" class="token-input mint-attr-type" data-index="${i}" placeholder="Background" value="${this.escapeHtml(attr.trait_type)}" /></div>
        <div class="input-group" style="flex:1"><label>Value</label><input type="text" class="token-input mint-attr-value" data-index="${i}" placeholder="Blue" value="${this.escapeHtml(attr.value)}" /></div>
        <button class="cc-royalty-remove mint-attr-remove" data-index="${i}" title="Remove">✕</button>
      </div>
    `).join('');
    return `
      <div style="margin-top:0.5rem">
        <label style="color:var(--terminal-text);font-size:0.9rem;text-transform:uppercase;letter-spacing:0.05em">Attributes <span class="cc-field-hint">optional</span></label>
        ${rows ? `<div class="cc-royalty-entries">${rows}</div>` : ''}
        <button class="terminal-button secondary" id="mint-add-attr" style="font-size:0.8rem;padding:0.4rem 0.8rem;margin-top:0.35rem">+ ADD ATTRIBUTE</button>
      </div>
    `;
  }


  // ─── PRE-MINT SUMMARY ─────────────────────────────────────
  private static renderPreMintSummary(): string {
    const entries = this.mode === 'csv' ? this.csvEntries : this.directEntries;
    if (!this.tokenValidated || entries.length === 0) return '';

    const nextSerial = this.tokenInfo ? this.tokenInfo.totalSupply + 1 : 1;
    const displayRows = entries.slice(0, 20).map((e, i) => {
      const displayNumber = this.getDisplayNumber(e);
      const expectedSerial = nextSerial + i;
      const mismatch = displayNumber !== expectedSerial;
      return `
        <tr style="border-bottom:1px solid rgba(255,255,255,0.06)">
          <td style="padding:0.35rem 0.5rem;font-size:0.8rem;color:${mismatch ? '#ff6b6b' : 'var(--terminal-text)'}">#${displayNumber}${mismatch ? ' ⚠' : ''}</td>
          <td style="padding:0.35rem 0.5rem;font-size:0.8rem;color:var(--terminal-text-dim)">${this.escapeHtml(e.tokenURI)}</td>
          <td style="padding:0.35rem 0.5rem;font-size:0.8rem;color:var(--terminal-text-dim)">#${expectedSerial}</td>
        </tr>
      `;
    }).join('');

    const mismatches = entries.slice(0, 100).map((e, i) => {
      const displayNumber = this.getDisplayNumber(e);
      const expectedSerial = nextSerial + i;
      return displayNumber !== expectedSerial ? { displayNumber, expectedSerial } : null;
    }).filter(Boolean);

    return `
      <div class="filter-divider"></div>
      <h4 class="cc-sub-heading">Pre-Mint Check</h4>
      <p style="color:var(--terminal-text-dim);font-size:0.78rem;margin:0 0 0.5rem">
        Verify that the intended names/numbers line up with the Hedera serials that will be minted.
      </p>
      <div style="max-height:300px;overflow:auto;border:1px solid rgba(255,255,255,0.08);border-radius:6px">
        <table style="width:100%;border-collapse:collapse">
          <thead style="position:sticky;top:0;background:var(--terminal-bg)">
            <tr>
              <th style="text-align:left;padding:0.5rem;font-size:0.75rem;color:var(--terminal-text-dim);font-weight:600">Intended #</th>
              <th style="text-align:left;padding:0.5rem;font-size:0.75rem;color:var(--terminal-text-dim);font-weight:600">Metadata URI</th>
              <th style="text-align:left;padding:0.5rem;font-size:0.75rem;color:var(--terminal-text-dim);font-weight:600">Will be serial</th>
            </tr>
          </thead>
          <tbody>
            ${displayRows}
          </tbody>
        </table>
      </div>
      ${entries.length > 20 ? `<p style="color:var(--terminal-text-dim);font-size:0.75rem;margin:0.35rem 0 0">...and ${entries.length - 20} more</p>` : ''}
      ${mismatches.length > 0 ? `
        <div style="margin-top:0.75rem;padding:0.6rem 0.8rem;background:rgba(255,80,80,0.08);border:1px solid rgba(255,80,80,0.25);border-radius:6px">
          <p style="font-size:0.78rem;color:#ff6b6b;margin:0">⚠️ ${mismatches.length} NFT(s) have intended numbers that do not match the next available Hedera serials. This usually means the metadata names will be wrong. Please review before minting.</p>
        </div>
      ` : ''}
    `;
  }

  // ─── MINT BUTTON ──────────────────────────────────────────
  private static renderMintButton(): string {
    const entries = this.mode === 'csv' ? this.csvEntries : this.directEntries;
    if (!this.tokenValidated || entries.length === 0) return '';
    return `
      <div class="filter-divider"></div>
      <button class="terminal-button" id="mint-start" ${this.loading ? 'disabled' : ''}>
        MINT ${entries.length} NFT${entries.length > 1 ? 'S' : ''}
      </button>
    `;
  }

  // ─── MINTING PROGRESS ────────────────────────────────────
  private static renderMintingProgress(): string {
    const entries = this.mode === 'csv' ? this.csvEntries : this.directEntries;
    const minted = entries.filter(e => e.status === 'minted').length;
    const errors = entries.filter(e => e.status === 'error').length;
    const pending = entries.filter(e => e.status === 'pending' || e.status === 'minting').length;
    const pct = entries.length > 0 ? Math.round((minted / entries.length) * 100) : 0;
    return `
      <div class="filter-divider"></div>
      <h4 class="cc-sub-heading">Minting Progress</h4>
      <div class="mint-progress-bar-container">
        <div class="mint-progress-bar" style="width:${pct}%"></div>
      </div>
      <div class="preview-info" style="margin-top:0.75rem">
        <div class="info-row"><span>Progress</span><span class="status-value">${minted}/${entries.length} (${pct}%)</span></div>
        <div class="info-row"><span>Batch</span><span class="status-value">${this.currentBatch}/${this.totalBatches}</span></div>
        ${errors > 0 ? `<div class="info-row"><span>Errors</span><span class="status-value" style="color:#ff6b6b">${errors}</span></div>` : ''}
        ${pending > 0 ? `<div class="info-row"><span>Remaining</span><span class="status-value">${pending}</span></div>` : ''}
      </div>
      ${this.statusMessage ? `<p style="color:var(--terminal-text-dim);font-size:0.85rem;margin-top:0.75rem">${this.statusMessage}</p>` : ''}
      ${!this.isMinting && (minted > 0 || errors > 0) ? `
        <div style="margin-top:1rem;display:flex;gap:0.5rem">
          ${pending > 0 ? `<button class="terminal-button" id="mint-resume">RESUME MINTING</button>` : ''}
          <button class="terminal-button secondary" id="mint-done">DONE</button>
        </div>
      ` : ''}
    `;
  }

  // ─── COMPLETE ─────────────────────────────────────────────
  private static renderComplete(): string {
    return `
      <div class="filter-divider"></div>
      <h3 class="section-title">◆ Minting Complete ✓</h3>
      <div class="preview-info">
        <div class="info-row"><span>Token ID</span><span class="status-value">${this.tokenInfo?.tokenId || '—'}</span></div>
        <div class="info-row"><span>NFTs Minted</span><span class="status-value">${this.mintedSerials.length}</span></div>
        ${this.mintErrors.length > 0 ? `<div class="info-row"><span>Errors</span><span class="status-value" style="color:#ff6b6b">${this.mintErrors.length}</span></div>` : ''}
      </div>
      <div style="margin-top:1rem;display:flex;gap:0.5rem">
        <button class="terminal-button" id="mint-new">MINT MORE</button>
        <button class="terminal-button secondary" id="mint-download-csv">DOWNLOAD RESULTS CSV</button>
      </div>
    `;
  }

  // ─── RIGHT PANEL ──────────────────────────────────────────
  private static renderRightPanel(): string {
    if (this.step === 'complete') return this.renderRightComplete();

    const entries = this.mode === 'csv' ? this.csvEntries : this.directEntries;
    const network = WalletConnectService.getState().network?.toLowerCase() || 'mainnet';

    return `
      <div class="cc-right-content">
        <h4 class="section-title" style="font-size:0.95rem">Mint Preview</h4>
        ${this.tokenInfo ? `
          <div class="preview-info">
            <div class="info-row"><span>Collection</span><span class="status-value">${this.escapeHtml(this.tokenInfo.name)}</span></div>
            <div class="info-row"><span>Token ID</span><span class="status-value">${this.tokenInfo.tokenId}</span></div>
            <div class="info-row"><span>Symbol</span><span class="status-value">${this.tokenInfo.symbol}</span></div>
            <div class="info-row"><span>Supply</span><span class="status-value">${this.tokenInfo.totalSupply} / ${this.tokenInfo.maxSupply}</span></div>
            <div class="info-row"><span>Remaining</span><span class="status-value">${this.tokenInfo.maxSupply - this.tokenInfo.totalSupply}</span></div>
          </div>
          <a class="cid-link" href="https://hashscan.io/${network}/token/${this.tokenInfo.tokenId}" target="_blank" rel="noopener" style="font-size:0.8rem;margin-top:0.5rem;display:block">View on HashScan →</a>
        ` : `
          <p style="color:var(--terminal-text-dim);font-size:0.85rem">Enter a Token ID and click VALIDATE to begin.</p>
        `}

        ${this.mode === 'direct' && this.uploadedImages.length > 0 ? `
          <div class="filter-divider"></div>
          <h4 class="section-title" style="font-size:0.9rem">Media (${this.uploadedImages.length})</h4>
          <div class="mint-queue-grid">
            ${this.uploadedImages.slice(0, 50).map((img) => `
              <div class="mint-queue-card ${img.status}" title="${this.escapeHtml(img.name)}">
                ${img.file.type === 'video/mp4'
                  ? `<video src="${img.preview}" class="mint-queue-thumb" muted autoplay loop playsinline style="object-fit:cover"></video>`
                  : `<img src="${img.preview}" class="mint-queue-thumb" />`
                }
                <div class="mint-queue-card-info">
                  <span class="mint-queue-card-num">${this.escapeHtml(img.name)}</span>
                  <span class="mint-queue-card-status">${
                    img.status === 'pinned' ? '✓' :
                    img.status === 'pinning' ? '⏳' :
                    img.status === 'error' ? '✗' : '○'
                  }</span>
                </div>
              </div>
            `).join('')}
            ${this.uploadedImages.length > 50 ? `<p style="color:var(--terminal-text-dim);font-size:0.8rem;margin-top:0.5rem;grid-column:1/-1">...and ${this.uploadedImages.length - 50} more</p>` : ''}
          </div>
        ` : ''}

        ${entries.length > 0 ? `
          <div class="filter-divider"></div>
          <h4 class="section-title" style="font-size:0.9rem">Queue (${entries.length} NFTs)</h4>
          <div class="mint-queue-grid">
            ${entries.slice(0, 50).map((e) => `
              <div class="mint-queue-card ${e.status}" title="#${this.getDisplayNumber(e)} — ${this.escapeHtml(e.tokenURI)}">
                ${e.previewUrl
                  ? `<img src="${e.previewUrl}" class="mint-queue-thumb" />`
                  : e.imageCID
                    ? `<img src="https://ipfs.io/ipfs/${e.imageCID}" class="mint-queue-thumb" loading="lazy" />`
                    : `<div class="mint-queue-thumb-placeholder">#${e.number}</div>`}
                <div class="mint-queue-card-info">
                  <span class="mint-queue-card-num">#${this.getDisplayNumber(e)}</span>
                  <span class="mint-queue-card-status">${
                    e.status === 'minted' ? `S/N ${e.serial}` :
                    e.status === 'minting' ? '⏳' :
                    e.status === 'error' ? '✗' : '○'
                  }</span>
                </div>
              </div>
            `).join('')}
            ${entries.length > 50 ? `<p style="color:var(--terminal-text-dim);font-size:0.8rem;margin-top:0.5rem;grid-column:1/-1">...and ${entries.length - 50} more</p>` : ''}
          </div>
        ` : ''}

        <div class="result-block" style="margin-top:1rem">
          <label style="font-size:0.75rem;opacity:0.6">Standard: HIP-412 NFT Metadata</label>
        </div>
      </div>
    `;
  }

  private static getDisplayNumber(entry: NftEntry): number {
    if (this.mode === 'csv') return entry.number + this.csvOffset;
    return entry.number;
  }

  private static renderRightComplete(): string {
    const network = WalletConnectService.getState().network?.toLowerCase() || 'mainnet';
    return `
      <div class="cc-right-content">
        <h4 class="section-title" style="font-size:0.95rem">🎉 Minting Results</h4>
        ${this.tokenInfo ? `
          <div class="result-block">
            <label>Collection</label>
            <code class="cid-value">${this.tokenInfo.tokenId}</code>
            <a class="cid-link" href="https://hashscan.io/${network}/token/${this.tokenInfo.tokenId}" target="_blank" rel="noopener">View on HashScan →</a>
          </div>
        ` : ''}
        <div class="result-block" style="margin-top:0.75rem">
          <label>Minted Serials</label>
          <div class="mint-queue-list">
            ${this.mintedSerials.slice(0, 100).map(s => `
              <div class="mint-queue-item minted">
                <span class="mint-queue-num">#${s.number}</span>
                <span class="mint-queue-status">Serial ${s.serial}</span>
              </div>
            `).join('')}
            ${this.mintedSerials.length > 100 ? `<p style="color:var(--terminal-text-dim);font-size:0.8rem">...and ${this.mintedSerials.length - 100} more</p>` : ''}
          </div>
        </div>
        ${this.mintErrors.length > 0 ? `
          <div class="result-block" style="margin-top:0.75rem">
            <label style="color:#ff6b6b">Errors (${this.mintErrors.length})</label>
            ${this.mintErrors.slice(0, 20).map(e => `<p style="font-size:0.8rem;color:#ff6b6b;margin:0.2rem 0">#${e.number}: ${this.escapeHtml(e.error)}</p>`).join('')}
          </div>
        ` : ''}
      </div>
    `;
  }

  // ─── INIT ─────────────────────────────────────────────────
  public static init(): void {
    // Back button
    document.getElementById('mint-back')?.addEventListener('click', () => {
      window.dispatchEvent(new CustomEvent('navigate-to-tool', { detail: { toolId: 'home' } }));
    });

    // Token ID input
    const tokenInput = document.getElementById('mint-token-id') as HTMLInputElement | null;
    tokenInput?.addEventListener('input', () => { this.tokenIdInput = tokenInput.value; });
    tokenInput?.addEventListener('keydown', (e) => { if (e.key === 'Enter') this.validateToken(); });

    // Validate button
    document.getElementById('mint-validate-token')?.addEventListener('click', () => this.validateToken());

    // Supply key input
    const supplyKeyInput = document.getElementById('mint-supply-key') as HTMLInputElement | null;
    supplyKeyInput?.addEventListener('input', () => {
      this.supplyKeyInput = supplyKeyInput.value;
      this.supplyKeyError = null;
    });

    // Supply key toggle button
    document.getElementById('mint-toggle-supply-key')?.addEventListener('click', () => {
      this.supplyKeyRevealed = !this.supplyKeyRevealed;
      this.refresh();
    });

    // Mode tabs
    document.querySelectorAll('.mint-mode-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        this.mode = (btn as HTMLElement).dataset.mode as MintMode;
        this.refresh();
      });
    });

    // CSV import zone
    this.initCsvZone('mint-csv-drop', 'mint-csv-input', true);

    // Zip upload zone (same pattern as CSV zone)
    this.initZipZone('mint-zip-drop', 'mint-zip-input');

    // Per-image name editing
    document.querySelectorAll('.mint-upload-name').forEach(el => {
      el.addEventListener('input', () => {
        const idx = parseInt((el as HTMLElement).dataset.index || '0');
        if (!this.uploadedImages[idx]) return;
        const newName = (el as HTMLInputElement).value;
        this.uploadedImages[idx].name = newName;
        // Try to extract a number from the end of the name (e.g. "Collection #1502")
        const match = newName.match(/#(\d+)(?:\s*\/\s*\d+)?\s*$/);
        if (match) {
          this.uploadedImages[idx].targetNumber = parseInt(match[1]);
        }
      });
    });

    // Direct upload start number input
    const startInput = document.getElementById('mint-direct-start') as HTMLInputElement | null;
    startInput?.addEventListener('input', () => {
      const val = parseInt(startInput.value);
      this.directStartNumber = isNaN(val) || val < 1 ? 0 : val;
    });

    // Renumber all images button
    document.getElementById('mint-renumber-images')?.addEventListener('click', () => {
      this.renumberImages();
    });

    // Per-image remove buttons
    document.querySelectorAll('.mint-upload-remove').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const idx = parseInt((btn as HTMLElement).dataset.index || '0');
        if (this.uploadedImages[idx]) {
          URL.revokeObjectURL(this.uploadedImages[idx].preview);
          this.uploadedImages.splice(idx, 1);
          this.refresh();
        }
      });
    });

    // Clear all images
    document.getElementById('mint-clear-images')?.addEventListener('click', () => {
      this.uploadedImages.forEach(img => URL.revokeObjectURL(img.preview));
      this.uploadedImages = [];
      this.refresh();
    });

    // Shared metadata inputs
    const descInput = document.getElementById('mint-shared-desc') as HTMLInputElement | null;
    descInput?.addEventListener('input', () => { this.sharedDescription = descInput.value; });
    const creatorInput = document.getElementById('mint-shared-creator') as HTMLInputElement | null;
    creatorInput?.addEventListener('input', () => { this.sharedCreator = creatorInput.value; });

    // Attributes
    document.querySelectorAll('.mint-attr-type').forEach(el => {
      el.addEventListener('input', () => {
        const idx = parseInt((el as HTMLElement).dataset.index || '0');
        if (this.sharedAttributes[idx]) this.sharedAttributes[idx].trait_type = (el as HTMLInputElement).value;
      });
    });
    document.querySelectorAll('.mint-attr-value').forEach(el => {
      el.addEventListener('input', () => {
        const idx = parseInt((el as HTMLElement).dataset.index || '0');
        if (this.sharedAttributes[idx]) this.sharedAttributes[idx].value = (el as HTMLInputElement).value;
      });
    });
    document.querySelectorAll('.mint-attr-remove').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt((btn as HTMLElement).dataset.index || '0');
        this.sharedAttributes.splice(idx, 1);
        this.refresh();
      });
    });
    document.getElementById('mint-add-attr')?.addEventListener('click', () => {
      this.sharedAttributes.push({ trait_type: '', value: '' });
      this.refresh();
    });

    // Mint copies input
    const copiesInput = document.getElementById('mint-copies') as HTMLInputElement | null;
    copiesInput?.addEventListener('input', () => {
      const val = parseInt(copiesInput.value);
      if (val >= 1 && val <= 10000) this.mintCopies = val;
    });

    // Direct CSV upload zone (for unique metadata matching)
    const directCsvDrop = document.getElementById('mint-direct-csv-drop');
    const directCsvInput = document.getElementById('mint-direct-csv-input') as HTMLInputElement | null;
    if (directCsvDrop && directCsvInput) {
      directCsvDrop.addEventListener('click', (e) => { if (e.target !== directCsvInput) directCsvInput.click(); });
      directCsvDrop.addEventListener('dragover', (e) => { e.preventDefault(); directCsvDrop.classList.add('drag-over'); });
      directCsvDrop.addEventListener('dragleave', () => directCsvDrop.classList.remove('drag-over'));
      directCsvDrop.addEventListener('drop', (e) => {
        e.preventDefault();
        directCsvDrop.classList.remove('drag-over');
        const file = e.dataTransfer?.files[0];
        if (file && file.name.endsWith('.csv')) this.parseDirectCsv(file);
      });
      directCsvInput.addEventListener('change', () => {
        const file = directCsvInput.files?.[0];
        if (file) this.parseDirectCsv(file);
      });
    }

    // Download CSV template
    document.getElementById('mint-download-csv-template')?.addEventListener('click', (e) => {
      e.preventDefault();
      this.downloadCsvTemplate();
    });

    // Pin all images button
    document.getElementById('mint-pin-all')?.addEventListener('click', () => this.pinAllImages());

    // Batch size
    const batchInput = document.getElementById('mint-batch-size') as HTMLInputElement | null;
    batchInput?.addEventListener('input', () => {
      const val = parseInt(batchInput.value);
      if (val >= 1 && val <= 10) this.batchSize = val;
    });

    // CSV offset
    const csvOffsetInput = document.getElementById('mint-csv-offset') as HTMLInputElement | null;
    csvOffsetInput?.addEventListener('input', () => {
      const val = parseInt(csvOffsetInput.value);
      this.csvOffset = isNaN(val) ? 0 : val;
      this.refresh();
    });

    // Mint start
    document.getElementById('mint-start')?.addEventListener('click', () => this.startMinting());

    // Resume
    document.getElementById('mint-resume')?.addEventListener('click', () => this.startMinting());

    // Done
    document.getElementById('mint-done')?.addEventListener('click', () => {
      this.step = 'complete';
      this.refresh();
    });

    // Complete actions
    document.getElementById('mint-new')?.addEventListener('click', () => {
      this.resetState();
      this.refresh();
    });
    document.getElementById('mint-download-csv')?.addEventListener('click', () => this.downloadResultsCsv());
  }

  // ─── REFRESH (scroll-preserving) ─────────────────────────
  private static refresh(): void {
    const scrollContainer = document.querySelector('.art-gen-left');
    const scrollTop = scrollContainer?.scrollTop ?? 0;
    const app = document.querySelector<HTMLDivElement>('#app')!;
    app.innerHTML = this.render();
    this.init();
    const newContainer = document.querySelector('.art-gen-left');
    if (newContainer) newContainer.scrollTop = scrollTop;
  }

  // ─── CSV ZONE HELPER ──────────────────────────────────────
  private static initCsvZone(dropId: string, inputId: string, isCsvMode: boolean): void {
    const dropZone = document.getElementById(dropId);
    const fileInput = document.getElementById(inputId) as HTMLInputElement | null;
    if (!dropZone || !fileInput) return;

    dropZone.addEventListener('click', (e) => { if (e.target !== fileInput) fileInput.click(); });
    dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('drag-over'); });
    dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
    dropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropZone.classList.remove('drag-over');
      const file = e.dataTransfer?.files[0];
      if (file && file.name.endsWith('.csv')) this.parseCsvFile(file, isCsvMode);
    });
    fileInput.addEventListener('change', () => {
      const file = fileInput.files?.[0];
      if (file) this.parseCsvFile(file, isCsvMode);
    });
  }

  // ─── ZIP ZONE HELPER ─────────────────────────────────────
  private static initZipZone(dropId: string, inputId: string): void {
    const dropZone = document.getElementById(dropId);
    const fileInput = document.getElementById(inputId) as HTMLInputElement | null;
    const folderInput = document.getElementById('mint-folder-input') as HTMLInputElement | null;
    if (!dropZone || !fileInput) return;

    // Folder button opens the folder picker
    document.getElementById('mint-folder-btn')?.addEventListener('click', () => folderInput?.click());

    // Folder selection — files come back as individual File objects, addImages handles them
    folderInput?.addEventListener('change', () => {
      const files = folderInput.files;
      if (!files || files.length === 0) return;
      const media = Array.from(files).filter(f => f.type.startsWith('image/') || f.type === 'video/mp4');
      if (media.length > 0) this.addImages(media);
    });

    dropZone.addEventListener('click', (e) => { if (e.target !== fileInput) fileInput.click(); });
    dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('drag-over'); });
    dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
    dropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropZone.classList.remove('drag-over');
      const files = e.dataTransfer?.files;
      if (!files || files.length === 0) return;
      if (files[0].name.toLowerCase().endsWith('.zip')) {
        this.extractZip(files[0]);
      } else {
        const media = Array.from(files).filter(f => f.type.startsWith('image/') || f.type === 'video/mp4');
        if (media.length > 0) this.addImages(media);
      }
    });
    fileInput.addEventListener('change', () => {
      const files = fileInput.files;
      if (!files || files.length === 0) return;
      if (files[0].name.toLowerCase().endsWith('.zip')) {
        this.extractZip(files[0]);
      } else {
        const media = Array.from(files).filter(f => f.type.startsWith('image/') || f.type === 'video/mp4');
        if (media.length > 0) this.addImages(media);
      }
    });
  }

  // ─── CSV PARSING ──────────────────────────────────────────
  private static parseCsvFile(file: File, isCsvMode: boolean): void {
    const reader = new FileReader();
    reader.onload = () => {
      const text = reader.result as string;
      const lines = text.trim().split('\n');
      if (lines.length < 2) {
        this.error = 'CSV file is empty or has no data rows';
        this.refresh();
        return;
      }

      // Parse header
      const header = lines[0].toLowerCase();
      const hasTokenURI = header.includes('token uri') || header.includes('tokenuri');
      const hasMetadataCID = header.includes('metadata cid') || header.includes('metadatacid');

      if (!hasTokenURI && !hasMetadataCID) {
        this.error = 'CSV must have a "Metadata CID" or "Token URI" column';
        this.refresh();
        return;
      }

      const entries: NftEntry[] = [];
      for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].split(',').map(c => c.trim());
        if (cols.length < 3) continue;

        const number = parseInt(cols[0]) || i;
        const imageCID = cols[1] || '';
        const metadataCID = cols[2] || '';
        const tokenURI = cols[3] || (metadataCID ? `ipfs://${metadataCID}` : '');

        if (!metadataCID && !tokenURI) continue;

        entries.push({
          number,
          metadataCID: metadataCID || tokenURI.replace('ipfs://', ''),
          tokenURI: tokenURI || `ipfs://${metadataCID}`,
          imageCID: imageCID || undefined,
          status: 'pending',
        });
      }

      if (entries.length === 0) {
        this.error = 'No valid entries found in CSV';
        this.refresh();
        return;
      }

      if (isCsvMode) {
        this.csvEntries = entries;
        this.csvFileName = file.name;
      } else {
        this.directEntries = entries;
      }
      this.error = null;
      this.refresh();
    };
    reader.readAsText(file);
  }

  // ─── DIRECT CSV (filename-matching for unique metadata) ────
  private static parseDirectCsv(file: File): void {
    this.directCsvError = null;
    this.directCsvMatched = false;

    const reader = new FileReader();
    reader.onload = () => {
      const text = reader.result as string;
      const lines = text.trim().split('\n');
      if (lines.length < 2) {
        this.directCsvError = 'CSV is empty or has no data rows';
        this.refresh();
        return;
      }

      // Parse header — require a 'filename' column
      const headerCols = lines[0].split(',').map(c => c.trim().toLowerCase());
      const fnIdx = headerCols.findIndex(h => h === 'filename' || h === 'file');
      if (fnIdx === -1) {
        this.directCsvError = 'CSV must have a "filename" column (e.g. filename, name, description, creator, trait1, trait2...)';
        this.refresh();
        return;
      }

      const nameIdx = headerCols.findIndex(h => h === 'name');
      const descIdx = headerCols.findIndex(h => h === 'description' || h === 'desc');
      const creatorIdx = headerCols.findIndex(h => h === 'creator' || h === 'artist');

      // Identify trait columns (any column that isn't filename/name/description/creator)
      const reservedIdxs = new Set([fnIdx, nameIdx, descIdx, creatorIdx].filter(i => i >= 0));
      const traitIdxs = headerCols.map((_, i) => i).filter(i => !reservedIdxs.has(i));

      // Build map: filename → metadata
      const csvMap = new Map<string, {
        name: string; description: string; creator: string;
        attributes: Array<{ trait_type: string; value: string }>;
      }>();

      for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].split(',').map(c => c.trim());
        const fn = cols[fnIdx]?.trim();
        if (!fn) continue;

        const attrs: Array<{ trait_type: string; value: string }> = [];
        for (const ti of traitIdxs) {
          const val = cols[ti]?.trim();
          if (val) attrs.push({ trait_type: headerCols[ti], value: val });
        }

        csvMap.set(fn, {
          name: nameIdx >= 0 ? (cols[nameIdx]?.trim() || '') : '',
          description: descIdx >= 0 ? (cols[descIdx]?.trim() || '') : '',
          creator: creatorIdx >= 0 ? (cols[creatorIdx]?.trim() || '') : '',
          attributes: attrs,
        });
      }

      // Match CSV rows to uploaded images by filename
      const unmatched: string[] = [];
      for (const img of this.uploadedImages) {
        const baseName = img.file.name;
        const row = csvMap.get(baseName);
        if (row) {
          if (row.name) img.name = row.name;
          img.description = row.description;
          img.creator = row.creator;
          img.attributes = row.attributes;
        } else {
          unmatched.push(baseName);
        }
      }

      if (unmatched.length > 0) {
        this.directCsvError = `${unmatched.length} file(s) not found in CSV: ${unmatched.slice(0, 5).join(', ')}${unmatched.length > 5 ? '...' : ''}`;
        this.directCsvFile = file;
        this.directCsvFileName = file.name;
        this.directCsvMatched = false;
      } else {
        this.directCsvFile = file;
        this.directCsvFileName = file.name;
        this.directCsvMatched = true;
        this.directCsvError = null;
      }

      this.refresh();
    };
    reader.readAsText(file);
  }

  // ─── TOKEN VALIDATION ─────────────────────────────────────
  private static async validateToken(): Promise<void> {
    const tokenId = this.tokenIdInput.trim();
    if (!tokenId) {
      this.tokenError = 'Please enter a Token ID';
      this.refresh();
      return;
    }

    this.loading = true;
    this.tokenError = null;
    this.tokenValidated = false;
    this.tokenInfo = null;
    this.refresh();

    try {
      const res = await fetch(`${MIRROR_NODE_URL}/api/v1/tokens/${tokenId}`);
      if (!res.ok) throw new Error(`Token ${tokenId} not found`);
      const data = await res.json();

      if (data.type !== 'NON_FUNGIBLE_UNIQUE') {
        throw new Error('This token is not an NFT collection (must be NON_FUNGIBLE_UNIQUE)');
      }

      if (!data.supply_key) {
        throw new Error('This token has no Supply Key — minting is not possible');
      }

      this.tokenInfo = {
        tokenId: data.token_id,
        name: data.name || 'Unnamed',
        symbol: data.symbol || '',
        totalSupply: parseInt(data.total_supply) || 0,
        maxSupply: parseInt(data.max_supply) || 0,
        supplyKey: data.supply_key?.key || null,
        type: data.type,
      };
      this.tokenValidated = true;
      this.tokenError = null;
    } catch (err: any) {
      this.tokenError = err.message || 'Failed to validate token';
      this.tokenValidated = false;
      this.tokenInfo = null;
    }

    this.loading = false;
    this.refresh();
  }

  // ─── PIN ALL IMAGES ─────────────────────────────────────
  private static async pinAllImages(): Promise<void> {
    const pendingImages = this.uploadedImages.filter(img => img.status === 'pending');
    if (pendingImages.length === 0) {
      this.error = 'No images to pin';
      this.refresh();
      return;
    }

    // Validate all have names
    const unnamed = pendingImages.find(img => !img.name.trim());
    if (unnamed) {
      this.error = 'All images must have a name';
      this.refresh();
      return;
    }

    this.isPinning = true;
    this.pinProgress = 0;
    this.error = null;
    this.statusMessage = `Pinning ${pendingImages.length} file(s) to IPFS...`;
    this.refresh();

    for (const img of pendingImages) {
      img.status = 'pinning';
      this.pinProgress++;
      this.statusMessage = `Pinning file ${this.pinProgress}/${pendingImages.length}: ${img.name}`;
      this.refresh();

      try {
        const formData = new FormData();
        formData.append('image', img.file);
        formData.append('name', img.name.trim());

        // Use per-image metadata, fall back to shared if empty
        const desc = img.description.trim() || this.sharedDescription.trim();
        if (desc) formData.append('description', desc);

        const creator = img.creator.trim() || this.sharedCreator.trim();
        if (creator) formData.append('creator', creator);

        if (this.tokenInfo?.name) formData.append('collectionName', this.tokenInfo.name);

        // Use per-image attributes, fall back to shared if empty
        const imgAttrs = img.attributes.filter(a => a.trait_type.trim() && a.value.trim());
        const attrs = imgAttrs.length > 0 ? imgAttrs : this.sharedAttributes.filter(a => a.trait_type.trim() && a.value.trim());
        if (attrs.length > 0) {
          formData.append('attributes', JSON.stringify(attrs));
        }

        const res = await fetch(`${API_BASE_URL}/api/pin-nft-metadata`, {
          method: 'POST',
          body: formData,
        });

        const text = await res.text();
        let data: any;
        try { data = JSON.parse(text); } catch { throw new Error(`Server returned ${res.status}: ${text || 'empty response'}`); }
        if (!data.success) throw new Error(data.error || 'Failed to pin metadata');

        img.status = 'pinned';

        // When using CSV matching, 1 entry per image. Otherwise multiply by mintCopies.
        const copies = this.directCsvFile ? 1 : this.mintCopies;
        for (let c = 0; c < copies; c++) {
          this.directEntries.push({
            number: img.targetNumber + c,
            metadataCID: data.metadataCID,
            tokenURI: data.tokenURI,
            imageCID: data.imageCID,
            previewUrl: img.file.type === 'video/mp4' ? undefined : img.preview,
            status: 'pending',
          });
        }
      } catch (err: any) {
        img.status = 'error';
        this.error = `Failed to pin "${img.name}": ${err.message}`;
        this.isPinning = false;
        this.statusMessage = '';
        this.refresh();
        return;
      }

      this.refresh();
    }

    this.isPinning = false;
    const totalQueued = this.directEntries.length;
    this.statusMessage = `All ${pendingImages.length} file(s) pinned — ${totalQueued} NFT(s) queued for minting`;
    this.refresh();
  }

  // ─── ADD IMAGES HELPER ─────────────────────────────────
  private static addImages(files: FileList | File[]): void {
    const collectionName = this.tokenInfo?.name || 'NFT';
    const baseStart = this.directStartNumber > 0
      ? this.directStartNumber
      : (this.tokenInfo ? this.tokenInfo.totalSupply + 1 : 1);
    const existingCount = this.uploadedImages.length + this.directEntries.length;
    const startNum = baseStart + existingCount;

    // Sort by filename so numbered images (1.png, 2.png, …) come in order
    const sorted = Array.from(files)
      .filter(f => f.type.startsWith('image/') || f.type === 'video/mp4')
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));

    sorted.forEach((file, i) => {
      const targetNumber = startNum + i;
      this.uploadedImages.push({
        file,
        preview: URL.createObjectURL(file),
        name: `${collectionName} #${targetNumber}`,
        targetNumber,
        status: 'pending',
        description: '',
        creator: '',
        attributes: [],
      });
    });

    this.refresh();
  }

  // ─── RENUMBER IMAGES HELPER ─────────────────────────────
  private static renumberImages(): void {
    if (this.uploadedImages.length === 0) return;
    const collectionName = this.tokenInfo?.name || 'NFT';
    const baseStart = this.directStartNumber > 0
      ? this.directStartNumber
      : (this.tokenInfo ? this.tokenInfo.totalSupply + 1 : 1);

    this.uploadedImages.forEach((img, i) => {
      img.targetNumber = baseStart + i;
      // Preserve any custom prefix the user may have set; only update if it looks like the default
      const hasDefaultName = img.name.match(/#\d+(?:\s*\/\s*\d+)?\s*$/);
      if (hasDefaultName) {
        img.name = `${collectionName} #${img.targetNumber}`;
      }
    });

    this.refresh();
  }

  // ─── EXTRACT ZIP HELPER ───────────────────────────────
  private static async extractZip(zipFile: File): Promise<void> {
    this.statusMessage = 'Extracting zip file…';
    this.refresh();

    try {
      const zip = await JSZip.loadAsync(zipFile);
      const mediaFiles: File[] = [];
      const MEDIA_EXTS = /\.(png|jpe?g|gif|webp|svg|bmp|tiff?|mp4)$/i;
      const mimeMap: Record<string, string> = {
        png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
        gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml',
        bmp: 'image/bmp', tif: 'image/tiff', tiff: 'image/tiff',
        mp4: 'video/mp4',
      };

      const entries = Object.entries(zip.files).filter(
        ([name, entry]) => !entry.dir && MEDIA_EXTS.test(name) && !name.startsWith('__MACOSX')
      );

      for (const [name, entry] of entries) {
        const blob = await entry.async('blob');
        const ext = name.split('.').pop()?.toLowerCase() || 'png';
        const mime = mimeMap[ext] || 'image/png';
        const baseName = name.split('/').pop() || name;
        mediaFiles.push(new File([blob], baseName, { type: mime }));
      }

      if (mediaFiles.length === 0) {
        this.error = 'No supported files found in the zip (PNG, JPG, GIF, WEBP, MP4)';
      } else {
        this.addImages(mediaFiles);
        this.statusMessage = `Extracted ${mediaFiles.length} file(s) from zip`;
      }
    } catch (err: any) {
      this.error = `Failed to extract zip: ${err.message}`;
    }

    this.refresh();
  }

  // ─── MINTING ──────────────────────────────────────────────
  private static async startMinting(): Promise<void> {
    const ws = WalletConnectService.getState();
    if (!ws.connected || !ws.accountId) {
      this.error = 'Wallet not connected';
      return;
    }
    if (!this.tokenInfo) {
      this.error = 'Token not validated';
      return;
    }

    // Validate supply key
    if (!this.supplyKeyInput.trim()) {
      this.supplyKeyError = 'Supply private key is required';
      this.refresh();
      return;
    }

    // Validate supply key format
    try {
      PrivateKey.fromString(this.supplyKeyInput.trim());
    } catch (err) {
      this.supplyKeyError = 'Invalid supply key format';
      this.refresh();
      return;
    }

    const entries = this.mode === 'csv' ? this.csvEntries : this.directEntries;
    const pendingEntries = entries.filter(e => e.status === 'pending');
    if (pendingEntries.length === 0) {
      this.error = 'No pending NFTs to mint';
      return;
    }

    // Check remaining supply
    const remaining = this.tokenInfo.maxSupply - this.tokenInfo.totalSupply;
    if (pendingEntries.length > remaining) {
      this.error = `Cannot mint ${pendingEntries.length} NFTs — only ${remaining} remaining in max supply`;
      this.refresh();
      return;
    }

    const accountId = ws.accountId;
    const metadataCIDs = pendingEntries.map(e => e.metadataCID);

    this.step = 'minting';
    this.isMinting = true;
    this.error = null;
    this.statusMessage = 'Calculating exact minting fees...';
    this.refresh();

    try {
      // Step 1: Calculate exact fees using network-calculated maxTransactionFee
      const feeResponse = await fetch(`${API_BASE_URL}/api/calculate-mint-fee`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tokenId: this.tokenInfo.tokenId,
          metadataCIDs,
        }),
      });

      if (!feeResponse.ok) {
        const errorData = await feeResponse.json();
        throw new Error(errorData.error || 'Failed to calculate minting fees');
      }

      const feeData = await feeResponse.json();
      const feeWithBuffer = feeData.totalFeeWithBuffer;
      // Round up to the nearest tinybar to avoid "Hbar in tinybars contains decimals" SDK error
      const feeTinybars = Math.ceil(feeWithBuffer * 1e8);

      this.statusMessage = `Transferring ${feeWithBuffer.toFixed(4)} HBAR to cover minting fees for ${pendingEntries.length} NFTs (${feeData.totalBatches} batches)...`;
      this.refresh();

      // Step 2: Transfer HBAR to operator to cover fees (ONE wallet signature)
      const transferTx = new TransferTransaction()
        .addHbarTransfer(AccountId.fromString(accountId), Hbar.fromTinybars(-feeTinybars))
        .addHbarTransfer(AccountId.fromString(BACKEND_MINTER_ACCOUNT), Hbar.fromTinybars(feeTinybars));

      const signer = WalletConnectService.getSigner(accountId);
      const acctId = AccountId.fromString(accountId);
      const frozenTx = await transferTx
        .setTransactionId(TransactionId.generate(acctId))
        .freezeWith(getHederaClient());

      this.statusMessage = 'Waiting for wallet approval to transfer fees...';
      this.refresh();

      await frozenTx.executeWithSigner(signer);

      this.statusMessage = 'Fee transferred! Sending to backend for minting...';
      this.refresh();

      // Step 3: Start async minting job
      this.statusMessage = 'Starting minting job...';
      this.refresh();
      this.clearMintPolling();

      const startRes = await fetch(`${API_BASE_URL}/api/mint-nfts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tokenId: this.tokenInfo.tokenId,
          supplyKey: this.supplyKeyInput.trim(),
          metadataCIDs,
          userAccountId: accountId,
        }),
      });

      const startText = await startRes.text();
      let startData: any;
      try {
        startData = JSON.parse(startText);
      } catch {
        throw new Error(`Server returned ${startRes.status}: ${startText || 'empty response'}`);
      }

      if (!startData.success) {
        throw new Error(startData.error || 'Backend minting failed');
      }

      this.mintJobId = startData.jobId;
      this.totalBatches = startData.totalBatches || Math.ceil(metadataCIDs.length / this.batchSize);
      this.mintPollFailures = 0;
      this.statusMessage = 'Minting job started. Waiting for first update...';
      this.refresh();

      // Poll immediately, then every 3 seconds
      this.pollMintStatus();
      this.mintPollInterval = window.setInterval(() => this.pollMintStatus(), 3000);
    } catch (err: any) {
      console.error('Minting error:', err);
      this.isMinting = false;
      this.error = err.message || 'Minting failed';
      this.statusMessage = '';
      this.step = 'setup';
      this.clearMintPolling();
      this.refresh();
    }
  }

  private static async pollMintStatus(): Promise<void> {
    if (!this.mintJobId) return;

    try {
      const res = await fetch(`${API_BASE_URL}/api/mint-status/${this.mintJobId}`);
      const data = await res.json();

      if (!data.success) {
        this.mintPollFailures++;
        if (this.mintPollFailures >= this.MAX_MINT_POLL_FAILURES) {
          throw new Error(data.error || 'Lost connection to minting job');
        }
        return;
      }

      this.mintPollFailures = 0;

      const { status, progress, batchResults, errors, error } = data;
      this.currentBatch = progress?.currentBatch || this.currentBatch;
      this.totalBatches = progress?.totalBatches || this.totalBatches;
      this.statusMessage = this.formatMintProgressMessage(status, progress);

      // Update entry statuses and serials from latest job state.
      // batchResults tells us exactly which entry ranges succeeded or failed.
      const entries = this.mode === 'csv' ? this.csvEntries : this.directEntries;
      if (batchResults && batchResults.length > 0) {
        for (const batch of batchResults) {
          const startIdx = batch.batchIndex * this.batchSize;
          const endIdx = Math.min(startIdx + this.batchSize, entries.length);
          for (let i = startIdx; i < endIdx; i++) {
            const entry = entries[i];
            if (!entry) continue;
            if (batch.success) {
              const serial = batch.serials[i - startIdx] ?? 0;
              entry.status = 'minted';
              entry.serial = serial;
              if (!this.mintedSerials.find(s => s.number === entry.number)) {
                this.mintedSerials.push({ number: entry.number, serial });
              }
            } else if (entry.status !== 'minted') {
              entry.status = 'error';
              entry.error = batch.error;
            }
          }
        }
      } else if (status === 'minting') {
        // Fallback for older jobs that don't have batchResults yet:
        // mark all still-pending entries as minting while we wait.
        entries.forEach(e => {
          if (e.status === 'pending') e.status = 'minting';
        });
      }

      this.refresh();

      if (status === 'completed') {
        this.clearMintPolling();
        const entries = this.mode === 'csv' ? this.csvEntries : this.directEntries;
        const mintedCount = entries.filter(e => e.status === 'minted').length;
        this.tokenInfo!.totalSupply += mintedCount;
        this.isMinting = false;
        this.statusMessage = errors?.length
          ? `Minted ${mintedCount} NFTs with ${errors.length} batch error(s).`
          : `Successfully minted ${mintedCount} NFTs!`;
        this.step = 'complete';
        this.refresh();
        return;
      }

      if (status === 'failed') {
        throw new Error(error || 'Minting failed on the server');
      }

    } catch (err: any) {
      if (err.name === 'TypeError' || err.message?.includes('fetch')) {
        this.mintPollFailures++;
        if (this.mintPollFailures < this.MAX_MINT_POLL_FAILURES) {
          this.statusMessage = `Connection hiccup (${this.mintPollFailures}/${this.MAX_MINT_POLL_FAILURES}) — retrying...`;
          this.refresh();
          return;
        }
      }

      this.clearMintPolling();
      this.isMinting = false;
      this.error = err.message || 'Failed to check minting status';
      this.statusMessage = '';
      this.step = 'setup';
      this.refresh();
    }
  }

  private static formatMintProgressMessage(status: string, progress: any): string {
    const current = progress?.currentBatch || 0;
    const total = progress?.totalBatches || this.totalBatches;
    const minted = progress?.minted || 0;
    const totalNfts = progress?.totalNFTs || (this.mode === 'csv' ? this.csvEntries.length : this.directEntries.length);

    switch (status) {
      case 'queued':
        return 'Minting job queued — waiting to start...';
      case 'minting':
        return `Minting batch ${current} / ${total} (${minted} / ${totalNfts} NFTs)...`;
      case 'completed':
        return `Minting complete — ${minted} NFTs minted.`;
      case 'failed':
        return 'Minting failed.';
      default:
        return `Processing... (${status})`;
    }
  }

  private static clearMintPolling(): void {
    if (this.mintPollInterval !== null) {
      clearInterval(this.mintPollInterval);
      this.mintPollInterval = null;
    }
  }

  // ─── DOWNLOAD CSV TEMPLATE ──────────────────────────────────
  private static downloadCsvTemplate(): void {
    const header = 'filename,name,description,creator,Background,Accessory,Eyes';
    const rows = [
      '1.png,My NFT #1,A rare collectible from my collection,ArtistName,Blue,Crown,Laser',
      '2.png,My NFT #2,An uncommon collectible from my collection,ArtistName,Red,None,Normal',
      '3.png,My NFT #3,A legendary collectible from my collection,ArtistName,Gold,Halo,Diamond',
    ];
    const csv = [header, ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'metadata-template.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // ─── DOWNLOAD RESULTS CSV ──────────────────────────────────
  private static downloadResultsCsv(): void {
    const entries = this.mode === 'csv' ? this.csvEntries : this.directEntries;
    const minted = entries.filter(e => e.status === 'minted');
    if (minted.length === 0) return;

    const header = 'NFT Number,Serial Number,Metadata CID,Token URI';
    const rows = minted.map(e => `${e.number},${e.serial || ''},${e.metadataCID},${e.tokenURI}`);
    const csv = [header, ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${this.tokenInfo?.name || 'mint'}-results.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // ─── RESET STATE ───────────────────────────────────────────
  static resetState(): void {
    this.step = 'setup';
    this.mode = 'csv';
    this.tokenIdInput = '';
    this.tokenInfo = null;
    this.tokenValidated = false;
    this.tokenError = null;
    this.supplyKeyInput = '';
    this.supplyKeyRevealed = false;
    this.supplyKeyError = null;
    this.csvEntries = [];
    this.csvFileName = '';
    this.directEntries = [];
    this.uploadedImages.forEach(img => URL.revokeObjectURL(img.preview));
    this.uploadedImages = [];
    this.sharedDescription = '';
    this.sharedCreator = '';
    this.sharedAttributes = [];
    this.isPinning = false;
    this.pinProgress = 0;
    this.mintCopies = 1;
    this.directCsvFile = null;
    this.directCsvFileName = '';
    this.directCsvMatched = false;
    this.directCsvError = null;
    this.directStartNumber = 0;
    this.csvOffset = 0;
    this.batchSize = 10;
    this.currentBatch = 0;
    this.totalBatches = 0;
    this.mintedSerials = [];
    this.mintErrors = [];
    this.isMinting = false;
    this.loading = false;
    this.error = null;
    this.statusMessage = '';
    this.mintJobId = null;
    this.mintPollFailures = 0;
    this.clearMintPolling();
  }

  // ─── ESCAPE HTML ───────────────────────────────────────────
  private static escapeHtml(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
}
