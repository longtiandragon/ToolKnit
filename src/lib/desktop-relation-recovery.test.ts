import { describe, expect, it } from 'vitest'
import { appendRelationRecoveryChange, DESKTOP_RELATION_RECOVERY_MAX_CHARS, parseDesktopRelationRecovery, replayDesktopRelationRecovery, serializeDesktopRelationRecovery, serializeDesktopRelationRecoveryBounded } from './desktop-relation-recovery'
import type { EntityRelation } from '@/types'

function relation(fromId: string, toId: string, relationType: EntityRelation['relationType'] = 'related'): EntityRelation {
  return { fromId, toId, relationType, createdAt: '2026-01-01T00:00:00.000Z' }
}

describe('desktop relation recovery journal', () => {
  it('continues to read the complete v1 emergency snapshot', () => {
    const recovery = parseDesktopRelationRecovery(JSON.stringify({ relations: [relation('a', 'b')] }))
    expect(recovery.exists).toBe(true)
    expect(recovery.snapshot).toEqual([relation('a', 'b')])
    expect(recovery.changes).toEqual([])
  })

  it('coalesces an edge write journal and replays removal', () => {
    let changes = appendRelationRecoveryChange([], { kind: 'save', relation: relation('a', 'b') })
    changes = appendRelationRecoveryChange(changes, { kind: 'delete', relation: relation('a', 'b') })
    changes = appendRelationRecoveryChange(changes, { kind: 'save', relation: relation('b', 'c', 'prerequisite') })
    expect(changes).toHaveLength(2)
    expect(replayDesktopRelationRecovery([relation('a', 'b')], changes)).toEqual([relation('b', 'c', 'prerequisite')])
  })

  it('serializes a compact v2 journal without unrelated edges', () => {
    const raw = serializeDesktopRelationRecovery([{ kind: 'save', relation: relation('active', 'target') }], '2026-01-02T00:00:00.000Z')
    const parsed = parseDesktopRelationRecovery(raw)
    expect(parsed.snapshot).toBeUndefined()
    expect(parsed.changes).toHaveLength(1)
    expect(parsed.changes[0]).toMatchObject({ kind: 'save', relation: { fromId: 'active', toId: 'target' } })
  })

  it('does not stringify an oversized relation journal', () => {
    const huge = relation('a'.repeat(DESKTOP_RELATION_RECOVERY_MAX_CHARS), 'target')
    expect(serializeDesktopRelationRecoveryBounded([{ kind: 'save', relation: huge }], '2026-01-02T00:00:00.000Z')).toBeUndefined()
  })
})
