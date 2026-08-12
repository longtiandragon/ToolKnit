import { describe, expect, it } from 'vitest'
import { EDITOR_CRASH_DRAFT_MAX_BYTES, editorCrashDraftDelay, parseUsableEditorCrashDraft } from '@/lib/editor-crash-draft'
import type { DesktopEditorCrashDraft } from '@/lib/native'

const current = { id: '01989f84-3200-7000-8000-000000000001', updatedAt: '2026-08-10T08:00:00Z', content: 'saved' }

function record(overrides: Partial<DesktopEditorCrashDraft> = {}): DesktopEditorCrashDraft {
  return {
    kind: 'document',
    entityId: current.id,
    baseUpdatedAt: current.updatedAt,
    savedAt: '2026-08-10T09:00:00Z',
    byteSize: 120,
    payloadJson: JSON.stringify({ ...current, content: 'unfinished' }),
    ...overrides,
  }
}

describe('editor crash draft validation', () => {
  it('returns only a draft based on the current persisted entity', () => {
    expect(parseUsableEditorCrashDraft(record(), current, 'document')?.content).toBe('unfinished')
    expect(parseUsableEditorCrashDraft(record({ baseUpdatedAt: '2026-08-09T08:00:00Z' }), current, 'document')).toBeUndefined()
  })

  it('rejects mismatched entities, kinds, corrupt json and oversized records', () => {
    expect(parseUsableEditorCrashDraft(record({ entityId: 'other' }), current, 'document')).toBeUndefined()
    expect(parseUsableEditorCrashDraft(record({ kind: 'vocabulary' }), current, 'document')).toBeUndefined()
    expect(parseUsableEditorCrashDraft(record({ payloadJson: '{broken' }), current, 'document')).toBeUndefined()
    expect(parseUsableEditorCrashDraft(record({ byteSize: EDITOR_CRASH_DRAFT_MAX_BYTES + 1 }), current, 'document')).toBeUndefined()
  })

  it('backs off large editor writes', () => {
    expect(editorCrashDraftDelay(100)).toBe(1000)
    expect(editorCrashDraftDelay(2 * 1024 * 1024)).toBe(1800)
    expect(editorCrashDraftDelay(5 * 1024 * 1024)).toBe(2600)
  })
})
