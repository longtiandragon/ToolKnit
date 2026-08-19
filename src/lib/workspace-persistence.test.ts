import { afterEach, describe, expect, it, vi } from 'vitest'
import type { WorkspaceSnapshot } from './workspace-backup'
import { boundedJobHistory, codeDraftPersistDelay, createCoalescedTask, createPrimaryWorkspaceSnapshot, JOB_PROGRESS_PERSIST_DELAY_MS, MAX_JOB_HISTORY } from './workspace-persistence'

const snapshot: WorkspaceSnapshot = {
  sources: [{ id: 'source-1', name: 'large.png', kind: 'image', mime: 'image/png', size: 10, importedAt: '2026-08-10', tags: [] }],
  documents: [{ id: 'doc-1', title: '大型笔记', kind: 'note', subject: '计算机', tags: [], difficulty: 0, content: '# 正文', createdAt: '2026-08-10', updatedAt: '2026-08-10', reviewEnabled: false, errorTypes: [] }],
  vocabulary: [],
  relations: [],
  jobs: [],
  aiProfiles: [],
  activeVaultName: '我的 KnitspaceVault',
  codeDraft: { content: 'x'.repeat(1_000_000), name: 'large.ts' },
  recipes: [],
  favorites: [],
  toolUsages: [],
  activities: [{ id: 'activity-1', kind: 'tool', title: '打开工具', createdAt: '2026-08-10' }],
}

afterEach(() => vi.useRealTimers())

describe('workspace persistence boundaries', () => {
  it('keeps the standalone code draft out of every primary workspace snapshot', () => {
    const primary = createPrimaryWorkspaceSnapshot(snapshot, false)
    expect(primary).not.toHaveProperty('codeDraft')
    expect(JSON.stringify(primary)).not.toContain('large.ts')
    expect(primary.documents).toHaveLength(1)
  })

  it('keeps heavy Vault collections out of the desktop renderer snapshot', () => {
    const primary = createPrimaryWorkspaceSnapshot(snapshot, true)
    expect(primary).toMatchObject({ sources: [], documents: [], vocabulary: [], relations: [], activities: [], jobs: [] })
  })

  it('retains task recovery when only the native job ledger is unavailable', () => {
    const withJob = { ...snapshot, jobs: [{ id: 'job-1', kind: 'pdf' as const, label: '合并 PDF', status: 'queued' as const, progress: 0, createdAt: '2026-08-10' }] }
    expect(createPrimaryWorkspaceSnapshot(withJob, true, false).jobs).toHaveLength(1)
    expect(createPrimaryWorkspaceSnapshot(withJob, true, true).jobs).toEqual([])
  })

  it('clears portable recipes only after the desktop automation ledger is active', () => {
    const withRecipes = {
      ...snapshot,
      recipes: [{ id: 'recipe-1', title: '压缩图片', group: 'image' as const, operation: 'compress', parameters: { quality: 82 }, createdAt: '2026-08-19T00:00:00Z' }],
      pipelineRecipes: [{ id: 'pipeline-1', title: '清理文本', version: 1 as const, scope: 'text' as const, steps: [{ id: 'step-1', toolId: 'trim-lines' }], createdAt: '2026-08-19T00:00:00Z', updatedAt: '2026-08-19T00:00:00Z' }],
    }
    expect(createPrimaryWorkspaceSnapshot(withRecipes, true, true, false).recipes).toHaveLength(1)
    expect(createPrimaryWorkspaceSnapshot(withRecipes, true, true, false).pipelineRecipes).toHaveLength(1)
    expect(createPrimaryWorkspaceSnapshot(withRecipes, true, true, true)).toMatchObject({ recipes: [], pipelineRecipes: [] })
  })

  it('keeps absolute paths out of the browser job fallback', () => {
    const withJob = {
      ...snapshot,
      jobs: [{
        id: 'job-private', kind: 'media' as const, label: '转码', status: 'queued' as const,
        progress: 0, createdAt: '2026-08-19', inputs: [{ name: 'video.mp4', path: 'Z:\\private\\video.mp4' }],
        parameters: { outputDirectory: 'Z:\\private', operation: 'clean-metadata' },
      }],
    }
    const primary = createPrimaryWorkspaceSnapshot(withJob, false)
    expect(primary.jobs[0]).toMatchObject({ inputs: [{ name: 'video.mp4' }], parameters: { operation: 'clean-metadata' } })
    expect(JSON.stringify(primary.jobs)).not.toContain('Z:\\\\private')
  })

  it('bounds job history while retaining the newest entries', () => {
    const jobs = Array.from({ length: MAX_JOB_HISTORY + 3 }, (_, index) => ({ id: `job-${index}`, kind: 'image' as const, label: `任务 ${index}`, status: 'succeeded' as const, progress: 100, createdAt: '2026-08-10' }))
    expect(boundedJobHistory(jobs)).toHaveLength(MAX_JOB_HISTORY)
    expect(boundedJobHistory(jobs).at(0)?.id).toBe('job-0')
    expect(boundedJobHistory(jobs).at(-1)?.id).toBe(`job-${MAX_JOB_HISTORY - 1}`)
  })

  it('backs off standalone draft writes as source text grows', () => {
    expect(codeDraftPersistDelay(8_000)).toBe(450)
    expect(codeDraftPersistDelay(100_000)).toBe(900)
    expect(codeDraftPersistDelay(500_000)).toBe(1_500)
  })

  it('coalesces progress bursts and still supports an immediate shutdown flush', () => {
    vi.useFakeTimers()
    const write = vi.fn()
    const scheduler = createCoalescedTask(write)
    scheduler.schedule()
    scheduler.schedule()
    scheduler.schedule()
    expect(scheduler.pending()).toBe(true)
    vi.advanceTimersByTime(JOB_PROGRESS_PERSIST_DELAY_MS - 1)
    expect(write).not.toHaveBeenCalled()
    scheduler.flush()
    expect(write).toHaveBeenCalledTimes(1)
    expect(scheduler.pending()).toBe(false)
    vi.advanceTimersByTime(JOB_PROGRESS_PERSIST_DELAY_MS)
    expect(write).toHaveBeenCalledTimes(1)
  })
})
