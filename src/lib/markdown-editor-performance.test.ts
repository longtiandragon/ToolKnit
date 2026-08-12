import { describe, expect, it } from 'vitest'
import {
  EXTREME_MARKDOWN_EDITOR_THRESHOLD,
  HUGE_MARKDOWN_EDITOR_THRESHOLD,
  LARGE_MARKDOWN_EDITOR_THRESHOLD,
  markdownEditorCommitPolicy,
} from './markdown-editor-performance'

describe('Markdown editor commit policy', () => {
  it('keeps ordinary notes responsive without visible batching', () => {
    expect(markdownEditorCommitPolicy(LARGE_MARKDOWN_EDITOR_THRESHOLD)).toEqual({ delayMs: 120, label: '' })
  })

  it('increases only the expensive downstream batching delay for large notes', () => {
    expect(markdownEditorCommitPolicy(LARGE_MARKDOWN_EDITOR_THRESHOLD + 1).delayMs).toBe(320)
    expect(markdownEditorCommitPolicy(HUGE_MARKDOWN_EDITOR_THRESHOLD + 1).delayMs).toBe(520)
    expect(markdownEditorCommitPolicy(EXTREME_MARKDOWN_EDITOR_THRESHOLD + 1)).toEqual({
      delayMs: 720,
      label: '0.7 秒合并更新',
    })
  })

  it('does not change policy inside a size tier', () => {
    expect(markdownEditorCommitPolicy(HUGE_MARKDOWN_EDITOR_THRESHOLD).delayMs).toBe(320)
    expect(markdownEditorCommitPolicy(EXTREME_MARKDOWN_EDITOR_THRESHOLD).delayMs).toBe(520)
  })
})
