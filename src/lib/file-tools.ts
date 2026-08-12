export type TextTransformMode = 'json' | 'trim' | 'markdown' | 'dedupe-lines' | 'sort-lines' | 'extract-contacts' | 'statistics'

export interface RenameOptions {
  prefix: string
  suffix?: string
  start?: number
  digits?: number
  separator?: string
  keepOriginalName?: boolean
}

export function cleanOutputName(name: string) {
  return name.replace(/\.[^.]+$/, '').replace(/[^\w\-\u4e00-\u9fff]+/g, '-') || 'knitspace'
}

export function parsePageIndexes(raw: string, total: number) {
  if (!Number.isInteger(total) || total < 1) throw new Error('PDF 没有可处理的页面。')
  const tokens = raw.split(',').map((token) => token.trim()).filter(Boolean)
  if (!tokens.length) throw new Error('请输入页码，例如：1,3-5。')

  const indexes: number[] = []
  for (const token of tokens) {
    if (!/^\d+(?:-\d+)?$/.test(token)) throw new Error(`页码“${token}”格式不正确。`)
    const [start, end = start] = token.split('-').map(Number)
    if (start < 1 || end < start || end > total) {
      throw new Error(`页码“${token}”超出范围，当前文件共 ${total} 页。`)
    }
    for (let page = start; page <= end; page += 1) indexes.push(page - 1)
  }
  return indexes
}

export function transformText(raw: string, mode: TextTransformMode) {
  if (!raw.trim()) throw new Error('粘贴文本或选择一个文本文件。')
  if (mode === 'json') {
    try {
      return { content: JSON.stringify(JSON.parse(raw), null, 2), extension: 'json' }
    } catch (error) {
      const detail = error instanceof Error ? error.message : ''
      const location = detail.match(/(?:position|line|column)\s+\d+(?:\s*\([^)]*\))?/i)?.[0]
      throw new Error(`JSON 格式错误${location ? `（${location}）` : ''}，请检查引号、逗号和括号。`)
    }
  }
  if (mode === 'trim') {
    const content = raw
      .replace(/\r\n/g, '\n')
      .split('\n')
      .map((line) => line.trimEnd())
      .filter((line, index, lines) => line || lines[index - 1])
      .join('\n')
      .trim()
    return { content: `${content}\n`, extension: 'txt' }
  }
  if (mode === 'dedupe-lines') {
    const seen = new Set<string>()
    const content = raw.replace(/\r\n/g, '\n').split('\n').filter((line) => {
      const key = line.trim()
      if (!key || seen.has(key)) return false
      seen.add(key)
      return true
    }).join('\n')
    return { content: `${content}\n`, extension: 'txt' }
  }
  if (mode === 'sort-lines') {
    const lines = raw.replace(/\r\n/g, '\n').split('\n').map((line) => line.trim()).filter(Boolean)
    lines.sort((a, b) => a.localeCompare(b, 'zh-CN', { numeric: true, sensitivity: 'base' }))
    return { content: `${lines.join('\n')}\n`, extension: 'txt' }
  }
  if (mode === 'extract-contacts') {
    const urls = raw.match(/https?:\/\/[^\s<>"')\]，。！？；、]+/gi) ?? []
    const emails = raw.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ?? []
    const unique = (values: string[]) => [...new Set(values)]
    const sections = [
      `链接（${unique(urls).length}）\n${unique(urls).join('\n') || '无'}`,
      `邮箱（${unique(emails).length}）\n${unique(emails).join('\n') || '无'}`
    ]
    return { content: `${sections.join('\n\n')}\n`, extension: 'txt' }
  }
  if (mode === 'statistics') {
    const normalized = raw.replace(/\r\n/g, '\n')
    const nonWhitespace = normalized.replace(/\s/g, '').length
    const words = normalized.match(/[A-Za-z0-9]+(?:['’-][A-Za-z0-9]+)*/g)?.length ?? 0
    const chinese = normalized.match(/[\u3400-\u9fff]/g)?.length ?? 0
    const paragraphs = normalized.split(/\n\s*\n/).filter((item) => item.trim()).length
    const lines = normalized.split('\n').length
    return { content: `文本统计\n\n字符（含空格）：${normalized.length}\n字符（不含空格）：${nonWhitespace}\n中文字符：${chinese}\n英文/数字词：${words}\n段落：${paragraphs}\n行数：${lines}\n`, extension: 'txt' }
  }
  return {
    content: `${raw.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()}\n`,
    extension: 'md'
  }
}

export function buildRenamePreview(names: string[], input: string | RenameOptions) {
  const options: RenameOptions = typeof input === 'string' ? { prefix: input } : input
  const safePrefix = options.prefix.trim() || '整理文件'
  const suffix = options.suffix?.trim() ?? ''
  const separator = options.separator?.trim() || '-'
  const start = Math.max(0, Math.floor(options.start ?? 1))
  const digits = Math.max(1, Math.min(8, Math.floor(options.digits ?? 3)))
  return names.map((name, index) => {
    const dot = name.lastIndexOf('.')
    const extension = dot > 0 && dot < name.length - 1 ? name.slice(dot) : ''
    const original = cleanOutputName(extension ? name.slice(0, dot) : name)
    const number = String(start + index).padStart(digits, '0')
    const parts = options.keepOriginalName ? [safePrefix, original, suffix] : [safePrefix, number, suffix]
    return `${name}  →  ${parts.filter(Boolean).join(separator)}${extension}`
  })
}
