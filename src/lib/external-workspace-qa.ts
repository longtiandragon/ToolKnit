import type { ExternalMarkdownContentSearch, ExternalMarkdownDirectory, ExternalMarkdownDirectoryEntry, ExternalMarkdownPayload, ExternalMarkdownWorkspaceSearch } from '@/lib/native'

export const EXTERNAL_WORKSPACE_QA_ROOT = 'F:\\Knitspace QA\\Notes'

const definitions: Record<string, Array<{ name: string; kind: 'directory' | 'markdown'; size?: number }>> = {
  '': [
    { name: '算法与数据结构', kind: 'directory' },
    { name: '英语学习', kind: 'directory' },
    { name: 'Knitspace 开发记录.md', kind: 'markdown', size: 18_420 },
    { name: '一篇标题很长用于验证桌面文件树省略而不是挤压按钮的笔记.md', kind: 'markdown', size: 52_880 },
  ],
  '算法与数据结构': [
    { name: '二分边界.md', kind: 'markdown', size: 7_812 },
    { name: '重复标题.md', kind: 'markdown', size: 5_210 },
    { name: '最短路', kind: 'directory' },
  ],
  '算法与数据结构/最短路': [{ name: 'Dijkstra.md', kind: 'markdown', size: 12_620 }],
  '英语学习': [{ name: '词根与易混词.md', kind: 'markdown', size: 9_450 }, { name: '重复标题.md', kind: 'markdown', size: 4_880 }],
}

const qaMarkdownContent: Record<string, string> = {
  '算法与数据结构/最短路/Dijkstra.md': '# Dijkstra\n\n从 [[二分边界#边界条件]] 回顾边界，再比较两个 [[重复标题]]。\n\n## 松弛操作\n\n只处理当前最短的节点。',
  '算法与数据结构/二分边界.md': '# 二分边界\n\n## 边界条件\n\n维护左闭右开的循环不变量。',
  '算法与数据结构/重复标题.md': '# 重复标题\n\n这是算法目录中的同名笔记。',
  '英语学习/重复标题.md': '# 重复标题\n\n这是英语目录中的同名笔记。',
}

export function externalWorkspaceQaDirectory(root: string, relativePath: string): ExternalMarkdownDirectory {
  const entries = (definitions[relativePath] ?? []).map((item) => {
    const childRelative = relativePath ? `${relativePath}/${item.name}` : item.name
    return {
      ...item,
      relativePath: childRelative,
      path: `${root}\\${childRelative.replace(/\//g, '\\')}`,
      modifiedAt: '2026-08-10T10:00:00.000Z',
    }
  })
  return { root, relativePath, entries, truncated: false }
}

function qaMarkdownEntries(root: string): ExternalMarkdownDirectoryEntry[] {
  return Object.entries(definitions).flatMap(([parent, children]) => children.flatMap((item) => {
    if (item.kind !== 'markdown') return []
    const relativePath = parent ? `${parent}/${item.name}` : item.name
    return [{
      name: item.name,
      kind: item.kind,
      size: item.size,
      relativePath,
      path: `${root}\\${relativePath.replace(/\//g, '\\')}`,
      modifiedAt: '2026-08-10T10:00:00.000Z',
    }]
  }))
}

export function externalWorkspaceQaSearch(root: string, query: string, limit = 40): ExternalMarkdownWorkspaceSearch {
  const terms = query.trim().toLocaleLowerCase('zh-CN').split(/\s+/).filter(Boolean)
  const allEntries = qaMarkdownEntries(root)
  const entries = allEntries.filter(entry => terms.every(term => entry.relativePath.toLocaleLowerCase('zh-CN').includes(term)))
  const capped = entries.slice(0, Math.max(1, Math.min(80, Math.trunc(limit))))
  return { root, query: query.trim(), entries: capped, scanned: allEntries.length, truncated: entries.length > capped.length }
}

export function externalWorkspaceQaContentSearch(root: string, query: string, limit = 40): ExternalMarkdownContentSearch {
  const terms = query.trim().toLocaleLowerCase('zh-CN').split(/\s+/).filter(Boolean)
  const allEntries = qaMarkdownEntries(root)
  const matches = allEntries.flatMap((entry) => {
    const content = qaMarkdownContent[entry.relativePath] ?? `# ${entry.name.replace(/\.(?:md|mdx|markdown|mkd)$/i, '')}\n`
    const relativeLower = entry.relativePath.toLocaleLowerCase('zh-CN')
    const contentLower = content.toLocaleLowerCase('zh-CN')
    if (!terms.every(term => relativeLower.includes(term) || contentLower.includes(term))) return []
    const lines = content.split(/\r?\n/)
    const lineIndex = Math.max(0, lines.findIndex(line => terms.some(term => line.toLocaleLowerCase('zh-CN').includes(term))))
    const rawPreview = lines[lineIndex]?.trim() ?? ''
    return [{ ...entry, line: lineIndex + 1, preview: rawPreview.length > 180 ? `${rawPreview.slice(0, 179)}…` : rawPreview }]
  })
  const capped = matches.slice(0, Math.max(1, Math.min(80, Math.trunc(limit))))
  const scannedBytes = allEntries.reduce((total, entry) => total + (entry.size ?? 0), 0)
  return { root, query: query.trim(), matches: capped, scanned: allEntries.length, scannedBytes, skippedLarge: 0, truncated: matches.length > capped.length }
}

export function externalWorkspaceQaMarkdown(root: string, path: string): ExternalMarkdownPayload {
  const normalizedRoot = root.replace(/\\/g, '/').replace(/\/$/, '')
  const normalizedPath = path.replace(/\\/g, '/')
  const relativePath = normalizedPath.startsWith(`${normalizedRoot}/`) ? normalizedPath.slice(normalizedRoot.length + 1) : ''
  const name = relativePath.split('/').at(-1) ?? ''
  const content = qaMarkdownContent[relativePath] ?? (name ? `# ${name.replace(/\.(?:md|mdx|markdown|mkd)$/i, '')}\n` : '')
  const parentPath = relativePath.split('/').slice(0, -1).join('/')
  if (!relativePath || !name || !definitions[parentPath]?.some(item => item.kind === 'markdown' && item.name === name)) {
    throw new Error('QA Markdown 文件不存在。')
  }
  return {
    path,
    name,
    content,
    hash: `qa-${relativePath}`,
    modifiedAt: '2026-08-10T10:00:00.000Z',
    size: new TextEncoder().encode(content).byteLength,
  }
}
