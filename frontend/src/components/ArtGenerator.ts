/**
 * Art Generator Component
 */
import { API_BASE_URL } from '../config'

interface LayerInfo { name: string; traits: { name: string; filename: string; extension: string }[]; }
interface TraitWeight { traitCategory: string; traitValue: string; weight: number; }
interface ExclusionRule { trait1: { category: string; value: string }; trait2: { category: string; value: string }; }
interface ForcedPairing { ifTrait: { category: string; value: string }; thenTrait: { category: string; value: string }; }
interface PreviewItem { id: number; image: string; metadata: any; }
type ArtGenStep = 'upload' | 'configure' | 'preview' | 'generate' | 'complete';

export class ArtGenerator {
  private static step: ArtGenStep = 'upload';
  private static sessionId: string | null = null;
  private static layers: LayerInfo[] = [];
  private static collectionName = '';
  private static collectionDescription = '';
  private static collectionSize = 100;

  private static weights: TraitWeight[] = [];
  private static exclusionRules: ExclusionRule[] = [];
  private static forcedPairings: ForcedPairing[] = [];
  private static previews: PreviewItem[] = [];
  private static previewCount = 0;
  private static previewsRemaining = 5;
  private static loading = false;
  private static error: string | null = null;
  private static statusMessage = '';
  private static activeRulesTab: 'exclusions' | 'pairings' = 'exclusions';
  private static nftResults: Array<{ number: number; imageCID: string; metadataCID: string; tokenURI: string }> = [];
  private static tokenURIs: string[] = [];
  private static generationStats: any = null;

  static render(): string {
    return `<div class="terminal-window">${this.renderChrome()}${this.renderContent()}${this.renderStatusBar()}</div>`;
  }

  private static renderChrome(): string {
    return `<div class="window-chrome"><div class="window-controls"><div class="window-dot close"></div><div class="window-dot minimize"></div><div class="window-dot maximize"></div></div><div class="window-title">hedera-creator-kit — art generator</div></div>`;
  }

  private static renderStatusBar(): string {
    const labels: Record<ArtGenStep, string> = { upload: 'Step 1/5: Upload', configure: 'Step 2/5: Configure', preview: 'Step 3/5: Preview', generate: 'Step 4/5: Generate', complete: 'Step 5/5: Complete' };
    return `<div class="status-bar"><div class="status-left"><div class="status-item"><div class="status-indicator"></div><span>${labels[this.step]}</span></div></div><div class="status-center"><span class="status-highlight">${this.statusMessage}</span></div><div class="status-right"><div class="status-item"><span>Layers: <span class="status-value">${this.layers.length}</span></span></div></div></div>`;
  }

  private static renderContent(): string {
    return `<div class="terminal-content"><div class="art-gen-layout"><div class="art-gen-left">${this.renderLeftPanel()}</div><div class="art-gen-right">${this.renderRightPanel()}</div></div></div>`;
  }

  private static renderLeftPanel(): string {
    switch (this.step) {
      case 'upload': return this.renderUploadStep();
      case 'configure': return this.renderConfigureStep();
      case 'preview': return this.renderPreviewControls();
      case 'generate': return this.renderGenerateControls();
      case 'complete': return this.renderCompleteInfo();
      default: return '';
    }
  }

  private static renderRightPanel(): string {
    if (this.loading) return `<div class="loading-state"><div class="spinner"></div><p>${this.statusMessage || 'Processing...'}</p></div>`;
    if (this.error) return `<div class="error-state"><p class="error-message">⚠ ${this.error}</p></div>`;
    switch (this.step) {
      case 'upload': return '<div class="empty-state"><p>Upload a ZIP file containing your trait folders to get started</p></div>';
      case 'configure': return this.renderLayerList();
      case 'preview': return this.renderPreviewGrid();
      case 'generate': return this.renderGenerateProgress();
      case 'complete': return this.renderCompleteResults();
      default: return '';
    }
  }

  private static renderUploadStep(): string {
    return `
      <div class="art-gen-section">
        <h3 class="section-title">◆ Art Generator</h3>

        <div class="back-link" id="art-gen-back">
          <span class="back-arrow">←</span>
          <span>Back</span>
        </div>
        <p class="section-desc">Upload a ZIP file containing your trait layer folders. Each folder = a layer, images inside = trait variations.</p>
        <div class="upload-zone" id="upload-zone">
          <div class="upload-icon">📁</div>
          <p class="upload-text">Drop ZIP file here or click to browse</p>
          <p class="upload-hint">Max 500MB • PNG/JPG/WEBP images</p>
          <input type="file" id="zip-file-input" accept=".zip" style="display:none" />
        </div>
        <div class="upload-format-info">
          <h4>Expected ZIP Structure:</h4>
          <pre class="format-example">my-collection.zip
├── Background/
│   ├── blue.png
│   └── red.png
├── Body/
│   ├── human.png
│   └── alien.png
└── Eyes/
    ├── normal.png
    └── laser.png</pre>
        </div>
      </div>`;
  }

  private static renderConfigureStep(): string {
    return `
      <div class="art-gen-section">
        <h3 class="section-title">◆ Collection Config</h3>

        <div class="back-link" id="art-gen-back-to-upload">
          <span class="back-arrow">←</span>
          <span>Re-upload</span>
        </div>

        <div class="input-group">
          <label for="collection-name">Collection Name</label>
          <input type="text" id="collection-name" class="token-input" placeholder="My NFT Collection" value="${this.collectionName}" />
        </div>
        <div class="input-group">
          <label for="collection-desc">Description</label>
          <input type="text" id="collection-desc" class="token-input" placeholder="A unique NFT collection on Hedera" value="${this.collectionDescription}" />
        </div>
        <div class="input-row">
          <div class="input-group"><label for="collection-size">Collection Size</label><input type="number" id="collection-size" class="token-input" min="1" max="10000" value="${this.collectionSize}" /></div>
        </div>

        <div class="filter-divider"></div>
        <h4 class="subsection-title">Trait Distribution</h4>
        <p class="section-desc">Set how many of each trait to include. Each layer's total should equal the collection size (${this.collectionSize}).</p>
        <div id="rarity-weights-container">${this.renderRarityWeights()}</div>

        <div class="filter-divider"></div>
        <h4 class="subsection-title">Rules</h4>
        <div class="rules-section">
          <div class="rules-tabs">
            <button class="rules-tab ${this.activeRulesTab === 'exclusions' ? 'active' : ''}" data-tab="exclusions">Exclusions</button>
            <button class="rules-tab ${this.activeRulesTab === 'pairings' ? 'active' : ''}" data-tab="pairings">Forced Pairings</button>
          </div>
          <div class="rules-content" id="rules-content">
            ${this.activeRulesTab === 'exclusions' ? this.renderExclusionRules() : this.renderForcedPairings()}
          </div>
        </div>
        <button id="preview-btn" class="terminal-button"><span>GENERATE PREVIEW →</span></button>
      </div>`;
  }
  private static renderLayerList(): string {
    if (this.layers.length === 0) return '<div class="empty-state"><p>No layers loaded</p></div>';
    // Render in reverse so top layer (highest index) appears at top of list
    const reversed = [...this.layers].reverse();
    return `
      <div class="layer-list-panel">
        <h4 class="subsection-title">Layer Order <span class="dim">(drag to reorder)</span></h4>
        <p class="section-desc">Top layer first → Base layer last</p>
        <div class="layer-list" id="layer-list">
          ${reversed.map((layer) => {
            const i = this.layers.indexOf(layer);
            return `
            <div class="layer-item" draggable="true" data-index="${i}">
              <span class="layer-drag-handle">⠿</span>
              <span class="layer-name">${layer.name}</span>
              <span class="layer-trait-count">${layer.traits.length} traits</span>
              <div class="layer-arrows">
                <button class="layer-move-btn" data-dir="up" data-index="${i}" ${i === this.layers.length - 1 ? 'disabled' : ''}>▲</button>
                <button class="layer-move-btn" data-dir="down" data-index="${i}" ${i === 0 ? 'disabled' : ''}>▼</button>
              </div>
            </div>`;
          }).join('')}
        </div>
      </div>`;
  }

  private static renderRarityWeights(): string {
    if (this.layers.length === 0) return '<p class="dim">Upload layers first</p>';
    return this.layers.map(layer => {
      const layerTotal = this.getLayerTotal(layer.name);
      const isOff = layerTotal !== this.collectionSize;
      const warningHtml = isOff
        ? `<div class="terminal-line terminal-warning" style="margin-top:0.5rem;font-size:0.8rem;">⚠ Layer total is ${layerTotal} — should be ${this.collectionSize}</div>`
        : '';
      const traitsHtml = layer.traits.map(trait => {
        const existing = this.weights.find(w => w.traitCategory === layer.name && w.traitValue === trait.name);
        const count = existing ? existing.weight : 0;
        return `<div class="weight-row"><span class="weight-trait-name">${trait.name}</span><input type="number" class="weight-input" data-category="${layer.name}" data-trait="${trait.name}" min="0" step="1" value="${count}" /></div>`;
      }).join('');
      const totalClass = isOff ? 'terminal-warning' : 'dim';
      return `<details class="weight-layer-group"><summary>${layer.name} <span class="${totalClass}">(${layerTotal}/${this.collectionSize})</span></summary><div class="weight-traits">${traitsHtml}${warningHtml}</div></details>`;
    }).join('');
  }

  private static renderExclusionRules(): string {
    const options = this.layers.map(l => l.traits.map(t => ({ category: l.name, value: t.name }))).flat();
    const optionsHtml = options.map(o => `<option value="${o.category}::${o.value}">${o.category} → ${o.value}</option>`).join('');
    const rulesHtml = this.exclusionRules.map((rule, i) => `
      <div class="rule-row">
        <span class="rule-text">${rule.trait1.category}/${rule.trait1.value} ✕ ${rule.trait2.category}/${rule.trait2.value}</span>
        <button class="rule-remove-btn" data-type="exclusion" data-index="${i}">✕</button>
      </div>
    `).join('');
    return `
      <div class="rules-builder">
        <div class="rule-add-row">
          <select id="excl-trait1" class="rule-select"><option value="">Trait 1...</option>${optionsHtml}</select>
          <span class="rule-separator">✕</span>
          <select id="excl-trait2" class="rule-select"><option value="">Trait 2...</option>${optionsHtml}</select>
          <button id="add-exclusion-btn" class="rule-add-btn">+ Add</button>
        </div>
        <div class="rule-list">${rulesHtml || '<p class="dim">No exclusion rules yet</p>'}</div>
      </div>`;
  }

  private static renderForcedPairings(): string {
    const options = this.layers.map(l => l.traits.map(t => ({ category: l.name, value: t.name }))).flat();
    const optionsHtml = options.map(o => `<option value="${o.category}::${o.value}">${o.category} → ${o.value}</option>`).join('');
    const pairingsHtml = this.forcedPairings.map((p, i) => `
      <div class="rule-row">
        <span class="rule-text">IF ${p.ifTrait.category}/${p.ifTrait.value} → THEN ${p.thenTrait.category}/${p.thenTrait.value}</span>
        <button class="rule-remove-btn" data-type="pairing" data-index="${i}">✕</button>
      </div>
    `).join('');
    return `
      <div class="rules-builder">
        <div class="rule-add-row">
          <select id="pair-if" class="rule-select"><option value="">IF trait...</option>${optionsHtml}</select>
          <span class="rule-separator">→</span>
          <select id="pair-then" class="rule-select"><option value="">THEN trait...</option>${optionsHtml}</select>
          <button id="add-pairing-btn" class="rule-add-btn">+ Add</button>
        </div>
        <div class="rule-list">${pairingsHtml || '<p class="dim">No forced pairings yet</p>'}</div>
      </div>`;
  }
  private static renderPreviewControls(): string {
    return `
      <div class="art-gen-section">
        <h3 class="section-title">◆ Preview</h3>

        <div class="back-link" id="art-gen-back-to-config">
          <span class="back-arrow">←</span>
          <span>Back to Config</span>
        </div>
        <p class="section-desc">Review generated samples to verify your rules and rarity settings.</p>
        <div class="preview-info">
          <div class="info-row"><span>Collection:</span><span class="status-value">${this.collectionName || 'Untitled'}</span></div>
          <div class="info-row"><span>Size:</span><span class="status-value">${this.collectionSize}</span></div>
          <div class="info-row"><span>Previews used:</span><span class="status-value">${this.previewCount}/5</span></div>
          <div class="info-row"><span>Remaining:</span><span class="status-value">${this.previewsRemaining}</span></div>
        </div>
        <button id="regenerate-preview-btn" class="terminal-button" ${this.previewsRemaining <= 0 ? 'disabled' : ''}><span>REGENERATE PREVIEW (${this.previewsRemaining} left)</span></button>
        <button id="approve-generate-btn" class="terminal-button" style="margin-top:0.5rem"><span>APPROVE & GENERATE FULL COLLECTION →</span></button>
      </div>`;
  }

  private static renderPreviewGrid(): string {
    if (this.previews.length === 0) return '<div class="empty-state"><p>Generating preview...</p></div>';
    return `
      <div class="preview-grid-panel">
        <h4 class="subsection-title">Preview (${this.previews.length} samples)</h4>
        <div class="preview-grid">
          ${this.previews.map(p => `
            <div class="preview-card">
              <img src="${p.image}" alt="NFT #${p.id}" class="preview-img" />
              <div class="preview-card-info">#${p.id}</div>
            </div>
          `).join('')}
        </div>
      </div>`;
  }

  private static renderGenerateControls(): string {
    return `
      <div class="art-gen-section">
        <h3 class="section-title">◆ Generating Collection</h3>
        <p class="section-desc">Your full collection is being generated and pinned to IPFS via Pinata. This may take a while for large collections.</p>
        <div class="preview-info">
          <div class="info-row"><span>Collection:</span><span class="status-value">${this.collectionName}</span></div>
          <div class="info-row"><span>Size:</span><span class="status-value">${this.collectionSize} NFTs</span></div>

        </div>
      </div>`;
  }

  private static renderGenerateProgress(): string {
    return `<div class="loading-state"><div class="spinner"></div><p>Generating ${this.collectionSize} NFTs and uploading to IPFS...</p><p class="dim">This may take several minutes</p></div>`;
  }

  private static renderCompleteInfo(): string {
    return `
      <div class="art-gen-section">
        <h3 class="section-title">◆ Generation Complete ✓</h3>
        <p class="section-desc">Your NFT collection has been generated and pinned to IPFS.</p>
        <div class="preview-info">
          <div class="info-row"><span>Collection:</span><span class="status-value">${this.collectionName}</span></div>
          <div class="info-row"><span>Total NFTs:</span><span class="status-value">${this.generationStats?.successful || this.collectionSize}</span></div>
          ${this.generationStats ? `<div class="info-row"><span>Duration:</span><span class="status-value">${this.generationStats.duration}</span></div>` : ''}
        </div>
        <button id="art-gen-new" class="terminal-button" style="margin-top:1rem"><span>START NEW COLLECTION</span></button>
        <div class="back-link" id="art-gen-home" style="margin-top:1rem"><span class="back-arrow">←</span><span>Back to Home</span></div>
      </div>`;
  }

  private static renderCompleteResults(): string {
    return `
      <div class="complete-results-panel">
        <h4 class="subsection-title">IPFS Results</h4>
        <div class="result-block">
          <label>NFTs Pinned Individually: ${this.nftResults.length}</label>
          <p class="dim" style="margin:0.25rem 0 0">Each image and metadata file has its own unique CID on IPFS.</p>
        </div>
        <div class="result-block">
          <label>Token URIs (${this.tokenURIs.length})</label>
          <code class="cid-value">${this.tokenURIs[0] || ''}</code>
          ${this.tokenURIs.length > 1 ? `<p class="dim" style="margin:0.25rem 0 0">…and ${this.tokenURIs.length - 1} more</p>` : ''}
          <button id="download-uris-csv" class="terminal-button secondary" style="margin-top:0.75rem"><span>⬇ DOWNLOAD TOKEN URIs CSV</span></button>
        </div>
      </div>`;
  }
  static init(): void {
    this.attachEventListeners();
  }

  private static refresh(): void {
    const app = document.querySelector<HTMLDivElement>('#app')!;
    app.innerHTML = this.render();
    this.init();
  }

  private static refreshRulesContent(): void {
    // Update tabs active state
    document.querySelectorAll('.rules-tab').forEach(tab => {
      const t = tab as HTMLElement;
      t.classList.toggle('active', t.dataset.tab === this.activeRulesTab);
    });
    // Re-render just the rules content area
    const content = document.getElementById('rules-content');
    if (content) {
      content.innerHTML = this.activeRulesTab === 'exclusions'
        ? this.renderExclusionRules()
        : this.renderForcedPairings();
    }
    this.attachRuleRemoveListeners();
    this.attachRuleAddListeners();
  }

  private static attachRuleRemoveListeners(): void {
    document.querySelectorAll('.rule-remove-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const el = e.target as HTMLElement;
        const type = el.dataset.type;
        const idx = parseInt(el.dataset.index!);
        if (type === 'exclusion') this.exclusionRules.splice(idx, 1);
        else this.forcedPairings.splice(idx, 1);
        this.refreshRulesContent();
      });
    });
  }

  private static attachRuleAddListeners(): void {
    document.getElementById('add-exclusion-btn')?.addEventListener('click', () => {
      const s1 = (document.getElementById('excl-trait1') as HTMLSelectElement)?.value;
      const s2 = (document.getElementById('excl-trait2') as HTMLSelectElement)?.value;
      if (s1 && s2 && s1 !== s2) {
        const [c1, v1] = s1.split('::'); const [c2, v2] = s2.split('::');
        this.exclusionRules.push({ trait1: { category: c1, value: v1 }, trait2: { category: c2, value: v2 } });
        this.refreshRulesContent();
      }
    });
    document.getElementById('add-pairing-btn')?.addEventListener('click', () => {
      const s1 = (document.getElementById('pair-if') as HTMLSelectElement)?.value;
      const s2 = (document.getElementById('pair-then') as HTMLSelectElement)?.value;
      if (s1 && s2) {
        const [c1, v1] = s1.split('::'); const [c2, v2] = s2.split('::');
        this.forcedPairings.push({ ifTrait: { category: c1, value: v1 }, thenTrait: { category: c2, value: v2 } });
        this.refreshRulesContent();
      }
    });
  }

  private static attachEventListeners(): void {
    // Back buttons
    document.getElementById('art-gen-back')?.addEventListener('click', () => window.location.reload());
    document.getElementById('art-gen-back-to-upload')?.addEventListener('click', () => { this.step = 'upload'; this.sessionId = null; this.layers = []; this.refresh(); });
    document.getElementById('art-gen-back-to-config')?.addEventListener('click', () => { this.step = 'configure'; this.refresh(); });
    document.getElementById('art-gen-home')?.addEventListener('click', () => window.location.reload());
    document.getElementById('art-gen-new')?.addEventListener('click', () => { this.resetState(); this.refresh(); });

    // Upload zone
    const uploadZone = document.getElementById('upload-zone');
    const fileInput = document.getElementById('zip-file-input') as HTMLInputElement;
    uploadZone?.addEventListener('click', () => fileInput?.click());
    uploadZone?.addEventListener('dragover', (e) => { e.preventDefault(); uploadZone.classList.add('drag-over'); });
    uploadZone?.addEventListener('dragleave', () => uploadZone.classList.remove('drag-over'));
    uploadZone?.addEventListener('drop', (e) => { e.preventDefault(); uploadZone.classList.remove('drag-over'); if ((e as DragEvent).dataTransfer?.files[0]) this.uploadZip((e as DragEvent).dataTransfer!.files[0]); });
    fileInput?.addEventListener('change', () => { if (fileInput.files?.[0]) this.uploadZip(fileInput.files[0]); });

    // Config inputs - save values on change
    document.getElementById('collection-name')?.addEventListener('input', (e) => { this.collectionName = (e.target as HTMLInputElement).value; });
    document.getElementById('collection-desc')?.addEventListener('input', (e) => { this.collectionDescription = (e.target as HTMLInputElement).value; });
    document.getElementById('collection-size')?.addEventListener('input', (e) => {
      this.collectionSize = parseInt((e.target as HTMLInputElement).value) || 100;
      // Remember which details are open
      const openLayers = new Set<string>();
      document.querySelectorAll('.weight-layer-group[open]').forEach(d => {
        const summary = d.querySelector('summary');
        if (summary) openLayers.add(summary.textContent?.split('(')[0].trim() || '');
      });
      this.autoDistributeCounts();
      const container = document.getElementById('rarity-weights-container');
      if (container) container.innerHTML = this.renderRarityWeights();
      // Restore open state
      document.querySelectorAll('.weight-layer-group').forEach(d => {
        const summary = d.querySelector('summary');
        const name = summary?.textContent?.split('(')[0].trim() || '';
        if (openLayers.has(name)) (d as HTMLDetailsElement).open = true;
      });
      this.attachWeightListeners();
      // Update the description text
      const descEl = document.querySelector('.section-desc');
      if (descEl) descEl.textContent = `Set how many of each trait to include. Each layer's total should equal the collection size (${this.collectionSize}).`;
    });
    // Weight inputs
    this.attachWeightListeners();

    // Rules tabs
    document.querySelectorAll('.rules-tab').forEach(tab => {
      tab.addEventListener('click', (e) => {
        this.activeRulesTab = (e.target as HTMLElement).dataset.tab as any;
        this.refreshRulesContent();
      });
    });

    // Rules add/remove listeners
    this.attachRuleAddListeners();
    this.attachRuleRemoveListeners();

    // Layer reorder buttons (visual is reversed: ▲ = higher z-index = higher array index, ▼ = lower)
    document.querySelectorAll('.layer-move-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const el = e.target as HTMLElement;
        const idx = parseInt(el.dataset.index!);
        const dir = el.dataset.dir;
        if (dir === 'up' && idx < this.layers.length - 1) { [this.layers[idx], this.layers[idx + 1]] = [this.layers[idx + 1], this.layers[idx]]; this.refresh(); }
        if (dir === 'down' && idx > 0) { [this.layers[idx - 1], this.layers[idx]] = [this.layers[idx], this.layers[idx - 1]]; this.refresh(); }
      });
    });

    // Preview & Generate buttons
    document.getElementById('preview-btn')?.addEventListener('click', () => this.generatePreview());
    document.getElementById('regenerate-preview-btn')?.addEventListener('click', () => this.generatePreview());
    document.getElementById('approve-generate-btn')?.addEventListener('click', () => this.generateFull());

    // Copy buttons
    document.querySelectorAll('.copy-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const val = (e.target as HTMLElement).dataset.copy;
        if (val) { navigator.clipboard.writeText(val); (e.target as HTMLElement).textContent = 'COPIED'; setTimeout(() => { (e.target as HTMLElement).textContent = 'COPY'; }, 1500); }
      });
    });

    // Download token URIs CSV
    document.getElementById('download-uris-csv')?.addEventListener('click', () => this.downloadTokenURIsCSV());
  }

  private static attachWeightListeners(): void {
    document.querySelectorAll('.weight-input').forEach(input => {
      input.addEventListener('change', (e) => {
        const el = e.target as HTMLInputElement;
        const category = el.dataset.category!;
        const trait = el.dataset.trait!;
        const count = Math.max(0, parseInt(el.value) || 0);
        el.value = String(count);
        const idx = this.weights.findIndex(w => w.traitCategory === category && w.traitValue === trait);
        if (idx >= 0) this.weights[idx].weight = count;
        else this.weights.push({ traitCategory: category, traitValue: trait, weight: count });
        // Remember which details are open before re-render
        const openLayers = new Set<string>();
        document.querySelectorAll('.weight-layer-group[open]').forEach(d => {
          const summary = d.querySelector('summary');
          if (summary) openLayers.add(summary.textContent?.split('(')[0].trim() || '');
        });
        // Re-render just the weights container to update totals/warnings
        const container = document.getElementById('rarity-weights-container');
        if (container) container.innerHTML = this.renderRarityWeights();
        // Restore open state
        document.querySelectorAll('.weight-layer-group').forEach(d => {
          const summary = d.querySelector('summary');
          const name = summary?.textContent?.split('(')[0].trim() || '';
          if (openLayers.has(name)) (d as HTMLDetailsElement).open = true;
        });
        this.attachWeightListeners();
      });
    });
  }

  private static autoDistributeCounts(): void {
    this.weights = [];
    for (const layer of this.layers) {
      const traitCount = layer.traits.length;
      if (traitCount === 0) continue;
      const base = Math.floor(this.collectionSize / traitCount);
      let remainder = this.collectionSize - (base * traitCount);
      for (const trait of layer.traits) {
        const count = base + (remainder > 0 ? 1 : 0);
        if (remainder > 0) remainder--;
        this.weights.push({ traitCategory: layer.name, traitValue: trait.name, weight: count });
      }
    }
  }

  private static getLayerTotal(layerName: string): number {
    return this.weights
      .filter(w => w.traitCategory === layerName)
      .reduce((sum, w) => sum + w.weight, 0);
  }

  private static async uploadZip(file: File): Promise<void> {
    this.loading = true;
    this.error = null;
    this.statusMessage = 'Uploading and extracting layers...';
    this.refresh();

    try {
      const formData = new FormData();
      formData.append('zipFile', file);

      const response = await fetch(`${API_BASE_URL}/api/upload-layers`, {
        method: 'POST',
        body: formData
      });

      const data = await response.json();
      if (!data.success) throw new Error(data.error || 'Upload failed');

      this.sessionId = data.sessionId;
      this.layers = data.layers;
      this.step = 'configure';
      this.statusMessage = `Loaded ${data.totalLayers} layers with ${data.totalTraits} traits`;
      this.loading = false;
      // Auto-fill even distribution of counts per layer
      this.autoDistributeCounts();
      this.refresh();
    } catch (err: any) {
      this.loading = false;
      this.error = err.message || 'Failed to upload ZIP';
      this.statusMessage = '';
      this.refresh();
    }
  }

  private static async generatePreview(): Promise<void> {
    if (!this.sessionId) { this.error = 'No session. Please upload a ZIP first.'; this.refresh(); return; }
    this.loading = true;
    this.error = null;
    this.statusMessage = 'Generating preview images...';
    this.step = 'preview';
    this.refresh();

    try {
      const config = {
        collectionName: this.collectionName || 'Untitled',
        collectionDescription: this.collectionDescription,
        collectionSize: this.collectionSize,
        traitOrder: this.layers.map(l => l.name),
        rarity: {
          weights: this.weights.length > 0 ? this.weights : undefined,
          exclusionRules: this.exclusionRules.length > 0 ? this.exclusionRules : undefined,
          forcedPairings: this.forcedPairings.length > 0 ? this.forcedPairings : undefined
        }
      };

      const response = await fetch(`${API_BASE_URL}/api/preview-session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: this.sessionId, config })
      });

      const data = await response.json();
      if (!data.success) throw new Error(data.error || 'Preview failed');

      this.previews = data.previews;
      this.previewCount = data.previewCount;
      this.previewsRemaining = data.previewsRemaining;
      this.loading = false;
      this.statusMessage = `Preview batch ${this.previewCount}/5 — ${data.previews.length} samples`;
      this.refresh();
    } catch (err: any) {
      this.loading = false;
      this.error = err.message || 'Failed to generate preview';
      this.statusMessage = '';
      this.refresh();
    }
  }

  private static async generateFull(): Promise<void> {
    if (!this.sessionId) { this.error = 'No session. Please upload a ZIP first.'; this.refresh(); return; }
    this.loading = true;
    this.error = null;
    this.step = 'generate';
    this.statusMessage = `Generating ${this.collectionSize} NFTs and uploading to IPFS...`;
    this.refresh();

    try {
      const config = {
        collectionName: this.collectionName || 'Untitled',
        collectionDescription: this.collectionDescription,
        collectionSize: this.collectionSize,
        traitOrder: this.layers.map(l => l.name),
        rarity: {
          weights: this.weights.length > 0 ? this.weights : undefined,
          exclusionRules: this.exclusionRules.length > 0 ? this.exclusionRules : undefined,
          forcedPairings: this.forcedPairings.length > 0 ? this.forcedPairings : undefined
        }
      };

      const response = await fetch(`${API_BASE_URL}/api/generate-session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: this.sessionId, config })
      });

      const data = await response.json();
      if (!data.success) throw new Error(data.error || 'Generation failed');

      this.nftResults = data.nfts || [];
      this.tokenURIs = data.token_uris || [];
      this.generationStats = data.generation_stats;
      this.step = 'complete';
      this.loading = false;
      this.statusMessage = 'Collection generated and pinned to IPFS!';
      this.refresh();
    } catch (err: any) {
      this.loading = false;
      this.error = err.message || 'Failed to generate collection';
      this.statusMessage = '';
      this.refresh();
    }
  }

  private static downloadTokenURIsCSV(): void {
    const header = 'Token Number,Image CID,Metadata CID,Token URI';
    const rows = this.nftResults.map(nft => `${nft.number},${nft.imageCID},${nft.metadataCID},${nft.tokenURI}`);
    const csv = [header, ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${this.collectionName || 'collection'}-token-uris.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  static resetState(): void {
    this.step = 'upload';
    this.sessionId = null;
    this.layers = [];
    this.collectionName = '';
    this.collectionDescription = '';
    this.collectionSize = 100;

    this.weights = [];
    this.exclusionRules = [];
    this.forcedPairings = [];
    this.previews = [];
    this.previewCount = 0;
    this.previewsRemaining = 5;
    this.loading = false;
    this.error = null;
    this.statusMessage = '';
    this.activeRulesTab = 'exclusions';
    this.nftResults = [];
    this.tokenURIs = [];
    this.generationStats = null;
  }
}