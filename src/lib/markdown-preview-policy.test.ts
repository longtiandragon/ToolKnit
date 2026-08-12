import { describe, expect, it } from 'vitest'
import { EXPLICIT_MARKDOWN_PREVIEW_THRESHOLD, deferredMarkdownPreviewMessage, needsExplicitMarkdownPreview } from './markdown-preview-policy'

describe('Markdown preview policy', () => {
  it('keeps normal documents in live preview and gates only very large sources', () => {
    expect(needsExplicitMarkdownPreview('x'.repeat(EXPLICIT_MARKDOWN_PREVIEW_THRESHOLD))).toBe(false)
    expect(needsExplicitMarkdownPreview('x'.repeat(EXPLICIT_MARKDOWN_PREVIEW_THRESHOLD + 1))).toBe(true)
  })

  it('explains that the deferred reader is a performance choice', () => {
    expect(deferredMarkdownPreviewMessage()).toContain('保持流畅')
  })
})
