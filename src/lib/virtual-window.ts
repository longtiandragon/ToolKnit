export interface VirtualWindow {
  start: number
  end: number
  before: number
  after: number
}

/**
 * Calculates the small, buffered slice of a fixed-height list that needs DOM
 * nodes. Keeping this independent from Vue lets every dense desktop list use
 * the exact same, well-tested scroll math.
 */
export function fixedRowVirtualWindow(total: number, scrollTop: number, viewportHeight: number, rowHeight: number, overscan = 6): VirtualWindow {
  const safeTotal = Math.max(0, Math.floor(total))
  const safeHeight = Math.max(1, rowHeight)
  const safeOverscan = Math.max(0, Math.floor(overscan))
  const first = Math.max(0, Math.floor(Math.max(0, scrollTop) / safeHeight) - safeOverscan)
  const visible = Math.max(1, Math.ceil(Math.max(0, viewportHeight) / safeHeight))
  const start = Math.min(safeTotal, first)
  const end = Math.min(safeTotal, Math.max(start, Math.ceil(Math.max(0, scrollTop) / safeHeight) + visible + safeOverscan))
  return { start, end, before: start * safeHeight, after: Math.max(0, safeTotal - end) * safeHeight }
}
