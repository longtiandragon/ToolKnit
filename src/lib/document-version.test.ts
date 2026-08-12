import { describe, expect, it } from 'vitest'
import type { StudyDocument } from '@/types'
import { historicalDocumentDraft } from './document-version'

function document(id: string, title: string, content: string): StudyDocument {
  return {
    id,
    title,
    kind: 'note',
    subject: '计算机',
    tags: [],
    difficulty: 1,
    content,
    createdAt: '2026-08-10T08:00:00.000Z',
    updatedAt: '2026-08-10T08:00:00.000Z',
    reviewEnabled: false,
    errorTypes: [],
  }
}

describe('historicalDocumentDraft', () => {
  it('keeps current identity and external association while restoring old content', () => {
    const current = document('current-id', '当前标题', '# 当前正文')
    current.externalFile = {
      path: 'F:/Notes/current.md',
      name: 'current.md',
      hash: 'current-hash',
      modifiedAt: '2026-08-10T09:00:00.000Z',
      size: 48,
    }
    const snapshot = document('snapshot-id', '旧标题', '# 旧正文')
    snapshot.createdAt = '2025-01-01T00:00:00.000Z'
    snapshot.externalFile = {
      path: 'F:/Notes/obsolete.md',
      name: 'obsolete.md',
      hash: 'old-hash',
      modifiedAt: '2025-01-01T00:00:00.000Z',
      size: 12,
    }

    const restored = historicalDocumentDraft(current, snapshot, '2026-08-10T10:00:00.000Z')

    expect(restored).toMatchObject({
      id: 'current-id',
      title: '旧标题',
      content: '# 旧正文',
      createdAt: current.createdAt,
      updatedAt: '2026-08-10T10:00:00.000Z',
      externalFile: current.externalFile,
    })
    expect(restored.externalFile).not.toBe(current.externalFile)
  })

  it('does not revive an external association removed from the current document', () => {
    const current = document('current-id', '当前标题', '# 当前正文')
    const snapshot = document('snapshot-id', '旧标题', '# 旧正文')
    snapshot.externalFile = {
      path: 'F:/Notes/obsolete.md', name: 'obsolete.md', hash: 'old', modifiedAt: '2025-01-01T00:00:00.000Z', size: 8,
    }

    expect(historicalDocumentDraft(current, snapshot, '2026-08-10T10:00:00.000Z').externalFile).toBeUndefined()
  })
})
