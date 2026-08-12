import { describe, expect, it } from 'vitest'
import { workspaceCommandCatalog } from './workspace-navigation'
import { subtitleWorkflowActions, subtitleWorkflowId } from './subtitle-workflows'

describe('subtitle workflows', () => {
  it('exposes six bounded desktop tasks with stable deep links', () => {
    expect(subtitleWorkflowActions.map(action => action.id)).toEqual(['import', 'paste', 'transcribe', 'create', 'convert', 'shift'])
    expect(new Set(subtitleWorkflowActions.map(action => action.to)).size).toBe(6)
    expect(subtitleWorkflowActions.filter(action => action.requiresCues).map(action => action.id)).toEqual(['convert', 'shift'])
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
})

