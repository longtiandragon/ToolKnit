import { describe, expect, it } from 'vitest'
import { recentCreateMenuHeight } from './create-recent-menu'

describe('create space recent-work menu', () => {
  it('reserves the rendered height of recent-work context menus', () => {
    expect(recentCreateMenuHeight('note')).toBe(387)
    expect(recentCreateMenuHeight('visual')).toBe(167)
  })
})
