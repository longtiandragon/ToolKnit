import type { Source, SourceAnchor } from '@/types'

export interface SourceNoteScaffold {
  title: string
  folder: string
  subject: string
  tags: string[]
  content: string
  sourceAnchor: SourceAnchor
}

const markdownExtension = /\.(?:md|mdx|markdown|mkd)$/i
const codeLanguages: Record<string, string> = {
  c: 'cpp', cc: 'cpp', cpp: 'cpp', cxx: 'cpp', h: 'cpp', hpp: 'cpp',
  js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
  ts: 'typescript', tsx: 'typescript', py: 'python', java: 'java', rs: 'rust',
  go: 'go', vue: 'vue', html: 'html', css: 'css', scss: 'scss', json: 'json',
  sh: 'bash', ps1: 'powershell', sql: 'sql',
}

function sourceBaseName(name: string) {
  return (name.replace(/\.[^./\\]+$/, '').trim() || '未命名资料').slice(0, 96)
}

function codeFence(content: string) {
  const longest = [...content.matchAll(/`+/g)].reduce((length, match) => Math.max(length, match[0].length), 0)
  return '`'.repeat(Math.max(3, longest + 1))
}

function sourceLanguage(name: string) {
  const extension = name.split('.').at(-1)?.toLocaleLowerCase() ?? ''
  return codeLanguages[extension] ?? ''
}

function sourceTags(source: Source) {
  const kindLabel = source.kind === 'image' ? '图片' : source.kind === 'pdf' ? 'PDF' : source.kind === 'code' ? '代码' : '文本'
  const values = ['资料摘记', kindLabel, ...source.tags.slice(0, 8)]
  return values.filter((tag, index) => tag && values.findIndex((item) => item.toLocaleLowerCase('zh-CN') === tag.toLocaleLowerCase('zh-CN')) === index)
}

function defaultAnchor(source: Source): SourceAnchor {
  return { sourceId: source.id, pageIndex: 0, bbox: [0, 0, 1, 1] }
}

function scaffoldContent(source: Source, title: string, anchor: SourceAnchor) {
  const raw = source.content ?? ''
  if (markdownExtension.test(source.name) && raw.trim()) return raw

  const provenance = `> 来源：${source.name}${source.kind === 'pdf' ? ` · 第 ${anchor.pageIndex + 1} 页` : ''}\n> 原始资料保留在 Knitspace Vault；可从笔记顶部随时返回。`
  if (source.kind === 'code' && raw.trim()) {
    const body = raw.replace(/\s+$/, '')
    const fence = codeFence(body)
    return `# ${title}\n\n${provenance}\n\n## 原文\n\n${fence}${sourceLanguage(source.name)}\n${body}\n${fence}\n\n## 理解与备注\n\n`
  }
  if (source.kind === 'text' && raw.trim()) {
    return `# ${title}\n\n${provenance}\n\n${raw.replace(/\s+$/, '')}\n\n## 理解与备注\n\n`
  }
  return `# ${title}\n\n${provenance}\n\n## 摘录\n\n\n## 我的理解\n\n\n## 待确认\n\n`
}

/**
 * Creates an ordinary Markdown note without mutating the source. Markdown
 * stays byte-for-byte intact; other source types get a small, editable
 * scaffold and retain a structured anchor back to the original Vault asset.
 */
export function sourceNoteScaffold(source: Source, anchor = defaultAnchor(source), title = sourceBaseName(source.name)): SourceNoteScaffold {
  return {
    title,
    folder: '收集箱/资料摘记',
    subject: source.kind === 'code' ? '计算机' : '未分类',
    tags: sourceTags(source),
    content: scaffoldContent(source, title, anchor),
    sourceAnchor: anchor,
  }
}

export function sourceNoteTitle(source: Source) {
  return sourceBaseName(source.name)
}
