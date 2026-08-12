import { describe, expect, it } from 'vitest'
import { normalizePreviewSelection, PREVIEW_SELECTION_HTML_LIMIT, PREVIEW_SELECTION_TEXT_LIMIT, previewSelectionSummary, previewSelectionTreeToMarkdown, type PreviewSelectionNode } from './preview-selection'

const text = (value: string): PreviewSelectionNode => ({ type: 'text', value })
const element = (tag: string, children: PreviewSelectionNode[] = [], attrs?: Record<string, string>): PreviewSelectionNode => ({ type: 'element', tag, children, attrs })

describe('preview selection', () => {
  it('preserves selected text and rendered HTML while trimming outer whitespace', () => {
    expect(normalizePreviewSelection('  二分查找\n边界  ', ' <strong>二分查找</strong> ')).toEqual({
      text: '二分查找\n边界',
      html: '<strong>二分查找</strong>',
      textTruncated: false,
      htmlTruncated: false,
    })
  })

  it('rejects empty selections and bounds large reader payloads', () => {
    expect(normalizePreviewSelection(' \n ')).toBeUndefined()
    const payload = normalizePreviewSelection('文'.repeat(PREVIEW_SELECTION_TEXT_LIMIT + 10), 'x'.repeat(PREVIEW_SELECTION_HTML_LIMIT + 10))
    expect(payload).toMatchObject({ textTruncated: true, htmlTruncated: true })
    expect(payload?.text).toHaveLength(PREVIEW_SELECTION_TEXT_LIMIT)
    expect(payload?.html).toHaveLength(PREVIEW_SELECTION_HTML_LIMIT)
  })

  it('builds a compact menu label without exposing the full selection', () => {
    expect(previewSelectionSummary('  第一行\n\n第二行  ', 9)).toBe('第一行 第二行')
    expect(previewSelectionSummary('abcdefghijklmnopqrstuvwxyz', 10)).toBe('abcdefghi…')
  })

  it('serializes common rendered prose back to portable Markdown', () => {
    expect(previewSelectionTreeToMarkdown([
      element('h2', [text('边界条件')]),
      element('p', [text('使用 '), element('strong', [text('左闭右开')]), text('，参考 '), element('a', [text('说明')], { href: './guide.md' }), text('。')]),
      element('blockquote', [element('p', [text('先写不变量。')])]),
      element('ul', [
        element('li', [element('input', [], { type: 'checkbox', checked: '' }), text('检查空数组')]),
        element('li', [text('验证复杂度'), element('ol', [element('li', [text('时间')]), element('li', [text('空间')])])]),
      ]),
    ])).toBe([
      '## 边界条件',
      '',
      '使用 **左闭右开**，参考 [说明](./guide.md)。',
      '',
      '> 先写不变量。',
      '',
      '- [x] 检查空数组',
      '- 验证复杂度',
      '  1. 时间',
      '  2. 空间',
    ].join('\n'))
  })

  it('preserves code fences, images and tables without preview controls', () => {
    expect(previewSelectionTreeToMarkdown([
      element('div', [
        element('button', [text('复制')]),
        element('pre', [element('code', [text('const ticks = `x`\n')], { class: 'language-ts' })]),
      ], { class: 'code-frame' }),
      element('p', [element('img', [], { alt: '状态图', src: 'placeholder.gif', 'data-external-image-src': './assets/state (1).png' })]),
      element('table', [
        element('thead', [element('tr', [element('th', [text('字段')]), element('th', [text('含义')])])]),
        element('tbody', [element('tr', [element('td', [text('due')]), element('td', [text('到期 | 时间')])])]),
      ]),
    ])).toBe([
      '```ts',
      'const ticks = `x`',
      '```',
      '',
      '![状态图](./assets/state \\(1\\).png)',
      '',
      '| 字段 | 含义 |',
      '| --- | --- |',
      '| due | 到期 \\| 时间 |',
    ].join('\n'))
  })

  it('uses a longer inline code delimiter when the selection contains backticks', () => {
    expect(previewSelectionTreeToMarkdown([element('p', [text('运行 '), element('code', [text('`npm run`')])])])).toBe('运行 `` `npm run` ``')
  })
})
