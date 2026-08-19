import { toolCatalog, type ToolCatalogItem } from '@/lib/tool-catalog'
import type { ToolboxBoardLayout } from '@/types'

/**
 * The toolbox home, expressed as workbenches rather than as a flat grid.
 *
 * The catalogue holds 64 entries, but about forty of them are not places — they
 * are *operations* of four pages. Twelve `PDF 合并 / 拆分 / 旋转…` cards all open
 * `/tools?group=pdf`; sixteen `Base64 / JWT / 正则…` cards all open
 * `/developer-tools`. Rendering those at the same altitude as 离线文字识别 gave
 * the home route nine stacked sections and a page three windows tall, where the
 * last two categories held one tool each and were never reached.
 *
 * A block is therefore one destination and the operations it accepts. The
 * grouping is *derived* from `to.path` rather than hand-listed — the project
 * already carries three tool registries that do not agree with each other
 * (see docs/ROADMAP.md §2) and a fourth would be the worst of them, because it
 * would be the one deciding what the home page shows. Adding a tool to the
 * catalogue puts it in the right block, updates the count and the search with
 * no edit here.
 */

/** Blocks the user has not arranged sit in this order, most reached-for first. */
const BLOCK_META: Record<string, { label: string; summary: string; icon: string; accent: string }> = {
  '/tools:pdf': { label: 'PDF 工作台', summary: '合并、拆分、页面与水印', icon: 'file-pdf', accent: 'pdf' },
  '/visual': { label: '视觉画布工作室', summary: '转换、裁剪、标注与长图', icon: 'palette', accent: 'image' },
  '/developer-tools': { label: '开发者工具', summary: '编码、哈希、正则与数据检查', icon: 'terminal', accent: 'dev' },
  '/tools:text': { label: '文本处理', summary: '清理、排序、去重与统计', icon: 'file-text', accent: 'text' },
  '/media': { label: '媒体转换台', summary: '音视频转换、截取与音轨', icon: 'play', accent: 'media' },
  '/subtitles': { label: '字幕校对台', summary: '转写、时间轴与格式转换', icon: 'file-text', accent: 'media' },
  '/tools:organize': { label: '文件整理', summary: '归档、去重、照片与流水线', icon: 'sort', accent: 'organize' },
  '/ocr': { label: '离线文字识别', summary: '矫正拍歪的书页再识别文字', icon: 'file-text', accent: 'text' },
  '/code-image': { label: '代码分享图', summary: '高亮并按行分页导出', icon: 'terminal', accent: 'express' },
  '/quick': { label: '万能处理入口', summary: '拖入或粘贴，自动推荐下一步', icon: 'inbox', accent: 'organize' },
  '/ai': { label: 'AI 内容处理', summary: '摘要、翻译、改写与提取', icon: 'sparkle', accent: 'ai' },
  '/documents': { label: '公式图片识别', summary: '截图转可校对的 LaTeX 草稿', icon: 'math', accent: 'ai' },
  '/clipboard': { label: '剪贴板历史', summary: '重新复制、固定或归档', icon: 'clipboard', accent: 'organize' },
  '/history': { label: '处理历史', summary: '回看任务结果与输出位置', icon: 'clock', accent: 'organize' },
  '/library': { label: '收集与归档', summary: '保存截图、PDF 与来源', icon: 'inbox', accent: 'source' },
  '/private-tools': { label: '私人工具包', summary: '用本机清单安全运行你的脚本', icon: 'terminal', accent: 'dev' },
}

const DEFAULT_ORDER = Object.keys(BLOCK_META)

export interface ToolboxBlock {
  key: string
  label: string
  summary: string
  icon: string
  /** Token suffix consumed by the `cat-*` UnoCSS rule. */
  accent: string
  tools: ToolCatalogItem[]
  /** A block holding one tool opens it directly instead of expanding. */
  single: boolean
  hidden: boolean
  expanded: boolean
}

/**
 * Which workbench a catalogue entry belongs to.
 *
 * `/tools` is the one path that hosts unrelated families — BatchView switches
 * on `group`/`mode` — so it is keyed by its group as well. Entries that reach
 * it through a bare `mode` (归档, 流水线, 去重扫描) carry no group and land in
 * 文件整理, which is where they belong.
 */
export function workbenchKeyOf(tool: ToolCatalogItem) {
  if (tool.to.path !== '/tools') return tool.to.path
  return `/tools:${tool.to.query?.group ?? 'organize'}`
}

function orderedKeys(keys: string[], preferred: readonly string[]) {
  const known = preferred.filter((key) => keys.includes(key))
  return [...known, ...keys.filter((key) => !known.includes(key))]
}

/** Applies a saved tool order without letting it add, drop or duplicate tools. */
function orderTools(tools: ToolCatalogItem[], savedIds: readonly string[] | undefined) {
  if (!savedIds?.length) return tools
  const remaining = new Map(tools.map((tool) => [tool.id, tool]))
  const out: ToolCatalogItem[] = []
  for (const id of savedIds) {
    const tool = remaining.get(id)
    if (!tool) continue
    remaining.delete(id)
    out.push(tool)
  }
  return [...out, ...remaining.values()]
}

/**
 * Builds the board.
 *
 * Every part of the saved layout is treated as a *preference*, never as the
 * source of truth: unknown keys are ignored and blocks the layout has never
 * seen are appended in default order. That is what lets a tool be added, moved
 * or stripped by the public build without a settings migration.
 */
export function buildToolboxBoard(
  layout?: ToolboxBoardLayout,
  catalog: readonly ToolCatalogItem[] = toolCatalog,
): ToolboxBlock[] {
  const byKey = new Map<string, ToolCatalogItem[]>()
  for (const tool of catalog) {
    const key = workbenchKeyOf(tool)
    const bucket = byKey.get(key)
    if (bucket) bucket.push(tool)
    else byKey.set(key, [tool])
  }

  const hidden = new Set(layout?.hiddenBlocks ?? [])
  const expanded = new Set(layout?.expandedBlocks ?? [])
  // The saved order leads; anything it does not mention falls back to the
  // default order rather than to `Map` insertion order, which is catalogue
  // order and puts 万能处理入口 above PDF.
  const keys = orderedKeys(orderedKeys([...byKey.keys()], DEFAULT_ORDER), layout?.blockOrder ?? [])

  return keys.map((key) => {
    const tools = orderTools(byKey.get(key) ?? [], layout?.toolOrder?.[key])
    const meta = BLOCK_META[key]
    return {
      key,
      // A block with no metadata is a tool whose route nothing here knows yet.
      // It still gets a place rather than disappearing from the home page.
      label: meta?.label ?? tools[0]?.title ?? key,
      summary: meta?.summary ?? tools[0]?.description ?? '',
      icon: meta?.icon ?? tools[0]?.icon ?? 'toolbox',
      accent: meta?.accent ?? 'source',
      tools,
      single: tools.length === 1,
      hidden: hidden.has(key),
      expanded: expanded.has(key),
    }
  })
}

/** Moves `id` to where `target` currently sits, leaving everything else in place. */
export function moveBefore(ids: readonly string[], id: string, target: string) {
  const from = ids.indexOf(id)
  const to = ids.indexOf(target)
  if (from < 0 || to < 0 || from === to) return [...ids]
  const out = [...ids]
  out.splice(to, 0, out.splice(from, 1)[0])
  return out
}

/** Keyboard equivalent of a drag: one step in `direction`, clamped at the ends. */
export function moveByStep(ids: readonly string[], id: string, direction: -1 | 1) {
  const from = ids.indexOf(id)
  const to = from + direction
  if (from < 0 || to < 0 || to >= ids.length) return [...ids]
  const out = [...ids]
  ;[out[from], out[to]] = [out[to], out[from]]
  return out
}

/**
 * The layout a board is currently showing.
 *
 * Every mutation writes through this rather than through the board, so what is
 * persisted is exactly what the user changed — `blockOrder` is only frozen once
 * they drag a block, and a tool order only exists for blocks they reordered.
 * Anything they never touched keeps following the catalogue.
 */
export function currentLayout(layout: ToolboxBoardLayout | undefined): ToolboxBoardLayout {
  return {
    blockOrder: layout?.blockOrder ?? [],
    hiddenBlocks: layout?.hiddenBlocks ?? [],
    expandedBlocks: layout?.expandedBlocks ?? [],
    toolOrder: layout?.toolOrder ?? {},
  }
}

/** Adds or removes one key from a layout list. */
export function toggleKey(keys: readonly string[], key: string) {
  return keys.includes(key) ? keys.filter((item) => item !== key) : [...keys, key]
}
