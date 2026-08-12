import { describe, expect, it } from 'vitest'
import type { ActivityRecord, Job } from '@/types'
import { filterHistoryActivities, filterHistoryJobs, historyActivityKindFromQuery, historyJobSummary, historyKindFromQuery, historyOutputPaths, historyReplayLocation, historyStatusFromQuery, historyViewFromQuery, historyWindow, toggleHistorySelection } from './history-list'

const jobs: Job[] = [
  { id: 'script', kind: 'script', label: '单词整理', status: 'cancelled', progress: 100, inputNames: ['words.csv'], outputNames: ['clean.json'], createdAt: '2026-08-09T08:00:00.000Z' },
  { id: 'media', kind: 'media', label: '视频转码', status: 'succeeded', progress: 100, outputs: [{ name: 'lesson.mp3', path: 'C:\\out\\lesson.mp3' }], createdAt: '2026-08-09T07:00:00.000Z' },
  { id: 'image', kind: 'image', label: '图片压缩', status: 'failed', progress: 100, detail: '输入文件不存在', createdAt: '2026-08-09T06:00:00.000Z' },
]

describe('history list model', () => {
  it('normalizes deep-link filters instead of trusting malformed URLs', () => {
    expect(historyViewFromQuery('activity')).toBe('activity')
    expect(historyViewFromQuery('unknown')).toBe('jobs')
    expect(historyStatusFromQuery('failed')).toBe('failed')
    expect(historyStatusFromQuery(['failed'])).toBe('all')
    expect(historyKindFromQuery('media')).toBe('media')
    expect(historyKindFromQuery('video')).toBe('all')
    expect(historyActivityKindFromQuery('clipboard')).toBe('clipboard')
    expect(historyActivityKindFromQuery('pdf')).toBe('all')
  })

  it('keeps script and cancelled jobs searchable and filterable', () => {
    expect(filterHistoryJobs(jobs, { query: '', status: 'cancelled', kind: 'script' }).map((job) => job.id)).toEqual(['script'])
    expect(filterHistoryJobs(jobs, { query: 'lesson.mp3', status: 'all', kind: 'all' }).map((job) => job.id)).toEqual(['media'])
    expect(filterHistoryJobs(jobs, { query: '不存在', status: 'failed', kind: 'all' }).map((job) => job.id)).toEqual(['image'])
  })

  it('returns only the visible rows plus overscan for a long ledger', () => {
    expect(historyWindow(500, 1_680, 336, 168, 4)).toEqual({ start: 6, end: 16, offset: 1_008, height: 84_000 })
  })

  it('bounds batch output labels while preserving every real output path', () => {
    const batch: Job = {
      id: 'split', kind: 'pdf', label: '拆分 PDF', status: 'succeeded', progress: 100, createdAt: '2026-08-09T09:00:00.000Z',
      outputs: Array.from({ length: 24 }, (_, index) => ({ name: `page-${index + 1}.pdf`, path: `C:\\out\\page-${index + 1}.pdf` })),
    }
    expect(historyJobSummary(batch, 'output')).toBe('page-1.pdf、page-2.pdf、page-3.pdf 等 24 个文件')
    expect(historyOutputPaths(batch)).toHaveLength(24)
    expect(historyOutputPaths(batch).at(-1)).toBe('C:\\out\\page-24.pdf')
  })

  it('preserves an owning route query while adding a safe replay pointer', () => {
    expect(historyReplayLocation({ id: 'job-7', route: '/private-tools?tool=files&operation=rename' })).toEqual({
      path: '/private-tools', query: { tool: 'files', operation: 'rename', replay: 'job-7' },
    })
    expect(historyReplayLocation({ id: 'job-8', route: '/documents?kind=note#editor' })).toEqual({
      path: '/documents', query: { kind: 'note', replay: 'job-8' }, hash: '#editor',
    })
    expect(historyReplayLocation({ id: 'job-9', route: 'unsafe-relative' })).toEqual({
      path: '/tools', query: { replay: 'job-9' },
    })
  })

  it('searches the activity ledger independently and keeps selection immutable', () => {
    const activities: ActivityRecord[] = [
      { id: 'one', kind: 'clipboard', title: '保存剪贴板内容', detail: '代码片段', createdAt: '2026-08-11T08:00:00.000Z' },
      { id: 'two', kind: 'output', title: '完成：拆分 PDF', route: '/tools', createdAt: '2026-08-11T07:00:00.000Z' },
    ]
    expect(filterHistoryActivities(activities, '代码', 'clipboard').map((item) => item.id)).toEqual(['one'])
    expect(filterHistoryActivities(activities, '', 'output').map((item) => item.id)).toEqual(['two'])
    const original = new Set(['one'])
    const next = toggleHistorySelection(original, 'two')
    expect([...original]).toEqual(['one'])
    expect([...next]).toEqual(['one', 'two'])
  })
})
