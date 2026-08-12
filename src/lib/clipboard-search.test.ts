import { describe, expect, it } from 'vitest'
import { CLIPBOARD_SEARCH_CONTENT_LIMIT, clipboardSearchText, matchesClipboardQuery } from './clipboard-search'
import type { ClipboardItem } from '@/types'

function item(input: Partial<ClipboardItem>): ClipboardItem {
  return { id: 'clip-1', kind: 'text', hash: 'hash', capturedAt: '2026-08-09T00:00:00.000Z', ...input }
}

describe('clipboard search index', () => {
  it('matches readable text and compact type labels', () => {
    expect(matchesClipboardQuery(item({ content: 'const answer = 42', kind: 'code' }), 'answer')).toBe(true)
    expect(matchesClipboardQuery(item({ kind: 'image', preview: 'data:image/png;base64,ignored' }), '图片')).toBe(true)
  })

  it('does not scan image base64 payloads as searchable text', () => {
    expect(matchesClipboardQuery(item({ kind: 'image', preview: 'data:image/png;base64,secret-token' }), 'secret-token')).toBe(false)
  })

  it('bounds huge clipboard text before a query runs on every item', () => {
    const value = 'a'.repeat(CLIPBOARD_SEARCH_CONTENT_LIMIT + 100) + 'later-token'
    expect(clipboardSearchText(item({ content: value }))).not.toContain('later-token')
    expect(matchesClipboardQuery(item({ content: value }), 'later-token')).toBe(false)
  })
})
