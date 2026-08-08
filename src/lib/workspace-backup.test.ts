import { describe, expect, it } from 'vitest'
import { createWorkspaceBackup, normalizeWorkspace, parsePersistedWorkspace, parseWorkspaceBackup, type WorkspaceSnapshot } from './workspace-backup'

const snapshot: WorkspaceSnapshot = {
  sources: [],
  documents: [{ id: 'doc-1', title: '笔记', kind: 'note', subject: '通用', tags: [], difficulty: 0, content: '# 内容', createdAt: '2026-01-01', updatedAt: '2026-01-01', reviewEnabled: false, errorTypes: [] }],
  jobs: [],
  aiProfiles: [{ id: 'profile-1', label: '本地配置', baseUrl: 'http://localhost:11434/v1', model: 'local', hasKey: false }],
  activeVaultName: '测试资料库',
  codeDraft: { content: 'const ok = true', name: 'demo.ts' },
  recipes: []
}

describe('workspace persistence validation', () => {
  it('accepts a valid persisted workspace', () => {
    expect(parsePersistedWorkspace(JSON.stringify(snapshot))?.activeVaultName).toBe('测试资料库')
  })

  it('rejects corrupt collections instead of loading a half-valid state', () => {
    expect(normalizeWorkspace({ ...snapshot, documents: [{ title: '缺少字段' }] })).toBeUndefined()
    expect(parsePersistedWorkspace('{broken')).toBeUndefined()
  })
})

describe('workspace backups', () => {
  it('round-trips schema v2 including the code draft', () => {
    const restored = parseWorkspaceBackup(createWorkspaceBackup(snapshot, '2026-08-08T00:00:00.000Z'))
    expect(restored.codeDraft).toEqual(snapshot.codeDraft)
    expect(restored.documents).toHaveLength(1)
  })

  it('continues accepting schema v1 backups', () => {
    const legacy = JSON.stringify({ ...snapshot, format: 'toolknit-browser-backup', schemaVersion: 1 })
    expect(parseWorkspaceBackup(legacy).activeVaultName).toBe('测试资料库')
  })

  it('does not accept arbitrary JSON or malformed workspace data', () => {
    expect(() => parseWorkspaceBackup('{}')).toThrow('不是可恢复')
    expect(() => parseWorkspaceBackup(JSON.stringify({ ...snapshot, format: 'toolknit-browser-backup', schemaVersion: 2, sources: 'wrong' }))).toThrow('未修改')
  })
})
