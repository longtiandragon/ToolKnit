import { describe, expect, it } from 'vitest'
import { detectMarkdownEditorContext } from './markdown-editor-context'

describe('detectMarkdownEditorContext', () => {
  it('prioritizes a selected range', () => {
    expect(detectMarkdownEditorContext(['# title'], 0, 2, 1, 'picked')).toMatchObject({ kind: 'selection', text: 'picked', line: 1 })
  })

  it('detects links and images only when the cursor is inside them', () => {
    const line = 'See [docs](https://example.com) and ![plot](./plot.png)'
    expect(detectMarkdownEditorContext([line], 0, 8, 4)).toMatchObject({ kind: 'link', target: 'https://example.com' })
    expect(detectMarkdownEditorContext([line], 0, 45, 4)).toMatchObject({ kind: 'image', target: './plot.png' })
    expect(detectMarkdownEditorContext([line], 0, 0, 4).kind).toBe('text')
  })

  it('extracts a fenced code block from the bounded line window', () => {
    const context = detectMarkdownEditorContext(['before', '```ts', 'const n = 1', '```', 'after'], 2, 3, 12)
    expect(context).toMatchObject({ kind: 'code', language: 'ts', text: 'const n = 1', line: 12 })
  })

  it('keeps link-looking syntax inside a fence in code context', () => {
    const context = detectMarkdownEditorContext(['```md', '[docs](https://example.com)', '```'], 1, 8, 9)
    expect(context).toMatchObject({ kind: 'code', language: 'md', text: '[docs](https://example.com)' })
  })

  it('detects Obsidian links and inline code at the cursor', () => {
    const line = 'See [[Renderer#Cache|缓存策略]] and `renderBlock()`.'
    expect(detectMarkdownEditorContext([line], 0, 9, 5)).toMatchObject({ kind: 'wiki-link', target: 'Renderer#Cache', detail: '缓存策略' })
    expect(detectMarkdownEditorContext([line], 0, 39, 5)).toMatchObject({ kind: 'inline-code', text: 'renderBlock()' })
  })

  it('classifies headings and task-list rows', () => {
    expect(detectMarkdownEditorContext(['### Rendering'], 0, 5, 2)).toMatchObject({ kind: 'heading', detail: 'Rendering' })
    expect(detectMarkdownEditorContext(['- [x] keep source'], 0, 5, 3)).toMatchObject({ kind: 'list', detail: 'keep source' })
  })
})
