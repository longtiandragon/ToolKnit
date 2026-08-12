import { describe, expect, it } from 'vitest'
import { fixedRowVirtualWindow } from './virtual-window'

describe('fixedRowVirtualWindow', () => {
  it('renders a small buffered window at the beginning', () => {
    expect(fixedRowVirtualWindow(1000, 0, 300, 60, 4)).toEqual({ start: 0, end: 9, before: 0, after: 59460 })
  })

  it('clamps negative scroll positions and empty lists', () => {
    expect(fixedRowVirtualWindow(0, -10, 200, 60)).toEqual({ start: 0, end: 0, before: 0, after: 0 })
  })

  it('keeps the final rows reachable without creating excess items', () => {
    expect(fixedRowVirtualWindow(20, 1140, 120, 60, 3)).toEqual({ start: 16, end: 20, before: 960, after: 0 })
  })
})
