import { describe, expect, it } from 'vitest'
import { knowledgeSnippetParts, knowledgeSnippetText } from './knowledge-search'

describe('knowledge search snippets', () => {
  it('turns FTS markers into safe render segments', () => {
    expect(knowledgeSnippetParts('…负边会让 [Dijkstra] 失效，改用 [Bellman-Ford]。')).toEqual([
      { text: '…负边会让 ', highlighted: false },
      { text: 'Dijkstra', highlighted: true },
      { text: ' 失效，改用 ', highlighted: false },
      { text: 'Bellman-Ford', highlighted: true },
      { text: '。', highlighted: false },
    ])
  })

  it('does not render unmatched markers as markup', () => {
    expect(knowledgeSnippetText('数组 [i 与 <script>')).toBe('数组 [i 与 <script>')
    expect(knowledgeSnippetParts('   ')).toEqual([])
  })

  it('bounds snippets before building render segments', () => {
    const parts = knowledgeSnippetParts(`[${'a'.repeat(300)}]`, 40)
    expect(parts.map((part) => part.text).join('')).toHaveLength(40)
  })
})
