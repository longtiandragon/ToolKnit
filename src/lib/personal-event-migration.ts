import type { TimelineEvent } from '@/types'

export const BROWSER_PERSONAL_EVENTS_KEY = 'knitspace:today-events:v1'

type PersonalEventStorage = Pick<Storage, 'getItem' | 'removeItem'>

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function parseBrowserPersonalEvents(raw: string | null) {
  if (!raw) return [] as TimelineEvent[]
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.flatMap((event): TimelineEvent[] => {
      if (!isRecord(event)
        || typeof event.id !== 'string'
        || !['pomodoro', 'anniversary', 'activity'].includes(String(event.type))
        || typeof event.startsAt !== 'string'
        || !isRecord(event.payload)) return []
      const createdAt = typeof event.createdAt === 'string' ? event.createdAt : event.startsAt
      const updatedAt = typeof event.updatedAt === 'string' ? event.updatedAt : createdAt
      return [{
        id: event.id,
        type: event.type as TimelineEvent['type'],
        startsAt: event.startsAt,
        payload: event.payload,
        createdAt,
        updatedAt,
      }]
    })
      .slice(0, 240)
  } catch {
    return []
  }
}

/** Removes the legacy snapshot only after the whole native transaction has
 * committed. A failed import remains retryable on the next desktop launch. */
export async function migrateBrowserPersonalEvents(
  storage: PersonalEventStorage,
  importEvents: (events: TimelineEvent[]) => Promise<void>,
) {
  const raw = storage.getItem(BROWSER_PERSONAL_EVENTS_KEY)
  if (raw === null) return 0
  const events = parseBrowserPersonalEvents(raw)
  if (events.length) await importEvents(events)
  storage.removeItem(BROWSER_PERSONAL_EVENTS_KEY)
  return events.length
}
