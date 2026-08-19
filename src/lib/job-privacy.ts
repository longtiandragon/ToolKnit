import type { FileReference, Job } from '@/types'

const ABSOLUTE_PATH = /[a-z]:[\\/]|\\\\[^\\/\s]+[\\/][^\\/\s]+/i

export function containsAbsoluteDesktopPath(value: string) {
  return ABSOLUTE_PATH.test(value)
}

export function portableJobDetail(value?: string, replacement = '任务详情已省略（包含本机路径）。') {
  if (!value) return value
  return containsAbsoluteDesktopPath(value) ? replacement : value
}

function portableJobParameters(parameters?: Job['parameters']) {
  if (!parameters) return
  return Object.fromEntries(Object.entries(parameters).filter(([key, value]) =>
    !/(path|directory|root)$/i.test(key)
    && !(typeof value === 'string' ? containsAbsoluteDesktopPath(value) : Array.isArray(value) && value.some(containsAbsoluteDesktopPath)),
  )) as Job['parameters']
}

export function portableFileReference(reference: FileReference): FileReference {
  return {
    name: reference.name,
    size: reference.size,
    mime: reference.mime,
  }
}

/** Durable history is portable display metadata only. Absolute paths may stay
 * in a live tool component for reveal/open actions, but never enter SQLite,
 * localStorage, or a Vault/browser backup. */
export function portableProcessingJob(job: Job): Job {
  return {
    ...job,
    inputs: job.inputs?.map(portableFileReference),
    outputs: job.outputs?.map(portableFileReference),
    parameters: portableJobParameters(job.parameters),
    detail: portableJobDetail(job.detail),
  }
}
