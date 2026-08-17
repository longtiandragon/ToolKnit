export type SubtitleFormat = 'srt' | 'vtt'

export interface SubtitleCue {
  id: string
  startMs: number
  endMs: number
  text: string
}

export interface ParsedSubtitle {
  format: SubtitleFormat
  cues: SubtitleCue[]
  warnings: string[]
}

export type SubtitleQualityIssueKind = 'overlap' | 'cps' | 'line-length' | 'short-duration' | 'duplicate'

export interface SubtitleQualityIssue {
  cueId: string
  cueIndex: number
  kind: SubtitleQualityIssueKind
  message: string
}

export interface SubtitleQualityReport {
  cueCount: number
  overlapCount: number
  cpsViolationCount: number
  lineLengthViolationCount: number
  shortDurationCount: number
  duplicateCount: number
  maxCps: number
  maxLineLength: number
  issues: SubtitleQualityIssue[]
}

export const MAX_SUBTITLE_BYTES = 5 * 1024 * 1024
export const MAX_SUBTITLE_CUES = 20_000

/** Returns original cue indexes so a virtual row can show its stable ordinal
 * without calling Array#indexOf for every rendered item. */
export function subtitleCueIndexes(cues: readonly SubtitleCue[], query = '') {
  const needle = query.trim().toLocaleLowerCase('zh-CN')
  const indexes: number[] = []
  for (let index = 0; index < cues.length; index += 1) {
    if (!needle || cues[index].text.toLocaleLowerCase('zh-CN').includes(needle)) indexes.push(index)
  }
  return indexes
}

function parseTimestamp(value: string) {
  const match = value.trim().match(/^(?:(\d{1,3}):)?(\d{1,2}):(\d{2})[,.](\d{1,3})$/)
  if (!match) return undefined
  const hours = Number(match[1] || 0)
  const minutes = Number(match[2])
  const seconds = Number(match[3])
  const milliseconds = Number(match[4].padEnd(3, '0'))
  if (minutes > 59 || seconds > 59) return undefined
  return ((hours * 60 + minutes) * 60 + seconds) * 1000 + milliseconds
}

function parseTimingLine(value: string) {
  const [startSource, tail] = value.split(/\s+-->\s+/, 2)
  const endSource = tail?.trim().split(/\s+/)[0]
  if (!startSource || !endSource) return undefined
  const startMs = parseTimestamp(startSource)
  const endMs = parseTimestamp(endSource)
  if (startMs === undefined || endMs === undefined || endMs <= startMs) return undefined
  return { startMs, endMs }
}

export function detectSubtitleFormat(filename: string, source = ''): SubtitleFormat {
  return filename.toLocaleLowerCase('en-US').endsWith('.vtt') || source.replace(/^\uFEFF/, '').trimStart().startsWith('WEBVTT') ? 'vtt' : 'srt'
}

export function parseSubtitle(source: string, filename = ''): ParsedSubtitle {
  const normalized = source.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n')
  const format = detectSubtitleFormat(filename, normalized)
  const blocks = normalized.split(/\n{2,}/)
  const cues: SubtitleCue[] = []
  const warnings: string[] = []
  let skipped = 0
  for (const rawBlock of blocks) {
    if (cues.length >= MAX_SUBTITLE_CUES) break
    const lines = rawBlock.split('\n').map(line => line.trimEnd())
    if (!lines.some(line => line.trim())) continue
    const first = lines[0].trim()
    if (first === 'WEBVTT' || first.startsWith('NOTE') || first === 'STYLE' || first === 'REGION') continue
    const timingIndex = lines.findIndex(line => line.includes('-->'))
    const timing = timingIndex >= 0 ? parseTimingLine(lines[timingIndex]) : undefined
    const text = timingIndex >= 0 ? lines.slice(timingIndex + 1).join('\n').trim() : ''
    if (!timing || !text) { skipped += 1; continue }
    cues.push({ id: `cue-${cues.length + 1}`, ...timing, text })
  }
  if (skipped) warnings.push(`已跳过 ${skipped} 个无法识别或没有正文的字幕块。`)
  if (cues.length >= MAX_SUBTITLE_CUES && blocks.length > cues.length) warnings.push(`字幕超过 ${MAX_SUBTITLE_CUES.toLocaleString()} 条，只载入前 ${MAX_SUBTITLE_CUES.toLocaleString()} 条。`)
  const overlaps = cues.reduce((count, cue, index) => count + (index > 0 && cue.startMs < cues[index - 1].endMs ? 1 : 0), 0)
  if (overlaps) warnings.push(`检测到 ${overlaps} 处时间重叠，可在时间轴中逐条校对。`)
  return { format, cues, warnings }
}

/**
 * Performs bounded, local subtitle QA without changing the source cues. The
 * defaults are intentionally conservative: they flag items worth checking,
 * but never rewrite timing or text on the user's behalf.
 */
export function analyzeSubtitleQuality(
  cues: readonly SubtitleCue[],
  options: { maxCps?: number; maxCharsPerLine?: number; minDurationMs?: number } = {},
): SubtitleQualityReport {
  const maxCps = options.maxCps ?? 20
  const maxCharsPerLine = options.maxCharsPerLine ?? 42
  const minDurationMs = options.minDurationMs ?? 700
  const issues: SubtitleQualityIssue[] = []
  let overlapCount = 0
  let cpsViolationCount = 0
  let lineLengthViolationCount = 0
  let shortDurationCount = 0
  let duplicateCount = 0
  let maxCpsSeen = 0
  let maxLineLength = 0
  const seenText = new Set<string>()
  const addIssue = (cue: SubtitleCue, cueIndex: number, kind: SubtitleQualityIssueKind, message: string) => {
    if (issues.length < 200) issues.push({ cueId: cue.id, cueIndex, kind, message })
  }

  cues.forEach((cue, cueIndex) => {
    const durationMs = Math.max(1, cue.endMs - cue.startMs)
    const text = cue.text.trim()
    const lineLength = Math.max(...text.split(/\r?\n/).map(line => Array.from(line.replace(/\s/g, '')).length), 0)
    const cps = Array.from(text.replace(/\s/g, '')).length / (durationMs / 1000)
    maxCpsSeen = Math.max(maxCpsSeen, cps)
    maxLineLength = Math.max(maxLineLength, lineLength)
    if (cueIndex > 0 && cue.startMs < cues[cueIndex - 1].endMs) {
      overlapCount += 1
      addIssue(cue, cueIndex, 'overlap', `第 ${cueIndex + 1} 条与上一条字幕重叠。`)
    }
    if (cps > maxCps) {
      cpsViolationCount += 1
      addIssue(cue, cueIndex, 'cps', `第 ${cueIndex + 1} 条阅读速度约 ${cps.toFixed(1)} CPS，超过 ${maxCps} CPS。`)
    }
    if (lineLength > maxCharsPerLine) {
      lineLengthViolationCount += 1
      addIssue(cue, cueIndex, 'line-length', `第 ${cueIndex + 1} 条最长一行 ${lineLength} 字，超过 ${maxCharsPerLine} 字。`)
    }
    if (durationMs < minDurationMs) {
      shortDurationCount += 1
      addIssue(cue, cueIndex, 'short-duration', `第 ${cueIndex + 1} 条只显示 ${durationMs} ms，低于 ${minDurationMs} ms。`)
    }
    const normalized = text.replace(/\s+/g, ' ')
    if (normalized && seenText.has(normalized)) {
      duplicateCount += 1
      addIssue(cue, cueIndex, 'duplicate', `第 ${cueIndex + 1} 条字幕正文与之前重复。`)
    }
    if (normalized) seenText.add(normalized)
  })

  return {
    cueCount: cues.length,
    overlapCount,
    cpsViolationCount,
    lineLengthViolationCount,
    shortDurationCount,
    duplicateCount,
    maxCps: Number(maxCpsSeen.toFixed(1)),
    maxLineLength,
    issues,
  }
}

export function formatSubtitleTimestamp(milliseconds: number, format: SubtitleFormat = 'srt') {
  const safe = Math.max(0, Math.round(milliseconds))
  const hours = Math.floor(safe / 3_600_000)
  const minutes = Math.floor((safe % 3_600_000) / 60_000)
  const seconds = Math.floor((safe % 60_000) / 1000)
  const millis = safe % 1000
  const separator = format === 'srt' ? ',' : '.'
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}${separator}${String(millis).padStart(3, '0')}`
}

export function parseSubtitleTimestamp(value: string) {
  return parseTimestamp(value)
}

export function serializeSubtitle(cues: SubtitleCue[], format: SubtitleFormat) {
  const body = cues.map((cue, index) => {
    const timing = `${formatSubtitleTimestamp(cue.startMs, format)} --> ${formatSubtitleTimestamp(cue.endMs, format)}`
    return format === 'srt' ? `${index + 1}\n${timing}\n${cue.text.trim()}` : `${timing}\n${cue.text.trim()}`
  }).join('\n\n')
  return `${format === 'vtt' ? 'WEBVTT\n\n' : ''}${body}${body ? '\n' : ''}`
}

export function shiftSubtitleCues(cues: SubtitleCue[], deltaMs: number) {
  if (!cues.length || !Number.isFinite(deltaMs) || deltaMs === 0) return cues
  const requested = Math.round(deltaMs)
  const earliestStart = Math.min(...cues.map(cue => cue.startMs))
  const effectiveDelta = Math.max(-earliestStart, requested)
  return cues.map(cue => ({ ...cue, startMs: cue.startMs + effectiveDelta, endMs: cue.endMs + effectiveDelta }))
}

export interface SubtitleRepairReport {
  cues: SubtitleCue[]
  adjustedCount: number
  overlapCount: number
  reordered: boolean
}

/**
 * Repairs only timeline invariants that can be fixed without guessing at
 * subtitle wording: chronological order, non-negative starts, non-overlap,
 * and a small positive duration. The original text and cue ids are preserved.
 * When an overlap is found the later cue is moved forward; this makes the
 * choice explicit and deterministic instead of silently shortening speech.
 */
export function repairSubtitleTiming(cues: readonly SubtitleCue[], options: { minDurationMs?: number } = {}): SubtitleRepairReport {
  const minDurationMs = Math.min(10_000, Math.max(1, Math.round(options.minDurationMs ?? 200)))
  const indexed = cues.map((cue, index) => ({ cue, index })).sort((left, right) => {
    const startDelta = left.cue.startMs - right.cue.startMs
    if (Number.isFinite(startDelta) && startDelta !== 0) return startDelta
    const endDelta = left.cue.endMs - right.cue.endMs
    if (Number.isFinite(endDelta) && endDelta !== 0) return endDelta
    return left.index - right.index
  })
  const repaired: SubtitleCue[] = []
  let adjustedCount = 0
  let overlapCount = 0
  for (const { cue } of indexed) {
    const originalStart = cue.startMs
    const originalEnd = cue.endMs
    let startMs = Number.isFinite(originalStart) ? Math.max(0, Math.round(originalStart)) : 0
    let endMs = Number.isFinite(originalEnd) ? Math.round(originalEnd) : startMs + minDurationMs
    const previous = repaired.at(-1)
    if (previous && startMs < previous.endMs) {
      overlapCount += 1
      startMs = previous.endMs
    }
    if (endMs <= startMs) endMs = startMs + minDurationMs
    if (startMs !== originalStart || endMs !== originalEnd) adjustedCount += 1
    repaired.push({ ...cue, startMs, endMs })
  }
  return {
    cues: repaired,
    adjustedCount,
    overlapCount,
    reordered: indexed.some(({ index }, outputIndex) => index !== outputIndex),
  }
}

export function splitSubtitleCue(cue: SubtitleCue, nextId: string): [SubtitleCue, SubtitleCue] | undefined {
  const text = cue.text.trim()
  const duration = cue.endMs - cue.startMs
  if (text.length < 2 || duration < 200) return undefined
  const center = Math.floor(text.length / 2)
  const candidates = [...text.matchAll(/[\s，。！？；、,.!?;]+/g)].map(match => match.index ?? center)
  const splitAt = candidates.length ? candidates.reduce((best, value) => Math.abs(value - center) < Math.abs(best - center) ? value : best) : center
  const left = text.slice(0, splitAt).trim()
  const right = text.slice(splitAt).trim()
  if (!left || !right) return undefined
  const ratio = Math.min(.8, Math.max(.2, left.length / (left.length + right.length)))
  const middle = Math.round(cue.startMs + duration * ratio)
  return [{ ...cue, endMs: middle, text: left }, { id: nextId, startMs: middle, endMs: cue.endMs, text: right }]
}

export function mergeSubtitleCues(first: SubtitleCue, second: SubtitleCue) {
  return { ...first, endMs: Math.max(first.endMs, second.endMs), text: `${first.text.trim()}\n${second.text.trim()}`.trim() }
}
