import { describe, expect, it, vi } from 'vitest'
import type { TimelineEvent } from '@/types'
import { BROWSER_PERSONAL_EVENTS_KEY, migrateBrowserPersonalEvents, parseBrowserPersonalEvents } from './personal-event-migration'

function event(id = 'focus-1'): TimelineEvent {
  return {
    id,
    type: 'pomodoro',
    startsAt: '2026-08-16T08:00:00Z',
    payload: { title: '算法练习', actualMinutes: 25 },
    createdAt: '2026-08-16T08:00:00Z',
    updatedAt: '2026-08-16T08:25:00Z',
  }
}

describe('browser personal event migration', () => {
  it('accepts the three legacy timeline kinds and repairs missing audit times', () => {
    expect(parseBrowserPersonalEvents(JSON.stringify([
      event(),
      { ...event('anniversary-1'), type: 'anniversary' },
      { id: 'activity-1', type: 'activity', startsAt: '2026-08-16T09:00:00Z', payload: { title: '工具活动' } },
      { ...event('broken'), payload: null },
    ]))).toEqual([
      event(),
      { ...event('anniversary-1'), type: 'anniversary' },
      { id: 'activity-1', type: 'activity', startsAt: '2026-08-16T09:00:00Z', payload: { title: '工具活动' }, createdAt: '2026-08-16T09:00:00Z', updatedAt: '2026-08-16T09:00:00Z' },
    ])
  })

  it('clears the legacy snapshot only after the native import commits', async () => {
    const storage = {
      getItem: vi.fn(() => JSON.stringify([event()])),
      removeItem: vi.fn(),
    }
    const importEvents = vi.fn(async () => undefined)
    await expect(migrateBrowserPersonalEvents(storage, importEvents)).resolves.toBe(1)
    expect(importEvents).toHaveBeenCalledWith([event()])
    expect(storage.removeItem).toHaveBeenCalledWith(BROWSER_PERSONAL_EVENTS_KEY)
  })

  it('retains the legacy snapshot when the transaction fails', async () => {
    const storage = {
      getItem: vi.fn(() => JSON.stringify([event()])),
      removeItem: vi.fn(),
    }
    const importEvents = vi.fn(async () => { throw new Error('disk full') })
    await expect(migrateBrowserPersonalEvents(storage, importEvents)).rejects.toThrow('disk full')
    expect(storage.removeItem).not.toHaveBeenCalled()
  })
})
