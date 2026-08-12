import { describe, expect, it } from 'vitest'
import { externalMarkdownConflictPreview } from './external-markdown-conflict'

describe('external Markdown conflict preview', () => {
  it('distinguishes draft and disk edits from their last saved base', () => {
    const preview = externalMarkdownConflictPreview(
      '# 笔记\n共同内容\n旧结尾',
      '# 笔记\n草稿新增\n共同内容\n旧结尾',
      '# 笔记\n共同内容\n磁盘结尾',
    )
    expect(preview.draftChanged).toBe(true)
    expect(preview.diskChanged).toBe(true)
    expect(preview.lines.some((line) => line.kind === 'removed' && line.text === '草稿新增')).toBe(true)
    expect(preview.lines.some((line) => line.kind === 'added' && line.text === '磁盘结尾')).toBe(true)
    expect(preview.firstChangedLine).toBe(2)
  })

  it('normalizes Windows line endings before comparing', () => {
    const preview = externalMarkdownConflictPreview('a\r\nb', 'a\r\nb', 'a\nb')
    expect(preview.draftChanged).toBe(false)
    expect(preview.diskChanged).toBe(false)
    expect(preview.lines.every((line) => line.kind === 'same')).toBe(true)
  })

  it('keeps a huge document preview bounded around the first change', () => {
    const prefix = Array.from({ length: 5_000 }, (_, index) => `line ${index}`).join('\n')
    const preview = externalMarkdownConflictPreview(prefix, `${prefix}\n草稿`, `${prefix}\n磁盘`)
    expect(preview.truncated).toBe(true)
    expect(preview.lines.length).toBeLessThanOrEqual(64)
    expect(preview.firstChangedLine).toBe(5_001)
  })
})
