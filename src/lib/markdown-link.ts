export type MarkdownLinkTarget =
  | { kind: 'external'; href: string }
  | { kind: 'anchor'; fragment: string }
  | { kind: 'markdown'; path: string; fragment?: string }
  | { kind: 'file'; path: string }
  | { kind: 'unresolved-relative'; href: string; fragment?: string }
  | { kind: 'unsupported'; href: string }

const markdownExtension = /\.(?:md|mdx|markdown|mkd)$/i
const allowedExternalScheme = /^(?:https?:|mailto:|tel:)/i
const unsafeScheme = /^(?:javascript:|data:|vbscript:)/i

function decodeLinkPart(value: string) {
  try { return decodeURIComponent(value) } catch { return value }
}

function splitFragment(value: string) {
  const index = value.indexOf('#')
  if (index < 0) return { path: value }
  return { path: value.slice(0, index), fragment: decodeLinkPart(value.slice(index + 1)).trim() || undefined }
}

function fileUrlPath(value: string) {
  try {
    const url = new URL(value)
    const decoded = decodeLinkPart(url.pathname)
    return /^\/[a-z]:\//i.test(decoded) ? decoded.slice(1).replace(/\//g, '\\') : decoded
  } catch { return '' }
}

function normalizeLocalPath(value: string) {
  const decoded = decodeLinkPart(value).split('?', 1)[0]
  const separator = decoded.includes('\\') ? '\\' : '/'
  const normalized = decoded.replace(/\\/g, '/')
  const drive = normalized.match(/^[a-z]:/i)?.[0] ?? ''
  const absolute = Boolean(drive || normalized.startsWith('/'))
  const segments = normalized.slice(drive.length).split('/').filter(Boolean)
  const resolved: string[] = []
  for (const segment of segments) {
    if (segment === '.') continue
    if (segment === '..') {
      if (resolved.length) resolved.pop()
      else if (!absolute) resolved.push(segment)
      continue
    }
    resolved.push(segment)
  }
  const prefix = drive ? `${drive}/` : normalized.startsWith('/') ? '/' : ''
  return `${prefix}${resolved.join('/')}`.replace(/\//g, separator)
}

export function resolveMarkdownRelativePath(baseMarkdownPath: string, relativeHref: string) {
  const separator = baseMarkdownPath.includes('\\') ? '\\' : '/'
  const base = baseMarkdownPath.replace(/\\/g, '/')
  const directory = base.slice(0, Math.max(0, base.lastIndexOf('/') + 1))
  return normalizeLocalPath(`${directory}${relativeHref}`).replace(/[\\/]/g, separator)
}

export function classifyMarkdownLink(rawHref: string, baseMarkdownPath = ''): MarkdownLinkTarget {
  const href = rawHref.trim()
  if (!href || unsafeScheme.test(href)) return { kind: 'unsupported', href }
  if (href.startsWith('//')) return { kind: 'external', href: `https:${href}` }
  if (allowedExternalScheme.test(href)) return { kind: 'external', href }
  if (/^[a-z][a-z\d+.-]*:/i.test(href) && !/^[a-z]:[\\/]/i.test(decodeLinkPart(href))) {
    if (/^file:/i.test(href)) {
      const { path: source, fragment } = splitFragment(href)
      const path = fileUrlPath(source)
      if (!path) return { kind: 'unsupported', href }
      return markdownExtension.test(path) ? { kind: 'markdown', path, ...(fragment ? { fragment } : {}) } : { kind: 'file', path }
    }
    return { kind: 'unsupported', href }
  }
  if (href.startsWith('#')) return { kind: 'anchor', fragment: decodeLinkPart(href.slice(1)).trim() }

  const { path: hrefPath, fragment } = splitFragment(href)
  const decodedPath = decodeLinkPart(hrefPath)
  const absoluteWindowsPath = /^[a-z]:[\\/]/i.test(decodedPath)
  const absolutePosixPath = decodedPath.startsWith('/')
  const path = absoluteWindowsPath || absolutePosixPath
    ? normalizeLocalPath(decodedPath)
    : baseMarkdownPath
      ? resolveMarkdownRelativePath(baseMarkdownPath, decodedPath)
      : ''
  if (!path) return { kind: 'unresolved-relative', href, ...(fragment ? { fragment } : {}) }
  return markdownExtension.test(path)
    ? { kind: 'markdown', path, ...(fragment ? { fragment } : {}) }
    : { kind: 'file', path }
}

export function markdownLinkMarkup(label: string, href: string) {
  const safeLabel = label.replace(/[\[\]]/g, '\\$&').trim() || href
  const safeHref = href.replace(/\\/g, '\\\\').replace(/([()])/g, '\\$1')
  return `[${safeLabel}](${safeHref})`
}

export function markdownHeadingMatchesFragment(heading: string, fragment: string) {
  const normalize = (value: string) => decodeLinkPart(value)
    .normalize('NFKC')
    .toLocaleLowerCase('zh-CN')
    .replace(/^#+/, '')
    .replace(/[-_\s]+/g, '')
    .replace(/[^\p{L}\p{N}]/gu, '')
  return Boolean(normalize(heading)) && normalize(heading) === normalize(fragment)
}
