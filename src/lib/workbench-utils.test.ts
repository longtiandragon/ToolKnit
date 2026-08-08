import { describe, expect, it } from 'vitest'
import { canRetryJob, looksLikeCode, normalizeFavoriteOrder, pruneClipboardHistory } from './workbench-utils'
import type { ClipboardItem, Job } from '@/types'

describe('workbench utilities', () => {
  it('deduplicates favorites and assigns only nine shortcuts', () => {
    const result = normalizeFavoriteOrder(['pdf', 'image', 'pdf', ...Array.from({ length: 9 }, (_, index) => `tool-${index}`)])
    expect(result[0]).toEqual({ toolId: 'pdf', order: 0, shortcut: 1 })
    expect(result).toHaveLength(11)
    expect(result[9].shortcut).toBeUndefined()
  })
  it('keeps pinned clipboard items outside retention and repairs unsafe one-item limits', () => {
    const now = new Date('2026-08-08T00:00:00Z').getTime()
    const item = (id: string, days: number, pinned = false): ClipboardItem => ({ id, kind: 'text', content: id, hash: id, capturedAt: new Date(now - days * 86_400_000).toISOString(), pinned })
    const result = pruneClipboardHistory([item('pinned', 100, true), item('fresh', 1), item('second', 2), item('old', 40)], 1, 30, now)
    expect(result.map((entry) => entry.id)).toEqual(['pinned', 'fresh', 'second'])
  })
  it('recognizes code without treating ordinary prose as code', () => {
    expect(looksLikeCode('const answer = value => value * 2;')).toBe(true)
    expect(looksLikeCode('明天下午整理课程笔记')).toBe(false)
  })
  it('requires a complete retry payload', () => {
    const base: Job = { id: '1', kind: 'pdf', label: '合并', status: 'succeeded', progress: 100, createdAt: '2026-08-08T00:00:00Z' }
    expect(canRetryJob(base)).toBe(false)
    expect(canRetryJob({ ...base, retryable: true, route: '/tools', toolId: 'pdf:merge', parameters: {} })).toBe(true)
  })
})
