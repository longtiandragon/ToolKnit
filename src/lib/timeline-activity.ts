import type { ActivityKind, ActivityRecord, TimelineEvent } from '@/types'

export const MAX_TIMELINE_ACTIVITIES = 300

const activityKinds = new Set<ActivityKind>(['tool', 'job', 'source', 'output', 'clipboard', 'backup', 'system'])

/** Command clicks and route activation can describe the same tool opening.
 * Suppress only that short duplicate; later visits remain meaningful history. */
export function isRecentToolActivityDuplicate(activity: ActivityRecord | undefined, toolId: string, createdAt: string, windowMs = 2_000) {
  if (!activity || activity.kind !== 'tool' || activity.relatedId !== toolId) return false
  const previous = new Date(activity.createdAt).getTime()
  const current = new Date(createdAt).getTime()
  return Number.isFinite(previous) && Number.isFinite(current) && current >= previous && current - previous <= Math.max(0, windowMs)
}

function optionalText(value: unknown) {
  return typeof value === 'string' && value.trim() ? value : undefined
}

/** Keep the generic event payload compact and typed at this UI boundary. */
export function activityFromTimelineEvent(event: TimelineEvent): ActivityRecord | undefined {
  if (event.type !== 'activity') return undefined
  const kind = event.payload.kind
  const title = optionalText(event.payload.title)
  if (typeof kind !== 'string' || !activityKinds.has(kind as ActivityKind) || !title) return undefined
  return {
    id: event.id,
    kind: kind as ActivityKind,
    title,
    detail: optionalText(event.payload.detail),
    route: optionalText(event.payload.route),
    relatedId: optionalText(event.payload.relatedId),
    createdAt: event.startsAt || event.createdAt,
  }
}

export function activityToTimelineEvent(activity: ActivityRecord): TimelineEvent {
  return {
    id: activity.id,
    type: 'activity',
    startsAt: activity.createdAt,
    payload: {
      kind: activity.kind,
      title: activity.title,
      ...(activity.detail ? { detail: activity.detail } : {}),
      ...(activity.route ? { route: activity.route } : {}),
      ...(activity.relatedId ? { relatedId: activity.relatedId } : {}),
    },
    createdAt: activity.createdAt,
    updatedAt: activity.createdAt,
  }
}

/** Invalid or duplicate records must never prevent the history page opening. */
export function timelineActivities(events: TimelineEvent[], limit = MAX_TIMELINE_ACTIVITIES) {
  const distinct = new Map<string, ActivityRecord>()
  for (const event of events) {
    const activity = activityFromTimelineEvent(event)
    if (activity && !distinct.has(activity.id)) distinct.set(activity.id, activity)
  }
  return [...distinct.values()]
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .slice(0, Math.max(1, limit))
}
