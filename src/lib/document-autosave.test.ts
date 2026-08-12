import { describe, expect, it } from 'vitest'
import { documentAutoSavePolicy } from './document-autosave'

describe('document auto-save policy', () => {
  it('backs off as Markdown grows instead of increasing write frequency', () => {
    expect(documentAutoSavePolicy(20_000).delayMs).toBe(1800)
    expect(documentAutoSavePolicy(500_000).delayMs).toBe(2800)
    expect(documentAutoSavePolicy(1_000_000).delayMs).toBe(4200)
    expect(documentAutoSavePolicy(5_000_000)).toEqual({ delayMs: 6500, label: '大文档停笔 6.5 秒' })
  })

  it('normalizes invalid sizes to the small-document policy', () => {
    expect(documentAutoSavePolicy(-1).delayMs).toBe(1800)
    expect(documentAutoSavePolicy(Number.NaN).delayMs).toBe(1800)
  })
})
