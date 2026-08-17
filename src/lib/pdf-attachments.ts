import { cleanOutputName } from './file-tools'

export const PDF_ATTACHMENT_MAX_COUNT = 128
export const PDF_ATTACHMENT_MAX_BYTES = 16 * 1024 * 1024
export const PDF_ATTACHMENT_MAX_TOTAL_BYTES = 64 * 1024 * 1024

const mimeByExtension: Record<string, string> = {
  '.avif': 'image/avif',
  '.css': 'text/css',
  '.csv': 'text/csv',
  '.gif': 'image/gif',
  '.html': 'text/html',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.json': 'application/json',
  '.m4a': 'audio/mp4',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain',
  '.wav': 'audio/wav',
  '.webm': 'video/webm',
  '.webp': 'image/webp',
  '.xml': 'application/xml',
  '.zip': 'application/zip',
}

export type PdfAttachmentMime = 'application/json' | 'application/zip' | 'application/xml' | 'application/octet-stream' | 'audio/mpeg' | 'audio/mp4' | 'audio/wav' | 'image/avif' | 'image/gif' | 'image/jpeg' | 'image/png' | 'image/svg+xml' | 'image/webp' | 'text/css' | 'text/csv' | 'text/html' | 'text/plain' | 'video/mp4' | 'video/webm'

export function safePdfAttachmentName(raw: string, index = 1) {
  const basename = raw.split(/[\\/]/).at(-1)?.replace(/[\u0000-\u001f\u007f]/g, '').trim() ?? ''
  const safe = basename
    .replace(/[<>:"|?*]/g, '-')
    .replace(/[. ]+$/g, '')
    .slice(0, 180)
  return safe && safe !== '.' && safe !== '..' && !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(safe)
    ? safe
    : `attachment-${index}`
}

export function pdfAttachmentOutputName(sourceName: string, attachmentName: string, index: number) {
  const safe = safePdfAttachmentName(attachmentName, index)
  const extension = safe.match(/\.[A-Za-z0-9]{1,16}$/)?.[0].toLowerCase() ?? ''
  const stem = extension ? safe.slice(0, -extension.length) : safe
  return `${cleanOutputName(sourceName)}-attachment-${String(index).padStart(3, '0')}-${cleanOutputName(stem)}${extension}`
}

export function pdfAttachmentMime(name: string): PdfAttachmentMime {
  const extension = name.match(/\.[A-Za-z0-9]{1,16}$/)?.[0].toLowerCase() ?? ''
  return (mimeByExtension[extension] ?? 'application/octet-stream') as PdfAttachmentMime
}
