import type { ClipboardItem, Source } from '@/types'
import { matchesClipboardQuery } from '@/lib/clipboard-search'
import { filterSources } from '@/lib/source-list'

export interface GlobalSourceSearchItem {
  id: string
  title: string
  detail: string
  kind: Source['kind']
}

export interface GlobalClipboardSearchItem {
  id: string
  title: string
  detail: string
  kind: ClipboardItem['kind']
  pinned: boolean
}

const sourceKindLabels: Record<Source['kind'], string> = { image: '图片', pdf: 'PDF', code: '代码', text: '文本' }
const clipboardKindLabels: Record<ClipboardItem['kind'], string> = { image: '图片', code: '代码', text: '文本' }

function compactText(value: string, maxLength: number) {
  const normalized = value.replace(/\s+/g, ' ').trim()
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 1)}…` : normalized
}

/** Search only the already-hydrated lightweight source index. Binary bodies,
 * PDFs and managed files stay on disk until the selected result is opened. */
export function searchGlobalSources(sources: readonly Source[], query: string, limit = 6): GlobalSourceSearchItem[] {
  if (query.trim().length < 2) return []
  return filterSources([...sources], 'all', query).slice(0, Math.max(0, limit)).map((source) => ({
    id: source.id,
    title: source.name,
    detail: `${sourceKindLabels[source.kind]} · ${source.tags.length ? source.tags.slice(0, 3).join(' · ') : source.mime || '本地资料'}`,
    kind: source.kind,
  }))
}

/** Clipboard hydration is capped to a preview. Searching never resolves the
 * full payload; the clipboard page does that only when the user copies it. */
export function searchGlobalClipboard(items: readonly ClipboardItem[], query: string, limit = 6): GlobalClipboardSearchItem[] {
  if (query.trim().length < 2) return []
  return items.filter((item) => matchesClipboardQuery(item, query)).slice(0, Math.max(0, limit)).map((item) => {
    const preview = item.kind === 'image' ? '本机剪贴板图片' : compactText(item.content ?? '', 92)
    return {
      id: item.id,
      title: preview || `${clipboardKindLabels[item.kind]}剪贴板记录`,
      detail: `${item.pinned ? '常用片段 · ' : ''}${clipboardKindLabels[item.kind]} · ${new Date(item.capturedAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}`,
      kind: item.kind,
      pinned: Boolean(item.pinned),
    }
  })
}
