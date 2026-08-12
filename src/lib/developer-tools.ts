export type DiffKind = 'same' | 'added' | 'removed'

export interface DiffLine {
  kind: DiffKind
  text: string
  leftLine?: number
  rightLine?: number
}

export interface RegexMatch {
  index: number
  value: string
  groups: string[]
}

export interface TimestampResult {
  milliseconds: number
  seconds: number
  iso: string
  local: string
}

export type DateOffsetUnit = 'days' | 'weeks' | 'months' | 'years'

export interface DateDifferenceResult {
  days: number
  weeks: number
  remainingDays: number
  direction: 'same' | 'forward' | 'backward'
  start: string
  end: string
}

export interface DateOffsetResult {
  date: string
  weekday: string
}

export interface JwtResult {
  header: Record<string, unknown>
  payload: Record<string, unknown>
  signature: string
  expiresAt?: string
  expired?: boolean
}

export function encodeBase64(value: string) {
  const bytes = new TextEncoder().encode(value)
  let binary = ''
  for (let start = 0; start < bytes.length; start += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(start, start + 0x8000))
  }
  return btoa(binary)
}

export function decodeBase64(value: string) {
  const compact = value.replace(/\s+/g, '')
  if (!compact) throw new Error('请输入需要解码的 Base64 内容。')

  const normalized = compact.replace(/-/g, '+').replace(/_/g, '/')
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(normalized)) {
    throw new Error('Base64 包含无效字符；仅支持字母、数字、+、/、-、_ 和末尾补位符 =。')
  }

  const content = normalized.replace(/=+$/, '')
  if (content.length % 4 === 1) {
    throw new Error('Base64 长度无效：有效字符数量不能比 4 的倍数多 1。请检查内容是否缺失或多出字符。')
  }

  const padded = content.padEnd(Math.ceil(content.length / 4) * 4, '=')
  let binary: string
  try {
    binary = atob(padded)
  } catch {
    throw new Error('无法解码 Base64，请检查字符与末尾补位符是否正确。')
  }
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0))
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    throw new Error('Base64 已成功还原为字节，但内容不是有效的 UTF-8 文本。')
  }
}

function decodeBase64Url(value: string) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
  return decodeBase64(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '='))
}

export function transformJson(value: string, compact = false) {
  if (!value.trim()) throw new Error('请输入 JSON 内容。')
  try {
    return JSON.stringify(JSON.parse(value), null, compact ? 0 : 2)
  } catch (reason) {
    const detail = reason instanceof Error ? reason.message : '语法错误'
    throw new Error(`JSON 解析失败：${detail}`)
  }
}

export function decodeJwt(value: string, now = Date.now()): JwtResult {
  const parts = value.trim().split('.')
  if (parts.length !== 3 || parts.some((part) => !part)) throw new Error('JWT 应包含由两个句点分隔的三部分。')
  try {
    const header = JSON.parse(decodeBase64Url(parts[0])) as Record<string, unknown>
    const payload = JSON.parse(decodeBase64Url(parts[1])) as Record<string, unknown>
    const expiry = typeof payload.exp === 'number' ? payload.exp * 1000 : undefined
    return {
      header,
      payload,
      signature: parts[2],
      expiresAt: expiry === undefined ? undefined : new Date(expiry).toISOString(),
      expired: expiry === undefined ? undefined : expiry <= now
    }
  } catch (reason) {
    if (reason instanceof SyntaxError || reason instanceof DOMException) throw new Error('JWT 的 Header 或 Payload 不是有效的 Base64URL JSON。')
    throw reason
  }
}

export function generateUuids(count = 1) {
  if (!Number.isInteger(count) || count < 1 || count > 100) throw new Error('UUID 数量需要在 1 到 100 之间。')
  return Array.from({ length: count }, () => crypto.randomUUID()).join('\n')
}

function digitValue(character: string) {
  const code = character.toLowerCase().charCodeAt(0)
  return code >= 48 && code <= 57 ? code - 48 : code >= 97 && code <= 122 ? code - 87 : -1
}

export function convertNumberBase(value: string, fromBase: number, toBase: number) {
  if (!Number.isInteger(fromBase) || !Number.isInteger(toBase) || fromBase < 2 || fromBase > 36 || toBase < 2 || toBase > 36) {
    throw new Error('进制范围需要在 2 到 36 之间。')
  }
  const normalized = value.trim().replace(/_/g, '')
  if (!normalized) throw new Error('请输入需要转换的整数。')
  const negative = normalized.startsWith('-')
  const digits = negative || normalized.startsWith('+') ? normalized.slice(1) : normalized
  if (!digits) throw new Error('请输入有效整数。')
  let result = 0n
  for (const character of digits) {
    const digit = digitValue(character)
    if (digit < 0 || digit >= fromBase) throw new Error(`字符“${character}”不属于 ${fromBase} 进制。`)
    result = result * BigInt(fromBase) + BigInt(digit)
  }
  return `${negative && result !== 0n ? '-' : ''}${result.toString(toBase).toUpperCase()}`
}

export function encodeUrl(value: string) {
  return encodeURIComponent(value)
}

export function decodeUrl(value: string) {
  return decodeURIComponent(value)
}

export async function sha256(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export function convertTimestamp(value: string, locale = 'zh-CN'): TimestampResult {
  const normalized = value.trim()
  if (!normalized) throw new Error('请输入时间戳或日期时间。')
  const numeric = /^-?\d+(?:\.\d+)?$/.test(normalized) ? Number(normalized) : Number.NaN
  const date = Number.isFinite(numeric)
    ? new Date(Math.abs(numeric) < 100_000_000_000 ? numeric * 1000 : numeric)
    : new Date(normalized)
  if (Number.isNaN(date.getTime())) throw new Error('无法识别这个时间，请输入秒、毫秒时间戳或 ISO 日期。')
  return {
    milliseconds: date.getTime(),
    seconds: Math.floor(date.getTime() / 1000),
    iso: date.toISOString(),
    local: new Intl.DateTimeFormat(locale, { dateStyle: 'full', timeStyle: 'long' }).format(date)
  }
}

function parseLocalDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim())
  if (!match) throw new Error('请输入有效日期。')
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  if (date.getFullYear() !== Number(match[1]) || date.getMonth() !== Number(match[2]) - 1 || date.getDate() !== Number(match[3])) throw new Error('日期不存在，请检查年月日。')
  date.setHours(0, 0, 0, 0)
  return date
}

function formatLocalDate(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function calculateDateDifference(startValue: string, endValue: string): DateDifferenceResult {
  const start = parseLocalDate(startValue)
  const end = parseLocalDate(endValue)
  const signedDays = Math.round((end.getTime() - start.getTime()) / 86_400_000)
  const days = Math.abs(signedDays)
  return {
    days,
    weeks: Math.floor(days / 7),
    remainingDays: days % 7,
    direction: signedDays === 0 ? 'same' : signedDays > 0 ? 'forward' : 'backward',
    start: formatLocalDate(start),
    end: formatLocalDate(end)
  }
}

export function calculateDateOffset(baseValue: string, amount: number, unit: DateOffsetUnit, locale = 'zh-CN'): DateOffsetResult {
  if (!Number.isInteger(amount) || Math.abs(amount) > 100_000) throw new Error('偏移量需要是绝对值不超过 100000 的整数。')
  const date = parseLocalDate(baseValue)
  if (unit === 'days' || unit === 'weeks') date.setDate(date.getDate() + amount * (unit === 'weeks' ? 7 : 1))
  else {
    const originalDay = date.getDate()
    date.setDate(1)
    if (unit === 'months') date.setMonth(date.getMonth() + amount)
    else date.setFullYear(date.getFullYear() + amount)
    const lastDay = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate()
    date.setDate(Math.min(originalDay, lastDay))
  }
  return { date: formatLocalDate(date), weekday: new Intl.DateTimeFormat(locale, { weekday: 'long' }).format(date) }
}

export function testRegex(pattern: string, flags: string, input: string, limit = 1000): RegexMatch[] {
  if (!pattern) throw new Error('请输入正则表达式。')
  const scanFlags = flags.includes('g') ? flags : `${flags}g`
  const expression = new RegExp(pattern, scanFlags)
  const matches: RegexMatch[] = []
  let match: RegExpExecArray | null
  while ((match = expression.exec(input)) && matches.length < limit) {
    matches.push({ index: match.index, value: match[0], groups: match.slice(1).map((group) => group ?? '') })
    if (match[0] === '') expression.lastIndex += 1
  }
  if (matches.length === limit) throw new Error(`匹配结果超过 ${limit} 条，请缩小输入范围。`)
  return matches
}

export function diffLines(left: string, right: string, maxLines = 400): DiffLine[] {
  const leftLines = left.replace(/\r\n/g, '\n').split('\n')
  const rightLines = right.replace(/\r\n/g, '\n').split('\n')
  if (leftLines.length > maxLines || rightLines.length > maxLines) throw new Error(`单侧文本最多支持 ${maxLines} 行。`)

  const table = Array.from({ length: leftLines.length + 1 }, () => new Uint16Array(rightLines.length + 1))
  for (let leftIndex = leftLines.length - 1; leftIndex >= 0; leftIndex -= 1) {
    for (let rightIndex = rightLines.length - 1; rightIndex >= 0; rightIndex -= 1) {
      table[leftIndex][rightIndex] = leftLines[leftIndex] === rightLines[rightIndex]
        ? table[leftIndex + 1][rightIndex + 1] + 1
        : Math.max(table[leftIndex + 1][rightIndex], table[leftIndex][rightIndex + 1])
    }
  }

  const result: DiffLine[] = []
  let leftIndex = 0
  let rightIndex = 0
  while (leftIndex < leftLines.length && rightIndex < rightLines.length) {
    if (leftLines[leftIndex] === rightLines[rightIndex]) {
      result.push({ kind: 'same', text: leftLines[leftIndex], leftLine: leftIndex + 1, rightLine: rightIndex + 1 })
      leftIndex += 1
      rightIndex += 1
    } else if (table[leftIndex + 1][rightIndex] >= table[leftIndex][rightIndex + 1]) {
      result.push({ kind: 'removed', text: leftLines[leftIndex], leftLine: leftIndex + 1 })
      leftIndex += 1
    } else {
      result.push({ kind: 'added', text: rightLines[rightIndex], rightLine: rightIndex + 1 })
      rightIndex += 1
    }
  }
  while (leftIndex < leftLines.length) result.push({ kind: 'removed', text: leftLines[leftIndex], leftLine: ++leftIndex })
  while (rightIndex < rightLines.length) result.push({ kind: 'added', text: rightLines[rightIndex], rightLine: ++rightIndex })
  return result
}
