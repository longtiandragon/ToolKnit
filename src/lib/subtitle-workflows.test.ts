import { describe, expect, it } from 'vitest'
import { workspaceCommandCatalog } from './workspace-navigation'
import { analyzeSubtitleQuality } from './subtitle'
import { subtitleWorkflowActions, subtitleWorkflowId } from './subtitle-workflows'

describe('subtitle workflows', () => {
  it('exposes seven bounded desktop tasks with stable deep links', () => {
    expect(subtitleWorkflowActions.map(action => action.id)).toEqual(['import', 'paste', 'transcribe', 'create', 'convert', 'shift', 'repair'])
    expect(new Set(subtitleWorkflowActions.map(action => action.to)).size).toBe(7)
    expect(subtitleWorkflowActions.filter(action => action.requiresCues).map(action => action.id)).toEqual(['convert', 'shift', 'repair'])
  })

  it('keeps the four entry workflows discoverable from global navigation', () => {
    const routes = new Set(workspaceCommandCatalog().map(item => item.to))
    for (const id of ['import', 'paste', 'transcribe', 'create'] as const) {
      expect(routes.has(subtitleWorkflowActions.find(action => action.id === id)!.to)).toBe(true)
    }
  })

  it('rejects unknown route intents', () => {
    expect(subtitleWorkflowId('paste')).toBe('paste')
    expect(subtitleWorkflowId('delete')).toBeUndefined()
    expect(subtitleWorkflowId(['paste'])).toBeUndefined()
  })

  it('reports common subtitle QA issues without mutating cues', () => {
    const cues = [
      { id: 'a', startMs: 0, endMs: 400, text: '这是一条显示时间很短的字幕' },
      { id: 'b', startMs: 300, endMs: 4_000, text: '这是一条显示时间很短的字幕' },
      { id: 'c', startMs: 4_100, endMs: 7_000, text: '超'.repeat(50) },
    ]
    const report = analyzeSubtitleQuality(cues)
    expect(report.cueCount).toBe(3)
    expect(report.overlapCount).toBe(1)
    expect(report.shortDurationCount).toBe(1)
    expect(report.duplicateCount).toBe(1)
    expect(report.lineLengthViolationCount).toBe(1)
    expect(report.issues.map(issue => issue.kind)).toEqual(expect.arrayContaining(['overlap', 'short-duration', 'duplicate', 'line-length']))
    expect(cues[0].startMs).toBe(0)
  })
})
