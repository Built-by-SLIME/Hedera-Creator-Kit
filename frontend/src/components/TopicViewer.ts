/**
 * Topic Viewer Component (Tool #16)
 * Enter any HCS topic ID: inspect the message stream, reassemble + hash-verify
 * HCS-1 inscription files, and browse HCS-6 registry versions.
 * Media renders through the shared safety layer: SVG is <img>-only, HTML is
 * plain-text source, nothing inscribed is ever executed.
 */
import { API_BASE_URL } from '../config'
import { planMedia, bytesToText, base64ToBytes, revokeMedia, type SafeMedia } from '../services/mediaSafety'

interface TopicInfo {
  topicId: string
  memo: string
  running: boolean
  sequenceEnd: number
  kind: 'hcs1-file' | 'hcs6-registry' | 'raw'
  compression?: string
  sha256?: string
}

interface TopicMessage {
  sequence: number
  consensusTimestamp: string
  size: number
  kind: 'text' | 'json' | 'hcs1-chunk' | 'hcs6-register'
  preview: string
  parsed?: { t_id?: string; m?: string }
}

interface FileView {
  topicId: string
  mime: string
  sha256: string
  size: number
  chunks: number
  media: SafeMedia
  textContent?: string
}

export class TopicViewer {
  private static network: 'mainnet' | 'testnet' = 'mainnet'
  private static topicIdInput = ''
  private static info: TopicInfo | null = null
  private static messages: TopicMessage[] = []
  private static truncated = false
  private static loading = false
  private static error: string | null = null

  private static file: FileView | null = null
  private static fileLoading = false
  private static registryEntries: Array<{ sequence: number; t_id: string; m: string }> = []

  static render(): string {
    return `
      <div class="terminal-window">
        <div class="window-chrome">
          <div class="window-dots"><span class="dot red"></span><span class="dot yellow"></span><span class="dot green"></span></div>
          <div class="window-title">SLIME TOOLS</div>
        </div>
        <div class="terminal-content">
          <div class="art-gen-layout">
            <div class="art-gen-left">
              <div class="art-gen-section">
                <div class="back-link" id="topic-back"><span class="back-arrow">←</span><span>Back to Home</span></div>
                <h3 class="section-title">◆ Topic Viewer</h3>
                <p class="cc-hip-badge">⬡ HCS-1 / HCS-6 · read-only mirror explorer</p>
                ${this.renderLookup()}
                ${this.info ? this.renderInfo() : ''}
                ${this.messages.length ? this.renderMessages() : ''}
                ${this.registryEntries.length ? this.renderRegistry() : ''}
                ${this.error ? `<div class="cc-error-banner" style="margin-top:1rem">✗ ${this.escapeHtml(this.error)}</div>` : ''}
              </div>
            </div>
            <div class="art-gen-right" style="padding:1.25rem">
              ${this.renderRightPanel()}
            </div>
          </div>
        </div>
        <div class="status-bar">
          <span class="status-left">⬡ Read-only explorer</span>
          <span class="status-right">Mainnet</span>
        </div>
      </div>
    `
  }

  private static renderLookup(): string {
    return `
      <div class="cc-panel" style="margin-top:1rem">
        <div style="display:flex;gap:0.5rem;flex-wrap:wrap;align-items:center">
          <div style="display:flex;gap:0.25rem">
            <button class="cc-btn cc-btn-secondary tv-net ${this.network === 'mainnet' ? 'tv-net-active' : ''}" data-net="mainnet" type="button">Mainnet</button>
            <button class="cc-btn cc-btn-secondary tv-net ${this.network === 'testnet' ? 'tv-net-active' : ''}" data-net="testnet" type="button">Testnet</button>
          </div>
          <input type="text" id="topic-id-input" class="cc-input mono" placeholder="0.0.XXXXXXX"
            value="${this.escapeHtml(this.topicIdInput)}" style="flex:1;min-width:140px" />
          <button id="topic-load" class="cc-btn" ${this.loading ? 'disabled' : ''}>${this.loading ? 'Loading…' : 'Load'}</button>
        </div>
        <style>
          .tv-net-active { background: var(--terminal-green) !important; color: #000 !important; }
        </style>
      </div>
    `
  }

  private static renderInfo(): string {
    const i = this.info!
    const kindLabel = i.kind === 'hcs1-file' ? 'HCS-1 FILE' : i.kind === 'hcs6-registry' ? 'HCS-6 REGISTRY' : 'RAW TOPIC'
    return `
      <div class="cc-panel" style="margin-top:1rem">
        <div style="display:flex;gap:0.5rem;align-items:center;flex-wrap:wrap">
          <span class="cc-badge" style="background:var(--terminal-green);color:#000;font-size:0.72rem;padding:0.15rem 0.5rem;border-radius:4px;font-weight:700">${kindLabel}</span>
          <span style="font-size:0.78rem;color:var(--terminal-text)">${i.running ? '● running' : '■ stopped'} · ${i.sequenceEnd} messages</span>
        </div>
        ${i.memo ? `<p class="mono" style="font-size:0.72rem;color:var(--terminal-text);word-break:break-all;margin:0.6rem 0 0">memo: ${this.escapeHtml(i.memo)}</p>` : ''}
        ${i.sha256 ? `<p class="mono" style="font-size:0.72rem;color:var(--terminal-text);word-break:break-all;margin:0.25rem 0 0">sha-256: ${i.sha256}</p>` : ''}
        ${i.kind === 'hcs1-file' ? `
          <button id="topic-view-file" class="cc-btn" style="margin-top:0.75rem" ${this.fileLoading ? 'disabled' : ''}>
            ${this.fileLoading ? 'Reassembling…' : '⟳ Reassemble & Verify File'}
          </button>
        ` : ''}
      </div>
    `
  }

  private static renderMessages(): string {
    return `
      <div class="cc-panel" style="margin-top:1rem">
        <h4 style="margin:0 0 0.5rem;color:var(--terminal-green)">Messages</h4>
        ${this.truncated ? `<p style="font-size:0.75rem;color:var(--terminal-yellow);margin:0 0 0.5rem">Showing first 500 messages (topic is larger).</p>` : ''}
        <div style="max-height:420px;overflow-y:auto">
          ${this.messages.map((m) => `
            <div style="border-bottom:1px solid rgba(255,255,255,0.06);padding:0.45rem 0">
              <div style="display:flex;gap:0.5rem;align-items:center">
                <span class="mono" style="color:var(--terminal-green);font-size:0.75rem;min-width:44px">#${m.sequence}</span>
                <span style="font-size:0.72rem;color:var(--terminal-text)">${m.consensusTimestamp}</span>
                <span class="tv-chip tv-chip-${m.kind}">${m.kind}</span>
              </div>
              <pre class="mono" style="white-space:pre-wrap;word-break:break-all;font-size:0.72rem;color:var(--terminal-text);margin:0.25rem 0 0">${this.escapeHtml(m.preview)}</pre>
            </div>
          `).join('')}
        </div>
        <style>
          .tv-chip { font-size:0.62rem; padding:0.1rem 0.4rem; border-radius:3px; font-weight:700; letter-spacing:0.03em }
          .tv-chip-hcs1-chunk { background:#7c3aed33; color:#c4b5fd }
          .tv-chip-hcs6-register { background:#0891b233; color:#67e8f9 }
          .tv-chip-json { background:#6bff9e22; color:var(--terminal-green) }
          .tv-chip-text { background:#ffffff14; color:#cbd5e1 }
        </style>
      </div>
    `
  }

  private static renderRegistry(): string {
    return `
      <div class="cc-panel" style="margin-top:1rem">
        <h4 style="margin:0 0 0.5rem;color:var(--terminal-green)">Registry Versions (latest is current)</h4>
        ${this.registryEntries.map((e, idx) => `
          <div style="display:flex;gap:0.5rem;align-items:center;padding:0.4rem 0;border-bottom:1px solid rgba(255,255,255,0.06)">
            <span style="font-size:0.72rem;color:${idx === 0 ? 'var(--terminal-green)' : 'var(--terminal-text)'};font-weight:${idx === 0 ? '700' : '400'}">
              ${idx === 0 ? '● current' : '○ v' + (this.registryEntries.length - idx)}
            </span>
            <span class="mono" style="font-size:0.75rem;color:var(--terminal-text)">${e.t_id}</span>
            ${e.m ? `<span style="font-size:0.72rem;color:var(--terminal-text)">— ${this.escapeHtml(e.m)}</span>` : ''}
            <button class="cc-btn cc-btn-secondary tv-reg-load" data-topic="${e.t_id}" type="button" style="margin-left:auto;font-size:0.7rem;padding:0.2rem 0.5rem">View</button>
          </div>
        `).join('')}
      </div>
    `
  }

  private static renderRightPanel(): string {
    if (this.fileLoading) {
      return `<h4 style="color:var(--terminal-green);margin:0 0 0.75rem">File</h4>
        <p style="font-size:0.82rem;color:var(--terminal-text)">Reading chunks from the mirror node, decompressing, verifying the SHA-256 against the topic memo…</p>`
    }
    if (this.file) {
      const f = this.file
      const dlName = `${f.topicId.replace(/\./g, '-')}.${f.media.extension}`
      const download = `<a class="cc-btn cc-btn-secondary" style="display:inline-block;margin-top:0.6rem;text-decoration:none"
        href="${f.media.url}" download="${dlName}">⬇ Download .${f.media.extension}</a>`
      let body = ''
      switch (f.media.renderAs) {
        case 'img':
          body = `<img src="${f.media.url}" alt="inscribed media" style="max-width:100%;border-radius:6px" />`
          break
        case 'video':
          body = `<video src="${f.media.url}" controls style="max-width:100%;border-radius:6px"></video>`
          break
        case 'audio':
          body = `<audio src="${f.media.url}" controls style="width:100%"></audio>`
          break
        case 'text':
          body = `<pre class="mono" style="white-space:pre-wrap;word-break:break-word;max-height:420px;overflow-y:auto;font-size:0.75rem;background:rgba(0,0,0,0.3);padding:0.75rem;border-radius:6px">${this.escapeHtml(f.textContent || '')}</pre>`
          break
        default:
          body = `<p style="font-size:0.82rem;color:var(--terminal-text)">Binary file — download to inspect.</p>`
      }
      return `
        <h4 style="color:var(--terminal-green);margin:0 0 0.75rem">Verified File</h4>
        ${body}
        ${f.media.note ? `<p style="font-size:0.72rem;color:var(--terminal-yellow);margin:0.5rem 0 0">${this.escapeHtml(f.media.note)}</p>` : ''}
        <p class="mono" style="font-size:0.7rem;color:var(--terminal-text);word-break:break-all;margin:0.6rem 0 0">${f.mime} · ${this.fmtBytes(f.size)} · ${f.chunks} chunks</p>
        <p class="mono" style="font-size:0.7rem;color:var(--terminal-text);word-break:break-all;margin:0.25rem 0 0">sha-256: ${f.sha256}</p>
        ${download}
      `
    }
    return `
      <h4 style="color:var(--terminal-green);margin:0 0 0.75rem">Topic Viewer</h4>
      <p style="font-size:0.8rem;color:var(--terminal-text);margin:0 0 0.5rem">
        Load a topic to decode its message stream. HCS-1 inscription topics reassemble
        into their original file — compressed, hash-verified against the topic memo.
      </p>
      <p style="font-size:0.8rem;color:var(--terminal-text);margin:0">
        Safety: SVG renders as a static image only, HTML shows as source text, and no
        inscribed content is ever executed.
      </p>
    `
  }

  // ─── INIT ───────────────────────────────────────────────

  static init(): void {
    document.getElementById('topic-back')?.addEventListener('click', () => { window.location.hash = '' })

    document.querySelectorAll('.tv-net').forEach(btn => {
      btn.addEventListener('click', () => {
        this.network = (btn as HTMLElement).dataset.net as 'mainnet' | 'testnet'
        this.refresh()
      })
    })
    document.getElementById('topic-id-input')?.addEventListener('input', (e) => {
      this.topicIdInput = (e.target as HTMLInputElement).value.trim()
    })
    document.getElementById('topic-load')?.addEventListener('click', () => this.loadTopic())
    document.getElementById('topic-id-input')?.addEventListener('keydown', (e) => {
      if ((e as KeyboardEvent).key === 'Enter') this.loadTopic()
    })
    document.getElementById('topic-view-file')?.addEventListener('click', () => {
      if (this.info) this.loadFile(this.info.topicId)
    })
    document.querySelectorAll('.tv-reg-load').forEach(btn => {
      btn.addEventListener('click', () => {
        const t = (btn as HTMLElement).dataset.topic
        if (t) { this.topicIdInput = t; this.loadTopic() }
      })
    })
  }

  // ─── ACTIONS ────────────────────────────────────────────

  private static async loadTopic(): Promise<void> {
    const topicId = this.topicIdInput.trim()
    if (!topicId) { this.error = 'Enter a topic ID'; this.refresh(); return }
    this.loading = true
    this.error = null
    this.refresh()
    try {
      const [infoRes, msgsRes] = await Promise.all([
        fetch(`${API_BASE_URL}/api/hcs/topic/${topicId}/info?network=${this.network}`),
        fetch(`${API_BASE_URL}/api/hcs/topic/${topicId}/messages?network=${this.network}`),
      ])
      const info = await infoRes.json()
      if (!infoRes.ok || !info.success) throw new Error(info.error || `Mirror returned ${infoRes.status}`)
      const msgs = await msgsRes.json()
      this.clearFile()
      this.info = info
      this.messages = msgs.messages || []
      this.truncated = !!msgs.truncated
      if (info.kind === 'hcs6-registry') {
        this.registryEntries = this.messages
          .filter((m) => m.kind === 'hcs6-register' && m.parsed?.t_id)
          .map((m) => ({ sequence: m.sequence, t_id: m.parsed!.t_id!, m: m.parsed?.m || '' }))
          .reverse() // newest register = current
      } else {
        this.registryEntries = []
      }
      if (info.kind === 'hcs1-file') await this.loadFile(topicId)
    } catch (err: any) {
      this.error = err.message || 'Failed to load topic'
      this.info = null
      this.messages = []
      this.registryEntries = []
    }
    this.loading = false
    this.refresh()
  }

  private static async loadFile(topicId: string): Promise<void> {
    this.fileLoading = true
    this.refresh()
    try {
      const res = await fetch(`${API_BASE_URL}/api/hcs/topic/${topicId}/file?network=${this.network}`)
      const data = await res.json()
      if (!res.ok || !data.success) throw new Error(data.error || 'Reassembly failed')
      this.clearFile()
      const media = planMedia(data.mime, data.base64)
      let textContent: string | undefined
      if (media.renderAs === 'text') textContent = bytesToText(base64ToBytes(data.base64))
      this.file = {
        topicId: data.topicId,
        mime: data.mime,
        sha256: data.sha256,
        size: data.size,
        chunks: data.chunks,
        media,
        textContent,
      }
    } catch (err: any) {
      this.error = err.message || 'Failed to load file'
    }
    this.fileLoading = false
    this.refresh()
  }

  private static clearFile(): void {
    if (this.file) revokeMedia(this.file.media)
    this.file = null
  }

  static resetForm(): void {
    this.clearFile()
    this.network = 'mainnet'
    this.topicIdInput = ''
    this.info = null
    this.messages = []
    this.truncated = false
    this.loading = false
    this.error = null
    this.fileLoading = false
    this.registryEntries = []
  }

  private static refresh(): void {
    const scrollContainer = document.querySelector('.art-gen-left')
    const scrollTop = scrollContainer?.scrollTop ?? 0
    const app = document.querySelector<HTMLDivElement>('#app')!
    app.innerHTML = this.render()
    this.init()
    const newContainer = document.querySelector('.art-gen-left')
    if (newContainer) newContainer.scrollTop = scrollTop
  }

  private static fmtBytes(n: number): string {
    if (n < 1024) return n + ' B'
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB'
    return (n / (1024 * 1024)).toFixed(2) + ' MB'
  }

  private static escapeHtml(str: string): string {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
  }
}
