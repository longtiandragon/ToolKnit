import type { TimelineEvent } from '@/types'

export interface FocusLedgerDay {
  key: string
  label: string
  fullLabel: string
  minutes: number
  percent: number
  isToday: boolean
}

export interface FocusLedgerSummary {
  days: FocusLedgerDay[]
  totalMinutes: number
  sessionCount: number
  maxMinutes: number
}

function startOfLocalDay(value: Date) {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate())
}

export function localDateKey(value: Date) {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`
}

export function focusEventMinutes(event: TimelineEvent) {
  if (event.type !== 'pomodoro') return 0
  const value = Number(event.payload.actualMinutes)
  return Number.isFinite(value) ? Math.max(1, Math.min(1_440, Math.round(value))) : 0
}

/** Build a bounded seven-day summary from the already bounded event feed. */
export function buildFocusLedger(events: readonly TimelineEvent[], now = new Date()): FocusLedgerSummary {
  const today = startOfLocalDay(now)
  const minuteByDay = new Map<string, number>()
  const sessionByDay = new Map<string, number>()

  for (const event of events) {
    const minutes = focusEventMinutes(event)
    const startedAt = new Date(event.startsAt)
    if (!minutes || Number.isNaN(startedAt.getTime())) continue
    const key = localDateKey(startedAt)
    minuteByDay.set(key, (minuteByDay.get(key) ?? 0) + minutes)
    sessionByDay.set(key, (sessionByDay.get(key) ?? 0) + 1)
  }

  const values = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(today)
    date.setDate(today.getDate() - (6 - index))
    const key = localDateKey(date)
    return {
      key,
      label: index === 6 ? '今' : `周${'日一二三四五六'[date.getDay()]}`,
      fullLabel: `${date.getMonth() + 1} 月 ${date.getDate()} 日`,
      minutes: minuteByDay.get(key) ?? 0,
      sessionCount: sessionByDay.get(key) ?? 0,
      isToday: index === 6,
    }
  })
  const maxMinutes = Math.max(0, ...values.map((day) => day.minutes))

  return {
    days: values.map(({ sessionCount: _sessionCount, ...day }) => ({
      ...day,
      percent: maxMinutes ? Math.max(8, Math.round(day.minutes / maxMinutes * 100)) : 0,
    })),
    totalMinutes: values.reduce((total, day) => total + day.minutes, 0),
    sessionCount: values.reduce((total, day) => total + day.sessionCount, 0),
    maxMinutes,
  }
}

