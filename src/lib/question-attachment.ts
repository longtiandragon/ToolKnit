import type { DesktopQuestionAttachment } from '@/lib/native'

export function questionAttachmentIcon(attachment: Pick<DesktopQuestionAttachment, 'mime' | 'name'>) {
  const mime = attachment.mime.toLowerCase()
  const extension = attachment.name.split('.').at(-1)?.toLowerCase() ?? ''
  if (mime === 'application/pdf' || extension === 'pdf') return 'file-pdf'
  if (mime.startsWith('image/')) return 'file-image'
  if (mime.startsWith('text/') || ['md', 'txt', 'csv', 'json'].includes(extension)) return 'file-text'
  if (['js', 'jsx', 'ts', 'tsx', 'vue', 'py', 'java', 'c', 'cpp', 'rs', 'go'].includes(extension)) return 'file-code'
  return 'attachment'
}

export function formatQuestionAttachmentSize(size: number) {
  const bytes = Number.isFinite(size) && size > 0 ? size : 0
  if (bytes < 1024) return `${Math.round(bytes)} B`
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(bytes < 10 * 1024 ** 2 ? 1 : 0)} MB`
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`
}

export function upsertQuestionAttachment(
  current: DesktopQuestionAttachment[],
  attachment: DesktopQuestionAttachment,
) {
  return [attachment, ...current.filter((item) => item.id !== attachment.id)].slice(0, 64)
}
