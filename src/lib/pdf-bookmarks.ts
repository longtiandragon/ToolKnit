import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFNumber, PDFRef, PDFString } from 'pdf-lib'

/**
 * PDF outlines are a low-level linked tree rather than a page-level feature.
 * Keep the editor deliberately small: titles, page destinations, safe web
 * links and the two common text styles cover the useful workflow without
 * accepting arbitrary PDF actions from pasted JSON.
 */
export const PDF_BOOKMARK_MAX_ITEMS = 4096
export const PDF_BOOKMARK_MAX_DEPTH = 32
export const PDF_BOOKMARK_MAX_TITLE_CHARS = 512
export const PDF_BOOKMARK_MAX_URL_CHARS = 2048
export const PDF_BOOKMARK_MAX_INPUT_CHARS = 512 * 1024

export interface PdfBookmarkDraft {
  title: string
  page?: number
  url?: string
  bold?: boolean
  italic?: boolean
  color?: string
  items: PdfBookmarkDraft[]
}

export interface PdfBookmarkDocument {
  version: 1
  items: PdfBookmarkDraft[]
}

function recordOf(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

function stringValue(value: unknown, limit: number) {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, limit) : undefined
}

function parsePage(value: unknown, pageCount: number, path: string) {
  if (value === undefined || value === null || value === '') return undefined
  const page = typeof value === 'number' ? value : typeof value === 'string' && /^\d+$/.test(value.trim()) ? Number(value.trim()) : NaN
  if (!Number.isInteger(page) || page < 1 || page > pageCount) throw new Error(`${path} 的页码必须是 1 到 ${pageCount} 之间的整数。`)
  return page
}

function parseUrl(value: unknown, path: string) {
  const url = stringValue(value, PDF_BOOKMARK_MAX_URL_CHARS)
  if (!url) return undefined
  if (!/^https?:\/\//i.test(url)) throw new Error(`${path} 只允许 http:// 或 https:// 链接。`)
  return url
}

function parseColor(value: unknown, path: string) {
  const color = stringValue(value, 16)
  if (!color) return undefined
  if (!/^#[0-9a-f]{6}$/i.test(color)) throw new Error(`${path} 的颜色必须是 #RRGGBB。`)
  return color.toLowerCase()
}

/** Parses the import format used by the bookmark editor and bounds every
 * user-controlled field before it can reach pdf-lib's object graph. */
export function parsePdfBookmarkDocument(source: string, pageCount: number): PdfBookmarkDocument {
  if (source.length > PDF_BOOKMARK_MAX_INPUT_CHARS) throw new Error(`书签 JSON 不能超过 ${PDF_BOOKMARK_MAX_INPUT_CHARS / 1024} KB。`)
  let raw: unknown
  try {
    raw = JSON.parse(source)
  } catch {
    throw new Error('书签 JSON 格式无效，请检查逗号、引号和括号。')
  }
  const root = Array.isArray(raw) ? { items: raw } : recordOf(raw)
  if (!root || !Array.isArray(root.items)) throw new Error('书签 JSON 顶层必须包含 items 数组。')
  const state = { count: 0 }
  const normalize = (nodes: unknown[], depth: number, parentPath: string): PdfBookmarkDraft[] => {
    if (depth > PDF_BOOKMARK_MAX_DEPTH) throw new Error(`书签层级不能超过 ${PDF_BOOKMARK_MAX_DEPTH} 层。`)
    const result: PdfBookmarkDraft[] = []
    nodes.forEach((rawNode, index) => {
      state.count += 1
      const path = `${parentPath}[${index}]`
      if (state.count > PDF_BOOKMARK_MAX_ITEMS) throw new Error(`书签数量不能超过 ${PDF_BOOKMARK_MAX_ITEMS} 条。`)
      const node = recordOf(rawNode)
      if (!node) throw new Error(`${path} 必须是对象。`)
      const title = stringValue(node.title, PDF_BOOKMARK_MAX_TITLE_CHARS)
      if (!title) throw new Error(`${path}.title 不能为空。`)
      const page = parsePage(node.page ?? node.pageIndex, pageCount, `${path}.page`)
      const url = parseUrl(node.url, `${path}.url`)
      const color = parseColor(node.color, `${path}.color`)
      const items = node.items === undefined ? [] : Array.isArray(node.items) ? normalize(node.items, depth + 1, `${path}.items`) : (() => { throw new Error(`${path}.items 必须是数组。`) })()
      result.push({
        title,
        ...(page === undefined ? {} : { page }),
        ...(url ? { url } : {}),
        ...(typeof node.bold === 'boolean' ? { bold: node.bold } : {}),
        ...(typeof node.italic === 'boolean' ? { italic: node.italic } : {}),
        ...(color ? { color } : {}),
        items,
      })
    })
    return result
  }
  return { version: 1, items: normalize(root.items, 0, 'items') }
}

function colorNumbers(color: string) {
  return [
    PDFNumber.of(Number.parseInt(color.slice(1, 3), 16) / 255),
    PDFNumber.of(Number.parseInt(color.slice(3, 5), 16) / 255),
    PDFNumber.of(Number.parseInt(color.slice(5, 7), 16) / 255),
  ]
}

function destination(document: PDFDocument, page: number) {
  const pageRef = document.getPages()[page - 1]?.ref
  if (!pageRef) throw new Error(`无法定位第 ${page} 页。`)
  return document.context.obj([pageRef, PDFName.of('Fit')])
}

/** Replaces the document outline with a bounded tree. Existing outlines are
 * intentionally removed first so stale links cannot survive an import. */
export function applyPdfBookmarkDocument(document: PDFDocument, source: string) {
  const parsed = parsePdfBookmarkDocument(source, document.getPageCount())
  const catalog = document.catalog
  catalog.delete(PDFName.of('Outlines'))
  if (!parsed.items.length) return parsed

  const context = document.context
  const root = PDFDict.withContext(context)
  const rootRef = context.register(root)

  const buildList = (items: PdfBookmarkDraft[], parentRef: PDFRef) => {
    const refs = items.map(() => context.nextRef())
    let count = 0
    items.forEach((item, index) => {
      const itemDict = PDFDict.withContext(context)
      const itemRef = refs[index]
      context.assign(itemRef, itemDict)
      // PDFString is WinAnsi-only; PDFHexString.fromText keeps Chinese and
      // other Unicode bookmark titles intact across PDF viewers.
      itemDict.set(PDFName.of('Title'), PDFHexString.fromText(item.title))
      itemDict.set(PDFName.of('Parent'), parentRef)
      if (index > 0) itemDict.set(PDFName.of('Prev'), refs[index - 1])
      if (index + 1 < refs.length) itemDict.set(PDFName.of('Next'), refs[index + 1])
      if (item.url) {
        itemDict.set(PDFName.of('A'), context.obj({ S: PDFName.of('URI'), URI: PDFString.of(item.url) }))
      } else if (item.page !== undefined) {
        itemDict.set(PDFName.of('Dest'), destination(document, item.page))
      }
      const flags = (item.bold ? 2 : 0) + (item.italic ? 1 : 0)
      if (flags) itemDict.set(PDFName.of('F'), PDFNumber.of(flags))
      if (item.color) itemDict.set(PDFName.of('C'), context.obj(colorNumbers(item.color)))
      if (item.items.length) {
        const child = buildList(item.items, itemRef)
        itemDict.set(PDFName.of('First'), child.first)
        itemDict.set(PDFName.of('Last'), child.last)
        itemDict.set(PDFName.of('Count'), PDFNumber.of(child.count))
        count += child.count
      }
      count += 1
    })
    return { first: refs[0], last: refs[refs.length - 1], count }
  }

  const list = buildList(parsed.items, rootRef)
  root.set(PDFName.of('Type'), PDFName.of('Outlines'))
  root.set(PDFName.of('First'), list.first)
  root.set(PDFName.of('Last'), list.last)
  root.set(PDFName.of('Count'), PDFNumber.of(list.count))
  catalog.set(PDFName.of('Outlines'), rootRef)
  return parsed
}

/** A tiny readback helper for tests and future previews. It deliberately only
 * reads the fields generated by applyPdfBookmarkDocument. */
export function readPdfBookmarkRoot(document: PDFDocument) {
  const outline = document.catalog.lookupMaybe(PDFName.of('Outlines'), PDFDict)
  if (!outline) return undefined
  const first = outline.get(PDFName.of('First'))
  return first instanceof PDFRef ? outline.context.lookupMaybe(first, PDFDict) : undefined
}
