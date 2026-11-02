/**
 * Topic Viewer Component (Tool #10)
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
  payer?: string | null
  chunk?: string | null
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
          <div class="window-controls">
            <div class="window-dot close"></div>
            <div class="window-dot minimize"></div>
            <div class="window-dot maximize"></div>
          </div>
          <div class="window-title">slime-tools — topic viewer</div>
        </div>
        <div class="terminal-content">
          <div class="art-gen-layout">
            <div class="art-gen-left">
              <div class="art-gen-section">
                <div class="back-link" id="topic-back"><span class="back-arrow">←</span><span>Back to Home</span></div>
                <h3 class="section-title">◆ Topic Viewer</h3>
                <p class="cc-hip-badge">⬡ HCS-1 / HCS-6 · read-only mirror explorer</p>
                ${this.renderLookup()}
                ${this.error ? `<div class="cc-error-banner" style="margin-top:1rem">✗ ${this.escapeHtml(this.error)}</div>` : ''}
              </div>
            </div>
            <div class="art-gen-right" style="padding:1.25rem">
              ${this.renderRightPanel()}
            </div>
          </div>
        </div>
        <div class="status-bar">
          <div class="status-left"><span class="status-item">⬡ Read-only explorer</span></div>
          <div class="status-center"><span class="status-item">Built by SLIME</span></div>
          <div class="status-right">
            <span class="status-item">SLIME TOOLS v1.2</span>
            <span class="status-item">MAINNET</span>
          </div>
        </div>
      </div>
    `
  }

  private static renderLookup(): string {
    return `
      <div class="cc-panel" style="margin-top:1rem">
        <div style="display:flex;gap:0.5rem;flex-wrap:wrap;align-items:center">
          <input type="text" id="topic-id-input" class="cc-input mono" placeholder="0.0.XXXXXXX"
            value="${this.escapeHtml(this.topicIdInput)}" style="flex:1;min-width:140px" />
          <button id="topic-load" class="cc-btn" ${this.loading ? 'disabled' : ''}>${this.loading ? 'Loading…' : 'Load'}</button>
        </div>
      </div>
    `
  }

  private static renderInfo(): string {
    const i = this.info!
    const kindLabel = i.kind === 'hcs1-file' ? 'HCS-1 FILE' : i.kind === 'hcs6-registry' ? 'HCS-6 REGISTRY' : 'RAW TOPIC'
    return `
      <div class="cc-panel" style="margin-top:1rem">
        <div style="display:flex;gap:0.5rem;align-items:center;flex-wrap:wrap">
          <span class="cc-badge" style="background:var(--terminal-purple);color:var(--terminal-bg-dark);font-size:0.72rem;padding:0.15rem 0.5rem;border-radius:4px;font-weight:700">${kindLabel}</span>
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
      <div style="margin-top:1rem">
        <h4 style="margin:0 0 0.5rem;color:var(--terminal-green)">Messages</h4>
        ${this.truncated ? `<p style="font-size:0.75rem;color:var(--terminal-yellow);margin:0 0 0.75rem">Showing first 500 messages (topic is larger).</p>` : ''}
        <div style="max-height:560px;overflow-y:auto;padding-right:0.35rem">
          ${this.messages.map((m) => this.renderMessageCard(m)).join('')}
        </div>
        <style>
          .tv-msg { border:1px solid rgba(255,255,255,0.08); border-radius:8px; margin-bottom:0.75rem; overflow:hidden }
          .tv-msg-head { display:flex; justify-content:space-between; align-items:center; gap:0.5rem;
            padding:0.5rem 0.9rem; background:rgba(255,255,255,0.03); font-size:0.78rem; color:var(--terminal-text) }
          .tv-msg-head b { color:#fff; font-weight:700 }
          .tv-msg-body { padding:0.7rem 0.9rem 0.8rem }
          .tv-msg-row { display:flex; gap:1.5rem; padding:0.18rem 0; font-size:0.78rem; align-items:baseline }
          .tv-msg-label { color:var(--terminal-text); min-width:90px }
          .tv-msg-val { color:#e8ecf1; font-weight:700; word-break:break-all }
          .tv-msg-decode { color:var(--terminal-text); font-size:0.75rem; margin:0.65rem 0 0.45rem }
          .tv-json { margin:0; background:rgba(0,0,0,0.3); border:1px solid rgba(255,255,255,0.08); border-radius:8px;
            padding:0.75rem 0.9rem; white-space:pre-wrap; word-break:break-word; font-size:0.75rem; line-height:1.55;
            max-height:340px; overflow-y:auto }
          .tv-j-key { color:#e8d44d }
          .tv-j-str { color:var(--terminal-purple) }
          .tv-j-num { color:#7dd3fc }
          .tv-j-bool { color:#c084fc }
          .tv-msg-plain { margin:0.65rem 0 0; white-space:pre-wrap; word-break:break-all; font-size:0.75rem;
            color:var(--terminal-text); background:rgba(0,0,0,0.3); border:1px solid rgba(255,255,255,0.08);
            border-radius:8px; padding:0.65rem 0.9rem }
          .tv-msg-foot { display:flex; justify-content:space-between; gap:0.5rem; margin-top:0.6rem;
            font-size:0.72rem; color:var(--terminal-text) }
          .tv-chip { font-size:0.62rem; padding:0.1rem 0.4rem; border-radius:3px; font-weight:700; letter-spacing:0.03em }
          .tv-chip-hcs1-chunk { background:#7c3aed33; color:#c4b5fd }
          .tv-chip-hcs6-register { background:#0891b233; color:#67e8f9 }
          .tv-chip-json { background:#6bff9e22; color:#4ade80 }
          .tv-chip-text { background:#ffffff14; color:#cbd5e1 }
        </style>
      </div>
    `
  }

  private static renderMessageCard(m: TopicMessage): string {
    const isJson = m.kind === 'json' || m.kind === 'hcs6-register'
    const payload = isJson
      ? `<p class="tv-msg-decode">Decoded payload — JSON envelope</p>
         <pre class="tv-json mono">${this.highlightJson(this.prettyJson(m.preview))}</pre>`
      : `<pre class="tv-msg-plain mono">${this.escapeHtml(m.preview)}</pre>`
    return `
      <div class="tv-msg">
        <div class="tv-msg-head">
          <span><b>#${m.sequence}</b> seq <span class="tv-chip tv-chip-${m.kind}" style="margin-left:0.35rem">${m.kind}</span></span>
          <span>${this.fmtConsensusTs(m.consensusTimestamp)}</span>
        </div>
        <div class="tv-msg-body">
          <div class="tv-msg-row">
            <span class="tv-msg-label">payer</span>
            <span class="tv-msg-val mono">${this.escapeHtml(m.payer || '—')}</span>
          </div>
          <div class="tv-msg-row">
            <span class="tv-msg-label">timestamp</span>
            <span class="tv-msg-val mono">${m.consensusTimestamp}</span>
          </div>
          ${payload}
          <div class="tv-msg-foot">
            <span>${m.chunk ? `consensus chunk ${m.chunk}` : ''}</span>
            <span>${this.fmtBytes(m.size)}</span>
          </div>
        </div>
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
    if (!this.info && !this.messages.length && !this.fileLoading && !this.file) {
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
    let out = this.info ? this.renderInfo() : ''
    if (this.fileLoading) {
      out += `<h4 style="color:var(--terminal-green);margin:1rem 0 0.75rem">File</h4>
        <p style="font-size:0.82rem;color:var(--terminal-text)">Reading chunks from the mirror node, decompressing, verifying the SHA-256 against the topic memo…</p>`
    } else if (this.file) {
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
      out += `
        <h4 style="color:var(--terminal-green);margin:1rem 0 0.75rem">Verified File</h4>
        ${body}
        ${f.media.note ? `<p style="font-size:0.72rem;color:var(--terminal-yellow);margin:0.5rem 0 0">${this.escapeHtml(f.media.note)}</p>` : ''}
        <p class="mono" style="font-size:0.7rem;color:var(--terminal-text);word-break:break-all;margin:0.6rem 0 0">${f.mime} · ${this.fmtBytes(f.size)} · ${f.chunks} chunks</p>
        <p class="mono" style="font-size:0.7rem;color:var(--terminal-text);word-break:break-all;margin:0.25rem 0 0">sha-256: ${f.sha256}</p>
        ${download}
      `
    }
    if (this.messages.length) out += this.renderMessages()
    if (this.registryEntries.length) out += this.renderRegistry()
    return out
  }

  // ─── INIT ───────────────────────────────────────────────

  static init(): void {
    document.getElementById('topic-back')?.addEventListener('click', () => {
      window.dispatchEvent(new CustomEvent('navigate-to-tool', { detail: { toolId: 'home' } }))
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
        fetch(`${API_BASE_URL}/api/hcs/topic/${topicId}/info?network=mainnet`),
        fetch(`${API_BASE_URL}/api/hcs/topic/${topicId}/messages?network=mainnet`),
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
      const res = await fetch(`${API_BASE_URL}/api/hcs/topic/${topicId}/file?network=mainnet`)
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
    const left = document.querySelector('.art-gen-left')
    const right = document.querySelector('.art-gen-right')
    const leftTop = left?.scrollTop ?? 0
    const rightTop = right?.scrollTop ?? 0
    const app = document.querySelector<HTMLDivElement>('#app')!
    app.innerHTML = this.render()
    this.init()
    const newLeft = document.querySelector('.art-gen-left')
    const newRight = document.querySelector('.art-gen-right')
    if (newLeft) newLeft.scrollTop = leftTop
    if (newRight) newRight.scrollTop = rightTop
  }

  private static fmtBytes(n: number): string {
    if (n < 1024) return n + ' B'
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB'
    return (n / (1024 * 1024)).toFixed(2) + ' MB'
  }

  /** "1773072628.498607000" → "2026-03-09 16:10:28 UTC" */
  private static fmtConsensusTs(ts: string): string {
    const ms = Number(ts.split('.')[0]) * 1000
    if (!Number.isFinite(ms)) return ts
    return new Date(ms).toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, ' UTC')
  }

  private static prettyJson(text: string): string {
    try { return JSON.stringify(JSON.parse(text), null, 2) } catch { return text }
  }

  /** Syntax-highlight already-escaped pretty-printed JSON. */
  private static highlightJson(escaped: string): string {
    return escaped.replace(
      /(&quot;(?:[^&]|&(?!quot;))*?&quot;)(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g,
      (match, str: string, colon: string | undefined) => {
        if (str) {
          return colon ? `<span class="tv-j-key">${str}</span>${colon}` : `<span class="tv-j-str">${str}</span>`
        }
        if (/^(true|false|null)$/.test(match)) return `<span class="tv-j-bool">${match}</span>`
        return `<span class="tv-j-num">${match}</span>`
      }
    )
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
