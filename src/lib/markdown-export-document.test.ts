import { describe, expect, it } from 'vitest'
import { safeMarkdownExportName, standaloneMarkdownHtml } from './markdown-export-document'

describe('standalone Markdown export document', () => {
  it('creates a printable offline shell and escapes the document title', () => {
    const html = standaloneMarkdownHtml('算法 <最短路>', '<h1>Dijkstra</h1>')
    expect(html).toContain('<!doctype html>')
    expect(html).toContain('<title>算法 &lt;最短路&gt;</title>')
    expect(html).toContain('<h1>Dijkstra</h1>')
    expect(html).toContain('@media print')
    expect(html).toContain('.katex .katex-mathml')
    expect(html).not.toContain('<script')
  })

  it('produces a bounded Windows-safe filename', () => {
    expect(safeMarkdownExportName('  图论：Dijkstra / 证明？  ')).toBe('图论：Dijkstra - 证明？.html')
    expect(safeMarkdownExportName('CON')).toBe('_CON.html')
    expect(safeMarkdownExportName('...')).toBe('untitled.html')
    expect(safeMarkdownExportName('a'.repeat(180))).toHaveLength(125)
  })
})
