import { describe, expect, it } from 'vitest'
import type { ClipboardItem } from '@/types'
import { clipboardItemToMarkdownNote } from './clipboard-note'

function item(input: Partial<ClipboardItem>): ClipboardItem {
  return { id: 'clip-1', kind: 'text', hash: 'hash', capturedAt: '2026-08-09T00:00:00.000Z', ...input }
}

describe('clipboard item to Markdown note', () => {
  it('keeps plain text as an editable Markdown note', () => {
    expect(clipboardItemToMarkdownNote(item({ content: '# 二分边界\n\nleft 和 right 的含义。' }))).toEqual({
      title: '二分边界',
      content: '# 二分边界\n\n# 二分边界\n\nleft 和 right 的含义。\n',
    })
  })

  it('wraps code with a fence that cannot be closed by pasted content', () => {
    const draft = clipboardItemToMarkdownNote(item({ kind: 'code', content: '// 滑动窗口\nconst sample = `\`\`\``' }))
    expect(draft?.title).toBe('滑动窗口')
    const fence = draft?.content.match(/\n(`+)\n\/\/ 滑动窗口/)?.[1]
    expect(fence?.length).toBeGreaterThan(5)
    expect(draft?.content).toMatch(new RegExp(`\\n${fence}\\n$`))
  })

  it('uses a predictable title when pasted code has no descriptive comment', () => {
    expect(clipboardItemToMarkdownNote(item({ kind: 'code', content: 'const answer = solve(input)\nreturn answer' }))?.title).toBe('来自剪贴板的代码')
  })

  it('does not pretend an image is a text note', () => {
    expect(clipboardItemToMarkdownNote(item({ kind: 'image', preview: 'data:image/png;base64,ignored' }))).toBeUndefined()
  })
})
