export interface MediaClipRange {
  startSeconds: number
  endSeconds: number
  durationSeconds: number
}

export interface MediaClipValidation {
  range?: MediaClipRange
  error?: string
}

/** Accepts seconds, mm:ss or hh:mm:ss without relying on locale-specific
 * browser time inputs. */
export function parseMediaTimecode(value: string) {
  const source = value.trim()
  if (!source) return undefined
  const parts = source.split(':')
  if (parts.length > 3 || parts.some((part) => !/^\d+(?:\.\d{1,3})?$/.test(part))) return undefined
  const numbers = parts.map(Number)
  if (numbers.some((part) => !Number.isFinite(part) || part < 0)) return undefined
  if (parts.length > 1 && numbers.slice(1).some((part) => part >= 60)) return undefined
  const seconds = parts.length === 3
    ? numbers[0] * 3600 + numbers[1] * 60 + numbers[2]
    : parts.length === 2
      ? numbers[0] * 60 + numbers[1]
      : numbers[0]
  return Math.round(seconds * 1000) / 1000
}

export function formatMediaTimecode(seconds: number) {
  const normalized = Math.max(0, Math.round(seconds))
  const hours = Math.floor(normalized / 3600)
  const minutes = Math.floor((normalized % 3600) / 60)
  const remainder = normalized % 60
  return hours
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`
    : `${minutes}:${String(remainder).padStart(2, '0')}`
}

export function validateMediaClipRange(startText: string, endText: string, sourceDuration?: number): MediaClipValidation {
  const startSeconds = parseMediaTimecode(startText)
  const endSeconds = parseMediaTimecode(endText)
  if (startSeconds === undefined || endSeconds === undefined) return { error: '使用秒数、mm:ss 或 hh:mm:ss 格式。' }
  if (endSeconds <= startSeconds) return { error: '结束时间必须晚于开始时间。' }
  if (endSeconds - startSeconds < 0.1) return { error: '片段至少需要 0.1 秒。' }
  if (Number.isFinite(sourceDuration) && sourceDuration && endSeconds > sourceDuration + 0.05) {
    return { error: `结束时间不能超过媒体时长 ${formatMediaTimecode(sourceDuration)}。` }
  }
  return { range: { startSeconds, endSeconds, durationSeconds: endSeconds - startSeconds } }
}

export function mediaClipPercent(value: number, duration?: number) {
  if (!duration || !Number.isFinite(duration) || duration <= 0) return 0
  return Math.min(100, Math.max(0, value / duration * 100))
}
