import { describe, expect, it } from 'vitest'
import { defaultWorkbenchSettings, normalizeWorkspace, parsePersistedWorkspace, type WorkspaceSnapshot } from './workspace-backup'
import { createWorkspaceBackup, parseWorkspaceBackup } from './workspace-backup-transfer'

const snapshot: WorkspaceSnapshot = {
  sources: [],
  documents: [{ id: 'doc-1', title: '笔记', kind: 'note', subject: '通用', tags: [], difficulty: 0, content: '# 内容', createdAt: '2026-01-01', updatedAt: '2026-01-01', reviewEnabled: false, errorTypes: [] }],
  vocabulary: [{ id: 'word-1', lemma: 'run', language: '英语', forms: { past: 'ran' }, senses: [{ id: 'sense-1', partOfSpeech: 'verb', definition: '跑；运行', examples: ['The program runs.'], collocations: ['run a program'], synonyms: ['operate'], reviewEnabled: true, review: { due: '2026-08-09', intervalDays: 0, repetitions: 0, lapses: 0 } }], createdAt: '2026-01-01', updatedAt: '2026-01-01' }],
  relations: [{ fromId: 'doc-1', toId: 'word-1', relationType: 'related', createdAt: '2026-01-01' }],
  jobs: [],
  aiProfiles: [{ id: 'profile-1', label: '本地配置', baseUrl: 'http://localhost:11434/v1', model: 'local', hasKey: false }],
  activeVaultName: '测试资料库',
  codeDraft: { content: 'const ok = true', name: 'demo.ts' },
  recipes: [],
  pipelineRecipes: [{ id: 'pipeline-1', title: '名单清理', version: 1, steps: [{ id: 'step-1', toolId: 'text.trim' }, { id: 'step-2', toolId: 'text.sort-lines' }], createdAt: '2026-08-08', updatedAt: '2026-08-08' }],
  contentFavorites: [{ itemId: 'doc-1', itemKind: 'note', addedAt: '2026-08-08T00:00:00Z' }],
  contentRecents: [{ itemId: 'word-1', itemKind: 'word', openedAt: '2026-08-08T01:00:00Z' }],
}

describe('workspace persistence validation', () => {
  it('accepts a valid persisted workspace', () => {
    expect(parsePersistedWorkspace(JSON.stringify(snapshot))?.activeVaultName).toBe('测试资料库')
  })

  it('migrates only previous product default vault labels', () => {
    expect(parsePersistedWorkspace(JSON.stringify({ ...snapshot, activeVaultName: '我的 ToolKnitVault' }))?.activeVaultName).toBe('我的 KnitspaceVault')
    expect(parsePersistedWorkspace(JSON.stringify({ ...snapshot, activeVaultName: '我的算法资料库' }))?.activeVaultName).toBe('我的算法资料库')
  })

  it('rejects corrupt collections instead of loading a half-valid state', () => {
    expect(normalizeWorkspace({ ...snapshot, documents: [{ title: '缺少字段' }] })).toBeUndefined()
    expect(parsePersistedWorkspace('{broken')).toBeUndefined()
  })
})

describe('workspace backups', () => {
  it('round-trips schema v7 including vocabulary, relations, pipelines, favorites, and recents', () => {
    const restored = parseWorkspaceBackup(createWorkspaceBackup(snapshot, '2026-08-08T00:00:00.000Z'))
    expect(restored.codeDraft).toEqual(snapshot.codeDraft)
    expect(restored.documents).toHaveLength(1)
    expect(restored.vocabulary?.[0]).toMatchObject({ lemma: 'run', forms: { past: 'ran' } })
    expect(restored.vocabulary?.[0].senses[0].review?.due).toBe('2026-08-09')
    expect(restored.relations).toEqual(snapshot.relations)
    expect(restored.pipelineRecipes).toEqual(snapshot.pipelineRecipes)
    expect(restored.contentFavorites).toEqual(snapshot.contentFavorites)
    expect(restored.contentRecents).toEqual(snapshot.contentRecents)
  })

  it('removes processing paths from new and legacy backups', () => {
    const job = {
      id: 'job-private', kind: 'archive' as const, label: '交付', status: 'failed' as const,
      progress: 100, createdAt: '2026-08-19', inputNames: ['Z:\\private\\input.pdf'],
      inputs: [{ name: 'input.pdf', path: 'Z:\\private\\input.pdf' }],
      outputs: [{ name: 'output.zip', path: 'Z:\\private\\output.zip' }],
      parameters: { outputDirectory: 'Z:\\private', quality: 90 },
      detail: '无法读取 Z:\\private\\input.pdf',
    }
    const serialized = createWorkspaceBackup({
      ...snapshot,
      jobs: [job],
      activities: [{ id: 'activity-private', kind: 'job', title: '处理 Z:\\private\\input.pdf', detail: '无法读取 Z:\\private\\input.pdf', createdAt: '2026-08-19' }],
      settings: { ...defaultWorkbenchSettings, outputDirectory: 'Z:\\private', transcriptionModelPath: 'Z:\\private\\model.bin' },
    }, '2026-08-19T00:00:00.000Z')
    expect(serialized).not.toContain('Z:\\\\private')
    const restored = parseWorkspaceBackup(serialized)
    expect(restored.jobs[0]).toMatchObject({
      inputNames: ['input.pdf'], inputs: [{ name: 'input.pdf' }], outputs: [{ name: 'output.zip' }],
      parameters: { quality: 90 }, detail: '任务详情已省略（包含本机路径）。',
    })
    expect(restored.activities?.[0]).toMatchObject({ title: '本机活动', detail: '活动详情已省略（包含本机路径）。' })
    expect(restored.settings).toMatchObject({ outputDirectory: '', transcriptionModelPath: '' })

    const legacy = parseWorkspaceBackup(JSON.stringify({ ...snapshot, jobs: [job], format: 'toolknit-browser-backup', schemaVersion: 7, exportedAt: '2026-08-19' }))
    expect(JSON.stringify(legacy.jobs)).not.toContain('Z:\\\\private')
  })

  it('keeps the code image author in workspace settings', () => {
    const restored = parseWorkspaceBackup(createWorkspaceBackup({
      ...snapshot,
      settings: { ...defaultWorkbenchSettings, codeImageAuthor: 'Long Tian' }
    }, '2026-08-08T00:00:00.000Z'))
    expect(restored.settings?.codeImageAuthor).toBe('Long Tian')
  })

  it('fills settings added after an older workspace was saved', () => {
    const restored = parsePersistedWorkspace(JSON.stringify({
      ...snapshot,
      settings: { outputDirectory: '', clipboardEnabled: false }
    }))
    expect(restored?.settings?.codeImageAuthor).toBe('author')
    expect(restored?.settings?.clipboardRetentionDays).toBe(30)
    expect(restored?.settings).toMatchObject({ transcriptionExecutablePath: '', transcriptionModelPath: '', transcriptionLanguage: 'auto' })
    expect(restored?.settings).toMatchObject({ documentAutoSave: true, readingScale: 'comfortable', readingDensity: 'comfortable', readingWidth: 'balanced', readingPaperTone: 'warm', reduceMotion: false })
  })

  it('repairs invalid setting types instead of letting them crash lazy pages', () => {
    const restored = parsePersistedWorkspace(JSON.stringify({
      ...snapshot,
      settings: { codeImageAuthor: null, clipboardLimit: -50, closeBehavior: 'invalid', documentAutoSave: 'yes', readingScale: 'huge', readingWidth: 100, reduceMotion: 'yes', transcriptionExecutablePath: 99, transcriptionModelPath: false, transcriptionLanguage: '--help' }
    }))
    expect(restored?.settings).toMatchObject({ codeImageAuthor: 'author', clipboardLimit: 10, closeBehavior: 'ask', documentAutoSave: true, readingScale: 'comfortable', readingWidth: 'balanced', reduceMotion: false, transcriptionExecutablePath: '', transcriptionModelPath: '', transcriptionLanguage: 'auto' })
  })

  it('keeps a manual code-image page height and repairs an unusable one', () => {
    const restore = (codeImageLinesPerPage: unknown) => parsePersistedWorkspace(JSON.stringify({
      ...snapshot,
      settings: { ...defaultWorkbenchSettings, codeImageLinesPerPage }
    }))?.settings?.codeImageLinesPerPage
    expect(restore(45)).toBe(45)
    expect(restore(0)).toBe(0)
    expect(restore(2)).toBe(5)
    expect(restore(10_000)).toBe(200)
    expect(restore('40')).toBe(0)
  })

  it('keeps the scoped night reading surface when restoring a workspace', () => {
    const restored = parsePersistedWorkspace(JSON.stringify({
      ...snapshot,
      settings: { ...defaultWorkbenchSettings, readingPaperTone: 'night' }
    }))
    expect(restored?.settings?.readingPaperTone).toBe('night')
  })

  it('keeps manual and automatic backup records separate', () => {
    const restored = parsePersistedWorkspace(JSON.stringify({
      ...snapshot,
      settings: {
        ...defaultWorkbenchSettings,
        lastBackupAt: '2026-08-09T00:00:00.000Z',
        lastManualBackupAt: '2026-08-10T00:00:00.000Z',
        lastAutomaticBackupAt: '2026-08-11T00:00:00.000Z',
      },
    }))
    expect(restored?.settings).toMatchObject({
      lastBackupAt: '2026-08-09T00:00:00.000Z',
      lastManualBackupAt: '2026-08-10T00:00:00.000Z',
      lastAutomaticBackupAt: '2026-08-11T00:00:00.000Z',
    })
  })

  it('repairs incomplete legacy document arrays before rendering the document list', () => {
    const restored = parsePersistedWorkspace(JSON.stringify({
      ...snapshot,
      documents: [{ ...snapshot.documents[0], tags: undefined, errorTypes: undefined, reviewEnabled: undefined }]
    }))
    expect(restored?.documents[0]).toMatchObject({ tags: [], errorTypes: [], reviewEnabled: false })
  })

  it('filters malformed optional dashboard and history collections', () => {
    const restored = parsePersistedWorkspace(JSON.stringify({
      ...snapshot,
      jobs: [{ id: 'job-1', kind: 'image', label: '导出', status: 'succeeded', progress: 180, createdAt: '2026-08-08', outputs: 'broken' }],
      favorites: [null, { toolId: 'image-convert', order: 5 }],
      contentFavorites: [null, { itemId: 'doc-1', itemKind: 'note', addedAt: '2026-08-08' }, { itemId: 'bad', itemKind: 'canvas', addedAt: '2026-08-08' }],
      contentRecents: [null, { itemId: 'word-1', itemKind: 'word', openedAt: '2026-08-09' }, { itemId: 'bad', itemKind: 'canvas', openedAt: '2026-08-08' }],
      toolUsages: [{ toolId: 'image-convert' }, { toolId: 'code-image', route: '/code-image', usedAt: '2026-08-08' }],
      activities: ['broken']
    }))
    expect(restored?.jobs[0]).toMatchObject({ progress: 100, outputs: undefined })
    expect(restored?.favorites).toEqual([{ toolId: 'image-convert', order: 0, shortcut: 1 }])
    expect(restored?.contentFavorites).toEqual([{ itemId: 'doc-1', itemKind: 'note', addedAt: '2026-08-08' }])
    expect(restored?.contentRecents).toEqual([{ itemId: 'word-1', itemKind: 'word', openedAt: '2026-08-09' }])
    expect(restored?.toolUsages).toHaveLength(1)
    expect(restored?.activities).toEqual([])
  })

  it('continues accepting schema v1 backups', () => {
    const legacy = JSON.stringify({ ...snapshot, format: 'toolknit-browser-backup', schemaVersion: 1 })
    expect(parseWorkspaceBackup(legacy).activeVaultName).toBe('测试资料库')
  })

  it('bounds restored content favorite metadata', () => {
    const restored = parsePersistedWorkspace(JSON.stringify({
      ...snapshot,
      contentFavorites: Array.from({ length: 300 }, (_, index) => ({
        itemId: `doc-${index}`,
        itemKind: 'note',
        addedAt: `2026-08-08T00:${String(index % 60).padStart(2, '0')}:00Z`,
      })),
    }))
    expect(restored?.contentFavorites).toHaveLength(256)
  })

  it('bounds restored recent-content metadata', () => {
    const restored = parsePersistedWorkspace(JSON.stringify({
      ...snapshot,
      contentRecents: Array.from({ length: 150 }, (_, index) => ({
        itemId: `doc-${index}`,
        itemKind: 'note',
        openedAt: new Date(1_700_000_000_000 + index).toISOString(),
      })),
    }))
    expect(restored?.contentRecents).toHaveLength(128)
  })

  it('does not accept arbitrary JSON or malformed workspace data', () => {
    expect(() => parseWorkspaceBackup('{}')).toThrow('不是可恢复')
    expect(() => parseWorkspaceBackup(JSON.stringify({ ...snapshot, format: 'toolknit-browser-backup', schemaVersion: 2, sources: 'wrong' }))).toThrow('未修改')
  })
})

describe('toolbox board layout', () => {
  const persisted = (settings: unknown) =>
    parsePersistedWorkspace(JSON.stringify({ ...snapshot, settings }))?.settings

  it('survives a save and reload', () => {
    const board = { blockOrder: ['/ocr', '/tools:pdf'], hiddenBlocks: ['/history'], expandedBlocks: ['/tools:pdf'], toolOrder: { '/tools:pdf': ['pdf-split', 'pdf-merge'] } }
    expect(persisted({ ...defaultWorkbenchSettings, toolboxBoard: board })?.toolboxBoard).toEqual(board)
  })

  it('stays absent for a workspace that never rearranged anything', () => {
    expect(persisted(defaultWorkbenchSettings)?.toolboxBoard).toBeUndefined()
    expect(persisted({ ...defaultWorkbenchSettings, toolboxBoard: { blockOrder: [], hiddenBlocks: [], expandedBlocks: [], toolOrder: {} } })?.toolboxBoard).toBeUndefined()
  })

  it('drops anything in the layout that is not a list of strings', () => {
    const board = persisted({
      ...defaultWorkbenchSettings,
      toolboxBoard: { blockOrder: ['/ocr', 7, null], hiddenBlocks: 'nope', expandedBlocks: [{}], toolOrder: { '/ocr': ['a', 2], '/bad': 'x' } },
    })?.toolboxBoard
    expect(board).toEqual({ blockOrder: ['/ocr'], hiddenBlocks: [], expandedBlocks: [], toolOrder: { '/ocr': ['a'] } })
  })

  it('refuses a layout that is not an object at all', () => {
    expect(persisted({ ...defaultWorkbenchSettings, toolboxBoard: 'everything' })?.toolboxBoard).toBeUndefined()
    expect(persisted({ ...defaultWorkbenchSettings, toolboxBoard: [1, 2, 3] })?.toolboxBoard).toBeUndefined()
  })

  it('bounds a layout so a tampered backup cannot grow the settings blob', () => {
    const board = persisted({
      ...defaultWorkbenchSettings,
      toolboxBoard: { blockOrder: Array.from({ length: 500 }, (_, index) => `k${index}`), hiddenBlocks: [], expandedBlocks: [], toolOrder: {} },
    })?.toolboxBoard
    expect(board?.blockOrder.length).toBe(40)
  })
})
