import { JSON_SCHEMA, load } from 'js-yaml'
import { markdownFrontmatterBlock } from '@/lib/markdown-frontmatter-boundary'
export { markdownFrontmatterBlock, stripMarkdownFrontmatter } from '@/lib/markdown-frontmatter-boundary'

const FRONTMATTER_MAX_PROPERTIES = 40
const FRONTMATTER_MAX_DEPTH = 4
const FRONTMATTER_MAX_COLLECTION_ITEMS = 40

export interface MarkdownFrontmatterEntry {
  key: string
  summary: string
  kind: 'text' | 'number' | 'boolean' | 'list' | 'object' | 'empty'
}

export interface MarkdownFrontmatter {
  raw: string
  yaml: string
  bodyStart: number
  entries: MarkdownFrontmatterEntry[]
  json?: Record<string, unknown>
  error?: string
  truncated: boolean
}

function plainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function safeValue(value: unknown, depth: number, seen: WeakSet<object>): unknown {
  if (value == null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return typeof value === 'string' && value.length > 1000 ? `${value.slice(0, 997)}…` : value
  }
  if (depth >= FRONTMATTER_MAX_DEPTH || typeof value !== 'object') return '[复杂值]'
  if (seen.has(value)) return '[循环引用]'
  seen.add(value)
  if (Array.isArray(value)) {
    return value.slice(0, FRONTMATTER_MAX_COLLECTION_ITEMS).map(item => safeValue(item, depth + 1, seen))
  }
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .slice(0, FRONTMATTER_MAX_COLLECTION_ITEMS)
    .map(([key, item]) => [key, safeValue(item, depth + 1, seen)]))
}

function valueSummary(value: unknown): Pick<MarkdownFrontmatterEntry, 'summary' | 'kind'> {
  if (value == null || value === '') return { summary: '空', kind: 'empty' }
  if (typeof value === 'boolean') return { summary: value ? '是' : '否', kind: 'boolean' }
  if (typeof value === 'number') return { summary: String(value), kind: 'number' }
  if (typeof value === 'string') return { summary: value.length > 120 ? `${value.slice(0, 117)}…` : value, kind: 'text' }
  if (Array.isArray(value)) {
    const scalar = value.every(item => item == null || ['string', 'number', 'boolean'].includes(typeof item))
    const joined = scalar ? value.map(item => item == null ? '空' : String(item)).join(' · ') : `${value.length} 项`
    return { summary: joined.length > 120 ? `${joined.slice(0, 117)}…` : joined, kind: 'list' }
  }
  return { summary: `${Object.keys(value as object).length} 项`, kind: 'object' }
}

export function parseMarkdownFrontmatter(source: string): MarkdownFrontmatter | undefined {
  const block = markdownFrontmatterBlock(source)
  if (!block) return undefined
  try {
    const parsed = load(block.yaml, { schema: JSON_SCHEMA })
    if (parsed != null && !plainRecord(parsed)) {
      return { ...block, entries: [], error: 'Frontmatter 顶层需要是键值对象。', truncated: false }
    }
    const values = parsed ?? {}
    const properties = Object.entries(values)
    const json = safeValue(values, 0, new WeakSet()) as Record<string, unknown>
    const entries = properties.slice(0, FRONTMATTER_MAX_PROPERTIES).map(([key, value]) => ({
      key,
      ...valueSummary(value),
    }))
    return { ...block, entries, json, truncated: properties.length > FRONTMATTER_MAX_PROPERTIES }
  } catch (error) {
    return {
      ...block,
      entries: [],
      error: error instanceof Error ? error.message.split('\n')[0] : 'YAML 无法解析。',
      truncated: false,
    }
  }
}
