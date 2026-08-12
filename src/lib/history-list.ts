import type { ActivityKind, ActivityRecord, Job, JobKind, JobStatus } from '@/types'

export type HistoryStatusFilter = 'all' | JobStatus
export type HistoryKindFilter = 'all' | JobKind
export type HistoryView = 'jobs' | 'activity'
export type HistoryActivityFilter = 'all' | ActivityKind

export interface HistoryFilters {
  query: string
  status: HistoryStatusFilter
  kind: HistoryKindFilter
}

const historyStatuses = new Set<HistoryStatusFilter>(['all', 'queued', 'running', 'succeeded', 'failed', 'cancelled'])
const historyKinds = new Set<HistoryKindFilter>(['all', 'pdf', 'image', 'text', 'code', 'ocr', 'ai', 'archive', 'script', 'media'])
const historyActivityKinds = new Set<HistoryActivityFilter>(['all', 'tool', 'job', 'source', 'output', 'clipboard', 'backup', 'system'])

export function historyViewFromQuery(value: unknown): HistoryView {
  return value === 'activity' ? 'activity' : 'jobs'
}

export function historyStatusFromQuery(value: unknown): HistoryStatusFilter {
  return typeof value === 'string' && historyStatuses.has(value as HistoryStatusFilter) ? value as HistoryStatusFilter : 'all'
}

export function historyKindFromQuery(value: unknown): HistoryKindFilter {
  return typeof value === 'string' && historyKinds.has(value as HistoryKindFilter) ? value as HistoryKindFilter : 'all'
}

export function historyActivityKindFromQuery(value: unknown): HistoryActivityFilter {
  return typeof value === 'string' && historyActivityKinds.has(value as HistoryActivityFilter) ? value as HistoryActivityFilter : 'all'
}

export function filterHistoryJobs(jobs: Job[], filters: HistoryFilters) {
  const query = filters.query.trim().toLocaleLowerCase('zh-CN')
  return jobs.filter((job) => {
    if (filters.status !== 'all' && job.status !== filters.status) return false
    if (filters.kind !== 'all' && job.kind !== filters.kind) return false
    if (!query) return true
    const searchable = [
      job.label,
      job.toolId,
      job.detail,
      ...(job.inputNames ?? []),
      ...(job.outputNames ?? []),
      ...(job.inputs?.map((input) => input.name) ?? []),
      ...(job.outputs?.map((output) => output.name) ?? []),
    ].filter(Boolean).join(' ').toLocaleLowerCase('zh-CN')
    return searchable.includes(query)
  })
}

export function filterHistoryActivities(activities: ActivityRecord[], query: string, kind: HistoryActivityFilter) {
  const normalized = query.trim().toLocaleLowerCase('zh-CN')
  return activities.filter((activity) => {
    if (kind !== 'all' && activity.kind !== kind) return false
    if (!normalized) return true
    return [activity.title, activity.detail]
      .filter(Boolean)
      .join(' ')
      .toLocaleLowerCase('zh-CN')
      .includes(normalized)
  })
}

export function toggleHistorySelection(selection: ReadonlySet<string>, id: string) {
  const next = new Set(selection)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  return next
}

export function historyJobNames(job: Job, target: 'input' | 'output') {
  const structured = target === 'input' ? job.inputs : job.outputs
  const legacy = target === 'input' ? job.inputNames : job.outputNames
  return structured?.map((item) => item.name).filter(Boolean) ?? legacy?.filter(Boolean) ?? []
}

export function historyJobSummary(job: Job, target: 'input' | 'output', visibleLimit = 3) {
  const names = historyJobNames(job, target)
  if (!names.length) return target === 'input' ? '未记录' : job.detail || '等待生成'
  const limit = Math.max(1, Math.trunc(visibleLimit))
  const preview = names.slice(0, limit).join('、')
  return names.length > limit ? `${preview} 等 ${names.length} 个文件` : preview
}

export function historyOutputPaths(job: Job) {
  return job.outputs?.map((output) => output.path).filter((path): path is string => Boolean(path)) ?? []
}

/** Builds a safe deep link back to the owning tool without discarding route
 * parameters such as a private tool and operation. Landing on the page only
 * restores state; the tool page remains responsible for explicit execution. */
export function historyReplayLocation(job: Pick<Job, 'id' | 'route'>) {
  const rawTarget = job.route?.trim() || '/tools'
  const [pathAndQuery, rawHash = ''] = rawTarget.split('#', 2)
  const [rawPath, rawQuery = ''] = pathAndQuery.split('?', 2)
  const query: Record<string, string> = {}
  new URLSearchParams(rawQuery).forEach((value, key) => { query[key] = value })
  query.replay = job.id
  return {
    path: rawPath.startsWith('/') ? rawPath : '/tools',
    query,
    ...(rawHash ? { hash: `#${rawHash}` } : {}),
  }
}

/** Keeps a long desktop ledger to a small, stable DOM window. */
export function historyWindow(total: number, scrollTop: number, viewportHeight: number, rowHeight: number, overscan: number) {
  const safeRowHeight = Math.max(1, rowHeight)
  const start = Math.max(0, Math.floor(Math.max(0, scrollTop) / safeRowHeight) - Math.max(0, overscan))
  const end = Math.min(total, Math.ceil((Math.max(0, scrollTop) + Math.max(0, viewportHeight)) / safeRowHeight) + Math.max(0, overscan))
  return { start, end, offset: start * safeRowHeight, height: total * safeRowHeight }
}
