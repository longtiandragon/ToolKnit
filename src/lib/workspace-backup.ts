import type { ActivityRecord, AiProfile, FavoriteTool, Job, Source, StudyDocument, ToolRecipe, ToolUsage, WorkbenchSettings } from '@/types'

export interface WorkspaceSnapshot {
  sources: Source[]
  documents: StudyDocument[]
  jobs: Job[]
  aiProfiles: AiProfile[]
  activeVaultName: string
  codeDraft?: { content: string; name: string }
  recipes: ToolRecipe[]
  favorites?: FavoriteTool[]
  toolUsages?: ToolUsage[]
  activities?: ActivityRecord[]
  settings?: WorkbenchSettings
}

export interface WorkspaceBackup extends WorkspaceSnapshot {
  format: 'toolknit-browser-backup'
  schemaVersion: 3
  exportedAt: string
}

const MAX_BACKUP_CHARACTERS = 25_000_000

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasStrings(value: Record<string, unknown>, keys: string[]) {
  return keys.every((key) => typeof value[key] === 'string')
}

function validArray(value: unknown, validator: (item: Record<string, unknown>) => boolean) {
  return Array.isArray(value) && value.every((item) => isRecord(item) && validator(item))
}

function validSource(value: Record<string, unknown>) {
  return hasStrings(value, ['id', 'name', 'kind', 'mime', 'importedAt']) && typeof value.size === 'number' && Array.isArray(value.tags)
}

function validDocument(value: Record<string, unknown>) {
  return hasStrings(value, ['id', 'title', 'kind', 'subject', 'content', 'createdAt', 'updatedAt']) && Array.isArray(value.tags) && Array.isArray(value.errorTypes) && typeof value.reviewEnabled === 'boolean'
}

function validJob(value: Record<string, unknown>) {
  return hasStrings(value, ['id', 'kind', 'label', 'status', 'createdAt']) && typeof value.progress === 'number'
}

function validProfile(value: Record<string, unknown>) {
  return hasStrings(value, ['id', 'label', 'baseUrl', 'model']) && typeof value.hasKey === 'boolean'
}

function validRecipe(value: Record<string, unknown>) {
  return hasStrings(value, ['id', 'title', 'group', 'operation', 'createdAt']) && isRecord(value.parameters)
}

export const defaultWorkbenchSettings: WorkbenchSettings = {
  outputDirectory: '', clipboardEnabled: false, clipboardPaused: false,
  clipboardLimit: 100, clipboardRetentionDays: 30, closeBehavior: 'ask',
  notificationsEnabled: true, autoCheckUpdates: true
}

export function normalizeWorkspace(value: unknown): WorkspaceSnapshot | undefined {
  if (!isRecord(value)) return undefined
  if (!validArray(value.sources, validSource) || !validArray(value.documents, validDocument)) return undefined
  if (value.jobs !== undefined && !validArray(value.jobs, validJob)) return undefined
  if (value.aiProfiles !== undefined && !validArray(value.aiProfiles, validProfile)) return undefined
  if (value.recipes !== undefined && !validArray(value.recipes, validRecipe)) return undefined
  if (value.activeVaultName !== undefined && typeof value.activeVaultName !== 'string') return undefined
  if (value.codeDraft !== undefined && (!isRecord(value.codeDraft) || !hasStrings(value.codeDraft, ['content', 'name']))) return undefined
  return {
    sources: value.sources as unknown as Source[],
    documents: value.documents as unknown as StudyDocument[],
    jobs: (value.jobs ?? []) as unknown as Job[],
    aiProfiles: (value.aiProfiles ?? []) as unknown as AiProfile[],
    activeVaultName: typeof value.activeVaultName === 'string' && value.activeVaultName.trim() ? value.activeVaultName : '我的 ToolKnitVault',
    codeDraft: value.codeDraft as WorkspaceSnapshot['codeDraft'],
    recipes: (value.recipes ?? []) as unknown as ToolRecipe[],
    favorites: Array.isArray(value.favorites) ? value.favorites as FavoriteTool[] : [],
    toolUsages: Array.isArray(value.toolUsages) ? value.toolUsages as ToolUsage[] : [],
    activities: Array.isArray(value.activities) ? value.activities as ActivityRecord[] : [],
    settings: isRecord(value.settings) ? { ...defaultWorkbenchSettings, ...value.settings } as WorkbenchSettings : { ...defaultWorkbenchSettings }
  }
}

export function parsePersistedWorkspace(serialized: string) {
  try {
    return normalizeWorkspace(JSON.parse(serialized))
  } catch {
    return undefined
  }
}

export function createWorkspaceBackup(snapshot: WorkspaceSnapshot, exportedAt = new Date().toISOString()) {
  const backup: WorkspaceBackup = { format: 'toolknit-browser-backup', schemaVersion: 3, exportedAt, ...snapshot, favorites: snapshot.favorites ?? [], toolUsages: snapshot.toolUsages ?? [], activities: snapshot.activities ?? [], settings: { ...defaultWorkbenchSettings, ...snapshot.settings } }
  return JSON.stringify(backup, null, 2)
}

export function parseWorkspaceBackup(serialized: string) {
  if (serialized.length > MAX_BACKUP_CHARACTERS) throw new Error('备份文件超过 25 MB，浏览器版无法安全恢复。')
  let parsed: unknown
  try { parsed = JSON.parse(serialized) } catch { throw new Error('备份文件不是有效的 JSON。') }
  if (!isRecord(parsed) || parsed.format !== 'toolknit-browser-backup' || ![1, 2, 3].includes(Number(parsed.schemaVersion))) {
    throw new Error('这不是可恢复的 ToolKnit 浏览器备份。')
  }
  const snapshot = normalizeWorkspace(parsed)
  if (!snapshot) throw new Error('备份结构不完整或包含无效数据，未修改当前资料库。')
  return snapshot
}
