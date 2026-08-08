import type { ClipboardItem, FavoriteTool, Job } from '@/types'

export function normalizeFavoriteOrder(toolIds: string[]): FavoriteTool[] {
  return [...new Set(toolIds)].map((toolId, order) => ({ toolId, order, shortcut: order < 9 ? order + 1 : undefined }))
}

export function pruneClipboardHistory(items: ClipboardItem[], limit: number, retentionDays: number, at = Date.now()) {
  const threshold = at - Math.max(1, retentionDays) * 86_400_000
  const pinned = items.filter((item) => item.pinned)
  const recent = items.filter((item) => !item.pinned && new Date(item.capturedAt).getTime() >= threshold).sort((a, b) => b.capturedAt.localeCompare(a.capturedAt)).slice(0, Math.max(1, limit))
  return [...pinned, ...recent].sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) || b.capturedAt.localeCompare(a.capturedAt))
}

export function looksLikeCode(value: string) { return /[{};]|=>|\b(function|const|let|class|import|SELECT|FROM)\b/.test(value) }

export function canRetryJob(job: Job) { return Boolean(job.retryable && job.route && job.toolId && job.parameters) }
