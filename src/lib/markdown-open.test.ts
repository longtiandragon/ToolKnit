import { describe, expect, it } from 'vitest'
import { isMarkdownOpenShortcut, normalizeMarkdownOpenPaths } from './markdown-open'

describe('desktop Markdown open helpers', () => {
  it('recognizes the standard editor shortcut without stealing modified variants', () => {
    expect(isMarkdownOpenShortcut({ ctrlKey: true, metaKey: false, altKey: false, shiftKey: false, key: 'o' })).toBe(true)
    expect(isMarkdownOpenShortcut({ ctrlKey: false, metaKey: true, altKey: false, shiftKey: false, key: 'O' })).toBe(true)
    expect(isMarkdownOpenShortcut({ ctrlKey: true, metaKey: false, altKey: false, shiftKey: true, key: 'o' })).toBe(false)
    expect(isMarkdownOpenShortcut({ ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, key: 'o' })).toBe(false)
  })

  it('filters, deduplicates and bounds desktop Markdown paths', () => {
    const paths = Array.from({ length: 10 }, (_, index) => `F:\\Notes\\chapter-${index}.md`)
    expect(normalizeMarkdownOpenPaths([
      paths[0]!,
      paths[0]!.toUpperCase(),
      'F:\\Notes\\image.png',
      '  ',
      ...paths.slice(1),
    ])).toEqual(paths.slice(0, 8))
  })

  it('accepts every extension registered by the desktop installer', () => {
    expect(normalizeMarkdownOpenPaths(['a.md', 'b.mdx', 'c.markdown', 'd.mkd'])).toHaveLength(4)
  })
})
