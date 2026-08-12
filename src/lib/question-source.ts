import { classifyMarkdownLink, markdownLinkMarkup, type MarkdownLinkTarget } from './markdown-link'

export type QuestionSourceReference =
  | { kind: 'text'; raw: string; label: string; hint: string }
  | { kind: 'web'; raw: string; label: string; href: string; hint: string }
  | { kind: 'markdown'; raw: string; label: string; href: string; path: string; fragment?: string; hint: string }
  | { kind: 'file'; raw: string; label: string; href: string; path: string; hint: string }

const exactMarkdownLink = /^\s*\[([^\]\n]{1,240})\]\(([^)\n]+)\)\s*$/
const embeddedWebUrl = /https?:\/\/[^\s<>()]+/i
const trailingUrlPunctuation = /[。；，、！？）】》〉」』”’.,;!?]+$/

function compact(value: string) {
  return value.replace(/\s+/g, ' ').trim().slice(0, 2_000)
}

function fileLabel(path: string) {
  return path.split(/[\\/]/).filter(Boolean).pop() || path
}

function referenceFromTarget(raw: string, label: string, href: string, target: MarkdownLinkTarget): QuestionSourceReference | undefined {
  if (target.kind === 'external' && /^https?:/i.test(target.href)) {
    return { kind: 'web', raw, label: label || target.href, href: target.href, hint: '网页来源 · 使用系统浏览器打开' }
  }
  if (target.kind === 'markdown') {
    return { kind: 'markdown', raw, label: label || fileLabel(target.path), href, path: target.path, ...(target.fragment ? { fragment: target.fragment } : {}), hint: '本地 Markdown · 在 Knitspace 打开' }
  }
  if (target.kind === 'file') {
    return { kind: 'file', raw, label: label || fileLabel(target.path), href, path: target.path, hint: '本地文件 · 使用系统默认应用打开' }
  }
}

/**
 * Turns user-authored provenance into an action only when it is unambiguous.
 * Relative paths, mail/tel links and unknown schemes remain ordinary text.
 */
export function questionSourceReference(value: unknown): QuestionSourceReference {
  const raw = compact(typeof value === 'string' ? value : '')
  if (!raw) return { kind: 'text', raw: '', label: '', hint: '可填写题库编号、教材章节、课程、网页或本地文件' }

  const markdown = raw.match(exactMarkdownLink)
  if (markdown) {
    const label = compact(markdown[1] ?? '')
    const href = (markdown[2] ?? '').trim()
    const reference = referenceFromTarget(raw, label, href, classifyMarkdownLink(href))
    if (reference) return reference
  }

  const webMatch = raw.match(embeddedWebUrl)?.[0]?.replace(trailingUrlPunctuation, '') ?? ''
  if (webMatch) {
    const prefix = compact(raw.slice(0, raw.indexOf(webMatch)).replace(/[·:：—-]+$/, ''))
    const reference = referenceFromTarget(raw, prefix || webMatch, webMatch, classifyMarkdownLink(webMatch))
    if (reference) return reference
  }

  const direct = referenceFromTarget(raw, '', raw, classifyMarkdownLink(raw))
  return direct ?? { kind: 'text', raw, label: raw, hint: '文字出处 · 可右键复制' }
}

export function questionSourceActionLabel(reference: QuestionSourceReference) {
  if (reference.kind === 'web') return '打开来源网页'
  if (reference.kind === 'markdown') return '在 Knitspace 打开来源 Markdown'
  if (reference.kind === 'file') return '打开来源文件'
  return ''
}

function escapeInlineMarkdown(value: string) {
  return compact(value).replace(/([\\`*_[\]<>])/g, '\\$1')
}

export function questionSourceMarkdown(value: unknown) {
  const reference = questionSourceReference(value)
  if (!reference.raw) return ''
  if (reference.kind === 'text') return `> 来源：${escapeInlineMarkdown(reference.label)}`
  return `> 来源：${markdownLinkMarkup(reference.label, reference.href)}`
}
