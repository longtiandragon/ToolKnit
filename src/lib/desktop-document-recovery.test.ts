import { describe, expect, it } from 'vitest'
import { appendDocumentRecoveryChange, DESKTOP_DOCUMENT_RECOVERY_MAX_CHARS, parseDesktopDocumentRecovery, replayDesktopDocumentRecovery, serializeDesktopDocumentRecovery, serializeDesktopDocumentRecoveryBounded } from './desktop-document-recovery'
import type { StudyDocument } from '@/types'

function note(id: string, content = id): StudyDocument {
  return { id, title: id, kind: 'note', subject: '计算机', tags: [], difficulty: 0, content, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', reviewEnabled: false, errorTypes: [] }
}

describe('desktop document recovery journal', () => {
  it('continues to read the complete v1 emergency snapshot', () => {
    const recovery = parseDesktopDocumentRecovery(JSON.stringify({ documents: [note('legacy')] }))
    expect(recovery.exists).toBe(true)
    expect(recovery.snapshot?.map((document) => document.id)).toEqual(['legacy'])
    expect(recovery.changes).toEqual([])
  })

  it('coalesces a document write journal and replays the latest state', () => {
    let changes = appendDocumentRecoveryChange([], { kind: 'save', document: note('a', 'one') })
    changes = appendDocumentRecoveryChange(changes, { kind: 'save', document: note('a', 'two') })
    changes = appendDocumentRecoveryChange(changes, { kind: 'delete', id: 'b' })
    expect(changes).toHaveLength(2)
    expect(replayDesktopDocumentRecovery([note('a', 'old'), note('b')], changes).map((document) => `${document.id}:${document.content}`)).toEqual(['a:two'])
  })

  it('serializes a compact v2 journal without an unrelated document collection', () => {
    const raw = serializeDesktopDocumentRecovery([{ kind: 'save', document: note('active', 'large markdown') }], '2026-01-02T00:00:00.000Z')
    const parsed = parseDesktopDocumentRecovery(raw)
    expect(parsed.snapshot).toBeUndefined()
    expect(parsed.changes).toHaveLength(1)
    expect(parsed.changes[0]).toMatchObject({ kind: 'save', document: { id: 'active' } })
  })

  it('refuses a multi-megabyte change before serializing it into synchronous storage', () => {
    const oversized = note('large', 'x'.repeat(DESKTOP_DOCUMENT_RECOVERY_MAX_CHARS + 1))
    expect(serializeDesktopDocumentRecoveryBounded([{ kind: 'save', document: oversized }], '2026-01-02T00:00:00.000Z')).toBeUndefined()
  })
})
