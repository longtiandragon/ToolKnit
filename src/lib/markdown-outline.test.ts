import { describe, expect, it } from 'vitest'
import { extractMarkdownOutline, MAX_MARKDOWN_OUTLINE_ITEMS } from './markdown-outline'

describe('extractMarkdownOutline', () => {
  it('keeps source line positions and readable Markdown labels', () => {
    const source = [
      '---',
      'title: test',
      '---',
      '# Graph **Algorithms**',
      '',
      '## [Dijkstra](https://example.com) ###',
      '### [[Shortest path#Proof|Proof notes]]',
    ].join('\n')

    expect(extractMarkdownOutline(source)).toEqual([
      { label: 'Graph Algorithms', level: 1, index: 0, sourceLine: 4 },
      { label: 'Dijkstra', level: 2, index: 1, sourceLine: 6 },
      { label: 'Proof notes', level: 3, index: 2, sourceLine: 7 },
    ])
  })

  it('does not turn fenced code into document headings', () => {
    const source = '# Before\n\n```ts\n# not a heading\n```\n\n## After'
    expect(extractMarkdownOutline(source).map((item) => item.label)).toEqual(['Before', 'After'])
  })

  it('bounds pathological heading-heavy documents without dropping normal notes', () => {
    const source = Array.from({ length: MAX_MARKDOWN_OUTLINE_ITEMS + 12 }, (_, index) => `## Section ${index}`).join('\n')
    const outline = extractMarkdownOutline(source)
    expect(outline).toHaveLength(MAX_MARKDOWN_OUTLINE_ITEMS)
    expect(outline.at(-1)).toMatchObject({ label: `Section ${MAX_MARKDOWN_OUTLINE_ITEMS - 1}`, sourceLine: MAX_MARKDOWN_OUTLINE_ITEMS })
  })
})
