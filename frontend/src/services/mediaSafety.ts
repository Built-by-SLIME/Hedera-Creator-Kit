/**
 * Viewer media safety — shared by Topic Viewer and Wallet Viewer.
 *
 * Rules (agreed security posture for inscribed content):
 *  - SVG renders ONLY inside <img>. <img> contexts never execute scripts,
 *    so even a hostile SVG cannot run code. Never iframe/object/embed SVG.
 *  - HTML / XML is NEVER executed: served to the DOM as escaped plain text
 *    and offered as a download only.
 *  - The Blob MIME is overridden for dangerous types; a blob: URL opened
 *    directly in a new tab then also serves text/plain, not text/html.
 */

export type RenderAs = 'img' | 'video' | 'audio' | 'text' | 'binary'

export interface SafeMedia {
  url: string
  renderAs: RenderAs
  /** MIME actually given to the Blob — dangerous types are forced to text/plain. */
  blobMime: string
  /** Human note shown under the preview, when relevant. */
  note?: string
  extension: string
}

const EXT: Record<string, string> = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp',
  'image/avif': 'avif', 'image/bmp': 'bmp', 'image/svg+xml': 'svg',
  'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/webm': 'webm', 'video/ogg': 'ogv',
  'audio/mpeg': 'mp3', 'audio/wav': 'wav', 'audio/mp4': 'm4a', 'audio/ogg': 'ogg',
  'text/html': 'html', 'application/json': 'json', 'text/plain': 'txt',
  'application/pdf': 'pdf',
}

export function extensionFor(mime: string): string {
  return EXT[mime] || 'bin'
}

/**
 * Turn verified base64 file bytes into a display plan. The caller renders
 * according to `renderAs`; `text` means show as escaped text / download.
 */
export function planMedia(mime: string, base64: string): SafeMedia {
  const bytes = base64ToBytes(base64) as Uint8Array<ArrayBuffer>
  const ext = extensionFor(mime)
  const mk = (blobMime: string, renderAs: RenderAs, note?: string): SafeMedia => {
    const blob = new Blob([bytes], { type: blobMime })
    return { url: URL.createObjectURL(blob), renderAs, blobMime, note, extension: ext }
  }

  switch (mime) {
    case 'image/png': case 'image/jpeg': case 'image/gif':
    case 'image/webp': case 'image/avif': case 'image/bmp':
      return mk(mime, 'img')
    case 'image/svg+xml':
      // <img>-only: scripts in the SVG cannot run in this context.
      return mk(mime, 'img', 'SVG rendered as a static image — scripts never execute.')
    case 'video/mp4': case 'video/quicktime': case 'video/webm': case 'video/ogg':
      return mk(mime, 'video')
    case 'audio/mpeg': case 'audio/wav': case 'audio/mp4': case 'audio/ogg':
      return mk(mime, 'audio')
    case 'text/html':
    case 'application/xhtml+xml':
      // Never executable from our UI: the blob itself is text/plain.
      return mk('text/plain', 'text', 'HTML is never executed here — shown as source, download to inspect.')
    case 'application/json':
    case 'text/plain':
      return mk(mime, 'text')
    default:
      return mk('application/octet-stream', 'binary')
  }
}

export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64)
  const out = new Uint8Array(new ArrayBuffer(bin.length))
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

export function bytesToText(bytes: Uint8Array): string {
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes)
}

export function revokeMedia(m: SafeMedia | null): void {
  if (m) URL.revokeObjectURL(m.url)
}
