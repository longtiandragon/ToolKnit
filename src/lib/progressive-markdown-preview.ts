export const DEFAULT_MARKDOWN_PREVIEW_BATCH_CHARS = 96 * 1024
export const DEFAULT_MARKDOWN_PREVIEW_BATCH_BLOCKS = 12

export interface MarkdownPreviewBatch {
  html: string
  start: number
  end: number
}

export interface MarkdownPreviewBatchRange {
  start: number
  end: number
}

export interface MarkdownPreviewReconcilePlan {
  prefix: number
  suffix: number
  replaceStart: number
  previousReplaceEnd: number
  nextReplaceEnd: number
  fullReplace: boolean
}

/**
 * Reuse whole Worker-rendered Markdown blocks around the changed region. The
 * plan stores indexes rather than DOM nodes so it can be tested independently
 * and then applied through comment-delimited ranges in the reader.
 */
export function planMarkdownPreviewReconciliation(
  previous: readonly string[],
  next: readonly string[],
  rangesValid: boolean,
): MarkdownPreviewReconcilePlan {
  if (!rangesValid || !previous.length) {
    return { prefix: 0, suffix: 0, replaceStart: 0, previousReplaceEnd: previous.length, nextReplaceEnd: next.length, fullReplace: true }
  }
  const sharedLength = Math.min(previous.length, next.length)
  let prefix = 0
  while (prefix < sharedLength && previous[prefix] === next[prefix]) prefix += 1
  let suffix = 0
  while (
    suffix < sharedLength - prefix
    && previous[previous.length - suffix - 1] === next[next.length - suffix - 1]
  ) suffix += 1
  return {
    prefix,
    suffix,
    replaceStart: prefix,
    previousReplaceEnd: previous.length - suffix,
    nextReplaceEnd: next.length - suffix,
    fullReplace: false,
  }
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
  const range = nextMarkdownPreviewBatchRange(blocks, start, maxChars, maxBlocks)
  if (!range) return undefined
  return { html: blocks.slice(range.start, range.end).join(''), ...range }
}

/** Return only bounded indexes when a DOM caller already owns each block. */
export function nextMarkdownPreviewBatchRange(
  blocks: readonly string[],
  start: number,
  maxChars = DEFAULT_MARKDOWN_PREVIEW_BATCH_CHARS,
  maxBlocks = DEFAULT_MARKDOWN_PREVIEW_BATCH_BLOCKS,
  limit = blocks.length,
): MarkdownPreviewBatchRange | undefined {
  const safeLimit = Math.max(0, Math.min(blocks.length, Math.floor(limit)))
  if (start < 0 || start >= safeLimit) return undefined
  const safeMaxChars = Math.max(1, Math.floor(maxChars))
  const safeMaxBlocks = Math.max(1, Math.floor(maxBlocks))
  let end = start
  let characters = 0
  while (end < safeLimit && end - start < safeMaxBlocks) {
    const nextLength = blocks[end]?.length ?? 0
    if (end > start && characters + nextLength > safeMaxChars) break
    characters += nextLength
    end += 1
  }
  return { start, end }
}

export function markdownPreviewProgress(completed: number, total: number) {
  if (total <= 0) return 100
  return Math.max(0, Math.min(100, Math.round((completed / total) * 100)))
}
