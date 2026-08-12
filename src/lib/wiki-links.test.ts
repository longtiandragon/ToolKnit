import { describe, expect, it } from 'vitest'
import { externalWikiExactMatches, normalizeWikiTitle, parseWikiLinks, wikiLinkSource } from './wiki-links'

describe('wiki links', () => {
  it('parses targets, headings and aliases without rewriting Markdown', () => {
    expect(parseWikiLinks('复习 [[二分]]、[[ 图论 # 最短路 | Dijkstra ]]。')).toEqual([
      { target: '二分', label: '二分', heading: undefined, start: 3, end: 9 },
      { target: '图论', heading: '最短路', label: 'Dijkstra', start: 10, end: 35 },
    ])
  })

  it('normalizes titles only for lookups and preserves a portable source form', () => {
    expect(normalizeWikiTitle('  Loop   Invariant ')).toBe('loop invariant')
    expect(wikiLinkSource('二分', '边界条件', '这条笔记')).toBe('[[二分#边界条件|这条笔记]]')
  })

  it('resolves exact external stems and path-qualified Obsidian links without fuzzy navigation', () => {
    const entries = [
      { name: '二分.md', relativePath: '算法/二分.md' },
      { name: '二分.markdown', relativePath: '复习/二分.markdown' },
      { name: '二分边界.md', relativePath: '算法/二分边界.md' },
    ]
    expect(externalWikiExactMatches('二分', entries).map(item => item.relativePath)).toEqual(['复习/二分.markdown', '算法/二分.md'])
    expect(externalWikiExactMatches('算法\\二分.md', entries).map(item => item.relativePath)).toEqual(['算法/二分.md'])
    expect(externalWikiExactMatches('二分边', entries)).toEqual([])
  })
})
