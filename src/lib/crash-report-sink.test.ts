import { describe, expect, it } from 'vitest'
import { createCrashReportState, formatCrashDetail, shouldReport } from './crash-report-sink'

describe('formatCrashDetail', () => {
  it('prefers a stack, which is what locates the bug', () => {
    const error = new Error('boom')
    error.stack = 'Error: boom\n    at render (app.js:12:3)'
    expect(formatCrashDetail(error)).toContain('at render')
  })

  it('falls back to name and message when there is no stack', () => {
    const error = new TypeError('bad argument')
    error.stack = ''
    expect(formatCrashDetail(error)).toBe('TypeError: bad argument')
  })

  it('accepts a thrown string or object', () => {
    expect(formatCrashDetail('plain failure')).toBe('plain failure')
    expect(formatCrashDetail({ code: 42 })).toBe('{"code":42}')
  })

  it('survives a value that cannot be serialised', () => {
    const circular: Record<string, unknown> = {}
    circular.self = circular
    expect(formatCrashDetail(circular, 'unknown')).toBe('unknown')
  })

  it('bounds a runaway stack so the log entry cannot be one error', () => {
    const error = new Error('x')
    error.stack = 'at frame\n'.repeat(5000)
    expect(formatCrashDetail(error).length).toBeLessThanOrEqual(2000)
  })
})

describe('shouldReport', () => {
  it('collapses the same error repeating inside the dedupe window', () => {
    const state = createCrashReportState()
    expect(shouldReport(state, 'Error: same', 1000)).toBe(true)
    expect(shouldReport(state, 'Error: same', 1500)).toBe(false)
    // Past the window it is worth knowing the error is still happening.
    expect(shouldReport(state, 'Error: same', 4000)).toBe(true)
  })

  it('lets a different error through immediately', () => {
    const state = createCrashReportState()
    expect(shouldReport(state, 'Error: first', 1000)).toBe(true)
    expect(shouldReport(state, 'Error: second', 1001)).toBe(true)
  })

  it('stops after the session cap so a throwing render loop cannot flood', () => {
    const state = createCrashReportState()
    for (let index = 0; index < 20; index += 1) {
      expect(shouldReport(state, `Error: ${index}`, index * 10)).toBe(true)
    }
    expect(shouldReport(state, 'Error: overflow', 10_000)).toBe(false)
    expect(state.sent).toBe(20)
  })

  it('compares a prefix, so two runs of one stack count as one error', () => {
    const state = createCrashReportState()
    const first = `${'Error: boom\n at a.js:1'.padEnd(220, ' ')}deep frame A`
    const second = `${'Error: boom\n at a.js:1'.padEnd(220, ' ')}deep frame B`
    expect(shouldReport(state, first, 1000)).toBe(true)
    expect(shouldReport(state, second, 1200)).toBe(false)
  })
})
