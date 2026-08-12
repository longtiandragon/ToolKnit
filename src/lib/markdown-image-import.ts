export const MAX_MARKDOWN_IMAGE_IMPORTS = 12

export type MarkdownImageDropBounds = { left: number; top: number; right: number; bottom: number }
export type MarkdownImageDropPoint = { x: number; y: number }

const supportedImagePattern = /\.(png|jpe?g|gif|webp|bmp|avif|ico)$/i

export function markdownImageImportSelection(value: string | string[] | null | undefined, limit = MAX_MARKDOWN_IMAGE_IMPORTS) {
  const source = typeof value === 'string' ? [value] : Array.isArray(value) ? value : []
  const seen = new Set<string>()
  const supported: string[] = []
  let unsupported = 0
  for (const path of source) {
    const normalized = path.trim()
    if (!normalized || !supportedImagePattern.test(normalized)) { unsupported += normalized ? 1 : 0; continue }
    const key = normalized.replace(/\\/g, '/').toLocaleLowerCase('en-US')
    if (seen.has(key)) continue
    seen.add(key)
    supported.push(normalized)
  }
  const boundedLimit = Math.max(1, Math.round(limit))
  return {
    paths: supported.slice(0, boundedLimit),
    unsupported,
    truncated: Math.max(0, supported.length - boundedLimit),
  }
}

export function markdownImageDropIntent(
  value: string | string[] | null | undefined,
  point: MarkdownImageDropPoint,
  bounds: MarkdownImageDropBounds,
  limit = MAX_MARKDOWN_IMAGE_IMPORTS,
) {
  const selection = markdownImageImportSelection(value, limit)
  return {
    ...selection,
    active: selection.paths.length > 0
      && point.x >= bounds.left
      && point.x <= bounds.right
      && point.y >= bounds.top
      && point.y <= bounds.bottom,
  }
}

export function markdownImageAltText(path: string) {
  const filename = path.replace(/\\/g, '/').split('/').at(-1) ?? ''
  const stem = filename.replace(/\.(png|jpe?g|gif|webp|bmp|avif|ico)$/i, '')
  return stem.replace(/[\[\]\\\r\n]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || '本地图片'
}

export function markdownImportedImageMarkup(source: string, originalPath: string) {
  return `![${markdownImageAltText(originalPath)}](${source})`
}

export function markdownPreviewImageMarkup(source: string, alt = '') {
  const safeAlt = alt.replace(/[\[\]\\\r\n]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120) || '图片'
  const safeSource = source.trim().replace(/\\/g, '\\\\').replace(/([()])/g, '\\$1')
  return `![${safeAlt}](${safeSource})`
}

export function markdownPreviewImageFilename(source: string, alt = '', mime = '') {
  const cleanSource = source.split(/[?#]/, 1)[0] ?? ''
  let decoded = cleanSource
  try { decoded = decodeURIComponent(cleanSource) } catch { /* preserve malformed source for a readable fallback */ }
  const basename = decoded.replace(/\\/g, '/').split('/').at(-1)?.trim() ?? ''
  if (/\.(png|jpe?g|gif|webp|bmp|avif|ico|svg)$/i.test(basename)) return basename.slice(0, 160)
  const stem = alt.replace(/[<>:"/\\|?*\r\n]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120) || 'Markdown 图片'
  const extension = mime.includes('jpeg') ? 'jpg' : mime.match(/^image\/([a-z0-9.+-]+)$/i)?.[1]?.replace('svg+xml', 'svg') || 'png'
  return `${stem}.${extension}`
}
