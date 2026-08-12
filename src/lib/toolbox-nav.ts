import { toolCatalog, type CatalogGroup, type ToolCatalogItem } from '@/lib/tool-catalog'

/**
 * Navigation derived from what the product actually contains.
 *
 * The previous rail described five abstract "spaces" (today, knowledge,
 * create, review, tools) that had to be learned before anything could be
 * found. This is a toolbox with 53 tools in it, so the rail lists the kinds of
 * thing you can do to a file and each entry says how many tools it holds.
 *
 * Categories are read from the catalogue rather than hand-listed, so adding a
 * tool updates the navigation, the counts and the home page at once.
 */
export interface ToolCategory {
  id: string
  group: CatalogGroup
  label: string
  /** One line describing the kind of work, shown on the home page. */
  summary: string
  icon: string
  /** Token suffix consumed by the `cat-*` UnoCSS rule. */
  accent: string
  tools: ToolCatalogItem[]
}

interface CategoryMeta {
  id: string
  summary: string
  icon: string
  accent: string
}

/** Display order is by how often the category is reached for, not alphabetical. */
const CATEGORY_META: Record<CatalogGroup, CategoryMeta> = {
  PDF: { id: 'pdf', summary: '合并、拆分、旋转、水印与页码', icon: 'file-pdf', accent: 'pdf' },
  图片: { id: 'image', summary: '压缩、裁剪、标注、长图与画布', icon: 'image', accent: 'image' },
  文本: { id: 'text', summary: '识别、提取、清理与格式转换', icon: 'file-text', accent: 'text' },
  开发: { id: 'dev', summary: '编码、哈希、正则与数据检查', icon: 'terminal', accent: 'dev' },
  媒体: { id: 'media', summary: '音视频转换、截取与字幕', icon: 'play', accent: 'media' },
  整理: { id: 'organize', summary: '批量重命名、去重与归档', icon: 'sort', accent: 'organize' },
  表达: { id: 'express', summary: '代码长图、二维码与分享物料', icon: 'sparkle', accent: 'express' },
  AI: { id: 'ai', summary: '自带模型,只发送你确认的内容', icon: 'sparkle', accent: 'ai' },
  资料: { id: 'source', summary: '本地资料、笔记与复习', icon: 'book', accent: 'source' },
}

const ORDER: CatalogGroup[] = ['PDF', '图片', '文本', '开发', '媒体', '整理', '表达', 'AI', '资料']

export function buildToolCategories(catalog: ToolCatalogItem[] = toolCatalog): ToolCategory[] {
  const byGroup = new Map<CatalogGroup, ToolCatalogItem[]>()
  for (const tool of catalog) {
    const bucket = byGroup.get(tool.group)
    if (bucket) bucket.push(tool)
    else byGroup.set(tool.group, [tool])
  }

  return ORDER.flatMap((group) => {
    const tools = byGroup.get(group)
    // A category with nothing in it is noise in the rail; the public build
    // strips whole tool families, so this is a real case.
    if (!tools?.length) return []
    const meta = CATEGORY_META[group]
    return [{ id: meta.id, group, label: group, summary: meta.summary, icon: meta.icon, accent: meta.accent, tools }]
  })
}

export const toolCategories = buildToolCategories()

export function findCategory(id: string) {
  return toolCategories.find((category) => category.id === id)
}

/** Tools flagged `popular` lead the home page before any usage history exists. */
export function starterTools(limit = 6) {
  return toolCatalog.filter((tool) => tool.popular).slice(0, limit)
}
