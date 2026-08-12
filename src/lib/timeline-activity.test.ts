import { describe, expect, it } from 'vitest'
import { activityFromTimelineEvent, activityToTimelineEvent, isRecentToolActivityDuplicate, timelineActivities } from './timeline-activity'
import type { ActivityRecord, TimelineEvent } from '@/types'

const activity: ActivityRecord = {
  id: 'activity-1', kind: 'output', title: '复制代码图片', detail: '第 1 张', route: '/code-image', relatedId: 'job-1', createdAt: '2026-08-09T10:00:00.000Z'
}

describe('timeline activity bridge', () => {
  it('suppresses only immediate duplicate tool-open events', () => {
    const opened: ActivityRecord = { ...activity, kind: 'tool', relatedId: 'code-image', createdAt: '2026-08-11T08:00:00.000Z' }
    expect(isRecentToolActivityDuplicate(opened, 'code-image', '2026-08-11T08:00:01.000Z')).toBe(true)
    expect(isRecentToolActivityDuplicate(opened, 'visual-card', '2026-08-11T08:00:01.000Z')).toBe(false)
    expect(isRecentToolActivityDuplicate(opened, 'code-image', '2026-08-11T08:00:03.000Z')).toBe(false)
  })
  it('round-trips a compact local activity through the Vault event shape', () => {
    const event = activityToTimelineEvent(activity)
    expect(event).toMatchObject({ type: 'activity', startsAt: activity.createdAt, payload: { kind: 'output', title: '复制代码图片', route: '/code-image' } })
    expect(activityFromTimelineEvent(event)).toEqual(activity)
  })

  it('drops malformed events and keeps newest unique activity records first', () => {
    const newer = activityToTimelineEvent({ ...activity, id: 'activity-2', title: '完成处理', createdAt: '2026-08-10T10:00:00.000Z' })
    const malformed: TimelineEvent = { ...activityToTimelineEvent(activity), id: 'bad', payload: { kind: 'unknown', title: '坏数据' } }
    expect(timelineActivities([activityToTimelineEvent(activity), malformed, newer, newer])).toEqual([
      expect.objectContaining({ id: 'activity-2', title: '完成处理' }),
      expect.objectContaining({ id: 'activity-1', title: '复制代码图片' }),
    ])
  })
})
