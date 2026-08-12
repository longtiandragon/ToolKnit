import { describe, expect, it } from 'vitest'
import {
  createWorkspaceHistory,
  recordWorkspaceHistory,
  selectWorkspaceHistoryIndex,
  workspaceHistoryMenuEntries,
  workspaceHistoryTarget,
} from './workspace-history'

describe('workspace history', () => {
  it('records locations, drops the forward branch, and keeps a bounded trail', () => {
    let state = createWorkspaceHistory({ path: '/', label: '今天' })
    state = recordWorkspaceHistory(state, { path: '/knowledge', label: '知识库' }, 3)
    state = recordWorkspaceHistory(state, { path: '/documents?document=1', label: '第一篇' }, 3)
    state = selectWorkspaceHistoryIndex(state, 1)
    state = recordWorkspaceHistory(state, { path: '/review', label: '复习' }, 3)

    expect(state.entries.map(entry => entry.path)).toEqual(['/', '/knowledge', '/review'])
    state = recordWorkspaceHistory(state, { path: '/tools', label: '工具' }, 3)
    expect(state.entries.map(entry => entry.path)).toEqual(['/knowledge', '/review', '/tools'])
    expect(state.index).toBe(2)
  })

  it('recognizes adjacent browser navigation instead of duplicating it', () => {
    let state = createWorkspaceHistory({ path: '/', label: '今天' })
    state = recordWorkspaceHistory(state, { path: '/knowledge', label: '知识库' })
    state = recordWorkspaceHistory(state, { path: '/review', label: '复习' })
    state = recordWorkspaceHistory(state, { path: '/knowledge', label: '更新后的知识库' })

    expect(state.index).toBe(1)
    expect(state.entries).toHaveLength(3)
    expect(state.entries[1]?.label).toBe('更新后的知识库')
  })

  it('provides directional targets and nearest-first menu entries', () => {
    let state = createWorkspaceHistory({ path: '/', label: '今天' })
    state = recordWorkspaceHistory(state, { path: '/knowledge', label: '知识库' })
    state = recordWorkspaceHistory(state, { path: '/documents?document=1', label: '算法笔记' })
    state = selectWorkspaceHistoryIndex(state, 2)

    expect(workspaceHistoryTarget(state, -1)?.entry.label).toBe('知识库')
    expect(workspaceHistoryTarget(state, 1)).toBeUndefined()
    expect(workspaceHistoryMenuEntries(state, -1).map(entry => entry.label)).toEqual(['知识库', '今天'])
  })
})
