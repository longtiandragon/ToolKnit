export type MarkdownEditCommand = 'bold' | 'italic' | 'heading-2' | 'link' | 'quote' | 'bullet-list' | 'numbered-list' | 'task-list' | 'inline-code' | 'code-block'

export type MarkdownEditResult = {
  text: string
  selectionStart: number
  selectionEnd: number
}

export type MarkdownLineQueryRange = { from: number; to: number }

/** Find the most useful visible fragment to select after a body-search jump. */
export function markdownLineQueryRange(line: string, query?: string): MarkdownLineQueryRange | undefined {
  const normalized = query?.trim().slice(0, 160)
  if (!normalized) return undefined
  const candidates = [...new Set([normalized, ...normalized.split(/\s+/u)])]
    .filter(Boolean)
    .sort((left, right) => right.length - left.length)
  const searchable = line.toLocaleLowerCase()
  for (const candidate of candidates) {
    const from = searchable.indexOf(candidate.toLocaleLowerCase())
    if (from >= 0) return { from, to: from + candidate.length }
  }
  return undefined
}

const placeholders: Partial<Record<MarkdownEditCommand, string>> = {
  bold: '重点',
  italic: '强调',
  link: '链接文字',
  'inline-code': 'code',
  'code-block': '代码',
}

function wrapped(text: string, prefix: string, suffix: string, placeholder: string) {
  if (text.startsWith(prefix) && text.endsWith(suffix) && text.length >= prefix.length + suffix.length) {
    const unwrapped = text.slice(prefix.length, -suffix.length)
    return { text: unwrapped, selectionStart: 0, selectionEnd: unwrapped.length }
  }
  const body = text || placeholder
  return {
    text: `${prefix}${body}${suffix}`,
    selectionStart: prefix.length,
    selectionEnd: prefix.length + body.length,
  }
}

function mapLines(text: string, transform: (line: string, index: number) => string) {
  return text.split('\n').map((line, index) => {
    const carriageReturn = line.endsWith('\r') ? '\r' : ''
    const body = carriageReturn ? line.slice(0, -1) : line
    return `${transform(body, index)}${carriageReturn}`
  }).join('\n')
}

function lineEdit(command: MarkdownEditCommand, text: string) {
  const lines = text.split(/\r?\n/)
  const allMatch = command === 'heading-2'
    ? lines.every((line) => !line.trim() || /^##\s+/.test(line))
    : command === 'quote'
      ? lines.every((line) => !line.trim() || /^>\s?/.test(line))
      : command === 'bullet-list'
        ? lines.every((line) => !line.trim() || /^[-*+]\s+/.test(line))
        : command === 'numbered-list'
          ? lines.every((line) => !line.trim() || /^\d+\.\s+/.test(line))
          : lines.every((line) => !line.trim() || /^[-*+]\s+\[[ xX]\]\s+/.test(line))

  const edited = mapLines(text, (line, index) => {
    if (command === 'heading-2') {
      const body = line.replace(/^#{1,6}\s+/, '')
      return allMatch ? body : `## ${body}`
    }
    if (command === 'quote') return allMatch ? line.replace(/^>\s?/, '') : `> ${line}`
    if (command === 'bullet-list') return allMatch ? line.replace(/^[-*+]\s+/, '') : `- ${line}`
    if (command === 'numbered-list') return allMatch ? line.replace(/^\d+\.\s+/, '') : `${index + 1}. ${line}`
    return allMatch ? line.replace(/^[-*+]\s+\[[ xX]\]\s+/, '') : `- [ ] ${line}`
  })
  return { text: edited, selectionStart: 0, selectionEnd: edited.length }
}

function longestBacktickRun(text: string) {
  return Math.max(0, ...(text.match(/`+/g) ?? []).map((run) => run.length))
}

export function markdownLinePrefixLength(command: MarkdownEditCommand, text: string) {
  const pattern = command === 'heading-2'
    ? /^#{1,6}\s+/
    : command === 'quote'
      ? /^>\s?/
      : command === 'bullet-list'
        ? /^[-*+]\s+/
        : command === 'numbered-list'
          ? /^\d+\.\s+/
          : command === 'task-list'
            ? /^[-*+]\s+\[[ xX]\]\s+/
            : undefined
  return pattern ? (text.match(pattern)?.[0].length ?? 0) : 0
}

export function applyMarkdownEdit(command: MarkdownEditCommand, selectedText: string): MarkdownEditResult {
  if (command === 'bold') return wrapped(selectedText, '**', '**', placeholders.bold!)
  if (command === 'italic') {
    const isSingleItalic = selectedText.startsWith('*') && selectedText.endsWith('*') && !selectedText.startsWith('**') && !selectedText.endsWith('**')
    if (isSingleItalic) return { text: selectedText.slice(1, -1), selectionStart: 0, selectionEnd: Math.max(0, selectedText.length - 2) }
    const body = selectedText || placeholders.italic!
    return { text: `*${body}*`, selectionStart: 1, selectionEnd: 1 + body.length }
  }
  if (command === 'link') {
    const existing = selectedText.match(/^\[([^\]]+)]\(([^)]*)\)$/s)
    if (existing) return { text: existing[1], selectionStart: 0, selectionEnd: existing[1].length }
    const label = selectedText || placeholders.link!
    const prefix = `[${label}](`
    const url = 'https://'
    return { text: `${prefix}${url})`, selectionStart: prefix.length, selectionEnd: prefix.length + url.length }
  }
  if (command === 'inline-code') {
    const existing = selectedText.match(/^(`+) ?([\s\S]*?) ?\1$/)
    if (existing) return { text: existing[2], selectionStart: 0, selectionEnd: existing[2].length }
    const body = selectedText || placeholders['inline-code']!
    const fence = '`'.repeat(Math.max(1, longestBacktickRun(body) + 1))
    const spacing = body.startsWith('`') || body.endsWith('`') ? ' ' : ''
    return { text: `${fence}${spacing}${body}${spacing}${fence}`, selectionStart: fence.length + spacing.length, selectionEnd: fence.length + spacing.length + body.length }
  }
  if (command === 'code-block') {
    return applyMarkdownCodeBlock(selectedText)
  }
  return lineEdit(command, selectedText)
}

export function applyMarkdownCodeBlock(selectedText: string, language = ''): MarkdownEditResult {
  const body = selectedText || placeholders['code-block']!
  const fence = '`'.repeat(Math.max(3, longestBacktickRun(body) + 1))
  const prefix = `${fence}${language.trim()}\n`
  return { text: `${prefix}${body}\n${fence}`, selectionStart: prefix.length, selectionEnd: prefix.length + body.length }
}

export function isMarkdownLineCommand(command: MarkdownEditCommand) {
  return command === 'heading-2' || command === 'quote' || command === 'bullet-list' || command === 'numbered-list' || command === 'task-list'
}
