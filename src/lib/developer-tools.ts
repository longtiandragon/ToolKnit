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

export interface UrlParameter {
  name: string
  value: string
}

export interface UrlInspectionResult {
  href: string
  protocol: string
  origin: string
  username: string
  hostname: string
  port: string
  pathname: string
  search: string
  hash: string
  hasCredentials: boolean
  parameters: UrlParameter[]
  duplicateNames: string[]
  warnings: string[]
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
  version?: 4 | 6
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

export type HttpHeaderMessageKind = 'request' | 'response' | 'headers'

export interface HttpHeaderEntry {
  name: string
  value: string
  line: number
}

export interface HttpHeadersResult {
  kind: HttpHeaderMessageKind
  startLine: string
  headers: HttpHeaderEntry[]
  duplicateNames: string[]
  warnings: string[]
  normalized: string
}

export interface ColorResult {
  hex: string
  rgb: { r: number; g: number; b: number; alpha: number }
  hsl: { h: number; s: number; l: number; alpha: number }
  cssRgb: string
  cssHsl: string
}

export interface CronFieldResult {
  expression: string
  values: number[]
  summary: string
}

export interface CronResult {
  expression: string
  fields: {
    minute: CronFieldResult
    hour: CronFieldResult
    dayOfMonth: CronFieldResult
    month: CronFieldResult
    dayOfWeek: CronFieldResult
  }
  summary: string
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
export type CsvMarkdownDirection = 'csv-to-markdown' | 'markdown-to-csv'
export type HtmlEntityDirection = 'encode' | 'decode'
export type JsonSchemaDirection = 'generate' | 'validate'
export type GeneratedDataTypeLanguage = 'typescript' | 'java' | 'csharp' | 'go'
export type CompressionFormat = 'gzip' | 'deflate' | 'brotli'

const STRUCTURED_TEXT_MAX_BYTES = 2 * 1024 * 1024

function assertStructuredTextSize(value: string) {
  if (new TextEncoder().encode(value).byteLength > STRUCTURED_TEXT_MAX_BYTES) {
    throw new Error('结构化文本超过 2 MB，请先拆分后再转换。')
  }
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = ''
  for (let start = 0; start < bytes.length; start += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(start, start + 0x8000))
  }
  return btoa(binary)
}

function base64ToBytes(value: string) {
  const compact = value.replace(/\s+/g, '')
  if (!compact) throw new Error('请输入需要解压的 Base64 内容。')
  if (compact.length > 8 * 1024 * 1024 || !/^[A-Za-z0-9+/]*={0,2}$/.test(compact) || compact.replace(/=+$/, '').length % 4 === 1) {
    throw new Error('压缩数据不是有效的 Base64，或超过 8 MB 安全上限。')
  }
  try {
    const binary = atob(compact.padEnd(Math.ceil(compact.length / 4) * 4, '='))
    return Uint8Array.from(binary, character => character.charCodeAt(0))
  } catch {
    throw new Error('无法读取压缩数据的 Base64 编码。')
  }
}

async function readStreamBytes(stream: ReadableStream<Uint8Array>, maxBytes: number) {
  const reader = stream.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (true) {
      const next = await reader.read()
      if (next.done) break
      total += next.value.byteLength
      if (total > maxBytes) throw new Error('解压结果超过 8 MB 安全上限，请先拆分输入。')
      chunks.push(next.value)
    }
  } finally {
    reader.releaseLock()
  }
  const result = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    result.set(chunk, offset)
    offset += chunk.byteLength
  }
  return result
}

function compressionLabel(format: CompressionFormat) {
  return format === 'gzip' ? 'GZip' : format === 'deflate' ? 'Deflate' : 'Brotli'
}

// TypeScript 5.8's DOM definitions predate Brotli's addition to Compression
// Streams. The runtime still validates the supplied string, so cast only at
// the browser boundary and report a clear capability error on older WebView2.
type LegacyCompressionStreamFormat = 'gzip' | 'deflate' | 'deflate-raw'

function createCompressionStream(format: CompressionFormat) {
  if (typeof CompressionStream === 'undefined') throw new Error(`当前 WebView 不支持 ${compressionLabel(format)} 压缩。`)
  try {
    return new CompressionStream(format as LegacyCompressionStreamFormat)
  } catch {
    throw new Error(`当前 WebView 不支持 ${compressionLabel(format)} 压缩。请更新 WebView2 后重试，或使用 GZip / Deflate。`)
  }
}

function createDecompressionStream(format: CompressionFormat) {
  if (typeof DecompressionStream === 'undefined') throw new Error(`当前 WebView 不支持 ${compressionLabel(format)} 解压。`)
  try {
    return new DecompressionStream(format as LegacyCompressionStreamFormat)
  } catch {
    throw new Error(`当前 WebView 不支持 ${compressionLabel(format)} 解压。请更新 WebView2 后重试，或使用 GZip / Deflate。`)
  }
}

export async function compressText(value: string, format: CompressionFormat = 'gzip') {
  assertStructuredTextSize(value)
  const stream = new Blob([value]).stream().pipeThrough(createCompressionStream(format))
  return bytesToBase64(await readStreamBytes(stream, 8 * 1024 * 1024))
}

export async function decompressText(value: string, format: CompressionFormat = 'gzip') {
  const bytes = base64ToBytes(value)
  const stream = new Blob([bytes]).stream().pipeThrough(createDecompressionStream(format))
  let result: Uint8Array
  try {
    result = await readStreamBytes(stream, 8 * 1024 * 1024)
  } catch (error) {
    if (error instanceof Error && error.message.includes('安全上限')) throw error
    throw new Error(`${compressionLabel(format)} 解压失败：Base64 内容可能损坏，或压缩格式不匹配。`)
  }
  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(result)
  } catch {
    throw new Error(`${compressionLabel(format)} 解压完成，但结果不是有效的 UTF-8 文本。`)
  }
  assertStructuredTextSize(text)
  return text
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

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

function decodeUtf8(bytes: Uint8Array, label: string) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    throw new Error(`${label} 已成功还原为字节，但内容不是有效的 UTF-8 文本。`)
  }
}

export function encodeBase32(value: string) {
  assertStructuredTextSize(value)
  const bytes = new TextEncoder().encode(value)
  let buffer = 0
  let bits = 0
  let output = ''
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte
    bits += 8
    while (bits >= 5) {
      bits -= 5
      output += BASE32_ALPHABET[(buffer >> bits) & 31]
    }
  }
  if (bits) output += BASE32_ALPHABET[(buffer << (5 - bits)) & 31]
  return output.padEnd(Math.ceil(output.length / 8) * 8, '=')
}

export function decodeBase32(value: string) {
  const compact = value.replace(/\s+/g, '').toUpperCase()
  if (!compact) throw new Error('请输入需要解码的 Base32 内容。')
  if (!/^[A-Z2-7]*={0,6}$/.test(compact)) throw new Error('Base32 只能包含 A-Z、2-7 和末尾补位符 =。')
  assertStructuredTextSize(compact)
  const content = compact.replace(/=+$/, '')
  if ([1, 3, 6].includes(content.length % 8)) throw new Error('Base32 长度无效，请检查内容是否缺失。')
  const bytes: number[] = []
  let buffer = 0
  let bits = 0
  for (const character of content) {
    buffer = (buffer << 5) | BASE32_ALPHABET.indexOf(character)
    bits += 5
    if (bits >= 8) {
      bits -= 8
      bytes.push((buffer >> bits) & 255)
    }
  }
  return decodeUtf8(Uint8Array.from(bytes), 'Base32')
}

const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'

export function encodeBase58(value: string) {
  assertStructuredTextSize(value)
  const bytes = new TextEncoder().encode(value)
  if (!bytes.length) return ''
  const digits = [0]
  for (const byte of bytes) {
    let carry = byte
    for (let index = 0; index < digits.length; index += 1) {
      const next = digits[index] * 256 + carry
      digits[index] = next % 58
      carry = Math.floor(next / 58)
    }
    while (carry) {
      digits.push(carry % 58)
      carry = Math.floor(carry / 58)
    }
  }
  let leadingZeroes = 0
  while (leadingZeroes < bytes.length && bytes[leadingZeroes] === 0) leadingZeroes += 1
  return '1'.repeat(leadingZeroes) + digits.reverse().map(digit => BASE58_ALPHABET[digit]).join('').replace(/^1+/, '')
}

export function decodeBase58(value: string) {
  const compact = value.replace(/\s+/g, '')
  if (!compact) throw new Error('请输入需要解码的 Base58 内容。')
  assertStructuredTextSize(compact)
  const digits = [0]
  for (const character of compact) {
    const digit = BASE58_ALPHABET.indexOf(character)
    if (digit < 0) throw new Error('Base58 包含无效字符；不使用 0、O、I 和 l。')
    let carry = digit
    for (let index = 0; index < digits.length; index += 1) {
      const next = digits[index] * 58 + carry
      digits[index] = next % 256
      carry = Math.floor(next / 256)
    }
    while (carry) {
      digits.push(carry % 256)
      carry = Math.floor(carry / 256)
    }
  }
  let leadingOnes = 0
  while (leadingOnes < compact.length && compact[leadingOnes] === '1') leadingOnes += 1
  const payload = digits.length === 1 && digits[0] === 0 ? [] : digits.reverse()
  const bytes = new Uint8Array(leadingOnes + payload.length)
  bytes.set(payload, leadingOnes)
  return decodeUtf8(bytes, 'Base58')
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

function parseIpv6(value: string) {
  const normalized = value.trim().toLowerCase()
  if (!normalized || !/^[0-9a-f:]+$/.test(normalized)) throw new Error(`IPv6 地址“${value}”无效。`)
  const compression = normalized.indexOf('::')
  let groups: string[]
  if (compression >= 0) {
    if (normalized.indexOf('::', compression + 2) >= 0) throw new Error(`IPv6 地址“${value}”无效：只能使用一次 ::。`)
    const left = normalized.slice(0, compression).split(':').filter(Boolean)
    const right = normalized.slice(compression + 2).split(':').filter(Boolean)
    const missing = 8 - left.length - right.length
    if (missing < 1) throw new Error(`IPv6 地址“${value}”无效：:: 没有压缩任何分组。`)
    groups = [...left, ...Array.from({ length: missing }, () => '0'), ...right]
  } else {
    groups = normalized.split(':')
  }
  if (groups.length !== 8 || groups.some((group) => !/^[0-9a-f]{1,4}$/.test(group))) throw new Error(`IPv6 地址“${value}”无效。`)
  return groups.reduce((result, group) => (result << 16n) | BigInt(parseInt(group, 16)), 0n)
}

function formatIpv6(value: bigint) {
  const groups = Array.from({ length: 8 }, (_, index) => Number((value >> BigInt((7 - index) * 16)) & 0xffffn))
  let bestStart = -1
  let bestLength = 0
  let start = -1
  for (let index = 0; index <= groups.length; index += 1) {
    if (index < groups.length && groups[index] === 0) {
      if (start < 0) start = index
      continue
    }
    if (start >= 0 && index - start >= 2 && index - start > bestLength) {
      bestStart = start
      bestLength = index - start
    }
    start = -1
  }
  if (bestStart < 0) return groups.map((group) => group.toString(16)).join(':')
  const end = bestStart + bestLength
  const left = groups.slice(0, bestStart).map((group) => group.toString(16)).join(':')
  const right = groups.slice(end).map((group) => group.toString(16)).join(':')
  if (!left && !right) return '::'
  if (!left) return `::${right}`
  if (!right) return `${left}::`
  return `${left}::${right}`
}

export function calculateIpv6Cidr(value: string): CidrResult {
  const [addressValue, prefixValue, ...extra] = value.trim().split('/')
  if (!addressValue || prefixValue === undefined || extra.length) throw new Error('请输入 IPv6 CIDR，例如 2001:db8::1/64。')
  const prefix = Number(prefixValue)
  if (!/^\d+$/.test(prefixValue) || !Number.isInteger(prefix) || prefix < 0 || prefix > 128) throw new Error('IPv6 CIDR 前缀长度需要在 0 到 128 之间。')
  const address = parseIpv6(addressValue)
  const max = (1n << 128n) - 1n
  const hostBits = 128 - prefix
  const hostMask = hostBits === 0 ? 0n : (1n << BigInt(hostBits)) - 1n
  const mask = max ^ hostMask
  const network = address & mask
  const lastAddress = network | hostMask
  const total = lastAddress - network + 1n
  return {
    version: 6,
    address: formatIpv6(address),
    prefix,
    network: formatIpv6(network),
    broadcast: formatIpv6(lastAddress),
    netmask: formatIpv6(mask),
    wildcard: formatIpv6(max ^ mask),
    firstHost: formatIpv6(network),
    lastHost: formatIpv6(lastAddress),
    totalAddresses: total.toString(),
    usableHosts: total.toString(),
  }
}

export function calculateCidr(value: string): CidrResult {
  const [addressValue, prefixValue, ...extra] = value.trim().split('/')
  if (!addressValue || prefixValue === undefined || extra.length) throw new Error('请输入 IPv4 CIDR，例如 192.168.1.25/24。')
  if (addressValue.includes(':')) return calculateIpv6Cidr(value)
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

const HTTP_HEADER_MAX_BYTES = 64 * 1024
const HTTP_HEADER_MAX_LINES = 256
const HTTP_HEADER_MAX_VALUE_LENGTH = 16 * 1024
const HTTP_TOKEN_PATTERN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/

function isHttpResponseLine(value: string) {
  return /^HTTP\/\d(?:\.\d)?\s+\d{3}(?:\s+.*)?$/.test(value)
}

function isHttpRequestLine(value: string) {
  return /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+\s+\S+\s+HTTP\/\d(?:\.\d)?$/.test(value)
}

function hasHttpControlCharacters(value: string) {
  return /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(value)
}

/**
 * Parse a pasted HTTP request/response header block without touching the
 * network. The optional request/status line is kept, while the rest is
 * normalized into individual fields so duplicate and unsafe combinations can
 * be inspected before someone copies them into a client or server config.
 */
export function analyzeHttpHeaders(value: string): HttpHeadersResult {
  if (!value.trim()) throw new Error('请粘贴 HTTP 请求头、响应头，或至少一行“名称: 值”。')
  if (new TextEncoder().encode(value).byteLength > HTTP_HEADER_MAX_BYTES) throw new Error('HTTP Header 超过 64 KB 安全上限，请先拆分内容。')

  const lines = value.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop()
  if (lines.length > HTTP_HEADER_MAX_LINES) throw new Error(`HTTP Header 最多支持 ${HTTP_HEADER_MAX_LINES} 行。`)
  if (!lines.length) throw new Error('HTTP Header 不能为空。')

  let kind: HttpHeaderMessageKind = 'headers'
  let startLine = ''
  let firstHeaderIndex = 0
  const firstLine = lines[0].trim()
  if (isHttpResponseLine(firstLine)) {
    kind = 'response'
    startLine = firstLine
    firstHeaderIndex = 1
  } else if (isHttpRequestLine(firstLine)) {
    kind = 'request'
    startLine = firstLine
    firstHeaderIndex = 1
  } else if (!firstLine.includes(':')) {
    throw new Error('第一行不是有效的 HTTP 请求/响应行，也没有“名称: 值”格式。')
  }

  const headers: HttpHeaderEntry[] = []
  for (let index = firstHeaderIndex; index < lines.length; index += 1) {
    const line = lines[index]
    if (!line.trim()) throw new Error(`第 ${index + 1} 行为空；Header 区域不能混入正文。`)
    const separator = line.indexOf(':')
    if (separator <= 0) throw new Error(`第 ${index + 1} 行缺少“名称: 值”分隔符。`)
    const name = line.slice(0, separator)
    const rawValue = line.slice(separator + 1)
    if (!HTTP_TOKEN_PATTERN.test(name)) throw new Error(`第 ${index + 1} 行的 Header 名称“${name}”无效。`)
    if (rawValue.length > HTTP_HEADER_MAX_VALUE_LENGTH) throw new Error(`第 ${index + 1} 行的 Header 值超过 ${HTTP_HEADER_MAX_VALUE_LENGTH} 字符。`)
    const headerValue = rawValue.trim()
    if (hasHttpControlCharacters(headerValue)) throw new Error(`第 ${index + 1} 行包含不可见控制字符。`)
    headers.push({ name, value: headerValue, line: index + 1 })
  }
  if (!headers.length) throw new Error('没有解析到 Header 字段。')

  const byName = new Map<string, HttpHeaderEntry[]>()
  for (const header of headers) {
    const key = header.name.toLowerCase()
    const existing = byName.get(key) ?? []
    existing.push(header)
    byName.set(key, existing)
  }
  const duplicateNames = [...byName.entries()]
    .filter(([, entries]) => entries.length > 1)
    .map(([, entries]) => entries[0].name)
  const warnings: string[] = []

  if (duplicateNames.length) warnings.push(`发现重复 Header：${duplicateNames.join('、')}；除 Set-Cookie 等少数字段外，重复值可能被不同客户端解释不一致。`)
  const contentLengths = byName.get('content-length')?.map((header) => header.value) ?? []
  if (contentLengths.some((header) => !/^\d+$/.test(header))) warnings.push('Content-Length 不是纯数字，发送或代理转发前应修正。')
  if (new Set(contentLengths).size > 1) warnings.push('重复 Content-Length 的值不一致，可能造成请求走私或截断解析。')
  if (byName.has('transfer-encoding') && byName.has('content-length')) warnings.push('同时存在 Transfer-Encoding 与 Content-Length；不要把这组 Header 直接转发到不受信任的代理。')

  const getValues = (name: string) => byName.get(name)?.map((header) => header.value) ?? []
  const accessOrigin = getValues('access-control-allow-origin').at(-1)?.trim()
  const accessCredentials = getValues('access-control-allow-credentials').at(-1)?.trim().toLowerCase()
  if (accessOrigin === '*' && accessCredentials === 'true') warnings.push('CORS 的 Allow-Origin 为“*”时不能与 Allow-Credentials: true 一起使用。')

  const csp = getValues('content-security-policy').join(';').toLowerCase()
  if (csp.includes("'unsafe-inline'") || csp.includes("'unsafe-eval'")) warnings.push('Content-Security-Policy 含有 unsafe-inline 或 unsafe-eval；这会削弱脚本注入防护。')
  const contentTypeOptions = getValues('x-content-type-options').at(-1)?.toLowerCase()
  if (kind === 'response' && contentTypeOptions && contentTypeOptions !== 'nosniff') warnings.push('X-Content-Type-Options 不是 nosniff，浏览器可能进行 MIME 嗅探。')
  const strictTransport = getValues('strict-transport-security').at(-1)
  if (strictTransport && !/\bmax-age\s*=\s*\d+/i.test(strictTransport)) warnings.push('Strict-Transport-Security 缺少有效的 max-age。')
  if (getValues('server').length || getValues('x-powered-by').length) warnings.push('Server / X-Powered-By 暴露了服务端实现信息；公开响应可考虑移除或泛化。')

  return {
    kind,
    startLine,
    headers,
    duplicateNames,
    warnings,
    normalized: [startLine, ...headers.map((header) => `${header.name}: ${header.value}`)].filter(Boolean).join('\n'),
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

const CRON_MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 }
const CRON_WEEKDAYS: Record<string, number> = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 }

function cronNumber(value: string, names: Record<string, number>, minimum: number, maximum: number) {
  const numeric = names[value.toLowerCase()] ?? Number(value)
  if (!Number.isInteger(numeric) || numeric < minimum || numeric > maximum) throw new Error(`Cron 值“${value}”需要在 ${minimum} 到 ${maximum} 之间。`)
  return numeric
}

function parseCronField(expression: string, minimum: number, maximum: number, names: Record<string, number> = {}) {
  const values = new Set<number>()
  for (const rawPart of expression.split(',')) {
    const part = rawPart.trim()
    if (!part) throw new Error('Cron 字段不能包含空的列表项目。')
    const [rangePart, stepPart, ...extra] = part.split('/')
    if (extra.length) throw new Error(`Cron 字段“${part}”包含多个步长。`)
    const step = stepPart === undefined ? 1 : Number(stepPart)
    if (!Number.isInteger(step) || step < 1 || step > maximum - minimum + 1) throw new Error(`Cron 步长“${stepPart}”无效。`)
    let start: number
    let end: number
    if (rangePart === '*') {
      start = minimum
      end = maximum
    } else if (rangePart.includes('-')) {
      const [startValue, endValue, ...rangeExtra] = rangePart.split('-')
      if (rangeExtra.length || !startValue || !endValue) throw new Error(`Cron 范围“${rangePart}”无效。`)
      start = cronNumber(startValue, names, minimum, maximum)
      end = cronNumber(endValue, names, minimum, maximum)
      if (end < start) throw new Error(`Cron 范围“${rangePart}”的结束值不能小于开始值。`)
    } else {
      start = cronNumber(rangePart, names, minimum, maximum)
      end = start
    }
    for (let value = start; value <= end; value += step) values.add(value)
  }
  if (!values.size) throw new Error(`Cron 字段“${expression}”没有有效取值。`)
  return [...values].sort((left, right) => left - right)
}

function cronSummary(label: string, expression: string, values: number[], minimum: number, maximum: number) {
  if (expression === '*' || expression === `*/1`) return `每${label}`
  const step = /^\*\/(\d+)$/.exec(expression)
  if (step) return `每 ${step[1]} ${label}`
  if (values.length === 1) return `${label}为 ${values[0]}`
  if (values.length === maximum - minimum + 1) return `每${label}`
  const preview = values.slice(0, 12).join('、')
  return `${label}为 ${preview}${values.length > 12 ? ` 等 ${values.length} 个值` : ''}`
}

export function explainCron(value: string): CronResult {
  if (!value.trim()) throw new Error('请输入五字段 Cron，例如 0 9 * * 1-5。')
  assertStructuredTextSize(value)
  const parts = value.trim().split(/\s+/)
  if (parts.length !== 5) throw new Error('目前只支持标准五字段 Cron：分钟 小时 日 月 星期。')
  const fields = {
    minute: { expression: parts[0], values: parseCronField(parts[0], 0, 59), label: '分钟' },
    hour: { expression: parts[1], values: parseCronField(parts[1], 0, 23), label: '小时' },
    dayOfMonth: { expression: parts[2], values: parseCronField(parts[2], 1, 31), label: '每月第几天' },
    month: { expression: parts[3], values: parseCronField(parts[3], 1, 12, CRON_MONTHS), label: '月份' },
    dayOfWeek: { expression: parts[4], values: parseCronField(parts[4].replace(/\b7\b/g, '0'), 0, 6, CRON_WEEKDAYS), label: '星期' },
  }
  const resultFields = {
    minute: { expression: fields.minute.expression, values: fields.minute.values, summary: cronSummary(fields.minute.label, fields.minute.expression, fields.minute.values, 0, 59) },
    hour: { expression: fields.hour.expression, values: fields.hour.values, summary: cronSummary(fields.hour.label, fields.hour.expression, fields.hour.values, 0, 23) },
    dayOfMonth: { expression: fields.dayOfMonth.expression, values: fields.dayOfMonth.values, summary: cronSummary(fields.dayOfMonth.label, fields.dayOfMonth.expression, fields.dayOfMonth.values, 1, 31) },
    month: { expression: fields.month.expression, values: fields.month.values, summary: cronSummary(fields.month.label, fields.month.expression, fields.month.values, 1, 12) },
    dayOfWeek: { expression: fields.dayOfWeek.expression, values: fields.dayOfWeek.values, summary: cronSummary(fields.dayOfWeek.label, fields.dayOfWeek.expression, fields.dayOfWeek.values, 0, 6) },
  }
  return { expression: parts.join(' '), fields: resultFields, summary: Object.values(resultFields).map((field) => field.summary).join('；') }
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

type GeneratedSchema = Record<string, unknown>
type GeneratedModel = { name: string; schema: GeneratedSchema; fields: Array<{ key: string; type: string }> }

const GENERATED_TYPES_MAX_MODELS = 128
const GENERATED_TYPES_MAX_DEPTH = 32
const GENERATED_TYPES_MAX_OUTPUT_BYTES = 256 * 1024

function pascalIdentifier(value: string, fallback = 'Value') {
  const words = value
    .replace(/[^A-Za-z0-9_$]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
  const result = words.map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join('') || fallback
  return /^[A-Za-z_$]/.test(result) ? result.slice(0, 80) : `${fallback}${result}`.slice(0, 80)
}

function camelIdentifier(value: string, fallback = 'value') {
  const pascal = pascalIdentifier(value, pascalIdentifier(fallback, 'Value'))
  const result = `${pascal.charAt(0).toLowerCase()}${pascal.slice(1)}`
  return ['class', 'const', 'default', 'function', 'interface', 'new', 'package', 'private', 'public', 'return', 'static', 'this', 'type', 'var'].includes(result) ? `${result}_` : result
}

function generatedObject(value: unknown): GeneratedSchema | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as GeneratedSchema : undefined
}

function generatedLiteral(value: unknown) {
  if (typeof value === 'string') return JSON.stringify(value)
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  if (typeof value === 'boolean') return String(value)
  if (value === null) return 'null'
  return undefined
}

function generatedTypeArray(schema: GeneratedSchema) {
  if (Array.isArray(schema.type)) return schema.type.filter((value): value is string => typeof value === 'string')
  return typeof schema.type === 'string' ? [schema.type] : []
}

function generatedUnion(values: string[], language: GeneratedDataTypeLanguage) {
  const unique = [...new Set(values.filter(Boolean))]
  if (!unique.length) return language === 'go' ? 'any' : language === 'java' ? 'Object' : language === 'csharp' ? 'object' : 'unknown'
  if (unique.length === 1) return unique[0]
  if (language === 'go') return 'any'
  if (language === 'java') return 'Object'
  if (language === 'csharp') return 'object'
  return unique.join(' | ')
}

function generatedPropertyName(key: string, language: GeneratedDataTypeLanguage) {
  if (language === 'typescript') return /^[A-Za-z_$][\w$]*$/.test(key) ? key : JSON.stringify(key)
  if (language === 'go') return pascalIdentifier(key)
  return language === 'csharp' ? pascalIdentifier(key) : camelIdentifier(key)
}

function generatedPrimitive(type: string, language: GeneratedDataTypeLanguage) {
  if (language === 'typescript') return ({ string: 'string', number: 'number', integer: 'number', boolean: 'boolean', null: 'null' } as Record<string, string>)[type] ?? 'unknown'
  if (language === 'java') return ({ string: 'String', number: 'double', integer: 'long', boolean: 'boolean', null: 'Object' } as Record<string, string>)[type] ?? 'Object'
  if (language === 'csharp') return ({ string: 'string', number: 'double', integer: 'long', boolean: 'bool', null: 'object' } as Record<string, string>)[type] ?? 'object'
  return ({ string: 'string', number: 'float64', integer: 'int64', boolean: 'bool', null: 'any' } as Record<string, string>)[type] ?? 'any'
}

function generatedSchemaType(schema: GeneratedSchema, language: GeneratedDataTypeLanguage, preferredName: string, state: { models: GeneratedModel[]; names: Set<string>; depth: number }): string {
  if (state.depth > GENERATED_TYPES_MAX_DEPTH) throw new Error(`JSON 嵌套超过 ${GENERATED_TYPES_MAX_DEPTH} 层，无法生成类型。`)
  const enumValues = Array.isArray(schema.enum) ? schema.enum.map(generatedLiteral).filter((value): value is string => Boolean(value)) : []
  if (enumValues.length && language === 'typescript') return generatedUnion(enumValues, language)
  if (Array.isArray(schema.anyOf)) return generatedUnion(schema.anyOf.map((candidate) => generatedObject(candidate) ? generatedSchemaType(generatedObject(candidate)!, language, preferredName, { ...state, depth: state.depth + 1 }) : '').filter(Boolean), language)
  const types = generatedTypeArray(schema)
  if (types.length > 1) return generatedUnion(types.map((type) => generatedPrimitive(type, language)), language)
  const type = types[0]
  if (type === 'object' || schema.properties) {
    const base = pascalIdentifier(preferredName)
    let name = base
    let suffix = 2
    while (state.names.has(name)) name = `${base}${suffix++}`
    state.names.add(name)
    const model: GeneratedModel = { name, schema, fields: [] }
    state.models.push(model)
    const properties = generatedObject(schema.properties) ?? {}
    const required = new Set(Array.isArray(schema.required) ? schema.required.filter((key): key is string => typeof key === 'string') : [])
    for (const [key, child] of Object.entries(properties)) {
      const childSchema = generatedObject(child)
      const childType = childSchema
        ? generatedSchemaType(childSchema, language, `${name}${pascalIdentifier(key)}`, { ...state, depth: state.depth + 1 })
        : generatedUnion([], language)
      model.fields.push({ key: `${required.has(key) ? '' : '?'}${key}`, type: childType })
    }
    return name
  }
  if (type === 'array' || schema.items) {
    const items = generatedObject(schema.items)
    const itemType = items ? generatedSchemaType(items, language, `${preferredName}Item`, { ...state, depth: state.depth + 1 }) : generatedUnion([], language)
    if (language === 'typescript') return `Array<${itemType}>`
    if (language === 'java' || language === 'csharp') return `List<${itemType}>`
    return `[]${itemType}`
  }
  return generatedPrimitive(type ?? '', language)
}

function renderGeneratedTypes(models: GeneratedModel[], rootType: string, rootName: string, language: GeneratedDataTypeLanguage) {
  if (language === 'typescript') {
    const declarations = models.map((model) => `export interface ${model.name} {\n${model.fields.map((field) => `  ${generatedPropertyName(field.key.startsWith('?') ? field.key.slice(1) : field.key, language)}${field.key.startsWith('?') ? '?' : ''}: ${field.type};`).join('\n')}\n}`).join('\n\n')
    return `${declarations}${declarations && rootType !== rootName ? '\n\n' : ''}export type ${rootName} = ${rootType};`.trim()
  }
  if (language === 'java') {
    const render = (model: GeneratedModel, indent = '') => `${indent}public static final class ${model.name} {\n${model.fields.map((field) => `${indent}  public ${field.type} ${generatedPropertyName(field.key.startsWith('?') ? field.key.slice(1) : field.key, language)};`).join('\n')}\n${indent}}`
    const fieldName = (field: { key: string }) => generatedPropertyName(field.key.startsWith('?') ? field.key.slice(1) : field.key, language)
    const rootModel = models[0]?.name === rootName ? models[0] : undefined
    return `import java.util.List;\n\npublic final class ${rootName} {\n${rootModel?.fields.map((field) => `  public ${field.type} ${fieldName(field)};`).join('\n') ?? `  public ${rootType} value;`}\n${(rootModel ? models.slice(1) : models).map((model) => `\n  ${render(model, '  ').replace(/^  /gm, '  ')}`).join('')}\n}`
  }
  if (language === 'csharp') {
    const render = (model: GeneratedModel, indent = '') => `${indent}public sealed class ${model.name}\n${indent}{\n${model.fields.map((field) => `${indent}    public ${field.type} ${generatedPropertyName(field.key.startsWith('?') ? field.key.slice(1) : field.key, language)} { get; set; }`).join('\n')}\n${indent}}`
    const fieldName = (field: { key: string }) => generatedPropertyName(field.key.startsWith('?') ? field.key.slice(1) : field.key, language)
    const rootModel = models[0]?.name === rootName ? models[0] : undefined
    return `using System.Collections.Generic;\n\npublic sealed class ${rootName}\n{\n${rootModel?.fields.map((field) => `    public ${field.type} ${fieldName(field)} { get; set; }`).join('\n') ?? `    public ${rootType} Value { get; set; }`}\n${(rootModel ? models.slice(1) : models).map((model) => `\n${render(model, '    ').replace(/^    /gm, '    ')}`).join('')}\n}`
  }
  const render = (model: GeneratedModel) => `type ${model.name} struct {\n${model.fields.map((field) => { const key = field.key.startsWith('?') ? field.key.slice(1) : field.key; return `\t${generatedPropertyName(key, language)} ${field.type} \`json:"${key}\"\`` }).join('\n')}\n}`
  const declarations = models.map(render).join('\n\n')
  const alias = rootType === rootName ? '' : `type ${rootName} = ${rootType}`
  return `${declarations}${declarations && alias ? '\n\n' : ''}${alias}`.trim()
}

export function generateDataTypes(value: string, language: GeneratedDataTypeLanguage, rootName = 'Root') {
  if (!value.trim()) throw new Error('请输入用于生成类型的 JSON 样例。')
  assertStructuredTextSize(value)
  try {
    const schema = JSON.parse(transformJsonSchema(value, 'generate')) as GeneratedSchema
    const state = { models: [] as GeneratedModel[], names: new Set<string>(), depth: 0 }
    const rootType = generatedSchemaType(schema, language, pascalIdentifier(rootName), state)
    if (state.models.length > GENERATED_TYPES_MAX_MODELS) throw new Error(`对象类型超过 ${GENERATED_TYPES_MAX_MODELS} 个，无法安全生成。`)
    const safeRootName = pascalIdentifier(rootName)
    const result = `// Generated by ToolKnit from a JSON sample.\n\n${renderGeneratedTypes(state.models, rootType, safeRootName, language)}\n`
    if (new TextEncoder().encode(result).byteLength > GENERATED_TYPES_MAX_OUTPUT_BYTES) throw new Error('生成的类型代码超过 256 KB，请先缩小样例。')
    return result
  } catch (reason) {
    const detail = reason instanceof Error ? reason.message : '语法错误'
    throw new Error(`JSON 类型生成失败：${detail}`)
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

function markdownTableCell(value: string) {
  if (/\r|\n/.test(value)) throw new Error('Markdown 表格不能无损表示含换行的 CSV 单元格；请先拆分该字段。')
  return value.replace(/\\/g, '\\\\').replace(/\|/g, '\\|')
}

function parseMarkdownTableRow(value: string, lineNumber: number, allowEmpty = false) {
  const source = value.trim()
  if (!source) throw new Error(`Markdown 表格第 ${lineNumber} 行为空。`)
  const cells: string[] = []
  let cell = ''
  let escaped = false
  let endedWithDelimiter = false
  for (const character of source) {
    if (escaped) {
      cell += character === '|' || character === '\\' ? character : `\\${character}`
      escaped = false
      endedWithDelimiter = false
    } else if (character === '\\') {
      escaped = true
      endedWithDelimiter = false
    } else if (character === '|') {
      cells.push(cell.trim())
      cell = ''
      endedWithDelimiter = true
    } else {
      cell += character
      endedWithDelimiter = false
    }
  }
  if (escaped) cell += '\\'
  cells.push(cell.trim())
  if (source.startsWith('|')) cells.shift()
  if (endedWithDelimiter) cells.pop()
  if (!cells.length || (!allowEmpty && cells.some((item) => item.length === 0))) throw new Error(`Markdown 表格第 ${lineNumber} 行包含空列。`)
  return cells
}

function isMarkdownTableDivider(cells: string[]) {
  return cells.every((cell) => /^:?-{3,}:?$/.test(cell.replace(/\s+/g, '')))
}

export function transformCsvMarkdown(value: string, direction: CsvMarkdownDirection) {
  if (!value.trim()) throw new Error('请输入 CSV 或 Markdown 表格内容。')
  assertStructuredTextSize(value)
  try {
    if (direction === 'csv-to-markdown') {
      const rows = parseCsvRows(value)
      if (rows[0].length > 256) throw new Error('CSV 表格最多支持 256 列。')
      const columns = rows[0].length
      if (rows.some((row) => row.length > columns)) throw new Error('CSV 中存在超过表头列数的数据行，请先修正列数。')
      const renderRow = (row: string[]) => `| ${Array.from({ length: columns }, (_, index) => markdownTableCell(row[index] ?? '')).join(' | ')} |`
      return [renderRow(rows[0]), `| ${Array.from({ length: columns }, () => '---').join(' | ')} |`, ...rows.slice(1).map(renderRow)].join('\n')
    }
    const lines = value.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n').filter((line) => line.trim())
    if (lines.length < 2) throw new Error('Markdown 表格至少需要表头和分隔行。')
    if (lines.length > 10_002) throw new Error('Markdown 表格最多支持 10000 行数据。')
    const headers = parseMarkdownTableRow(lines[0], 1)
    const divider = parseMarkdownTableRow(lines[1], 2)
    if (headers.length > 256) throw new Error('Markdown 表格最多支持 256 列。')
    if (divider.length !== headers.length || !isMarkdownTableDivider(divider)) throw new Error('Markdown 表格第 2 行必须是与表头列数一致的 --- 分隔行。')
    const records = lines.slice(2).map((line, index) => {
      const row = parseMarkdownTableRow(line, index + 3, true)
      if (row.length !== headers.length) throw new Error(`Markdown 表格第 ${index + 3} 行有 ${row.length} 列，表头有 ${headers.length} 列。`)
      return row
    })
    return [headers.map(csvCell).join(','), ...records.map((row) => row.map(csvCell).join(','))].join('\r\n') + '\r\n'
  } catch (reason) {
    const detail = reason instanceof Error ? reason.message : '语法错误'
    throw new Error(`${direction === 'csv-to-markdown' ? 'CSV' : 'Markdown 表格'} 解析失败：${detail}`)
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

const ULID_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

function encodeUlidBase32(value: bigint, length: number) {
  let result = ''
  for (let index = 0; index < length; index += 1) {
    result = ULID_ALPHABET[Number(value & 31n)] + result
    value >>= 5n
  }
  return result
}

function randomBigInt(byteCount: number) {
  const bytes = new Uint8Array(byteCount)
  crypto.getRandomValues(bytes)
  return bytes.reduce((value, byte) => (value << 8n) | BigInt(byte), 0n)
}

/** Generates sortable ULIDs without relying on a remote service. The first
 * ten characters encode the millisecond timestamp; the remaining sixteen are
 * cryptographically random. `now` is injectable for deterministic tests. */
export function generateUlids(count = 1, now = Date.now()) {
  if (!Number.isInteger(count) || count < 1 || count > 100) throw new Error('ULID 数量需要在 1 到 100 之间。')
  if (!Number.isSafeInteger(now) || now < 0 || now > 0xffffffffffff) throw new Error('ULID 时间戳超出安全范围。')
  const timestamp = BigInt(now)
  return Array.from({ length: count }, () => `${encodeUlidBase32(timestamp, 10)}${encodeUlidBase32(randomBigInt(10), 16)}`).join('\n')
}

export interface RandomStringOptions {
  length?: number
  count?: number
  lowercase?: boolean
  uppercase?: boolean
  numbers?: boolean
  symbols?: boolean
}

const RANDOM_LOWERCASE = 'abcdefghijklmnopqrstuvwxyz'
const RANDOM_UPPERCASE = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
const RANDOM_NUMBERS = '0123456789'
const RANDOM_SYMBOLS = '!@#$%^&*()-_=+[]{}:,.?'

function randomByteBelow(max: number) {
  const limit = 256 - (256 % max)
  const byte = new Uint8Array(1)
  do crypto.getRandomValues(byte)
  while (byte[0] >= limit)
  return byte[0] % max
}

/** Generates passwords or temporary tokens using rejection sampling so that
 * every selected character is equally likely. The alphabet is fixed and
 * audited rather than accepted from callers. */
export function generateRandomStrings(options: RandomStringOptions = {}) {
  const length = Number(options.length ?? 24)
  const count = Number(options.count ?? 1)
  if (!Number.isInteger(length) || length < 1 || length > 256) throw new Error('随机字符串长度需要在 1 到 256 之间。')
  if (!Number.isInteger(count) || count < 1 || count > 100) throw new Error('随机字符串数量需要在 1 到 100 之间。')
  const alphabet = [
    options.lowercase === false ? '' : RANDOM_LOWERCASE,
    options.uppercase === false ? '' : RANDOM_UPPERCASE,
    options.numbers === false ? '' : RANDOM_NUMBERS,
    options.symbols === false ? '' : RANDOM_SYMBOLS,
  ].join('')
  if (!alphabet) throw new Error('至少保留一种字符类型。')
  return Array.from({ length: count }, () => Array.from({ length }, () => alphabet[randomByteBelow(alphabet.length)]).join('')).join('\n')
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

/** Inspect an absolute URL locally; this never performs a fetch or DNS lookup. */
export function inspectUrl(value: string): UrlInspectionResult {
  const normalized = value.trim()
  if (!normalized) throw new Error('请输入完整 URL，例如 https://example.com/search?q=工具箱。')
  if (new TextEncoder().encode(normalized).byteLength > 16 * 1024) throw new Error('URL 超过 16 KB 安全上限，请先拆分参数。')
  let url: URL
  try {
    url = new URL(normalized)
  } catch {
    throw new Error('URL 无法解析；请包含协议，例如 https://example.com/path。')
  }
  const safeUrl = new URL(url.toString())
  const hasCredentials = Boolean(url.username || url.password)
  if (url.password) safeUrl.password = '***'
  const parameters = [...url.searchParams.entries()].map(([name, parameterValue]) => ({ name, value: parameterValue }))
  const counts = new Map<string, number>()
  for (const parameter of parameters) counts.set(parameter.name, (counts.get(parameter.name) ?? 0) + 1)
  const duplicateNames = [...counts.entries()].filter(([, count]) => count > 1).map(([name]) => name)
  const warnings: string[] = []
  if (url.protocol === 'http:') warnings.push('当前 URL 使用明文 HTTP；登录或传输敏感数据时应优先使用 HTTPS。')
  if (hasCredentials) warnings.push('URL 内包含用户名或密码；不要把带凭据的地址写入日志、任务历史或公开文档。')
  if (url.hash) warnings.push('Fragment（# 后内容）通常只在浏览器端使用，不会随 HTTP 请求发送到服务器。')
  if (duplicateNames.length) warnings.push(`发现重复查询参数：${duplicateNames.join('、')}；服务端可能按首个、最后一个或全部值处理。`)
  if (url.protocol === 'file:') warnings.push('这是本地 file URL；跨应用打开前请确认路径和权限。')
  return {
    href: safeUrl.toString(),
    protocol: url.protocol,
    origin: url.origin,
    username: url.username,
    hostname: url.hostname,
    port: url.port,
    pathname: url.pathname,
    search: url.search,
    hash: url.hash,
    hasCredentials,
    parameters,
    duplicateNames,
    warnings,
  }
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
