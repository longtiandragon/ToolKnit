import { describe, expect, it } from 'vitest'
import { buildFocusLedger, focusEventMinutes, localDateKey } from './focus-ledger'
import type { TimelineEvent } from '@/types'

function focus(id: string, date: Date, minutes: unknown): TimelineEvent {
  const value = date.toISOString()
  return { id, type: 'pomodoro', startsAt: value, payload: { actualMinutes: minutes }, createdAt: value, updatedAt: value }
}

describe('focus ledger', () => {
  it('groups the latest seven local days without letting old sessions leak in', () => {
    const now = new Date(2026, 7, 10, 12)
    const events = [
      focus('today-a', new Date(2026, 7, 10, 9), 25),
      focus('today-b', new Date(2026, 7, 10, 11), 35),
      focus('yesterday', new Date(2026, 7, 9, 20), 40),
      focus('old', new Date(2026, 6, 30, 12), 200),
    ]
    const summary = buildFocusLedger(events, now)

    expect(summary.days).toHaveLength(7)
    expect(summary.days.at(-1)).toMatchObject({ key: '2026-08-10', minutes: 60, isToday: true, percent: 100 })
    expect(summary.days.at(-2)).toMatchObject({ key: '2026-08-09', minutes: 40 })
    expect(summary.totalMinutes).toBe(100)
    expect(summary.sessionCount).toBe(3)
  })

  it('keeps empty weeks explicit and chart-safe', () => {
    const summary = buildFocusLedger([], new Date(2026, 7, 10, 12))
    expect(summary.maxMinutes).toBe(0)
    expect(summary.days.every((day) => day.minutes === 0 && day.percent === 0)).toBe(true)
  })

  it('normalizes recorded minutes to a safe daily range', () => {
    const now = new Date(2026, 7, 10, 12)
    expect(focusEventMinutes(focus('rounded', now, 24.6))).toBe(25)
    expect(focusEventMinutes(focus('bounded', now, 99_999))).toBe(1_440)
    expect(focusEventMinutes(focus('invalid', now, 'nope'))).toBe(0)
  })

  it('formats dates from local calendar fields instead of UTC slices', () => {
    expect(localDateKey(new Date(2026, 0, 2, 0, 5))).toBe('2026-01-02')
  })
})
