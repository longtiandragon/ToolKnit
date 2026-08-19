import type { Job } from '@/types'
import type { WorkspaceSnapshot } from '@/lib/workspace-backup'
import { portableProcessingJob } from '@/lib/job-privacy'

export const MAX_JOB_HISTORY = 500
export const JOB_PROGRESS_PERSIST_DELAY_MS = 900

export type PrimaryWorkspaceSnapshot = Omit<WorkspaceSnapshot, 'codeDraft'>

/** The desktop Vault owns heavy collections. The code-image draft has its own
 * key in both browser and desktop modes so unrelated state changes never
 * stringify a potentially multi-megabyte source string. */
export function createPrimaryWorkspaceSnapshot(
  snapshot: WorkspaceSnapshot,
  desktopVaultActive: boolean,
  desktopJobsActive = desktopVaultActive,
  desktopAutomationActive = desktopVaultActive,
): PrimaryWorkspaceSnapshot {
  const { codeDraft: _standaloneCodeDraft, ...primary } = snapshot
  return {
    ...primary,
    sources: desktopVaultActive ? [] : snapshot.sources,
    documents: desktopVaultActive ? [] : snapshot.documents,
    vocabulary: desktopVaultActive ? [] : snapshot.vocabulary,
    relations: desktopVaultActive ? [] : snapshot.relations,
    activities: desktopVaultActive ? [] : snapshot.activities,
    jobs: desktopJobsActive ? [] : snapshot.jobs.slice(0, MAX_JOB_HISTORY).map(portableProcessingJob),
    recipes: desktopAutomationActive ? [] : snapshot.recipes,
    pipelineRecipes: desktopAutomationActive ? [] : snapshot.pipelineRecipes,
  }
}

/** Coalesce high-frequency progress events while retaining an explicit flush
 * for terminal states and application shutdown. */
export function createCoalescedTask(task: () => void, delayMs = JOB_PROGRESS_PERSIST_DELAY_MS) {
  let timer: ReturnType<typeof setTimeout> | undefined

  function cancel() {
    if (timer === undefined) return
    clearTimeout(timer)
    timer = undefined
  }

  function flush() {
    cancel()
    task()
  }

  function schedule() {
    if (timer !== undefined) return
    timer = setTimeout(() => {
      timer = undefined
      task()
    }, delayMs)
  }

  return { schedule, flush, cancel, pending: () => timer !== undefined }
}

export function boundedJobHistory(jobs: Job[]) {
  return jobs.slice(0, MAX_JOB_HISTORY)
}

export function codeDraftPersistDelay(characterCount: number) {
  if (characterCount >= 500_000) return 1_500
  if (characterCount >= 100_000) return 900
  return 450
}
