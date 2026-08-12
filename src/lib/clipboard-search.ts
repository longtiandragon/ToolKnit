import type { ClipboardItem } from '@/types'

/**
 * Clipboard content is user-provided and can be a multi-megabyte code block.
 * Index only a useful, bounded prefix so filtering stays responsive while the
 * full item remains intact for copying.
 */
export const CLIPBOARD_SEARCH_CONTENT_LIMIT = 12_000

export function clipboardSearchText(item: ClipboardItem) {
  const typeLabel = item.kind === 'image' ? '图片 image' : item.kind === 'code' ? '代码 code' : '文本 text'
  return `${typeLabel} ${(item.content ?? '').slice(0, CLIPBOARD_SEARCH_CONTENT_LIMIT)}`.toLowerCase()
}

export function matchesClipboardQuery(item: ClipboardItem, query: string) {
  const normalized = query.trim().toLowerCase()
  return !normalized || clipboardSearchText(item).includes(normalized)
}
