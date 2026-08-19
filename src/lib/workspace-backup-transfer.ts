import { containsAbsoluteDesktopPath, portableProcessingJob } from '@/lib/job-privacy'
import { replaceAutomationRecipes } from '@/lib/automation-recipes'
import {
  normalizeSettings,
  normalizeWorkspace,
  type WorkspaceSnapshot,
} from '@/lib/workspace-backup'

export interface WorkspaceBackup extends WorkspaceSnapshot {
  format: 'toolknit-browser-backup'
  schemaVersion: 7
  exportedAt: string
}

const MAX_BACKUP_CHARACTERS = 25_000_000

function portableBackupJob(job: WorkspaceSnapshot['jobs'][number]) {
  const portable = portableProcessingJob(job)
  const name = (value: string) => value.split(/[\\/]/).filter(Boolean).at(-1) ?? '未命名文件'
  return {
    ...portable,
    inputNames: portable.inputNames?.map(name), outputNames: portable.outputNames?.map(name),
    inputs: portable.inputs?.map(reference => ({ ...reference, name: name(reference.name) })),
    outputs: portable.outputs?.map(reference => ({ ...reference, name: name(reference.name) })),
  }
}

function portableActivities(value: WorkspaceSnapshot['activities']) {
  return value?.map(activity => ({
    ...activity,
    title: containsAbsoluteDesktopPath(activity.title) ? '本机活动' : activity.title,
    ...(activity.detail ? { detail: containsAbsoluteDesktopPath(activity.detail) ? '活动详情已省略（包含本机路径）。' : activity.detail } : {}),
  })) ?? []
}

function portableBackupSettings(value: WorkspaceSnapshot['settings']) {
  return {
    ...normalizeSettings(value),
    outputDirectory: '',
    markdownWorkspaceDirectory: '',
    privateToolsManifestPath: '',
    transcriptionExecutablePath: '',
    transcriptionModelPath: '',
  }
}

export function createWorkspaceBackup(snapshot: WorkspaceSnapshot, exportedAt = new Date().toISOString()) {
  const backup: WorkspaceBackup = {
    format: 'toolknit-browser-backup', schemaVersion: 7, exportedAt, ...snapshot,
    jobs: snapshot.jobs.map(portableBackupJob),
    favorites: snapshot.favorites ?? [],
    contentFavorites: snapshot.contentFavorites ?? [],
    contentRecents: snapshot.contentRecents ?? [],
    toolUsages: snapshot.toolUsages ?? [],
    activities: portableActivities(snapshot.activities),
    settings: portableBackupSettings(snapshot.settings),
  }
  return JSON.stringify(backup, null, 2)
}

export function parseWorkspaceBackup(serialized: string) {
  if (serialized.length > MAX_BACKUP_CHARACTERS) throw new Error('备份文件超过 25 MB，浏览器版无法安全恢复。')
  let parsed: unknown
  try { parsed = JSON.parse(serialized) } catch { throw new Error('备份文件不是有效的 JSON。') }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)
    || !('format' in parsed) || parsed.format !== 'toolknit-browser-backup'
    || !('schemaVersion' in parsed) || ![1, 2, 3, 4, 5, 6, 7].includes(Number(parsed.schemaVersion))) {
    throw new Error('这不是可恢复的 Knitspace 浏览器备份。')
  }
  const snapshot = normalizeWorkspace(parsed)
  if (!snapshot) throw new Error('备份结构不完整或包含无效数据，未修改当前资料库。')
  return { ...snapshot, jobs: snapshot.jobs.map(portableBackupJob), activities: portableActivities(snapshot.activities), settings: portableBackupSettings(snapshot.settings) }
}

export async function prepareWorkspaceRestore(serialized: string, desktopVaultActive: boolean) {
  const backup = parseWorkspaceBackup(serialized)
  const automation = desktopVaultActive
    ? await replaceAutomationRecipes(backup.recipes, backup.pipelineRecipes ?? [])
    : { recipes: backup.recipes, pipelineRecipes: backup.pipelineRecipes ?? [] }
  return { backup, automation }
}
