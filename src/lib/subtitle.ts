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
