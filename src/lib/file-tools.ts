export type TextTransformMode = 'json' | 'trim' | 'markdown'

export function cleanOutputName(name: string) {
  return name.replace(/\.[^.]+$/, '').replace(/[^\w\-\u4e00-\u9fff]+/g, '-') || 'toolknit'
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
  if (mode === 'json') return { content: JSON.stringify(JSON.parse(raw), null, 2), extension: 'json' }
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
  return {
    content: `${raw.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()}\n`,
    extension: 'md'
  }
}

export function buildRenamePreview(names: string[], prefix: string) {
  const safePrefix = prefix.trim() || '整理文件'
  return names.map((name, index) => {
    const dot = name.lastIndexOf('.')
    const extension = dot > 0 && dot < name.length - 1 ? name.slice(dot) : ''
    return `${name}  →  ${safePrefix}-${String(index + 1).padStart(3, '0')}${extension}`
  })
}
