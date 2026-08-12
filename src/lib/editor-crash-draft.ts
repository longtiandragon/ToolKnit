import {
  deleteDesktopEditorCrashDraft,
  getDesktopEditorCrashDraft,
  isDesktop,
  saveDesktopEditorCrashDraft,
  type DesktopEditorCrashDraft,
  type EditorCrashDraftKind,
} from '@/lib/native'

export const EDITOR_CRASH_DRAFT_MAX_BYTES = 8 * 1024 * 1024
const BROWSER_PREFIX = 'knitspace:editor-crash-draft:v1'

export type EditorCrashDraftSaveState = 'idle' | 'pending' | 'saved' | 'error' | 'oversize'

function browserKey(kind: EditorCrashDraftKind, entityId: string) {
  return `${BROWSER_PREFIX}:${kind}:${entityId}`
}

export function editorCrashDraftDelay(byteSize: number) {
  if (byteSize > 4 * 1024 * 1024) return 2600
  if (byteSize > 1024 * 1024) return 1800
  return 1000
}

export function parseUsableEditorCrashDraft<T extends { id: string; updatedAt: string }>(
  record: DesktopEditorCrashDraft | null | undefined,
  current: T,
  kind: EditorCrashDraftKind,
): T | undefined {
  if (!record || record.kind !== kind || record.entityId !== current.id) return undefined
  if (record.baseUpdatedAt !== current.updatedAt || record.byteSize <= 0 || record.byteSize > EDITOR_CRASH_DRAFT_MAX_BYTES) return undefined
  try {
    const parsed = JSON.parse(record.payloadJson) as Partial<T>
    if (!parsed || parsed.id !== current.id || parsed.updatedAt !== current.updatedAt) return undefined
    return parsed as T
  } catch {
    return undefined
  }
}

export async function saveEditorCrashDraft<T extends { id: string; updatedAt: string }>(kind: EditorCrashDraftKind, payload: T) {
  const payloadJson = JSON.stringify(payload)
  const byteSize = new TextEncoder().encode(payloadJson).byteLength
  if (byteSize > EDITOR_CRASH_DRAFT_MAX_BYTES) throw new RangeError('恢复点超过 8 MiB 上限，请手动保存。')
  const input = { kind, entityId: payload.id, baseUpdatedAt: payload.updatedAt, payloadJson }
  if (isDesktop()) return saveDesktopEditorCrashDraft(input)
  const record: DesktopEditorCrashDraft = { ...input, savedAt: new Date().toISOString(), byteSize }
  localStorage.setItem(browserKey(kind, payload.id), JSON.stringify(record))
  return record
}

export async function getEditorCrashDraft(kind: EditorCrashDraftKind, entityId: string) {
  if (isDesktop()) return getDesktopEditorCrashDraft(kind, entityId)
  try {
    const raw = localStorage.getItem(browserKey(kind, entityId))
    return raw ? JSON.parse(raw) as DesktopEditorCrashDraft : undefined
  } catch {
    return undefined
  }
}

export async function deleteEditorCrashDraft(kind: EditorCrashDraftKind, entityId: string) {
  if (isDesktop()) return deleteDesktopEditorCrashDraft(kind, entityId)
  localStorage.removeItem(browserKey(kind, entityId))
}

export function formatCrashDraftTime(savedAt: string) {
  const date = new Date(savedAt)
  return Number.isNaN(date.getTime())
    ? '上次编辑'
    : new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }).format(date)
}
