export const DEFAULT_MARKDOWN_PREVIEW_BATCH_CHARS = 96 * 1024
export const DEFAULT_MARKDOWN_PREVIEW_BATCH_BLOCKS = 12

export interface MarkdownPreviewBatch {
  html: string
  start: number
  end: number
}

/**
 * Join only a bounded slice of Worker-rendered sections for one DOM turn.
 * At least one section is always returned, even when a single code block is
 * larger than the character budget, so progress cannot stall.
 */
export function nextMarkdownPreviewBatch(
  blocks: readonly string[],
  start: number,
  maxChars = DEFAULT_MARKDOWN_PREVIEW_BATCH_CHARS,
  maxBlocks = DEFAULT_MARKDOWN_PREVIEW_BATCH_BLOCKS,
): MarkdownPreviewBatch | undefined {
  if (start < 0 || start >= blocks.length) return undefined
  const safeMaxChars = Math.max(1, Math.floor(maxChars))
  const safeMaxBlocks = Math.max(1, Math.floor(maxBlocks))
  let end = start
  let characters = 0
  while (end < blocks.length && end - start < safeMaxBlocks) {
    const nextLength = blocks[end]?.length ?? 0
    if (end > start && characters + nextLength > safeMaxChars) break
    characters += nextLength
    end += 1
  }
  return { html: blocks.slice(start, end).join(''), start, end }
}

export function markdownPreviewProgress(completed: number, total: number) {
  if (total <= 0) return 100
  return Math.max(0, Math.min(100, Math.round((completed / total) * 100)))
}
