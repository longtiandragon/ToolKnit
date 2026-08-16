import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const store = readFileSync(new URL('../stores/workbench.ts', import.meta.url), 'utf8')
const persistence = readFileSync(new URL('./workspace-persistence.ts', import.meta.url), 'utf8')
const native = readFileSync(new URL('./native.ts', import.meta.url), 'utf8')
const vault = readFileSync(new URL('../../src-tauri/src/vault.rs', import.meta.url), 'utf8')
const history = readFileSync(new URL('../views/HistoryView.vue', import.meta.url), 'utf8')

describe('desktop processing job ownership', () => {
  it('hydrates before activation and keeps a browser recovery copy on native failure', () => {
    const hydrationStart = store.indexOf('async function hydrateVault()')
    const hydrationEnd = store.indexOf('async function searchDocuments', hydrationStart)
    const hydration = store.slice(hydrationStart, hydrationEnd)
    expect(hydration.indexOf('hydrateDesktopProcessingJobs')).toBeLessThan(hydration.indexOf('desktopJobsActive.value = true'))
    expect(store).toContain('desktopJobsActive.value = false')
    expect(store).toContain('writePrimaryWorkspace()')
    expect(persistence).toContain('jobs: desktopJobsActive ? []')
  })

  it('coalesces progress but immediately saves lifecycle transitions and serializes deletion', () => {
    expect(store).toContain('pendingJobSaves.set(job.id, cloneJob(job))')
    expect(store).toContain('setTimeout(flushPendingJobSaves, 900)')
    expect(store).toContain("queueJobSave(job, patch.status === 'running')")
    expect(store).toContain('queueJobSave(job, true)')
    expect(store).toContain('if (ids.length === 1) await deleteDesktopProcessingJob(ids[0])')
    expect(store).toContain('else await deleteDesktopProcessingJobs(ids)')
  })

  it('routes native commands through SQLite and recovers stale sessions only at hydration', () => {
    expect(native).toContain("invoke<DesktopProcessingJobHydration>('hydrate_default_processing_jobs'")
    expect(native).toContain("invoke<Job>('save_default_processing_job'")
    const openStart = vault.indexOf('pub fn open(path: String)')
    const openEnd = vault.indexOf('fn connection(', openStart)
    expect(vault.slice(openStart, openEnd)).not.toContain('recover_interrupted_processing_jobs')
    const hydrateStart = vault.indexOf('pub fn hydrate_processing_jobs')
    const hydrateEnd = vault.indexOf('pub fn delete_processing_job', hydrateStart)
    expect(vault.slice(hydrateStart, hydrateEnd)).toContain('self.recover_interrupted_processing_jobs(&connection)?')
  })

  it('loads older jobs with a stable timestamp and id cursor without changing the history style', () => {
    expect(native).toContain('beforeCreatedAt: before?.createdAt')
    expect(native).toContain('beforeId: before?.id')
    expect(store).toContain('let jobHistoryCursor')
    expect(store).toContain('listDesktopProcessingJobs(121, cursor)')
    expect(vault).toContain('OR (created_at = ?1 AND id < ?2)')
    expect(history).toContain('store.jobsHasMore || store.jobsLoadingMore')
    expect(history).toContain('载入较早记录')
  })
})
