import type { ClipboardItem, FavoriteTool, Job } from '@/types'

export function normalizeClipboardHistory(value: unknown): ClipboardItem[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return []
    const item = entry as Record<string, unknown>
    if (typeof item.id !== 'string' || !['text', 'code', 'image'].includes(String(item.kind)) || typeof item.hash !== 'string' || typeof item.capturedAt !== 'string' || !Number.isFinite(new Date(item.capturedAt).getTime())) return []
    const normalized: ClipboardItem = { id: item.id, kind: item.kind as ClipboardItem['kind'], hash: item.hash, capturedAt: item.capturedAt }
    if (typeof item.content === 'string') normalized.content = item.content
    if (typeof item.assetPath === 'string') normalized.assetPath = item.assetPath
    if (typeof item.preview === 'string') normalized.preview = item.preview
    if (typeof item.pinned === 'boolean') normalized.pinned = item.pinned
    normalized.contentLoaded = typeof item.contentLoaded === 'boolean' ? item.contentLoaded : true
    if (normalized.kind === 'image' ? !normalized.assetPath && !normalized.preview : normalized.content === undefined) return []
    return [normalized]
  })
}

export function normalizeFavoriteOrder(toolIds: string[]): FavoriteTool[] {
  return [...new Set(toolIds)].map((toolId, order) => ({ toolId, order, shortcut: order < 9 ? order + 1 : undefined }))
}

export function pruneClipboardHistory(items: ClipboardItem[], limit: number, retentionDays: number, at = Date.now()) {
  const threshold = at - Math.max(1, retentionDays) * 86_400_000
  const safeLimit = Number.isFinite(limit) ? Math.max(10, Math.min(500, Math.round(limit))) : 100
  const pinned = items.filter((item) => item.pinned)
  const recent = items.filter((item) => !item.pinned && new Date(item.capturedAt).getTime() >= threshold).sort((a, b) => b.capturedAt.localeCompare(a.capturedAt)).slice(0, safeLimit)
  return [...pinned, ...recent].sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) || b.capturedAt.localeCompare(a.capturedAt))
}

export function looksLikeCode(value: string) { return /[{};]|=>|\b(function|const|let|class|import|SELECT|FROM)\b/.test(value) }

export function canRetryJob(job: Job) { return Boolean(job.retryable && job.route && job.toolId && job.parameters) }
