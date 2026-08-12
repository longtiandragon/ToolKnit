import { describe, expect, it } from 'vitest'
import { scrollOffset, scrollProgress } from './scroll-sync'

describe('scroll sync', () => {
  it('maps different scroll ranges through a stable normalized progress', () => {
    const progress = scrollProgress(450, 1200, 300)
    expect(progress).toBe(0.5)
    expect(scrollOffset(progress, 2600, 600)).toBe(1000)
  })

  it('clamps invalid and out-of-range values without producing NaN', () => {
    expect(scrollProgress(-20, 1000, 200)).toBe(0)
    expect(scrollProgress(1200, 1000, 200)).toBe(1)
    expect(scrollProgress(20, 200, 200)).toBe(0)
    expect(scrollOffset(Number.NaN, 1000, 200)).toBe(0)
    expect(scrollOffset(2, 1000, 200)).toBe(800)
  })
})
