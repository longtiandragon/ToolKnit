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

export interface CidrResult {
  address: string
  prefix: number
  network: string
  broadcast: string
  netmask: string
  wildcard: string
  firstHost: string
  lastHost: string
  totalAddresses: string
  usableHosts: string
}

export interface ColorResult {
  hex: string
  rgb: { r: number; g: number; b: number; alpha: number }
  hsl: { h: number; s: number; l: number; alpha: number }
  cssRgb: string
  cssHsl: string
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
export type HtmlEntityDirection = 'encode' | 'decode'
export type JsonSchemaDirection = 'generate' | 'validate'

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

export function encodeHex(value: string) {
  assertStructuredTextSize(value)
  const bytes = new TextEncoder().encode(value)
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('').toUpperCase()
}

export function decodeHex(value: string) {
  const normalized = value.trim().replace(/^0x/i, '').replace(/\s+/g, '')
  if (!normalized) throw new Error('请输入需要解码的 Hex 内容。')
  if (!/^[\da-f]+$/i.test(normalized)) throw new Error('Hex 只能包含 0-9 和 A-F 字符，可使用空格分隔。')
  if (normalized.length % 2 !== 0) throw new Error('Hex 字符数量必须是偶数，每两个字符代表一个字节。')
  assertStructuredTextSize(normalized)
  const bytes = Uint8Array.from({ length: normalized.length / 2 }, (_, index) => Number.parseInt(normalized.slice(index * 2, index * 2 + 2), 16))
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    throw new Error('Hex 已成功还原为字节，但内容不是有效的 UTF-8 文本。')
  }
}

function parseIpv4(value: string) {
  const parts = value.trim().split('.')
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part) || Number(part) > 255)) throw new Error(`IPv4 地址“${value}”无效。`)
  return parts.reduce((result, part) => (result << 8n) | BigInt(Number(part)), 0n)
}

function formatIpv4(value: bigint) {
  return [24n, 16n, 8n, 0n].map((shift) => Number((value >> shift) & 255n)).join('.')
}

export function calculateCidr(value: string): CidrResult {
  const [addressValue, prefixValue, ...extra] = value.trim().split('/')
  if (!addressValue || prefixValue === undefined || extra.length) throw new Error('请输入 IPv4 CIDR，例如 192.168.1.25/24。')
  const prefix = Number(prefixValue)
  if (!/^\d+$/.test(prefixValue) || !Number.isInteger(prefix) || prefix < 0 || prefix > 32) throw new Error('CIDR 前缀长度需要在 0 到 32 之间。')
  const address = parseIpv4(addressValue)
  const mask = prefix === 0 ? 0n : (0xffffffffn << BigInt(32 - prefix)) & 0xffffffffn
  const network = address & mask
  const broadcast = network | (0xffffffffn ^ mask)
  const total = broadcast - network + 1n
  const firstHost = prefix >= 31 ? network : network + 1n
  const lastHost = prefix >= 31 ? broadcast : broadcast - 1n
  return {
    address: formatIpv4(address),
    prefix,
    network: formatIpv4(network),
    broadcast: formatIpv4(broadcast),
    netmask: formatIpv4(mask),
    wildcard: formatIpv4(0xffffffffn ^ mask),
    firstHost: formatIpv4(firstHost),
    lastHost: formatIpv4(lastHost),
    totalAddresses: total.toString(),
    usableHosts: (prefix >= 31 ? total : total - 2n).toString(),
  }
}

function clampColor(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value))
}

function parseColorChannel(value: string) {
  if (value.endsWith('%')) {
    const percentage = Number(value.slice(0, -1))
    if (!Number.isFinite(percentage) || percentage < 0 || percentage > 100) throw new Error(`颜色通道“${value}”需要在 0% 到 100% 之间。`)
    return Math.round(percentage * 2.55)
  }
  const numeric = Number(value)
  if (!Number.isFinite(numeric) || numeric < 0 || numeric > 255) throw new Error(`颜色通道“${value}”需要在 0 到 255 之间。`)
  return Math.round(numeric)
}

function parseColorAlpha(value: string | undefined) {
  if (value === undefined) return 1
  const alpha = value.endsWith('%') ? Number(value.slice(0, -1)) / 100 : Number(value)
  if (!Number.isFinite(alpha) || alpha < 0 || alpha > 1) throw new Error(`透明度“${value}”需要在 0 到 1 或 0% 到 100% 之间。`)
  return Math.round(alpha * 1000) / 1000
}

function parseHue(value: string) {
  const match = /^(-?(?:\d+(?:\.\d*)?|\.\d+))(deg|grad|rad|turn)?$/i.exec(value)
  if (!match) throw new Error(`色相“${value}”不是有效角度。`)
  const number = Number(match[1])
  const unit = match[2]?.toLowerCase()
  const degrees = unit === 'grad' ? number * 0.9 : unit === 'rad' ? number * 180 / Math.PI : unit === 'turn' ? number * 360 : number
  return ((degrees % 360) + 360) % 360
}

function rgbToHsl(red: number, green: number, blue: number) {
  const r = red / 255
  const g = green / 255
  const b = blue / 255
  const maximum = Math.max(r, g, b)
  const minimum = Math.min(r, g, b)
  const lightness = (maximum + minimum) / 2
  if (maximum === minimum) return { h: 0, s: 0, l: Math.round(lightness * 10000) / 100 }
  const delta = maximum - minimum
  const saturation = lightness > 0.5 ? delta / (2 - maximum - minimum) : delta / (maximum + minimum)
  let hue = maximum === r ? (g - b) / delta + (g < b ? 6 : 0) : maximum === g ? (b - r) / delta + 2 : (r - g) / delta + 4
  hue /= 6
  return { h: Math.round(hue * 36000) / 100, s: Math.round(saturation * 10000) / 100, l: Math.round(lightness * 10000) / 100 }
}

function hslToRgb(hue: number, saturation: number, lightness: number) {
  const h = hue / 360
  const s = saturation / 100
  const l = lightness / 100
  if (s === 0) {
    const value = Math.round(l * 255)
    return { r: value, g: value, b: value }
  }
  const hueToRgb = (p: number, q: number, t: number) => {
    let normalized = t
    if (normalized < 0) normalized += 1
    if (normalized > 1) normalized -= 1
    if (normalized < 1 / 6) return p + (q - p) * 6 * normalized
    if (normalized < 1 / 2) return q
    if (normalized < 2 / 3) return p + (q - p) * (2 / 3 - normalized) * 6
    return p
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  return { r: Math.round(hueToRgb(p, q, h + 1 / 3) * 255), g: Math.round(hueToRgb(p, q, h) * 255), b: Math.round(hueToRgb(p, q, h - 1 / 3) * 255) }
}

export function convertColor(value: string): ColorResult {
  if (!value.trim()) throw new Error('请输入颜色，例如 #3B82F6、rgb(59 130 246) 或 hsl(217 91% 60%)。')
  assertStructuredTextSize(value)
  const input = value.trim()
  let red: number
  let green: number
  let blue: number
  let alpha = 1
  const hex = /^#([\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})$/i.exec(input)
  if (hex) {
    const digits = hex[1]
    const expanded = digits.length <= 4 ? digits.split('').map((digit) => digit + digit).join('') : digits
    red = Number.parseInt(expanded.slice(0, 2), 16)
    green = Number.parseInt(expanded.slice(2, 4), 16)
    blue = Number.parseInt(expanded.slice(4, 6), 16)
    if (expanded.length === 8) alpha = Math.round((Number.parseInt(expanded.slice(6, 8), 16) / 255) * 1000) / 1000
  } else {
    const rgb = /^rgba?\((.*)\)$/i.exec(input)
    const hsl = /^hsla?\((.*)\)$/i.exec(input)
    if (rgb) {
      const parts = rgb[1].trim().split(/[\s,\/]+/).filter(Boolean)
      if (parts.length < 3 || parts.length > 4) throw new Error('RGB 需要三个通道，可选第四项透明度。')
      red = parseColorChannel(parts[0])
      green = parseColorChannel(parts[1])
      blue = parseColorChannel(parts[2])
      alpha = parseColorAlpha(parts[3])
    } else if (hsl) {
      const parts = hsl[1].trim().split(/[\s,\/]+/).filter(Boolean)
      if (parts.length < 3 || parts.length > 4 || !parts[1].endsWith('%') || !parts[2].endsWith('%')) throw new Error('HSL 需要色相、饱和度百分比和明度百分比。')
      const hue = parseHue(parts[0])
      const saturation = clampColor(Number(parts[1].slice(0, -1)), 0, 100)
      const lightness = clampColor(Number(parts[2].slice(0, -1)), 0, 100)
      if (![saturation, lightness].every(Number.isFinite)) throw new Error('HSL 的饱和度和明度必须是数字。')
      const rgbValue = hslToRgb(hue, saturation, lightness)
      red = rgbValue.r
      green = rgbValue.g
      blue = rgbValue.b
      alpha = parseColorAlpha(parts[3])
    } else throw new Error('仅支持 #Hex、rgb()/rgba() 和 hsl()/hsla() 颜色。')
  }
  const hslValue = rgbToHsl(red, green, blue)
  const alphaHex = Math.round(alpha * 255).toString(16).padStart(2, '0').toUpperCase()
  const hexValue = `#${[red, green, blue].map((channel) => channel.toString(16).padStart(2, '0')).join('').toUpperCase()}${alpha < 1 ? alphaHex : ''}`
  const rgbValue = { r: red, g: green, b: blue, alpha }
  const hslOutput = { ...hslValue, alpha }
  return {
    hex: hexValue,
    rgb: rgbValue,
    hsl: hslOutput,
    cssRgb: alpha < 1 ? `rgba(${red}, ${green}, ${blue}, ${alpha})` : `rgb(${red}, ${green}, ${blue})`,
    cssHsl: alpha < 1 ? `hsla(${hslValue.h}, ${hslValue.s}%, ${hslValue.l}%, ${alpha})` : `hsl(${hslValue.h}, ${hslValue.s}%, ${hslValue.l}%)`,
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

type SqlToken = { kind: 'word' | 'quoted' | 'string' | 'number' | 'operator' | 'punctuation' | 'comment'; value: string }

const SQL_KEYWORDS = new Set([
  'all', 'and', 'as', 'asc', 'between', 'by', 'case', 'cast', 'create', 'delete', 'desc', 'distinct', 'else', 'end', 'exists', 'from', 'full', 'having', 'in', 'inner', 'insert', 'into', 'is', 'join', 'left', 'like', 'limit', 'not', 'null', 'offset', 'on', 'or', 'order', 'outer', 'over', 'partition', 'right', 'select', 'set', 'then', 'union', 'update', 'using', 'values', 'when', 'where', 'with', 'returning', 'cross', 'group', 'table', 'as', 'primary', 'key', 'references', 'alter', 'drop', 'view', 'index', 'begin', 'commit', 'rollback',
])
const SQL_CLAUSES = new Set(['select', 'from', 'where', 'having', 'order', 'group', 'limit', 'offset', 'union', 'returning', 'values', 'set', 'with', 'join', 'left', 'right', 'inner', 'outer', 'cross'])
const SQL_FUNCTIONS = new Set(['avg', 'cast', 'coalesce', 'concat', 'count', 'date', 'datetime', 'json_extract', 'lower', 'max', 'min', 'sum', 'trim', 'upper'])
const SQL_OPERATORS = ['::', '<=', '>=', '<>', '!=', '||', '&&', ':=', '+=', '-=', '*=', '/=', '=>', '=', '<', '>', '+', '-', '*', '/', '%']

function tokenizeSql(value: string) {
  const tokens: SqlToken[] = []
  let cursor = 0
  while (cursor < value.length) {
    const character = value[cursor]
    if (/\s/.test(character)) { cursor += 1; continue }
    if (value.startsWith('--', cursor)) {
      const end = value.indexOf('\n', cursor + 2)
      tokens.push({ kind: 'comment', value: value.slice(cursor, end < 0 ? value.length : end).trim() })
      cursor = end < 0 ? value.length : end + 1
      continue
    }
    if (value.startsWith('/*', cursor)) {
      const end = value.indexOf('*/', cursor + 2)
      if (end < 0) throw new Error('SQL 块注释缺少结束标记。')
      tokens.push({ kind: 'comment', value: value.slice(cursor, end + 2).trim() })
      cursor = end + 2
      continue
    }
    if (character === "'" || character === '"' || character === '`' || character === '[') {
      const quote = character === '[' ? ']' : character
      let end = cursor + 1
      let closed = false
      while (end < value.length) {
        if (value[end] === quote) {
          if (value[end + 1] === quote) { end += 2; continue }
          closed = true
          end += 1
          break
        }
        end += 1
      }
      if (!closed) throw new Error('SQL 字符串或标识符缺少结束引号。')
      tokens.push({ kind: character === "'" ? 'string' : 'quoted', value: value.slice(cursor, end) })
      cursor = end
      continue
    }
    const word = /^[A-Za-z_][\w$]*/.exec(value.slice(cursor))
    if (word) {
      tokens.push({ kind: 'word', value: word[0] })
      cursor += word[0].length
      continue
    }
    const number = /^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/.exec(value.slice(cursor))
    if (number) {
      tokens.push({ kind: 'number', value: number[0] })
      cursor += number[0].length
      continue
    }
    const operator = SQL_OPERATORS.find((candidate) => value.startsWith(candidate, cursor))
    if (operator) {
      tokens.push({ kind: 'operator', value: operator })
      cursor += operator.length
      continue
    }
    if ('(),.;'.includes(character)) {
      tokens.push({ kind: 'punctuation', value: character })
      cursor += 1
      continue
    }
    throw new Error(`无法识别 SQL 字符“${character}”。`)
  }
  return tokens
}

export function formatSql(value: string) {
  if (!value.trim()) throw new Error('请输入 SQL 内容。')
  assertStructuredTextSize(value)
  const tokens = tokenizeSql(value)
  const lines: string[] = []
  let line = ''
  let depth = 0
  let continuation = false
  let previous: SqlToken | undefined
  const indent = () => '  '.repeat(Math.max(0, depth + (continuation ? 1 : 0)))
  const newline = (nextIndent = true) => {
    const trimmed = line.trimEnd()
    if (trimmed) lines.push(trimmed)
    line = nextIndent ? indent() : ''
    continuation = false
  }
  const append = (text: string, needsSpace = false) => {
    if (!line) line = indent()
    if (needsSpace && line.trim() && !line.endsWith(' ') && !line.endsWith('(') && !line.endsWith('.')) line += ' '
    line += text
  }

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]
    const normalized = token.kind === 'word' && (SQL_KEYWORDS.has(token.value.toLowerCase()) || SQL_FUNCTIONS.has(token.value.toLowerCase())) ? token.value.toUpperCase() : token.value
    const lower = token.kind === 'word' ? token.value.toLowerCase() : ''
    if (token.kind === 'comment') {
      if (line.trim()) newline()
      const commentLines = token.value.split(/\r?\n/)
      commentLines.forEach((comment, commentIndex) => {
        if (commentIndex) newline()
        append(comment.trim())
      })
      newline(false)
      previous = token
      continue
    }
    if (token.kind === 'punctuation' && token.value === ')') {
      depth = Math.max(0, depth - 1)
      if (line.endsWith(' ')) line = line.trimEnd()
      append(')')
      previous = token
      continue
    }
    if (token.kind === 'punctuation' && token.value === '(') {
      append('(', Boolean(previous) && !(previous?.kind === 'word' && SQL_FUNCTIONS.has(previous.value.toLowerCase())))
      depth += 1
      previous = token
      continue
    }
    if (token.kind === 'punctuation' && token.value === ',') {
      append(',')
      if (depth === 0) newline()
      else append(' ')
      previous = token
      continue
    }
    if (token.kind === 'punctuation' && token.value === ';') {
      append(';')
      newline(false)
      previous = token
      continue
    }
    if (token.kind === 'punctuation' && token.value === '.') {
      append('.')
      previous = token
      continue
    }
    if (token.kind === 'operator') {
      append(token.value, true)
      append(' ')
      previous = token
      continue
    }
    const isClause = token.kind === 'word' && SQL_CLAUSES.has(lower)
    const previousWasModifier = previous?.kind === 'word' && ['left', 'right', 'inner', 'outer', 'cross', 'group', 'order'].includes(previous.value.toLowerCase())
    if (isClause && line.trim() && !previousWasModifier) newline()
    if ((lower === 'and' || lower === 'or') && line.trim()) {
      continuation = true
      newline()
      append(normalized)
      continuation = false
    } else {
      const needsSpace = Boolean(previous && previous.kind !== 'punctuation' && previous.kind !== 'operator' && previous.value !== '(' && previous.value !== '.')
      append(normalized, needsSpace)
    }
    previous = token
  }
  if (line.trim()) newline(false)
  return lines.join('\n')
}

type JsonSchemaObject = Record<string, unknown>

const JSON_SCHEMA_MAX_DEPTH = 32
const JSON_SCHEMA_MAX_NODES = 2_000
const JSON_SCHEMA_MAX_ERRORS = 100

function jsonSchemaPath(path: string, key: string | number) {
  if (typeof key === 'number') return `${path}[${key}]`
  return /^[A-Za-z_$][\w$-]*$/.test(key) ? `${path}.${key}` : `${path}[${JSON.stringify(key)}]`
}

function schemaJsonEqual(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right)
}

function mergeJsonSchemas(left: JsonSchemaObject, right: JsonSchemaObject): JsonSchemaObject {
  if (schemaJsonEqual(left, right)) return left
  const leftType = left.type
  const rightType = right.type
  if (leftType === 'object' && rightType === 'object') {
    const leftProperties = (left.properties && typeof left.properties === 'object' ? left.properties : {}) as JsonSchemaObject
    const rightProperties = (right.properties && typeof right.properties === 'object' ? right.properties : {}) as JsonSchemaObject
    const keys = [...new Set([...Object.keys(leftProperties), ...Object.keys(rightProperties)])]
    const properties: JsonSchemaObject = {}
    for (const key of keys) {
      if (key in leftProperties && key in rightProperties) properties[key] = mergeJsonSchemas(leftProperties[key] as JsonSchemaObject, rightProperties[key] as JsonSchemaObject)
      else properties[key] = (leftProperties[key] ?? rightProperties[key]) as JsonSchemaObject
    }
    const leftRequired = new Set(Array.isArray(left.required) ? left.required.filter((item): item is string => typeof item === 'string') : [])
    const rightRequired = new Set(Array.isArray(right.required) ? right.required.filter((item): item is string => typeof item === 'string') : [])
    const required = [...leftRequired].filter((key) => rightRequired.has(key))
    return {
      type: 'object',
      properties,
      ...(required.length ? { required } : {}),
    }
  }
  if (leftType === 'array' && rightType === 'array') {
    const leftItems = left.items && typeof left.items === 'object' ? left.items as JsonSchemaObject : undefined
    const rightItems = right.items && typeof right.items === 'object' ? right.items as JsonSchemaObject : undefined
    return { type: 'array', ...(leftItems && rightItems ? { items: mergeJsonSchemas(leftItems, rightItems) } : leftItems || rightItems ? { items: leftItems ?? rightItems } : {}) }
  }
  const alternatives = [left, right]
  return { anyOf: alternatives.filter((schema, index) => alternatives.findIndex((item) => schemaJsonEqual(item, schema)) === index) }
}

function inferJsonSchema(value: unknown, state: { nodes: number }, depth = 0): JsonSchemaObject {
  if (depth > JSON_SCHEMA_MAX_DEPTH) throw new Error(`JSON 嵌套超过 ${JSON_SCHEMA_MAX_DEPTH} 层，无法安全生成 Schema。`)
  state.nodes += 1
  if (state.nodes > JSON_SCHEMA_MAX_NODES) throw new Error(`JSON 结构超过 ${JSON_SCHEMA_MAX_NODES} 个节点，请先缩小样例。`)
  if (value === null) return { type: 'null' }
  if (typeof value === 'string') return { type: 'string' }
  if (typeof value === 'boolean') return { type: 'boolean' }
  if (typeof value === 'number') return { type: Number.isInteger(value) ? 'integer' : 'number' }
  if (Array.isArray(value)) {
    const items = value.map((item) => inferJsonSchema(item, state, depth + 1))
    const merged = items.reduce<JsonSchemaObject | undefined>((schema, item) => schema ? mergeJsonSchemas(schema, item) : item, undefined)
    return { type: 'array', ...(merged ? { items: merged } : {}) }
  }
  if (typeof value === 'object') {
    const object = value as Record<string, unknown>
    const properties = Object.fromEntries(Object.entries(object).map(([key, child]) => [key, inferJsonSchema(child, state, depth + 1)]))
    return { type: 'object', properties, ...(Object.keys(properties).length ? { required: Object.keys(properties) } : {}) }
  }
  return {}
}

function schemaTypeMatches(value: unknown, type: string) {
  if (type === 'null') return value === null
  if (type === 'object') return value !== null && typeof value === 'object' && !Array.isArray(value)
  if (type === 'array') return Array.isArray(value)
  if (type === 'integer') return typeof value === 'number' && Number.isInteger(value)
  if (type === 'number') return typeof value === 'number' && Number.isFinite(value)
  return typeof value === type
}

function validateJsonSchemaValue(value: unknown, schema: JsonSchemaObject, path: string, errors: Array<{ path: string; message: string; keyword?: string }>, depth = 0): boolean {
  if (errors.length >= JSON_SCHEMA_MAX_ERRORS) return false
  if (depth > JSON_SCHEMA_MAX_DEPTH) {
    errors.push({ path, message: `嵌套超过 ${JSON_SCHEMA_MAX_DEPTH} 层`, keyword: 'depth' })
    return false
  }
  let valid = true
  const fail = (message: string, keyword?: string) => {
    if (errors.length < JSON_SCHEMA_MAX_ERRORS) errors.push({ path, message, ...(keyword ? { keyword } : {}) })
    valid = false
  }
  if ('const' in schema && !schemaJsonEqual(value, schema.const)) fail('必须等于 Schema 中的 const 值。', 'const')
  if (Array.isArray(schema.enum) && !schema.enum.some((item) => schemaJsonEqual(item, value))) fail('不在允许的 enum 值中。', 'enum')

  if (Array.isArray(schema.anyOf)) {
    const matches = schema.anyOf.some((candidate) => candidate && typeof candidate === 'object' && validateJsonSchemaValue(value, candidate as JsonSchemaObject, path, [] , depth + 1))
    if (!matches) fail('不满足 anyOf 中的任一条件。', 'anyOf')
  }
  if (Array.isArray(schema.oneOf)) {
    const matches = schema.oneOf.filter((candidate) => candidate && typeof candidate === 'object' && validateJsonSchemaValue(value, candidate as JsonSchemaObject, path, [], depth + 1)).length
    if (matches !== 1) fail(`必须恰好满足 oneOf 中的一个条件，实际满足 ${matches} 个。`, 'oneOf')
  }
  if (Array.isArray(schema.allOf)) {
    for (const candidate of schema.allOf) if (candidate && typeof candidate === 'object') valid = validateJsonSchemaValue(value, candidate as JsonSchemaObject, path, errors, depth + 1) && valid
  }

  if (typeof schema.type === 'string' && !schemaTypeMatches(value, schema.type)) fail(`类型应为 ${schema.type}。`, 'type')
  if (Array.isArray(schema.type) && (!schema.type.length || !schema.type.some((type): type is string => typeof type === 'string' && schemaTypeMatches(value, type)))) fail(`类型应为 ${schema.type.join(' 或 ')}。`, 'type')
  if (typeof value === 'string') {
    if (typeof schema.minLength === 'number' && value.length < schema.minLength) fail(`长度不能少于 ${schema.minLength}。`, 'minLength')
    if (typeof schema.maxLength === 'number' && value.length > schema.maxLength) fail(`长度不能超过 ${schema.maxLength}。`, 'maxLength')
    if (typeof schema.pattern === 'string') {
      try { if (!new RegExp(schema.pattern).test(value)) fail('不匹配 Schema 的 pattern。', 'pattern') } catch { fail('Schema 的 pattern 不是有效正则。', 'pattern') }
    }
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    if (typeof schema.minimum === 'number' && value < schema.minimum) fail(`不能小于 ${schema.minimum}。`, 'minimum')
    if (typeof schema.maximum === 'number' && value > schema.maximum) fail(`不能大于 ${schema.maximum}。`, 'maximum')
    if (schema.exclusiveMinimum === true && typeof schema.minimum === 'number' && value <= schema.minimum) fail(`必须大于 ${schema.minimum}。`, 'exclusiveMinimum')
    if (schema.exclusiveMaximum === true && typeof schema.maximum === 'number' && value >= schema.maximum) fail(`必须小于 ${schema.maximum}。`, 'exclusiveMaximum')
  }
  if (Array.isArray(value)) {
    if (typeof schema.minItems === 'number' && value.length < schema.minItems) fail(`项目数不能少于 ${schema.minItems}。`, 'minItems')
    if (typeof schema.maxItems === 'number' && value.length > schema.maxItems) fail(`项目数不能超过 ${schema.maxItems}。`, 'maxItems')
    if (schema.items && typeof schema.items === 'object' && !Array.isArray(schema.items)) value.forEach((item, index) => validateJsonSchemaValue(item, schema.items as JsonSchemaObject, jsonSchemaPath(path, index), errors, depth + 1))
  }
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    const object = value as Record<string, unknown>
    const properties = schema.properties && typeof schema.properties === 'object' ? schema.properties as JsonSchemaObject : {}
    if (Array.isArray(schema.required)) for (const key of schema.required) if (typeof key === 'string' && !(key in object)) fail(`缺少必填字段“${key}”。`, 'required')
    for (const [key, child] of Object.entries(object)) {
      const childSchema = properties[key]
      if (key in properties && childSchema && typeof childSchema === 'object' && !Array.isArray(childSchema)) validateJsonSchemaValue(child, childSchema as JsonSchemaObject, jsonSchemaPath(path, key), errors, depth + 1)
      else if (key in properties) fail(`字段“${key}”的 Schema 必须是对象。`, 'schema')
      else if (schema.additionalProperties === false) fail(`不允许出现字段“${key}”。`, 'additionalProperties')
    }
  }
  return valid && errors.length === 0
}

export function transformJsonSchema(value: string, direction: JsonSchemaDirection, schemaValue = '') {
  if (!value.trim()) throw new Error(direction === 'generate' ? '请输入用于生成 Schema 的 JSON 样例。' : '请输入需要校验的 JSON 内容。')
  assertStructuredTextSize(value)
  try {
    if (direction === 'generate') {
      const sample = JSON.parse(value)
      const generated = inferJsonSchema(sample, { nodes: 0 })
      return JSON.stringify({ $schema: 'https://json-schema.org/draft/2020-12/schema', ...generated }, null, 2)
    }
    if (!schemaValue.trim()) throw new Error('请输入 JSON Schema。')
    assertStructuredTextSize(schemaValue)
    const document = JSON.parse(value)
    const schema = JSON.parse(schemaValue) as unknown
    if (!schema || typeof schema !== 'object' || Array.isArray(schema)) throw new Error('JSON Schema 必须是对象。')
    const errors: Array<{ path: string; message: string; keyword?: string }> = []
    validateJsonSchemaValue(document, schema as JsonSchemaObject, '$', errors)
    return JSON.stringify({ valid: errors.length === 0, errorCount: errors.length, errors: errors.slice(0, JSON_SCHEMA_MAX_ERRORS) }, null, 2)
  } catch (reason) {
    const detail = reason instanceof Error ? reason.message : '语法错误'
    throw new Error(`${direction === 'generate' ? 'JSON 样例' : 'JSON / Schema'} 解析失败：${detail}`)
  }
}

const HTML_ENTITY_ENCODE_MAP: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}

const HTML_ENTITY_DECODE_MAP: Record<string, string> = {
  amp: '&',
  apos: "'",
  gt: '>',
  lt: '<',
  nbsp: '\u00a0',
  quot: '"',
  copy: '\u00a9',
  reg: '\u00ae',
  hellip: '\u2026',
  ndash: '\u2013',
  mdash: '\u2014',
}

export function transformHtmlEntities(value: string, direction: HtmlEntityDirection) {
  if (!value.trim()) throw new Error('请输入需要转换的文本。')
  assertStructuredTextSize(value)
  if (direction === 'encode') return value.replace(/[&<>"']/g, (character) => HTML_ENTITY_ENCODE_MAP[character])
  return value.replace(/&(?:#(x[\da-f]+|\d+)|([a-z][a-z\d]+));/gi, (entity, numeric: string | undefined, named: string | undefined) => {
    if (named) return HTML_ENTITY_DECODE_MAP[named.toLowerCase()] ?? entity
    const value = numeric?.toLowerCase().startsWith('x') ? Number.parseInt(numeric.slice(1), 16) : Number.parseInt(numeric ?? '', 10)
    if (!Number.isInteger(value) || value < 0 || value > 0x10ffff || (value >= 0xd800 && value <= 0xdfff)) return entity
    try { return String.fromCodePoint(value) } catch { return entity }
  })
}

type XmlToken = { kind: 'tag' | 'text' | 'comment' | 'cdata'; value: string }

function scanXmlTokens(value: string) {
  const tokens: XmlToken[] = []
  let cursor = 0
  let textStart = 0
  const pushText = (end: number) => {
    if (end > textStart) tokens.push({ kind: 'text', value: value.slice(textStart, end) })
  }
  while (cursor < value.length) {
    if (value[cursor] !== '<') { cursor += 1; continue }
    pushText(cursor)
    if (value.startsWith('<!--', cursor)) {
      const end = value.indexOf('-->', cursor + 4)
      if (end < 0) throw new Error('XML 注释缺少结束标记。')
      tokens.push({ kind: 'comment', value: value.slice(cursor, end + 3) })
      cursor = end + 3
      textStart = cursor
      continue
    }
    if (value.startsWith('<![CDATA[', cursor)) {
      const end = value.indexOf(']]>', cursor + 9)
      if (end < 0) throw new Error('XML CDATA 缺少结束标记。')
      tokens.push({ kind: 'cdata', value: value.slice(cursor, end + 3) })
      cursor = end + 3
      textStart = cursor
      continue
    }
    let end = cursor + 1
    let quote = ''
    while (end < value.length) {
      const character = value[end]
      if (quote) {
        if (character === quote) quote = ''
      } else if (character === '"' || character === "'") {
        quote = character
      } else if (character === '>') {
        break
      }
      end += 1
    }
    if (end >= value.length) throw new Error('XML 标签缺少右尖括号。')
    tokens.push({ kind: 'tag', value: value.slice(cursor, end + 1).trim() })
    cursor = end + 1
    textStart = cursor
  }
  pushText(value.length)
  return tokens
}

export function formatXml(value: string) {
  if (!value.trim()) throw new Error('请输入 XML 内容。')
  assertStructuredTextSize(value)
  const tokens = scanXmlTokens(value.replace(/^\uFEFF/, '').trim())
  const lines: string[] = []
  const stack: string[] = []
  let rootSeen = false
  let rootClosed = false
  const indent = (depth: number) => '  '.repeat(depth)
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]
    if (token.kind === 'text') {
      const text = token.value.replace(/\s+/g, ' ').trim()
      if (!text) continue
      if (!stack.length) throw new Error('XML 根元素外不能出现文本内容。')
      lines.push(`${indent(stack.length)}${text}`)
      continue
    }
    if (token.kind === 'comment' || token.kind === 'cdata') {
      lines.push(`${indent(stack.length)}${token.value}`)
      continue
    }
    const closing = /^<\s*\/\s*([A-Za-z_][\w:.-]*)\s*>$/.exec(token.value)
    if (closing) {
      const expected = stack.pop()
      if (!expected || expected !== closing[1]) throw new Error(`XML 标签未正确闭合：期望 </${expected ?? 'root'}>，得到 </${closing[1]}>。`)
      lines.push(`${indent(stack.length)}</${closing[1]}>`)
      if (!stack.length) rootClosed = true
      continue
    }
    if (/^<\?/.test(token.value) || /^<!DOCTYPE\b/i.test(token.value)) {
      if (stack.length) throw new Error('XML 声明或 DOCTYPE 不能嵌套在元素中。')
      lines.push(token.value)
      continue
    }
    const opening = /^<\s*([A-Za-z_][\w:.-]*)(?:\s|\/?>)/.exec(token.value)
    if (!opening) throw new Error(`无法识别 XML 标签：${token.value}`)
    const name = opening[1]
    const selfClosing = /\/\s*>$/.test(token.value)
    if (!stack.length) {
      if (rootSeen && rootClosed) throw new Error('XML 只能有一个根元素。')
      rootSeen = true
    }
    lines.push(`${indent(stack.length)}${token.value}`)
    if (!selfClosing) {
      stack.push(name)
      rootClosed = false
    } else if (!stack.length) {
      rootClosed = true
    }
  }
  if (!rootSeen || stack.length) throw new Error(`XML 标签未闭合：${stack.length ? `缺少 </${stack.at(-1)}>。` : '缺少根元素。'}`)
  return lines.join('\n')
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
