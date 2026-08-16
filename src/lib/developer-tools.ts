import { JSON_SCHEMA, dump, load } from 'js-yaml'

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

export type JsonYamlDirection = 'json-to-yaml' | 'yaml-to-json'
export type CsvJsonDirection = 'csv-to-json' | 'json-to-csv'

const STRUCTURED_TEXT_MAX_BYTES = 2 * 1024 * 1024

function assertStructuredTextSize(value: string) {
  if (new TextEncoder().encode(value).byteLength > STRUCTURED_TEXT_MAX_BYTES) {
    throw new Error('结构化文本超过 2 MB，请先拆分后再转换。')
  }
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

type JsonPathToken =
  | { kind: 'property'; name: string }
  | { kind: 'index'; index: number }
  | { kind: 'wildcard' }
  | { kind: 'recursive'; name: string }

function parseJsonPath(value: string): JsonPathToken[] {
  const expression = value.trim()
  if (!expression.startsWith('$')) throw new Error('JSONPath 必须以 $ 开头。')
  const tokens: JsonPathToken[] = []
  let cursor = 1
  while (cursor < expression.length) {
    if (expression.startsWith('..', cursor)) {
      cursor += 2
      const match = /^[A-Za-z_$][\w$-]*/.exec(expression.slice(cursor))
      if (!match) throw new Error('递归查询后需要字段名，例如 $..name。')
      tokens.push({ kind: 'recursive', name: match[0] })
      cursor += match[0].length
      continue
    }
    if (expression[cursor] === '.') {
      cursor += 1
      const match = /^[A-Za-z_$][\w$-]*/.exec(expression.slice(cursor))
      if (!match) throw new Error('点号后需要字段名，例如 $.user.name。')
      tokens.push({ kind: 'property', name: match[0] })
      cursor += match[0].length
      continue
    }
    if (expression[cursor] === '[') {
      const end = expression.indexOf(']', cursor + 1)
      if (end < 0) throw new Error('JSONPath 缺少右方括号。')
      const raw = expression.slice(cursor + 1, end).trim()
      if (raw === '*') tokens.push({ kind: 'wildcard' })
      else if (/^\d+$/.test(raw)) tokens.push({ kind: 'index', index: Number(raw) })
      else {
        const quoted = /^(?:'([^']+)'|"([^"]+)")$/.exec(raw)
        if (!quoted) throw new Error('方括号仅支持数字、* 或带引号的字段名。')
        tokens.push({ kind: 'property', name: quoted[1] ?? quoted[2] })
      }
      cursor = end + 1
      continue
    }
    throw new Error(`无法解析 JSONPath 的“${expression[cursor]}”。`)
  }
  return tokens
}

function appendJsonPath(path: string, name: string) {
  return /^[A-Za-z_$][\w$-]*$/.test(name) ? `${path}.${name}` : `${path}[${JSON.stringify(name)}]`
}

function collectRecursiveJsonPath(value: unknown, path: string, name: string, matches: { value: unknown; path: string }[], seen: Set<object>, depth = 0) {
  if (depth > 64 || matches.length >= 1000 || value === null || typeof value !== 'object') return
  if (seen.has(value)) return
  seen.add(value)
  for (const [key, child] of Object.entries(value)) {
    const childPath = appendJsonPath(path, key)
    if (key === name) matches.push({ value: child, path: childPath })
    collectRecursiveJsonPath(child, childPath, name, matches, seen, depth + 1)
    if (matches.length >= 1000) return
  }
}

export function transformJsonPath(value: string, expression: string) {
  if (!value.trim()) throw new Error('请输入 JSON 内容。')
  if (!expression.trim()) throw new Error('请输入 JSONPath 查询，例如 $.users[0].name。')
  assertStructuredTextSize(value)
  let root: unknown
  try {
    root = JSON.parse(value)
  } catch (reason) {
    const detail = reason instanceof Error ? reason.message : '语法错误'
    throw new Error(`JSON 解析失败：${detail}`)
  }
  const tokens = parseJsonPath(expression)
  let matches = [{ value: root, path: '$' }]
  for (const token of tokens) {
    if (token.kind === 'recursive') {
      const next: { value: unknown; path: string }[] = []
      for (const match of matches) collectRecursiveJsonPath(match.value, match.path, token.name, next, new Set())
      matches = next
      continue
    }
    const next: { value: unknown; path: string }[] = []
    for (const match of matches) {
      if (match.value === null || typeof match.value !== 'object') continue
      if (token.kind === 'property' && Object.prototype.hasOwnProperty.call(match.value, token.name)) {
        next.push({ value: (match.value as Record<string, unknown>)[token.name], path: appendJsonPath(match.path, token.name) })
      } else if (token.kind === 'index' && Array.isArray(match.value) && token.index < match.value.length) {
        next.push({ value: match.value[token.index], path: `${match.path}[${token.index}]` })
      } else if (token.kind === 'wildcard') {
        Object.entries(match.value).forEach(([key, child]) => next.push({ value: child, path: appendJsonPath(match.path, key) }))
      }
      if (next.length >= 1000) break
    }
    matches = next.slice(0, 1000)
  }
  const result = matches.length === 1 ? matches[0].value : matches.map((match) => match.value)
  return JSON.stringify(result, null, 2)
}

export function transformJsonYaml(value: string, direction: JsonYamlDirection) {
  if (!value.trim()) throw new Error('请输入 JSON 或 YAML 内容。')
  assertStructuredTextSize(value)
  try {
    if (direction === 'json-to-yaml') {
      return dump(JSON.parse(value), { noRefs: true, lineWidth: -1, sortKeys: false })
    }
    const parsed = load(value, { schema: JSON_SCHEMA })
    if (parsed === undefined) throw new Error('YAML 内容为空。')
    return JSON.stringify(parsed, null, 2)
  } catch (reason) {
    const detail = reason instanceof Error ? reason.message : '语法错误'
    throw new Error(`${direction === 'json-to-yaml' ? 'JSON' : 'YAML'} 解析失败：${detail}`)
  }
}

function parseCsvRows(value: string) {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index]
    if (quoted) {
      if (character === '"' && value[index + 1] === '"') {
        cell += '"'
        index += 1
      } else if (character === '"') {
        quoted = false
      } else {
        cell += character
      }
    } else if (character === '"' && cell === '') {
      quoted = true
    } else if (character === ',') {
      row.push(cell)
      cell = ''
    } else if (character === '\n' || character === '\r') {
      row.push(cell)
      if (row.some((item) => item.length > 0) || rows.length === 0) rows.push(row)
      row = []
      cell = ''
      if (character === '\r' && value[index + 1] === '\n') index += 1
    } else {
      cell += character
    }
  }
  if (quoted) throw new Error('CSV 引号未闭合，请检查字段内容。')
  if (cell || row.length) row.push(cell)
  if (row.length && (row.some((item) => item.length > 0) || rows.length === 0)) rows.push(row)
  if (!rows.length) throw new Error('CSV 内容为空。')
  if (rows.length > 10_001) throw new Error('CSV 最多支持 10000 行数据。')
  return rows
}

function uniqueCsvHeaders(values: string[]) {
  const seen = new Map<string, number>()
  return values.map((value, index) => {
    const base = value.trim() || `column_${index + 1}`
    const count = (seen.get(base) ?? 0) + 1
    seen.set(base, count)
    return count === 1 ? base : `${base}_${count}`
  })
}

function csvCell(value: unknown) {
  if (value === null || value === undefined) return ''
  const text = typeof value === 'object' ? JSON.stringify(value) : String(value)
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

export function transformCsvJson(value: string, direction: CsvJsonDirection) {
  if (!value.trim()) throw new Error('请输入 CSV 或 JSON 内容。')
  assertStructuredTextSize(value)
  try {
    if (direction === 'csv-to-json') {
      const rows = parseCsvRows(value)
      const headers = uniqueCsvHeaders(rows[0])
      const records = rows.slice(1).map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ''])))
      return JSON.stringify(records, null, 2)
    }
    const parsed: unknown = JSON.parse(value)
    if (!Array.isArray(parsed) || parsed.some((item) => item === null || typeof item !== 'object' || Array.isArray(item))) {
      throw new Error('JSON → CSV 需要一个对象数组，例如 [{"name":"Ada"}]。')
    }
    const headers = [...new Set(parsed.flatMap((item) => Object.keys(item as Record<string, unknown>)))]
    if (!headers.length) throw new Error('对象数组没有可导出的字段。')
    return [headers.map(csvCell).join(','), ...parsed.map((item) => headers.map((header) => csvCell((item as Record<string, unknown>)[header])).join(','))].join('\r\n') + '\r\n'
  } catch (reason) {
    const detail = reason instanceof Error ? reason.message : '语法错误'
    throw new Error(`${direction === 'csv-to-json' ? 'CSV' : 'JSON'} 解析失败：${detail}`)
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
