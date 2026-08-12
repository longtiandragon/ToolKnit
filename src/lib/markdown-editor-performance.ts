export const LARGE_MARKDOWN_EDITOR_THRESHOLD = 120_000
export const HUGE_MARKDOWN_EDITOR_THRESHOLD = 768 * 1024
export const EXTREME_MARKDOWN_EDITOR_THRESHOLD = 1_500_000

export type MarkdownEditorCommitPolicy = {
  delayMs: number
  label: string
}

/**
 * CodeMirror keeps typing local and virtualized. This delay only batches the
 * expensive projection into Vue, preview/statistics workers and crash drafts.
 * Saving and leaving the editor always flush synchronously.
 */
export function markdownEditorCommitPolicy(length: number): MarkdownEditorCommitPolicy {
  if (length <= LARGE_MARKDOWN_EDITOR_THRESHOLD) return { delayMs: 120, label: '' }
  if (length <= HUGE_MARKDOWN_EDITOR_THRESHOLD) return { delayMs: 320, label: '0.3 秒合并更新' }
  if (length <= EXTREME_MARKDOWN_EDITOR_THRESHOLD) return { delayMs: 520, label: '0.5 秒合并更新' }
  return { delayMs: 720, label: '0.7 秒合并更新' }
}
