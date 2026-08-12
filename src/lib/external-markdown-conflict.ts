import { diffLines, type DiffLine } from './developer-tools'

export type ExternalMarkdownConflictPreview = {
  lines: DiffLine[]
  draftChanged: boolean
  diskChanged: boolean
  draftCharacters: number
  diskCharacters: number
  draftLines: number
  diskLines: number
  firstChangedLine: number
  truncated: boolean
}

function normalized(value: string) {
  return value.replace(/\r\n/g, '\n')
}

function lineCount(value: string) {
  if (!value) return 1
  let count = 1
  for (let index = 0; index < value.length; index += 1) if (value.charCodeAt(index) === 10) count += 1
  return count
}

function firstDifference(left: string, right: string) {
  const length = Math.min(left.length, right.length)
  let index = 0
  while (index < length && left.charCodeAt(index) === right.charCodeAt(index)) index += 1
  return index
}

function lineAt(value: string, index: number) {
  let line = 1
  for (let cursor = 0; cursor < Math.min(index, value.length); cursor += 1) if (value.charCodeAt(cursor) === 10) line += 1
  return line
}

function boundedLineWindow(value: string, index: number, beforeLines = 6, afterLines = 24, maxCharacters = 16_000) {
  let start = Math.min(index, value.length)
  let remainingBefore = beforeLines + 1
  while (start > 0 && remainingBefore > 0) {
    start -= 1
    if (value.charCodeAt(start) === 10) remainingBefore -= 1
  }
  if (start > 0 && value.charCodeAt(start) === 10) start += 1

  let end = Math.min(value.length, Math.max(start, index))
  let remainingAfter = afterLines
  while (end < value.length && remainingAfter > 0 && end - start < maxCharacters) {
    if (value.charCodeAt(end) === 10) remainingAfter -= 1
    end += 1
  }
  end = Math.min(end, start + maxCharacters)
  return {
    text: value.slice(start, end),
    startLine: lineAt(value, start),
    truncated: start > 0 || end < value.length,
  }
}

/**
 * Builds a small, deterministic conflict view around the first changed line.
 * It deliberately does not run an O(n*m) diff over a multi-megabyte note.
 */
export function externalMarkdownConflictPreview(base: string, draft: string, disk: string): ExternalMarkdownConflictPreview {
  const normalizedBase = normalized(base)
  const normalizedDraft = normalized(draft)
  const normalizedDisk = normalized(disk)
  const difference = firstDifference(normalizedDraft, normalizedDisk)
  const draftWindow = boundedLineWindow(normalizedDraft, difference)
  const diskWindow = boundedLineWindow(normalizedDisk, difference)
  const leftOffset = draftWindow.startLine - 1
  const rightOffset = diskWindow.startLine - 1
  const lines = diffLines(draftWindow.text, diskWindow.text, 64).map((line) => ({
    ...line,
    ...(line.leftLine ? { leftLine: line.leftLine + leftOffset } : {}),
    ...(line.rightLine ? { rightLine: line.rightLine + rightOffset } : {}),
  }))
  return {
    lines,
    draftChanged: normalizedDraft !== normalizedBase,
    diskChanged: normalizedDisk !== normalizedBase,
    draftCharacters: draft.length,
    diskCharacters: disk.length,
    draftLines: lineCount(normalizedDraft),
    diskLines: lineCount(normalizedDisk),
    firstChangedLine: Math.min(lineAt(normalizedDraft, difference), lineAt(normalizedDisk, difference)),
    truncated: draftWindow.truncated || diskWindow.truncated,
  }
}
