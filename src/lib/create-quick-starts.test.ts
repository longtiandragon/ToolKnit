import { describe, expect, it } from 'vitest'
import { createQuickStarts, recentCreateMenuHeight } from './create-quick-starts'

describe('create space quick starts', () => {
  it('keeps the eight high-frequency creative workflows directly visible and deep-linked', () => {
    expect(createQuickStarts).toHaveLength(8)
    expect(new Set(createQuickStarts.map((item) => item.id)).size).toBe(createQuickStarts.length)
    expect(createQuickStarts.every((item) => item.label && item.detail && item.icon && item.to.startsWith('/'))).toBe(true)
    expect(createQuickStarts.find((item) => item.id === 'stitch')?.to).toBe('/visual?tool=stitch')
    expect(createQuickStarts.find((item) => item.id === 'mindmap')?.to).toContain('mode=mindmap')
  })

  it('reserves the rendered height of recent-work context menus', () => {
    expect(recentCreateMenuHeight('note')).toBe(387)
    expect(recentCreateMenuHeight('visual')).toBe(167)
  })
})
