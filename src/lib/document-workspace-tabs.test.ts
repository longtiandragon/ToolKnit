import { describe, expect, it } from 'vitest'
import {
  adjacentDocumentWorkspaceTab,
  closeDocumentWorkspaceTab,
  closeDocumentWorkspaceTabsToRight,
  closeOtherDocumentWorkspaceTabs,
  MAX_DOCUMENT_WORKSPACE_TABS,
  MAX_PINNED_DOCUMENT_WORKSPACE_TABS,
  normalizeDocumentWorkspaceTabs,
  openDocumentWorkspaceTab,
  toggleDocumentWorkspaceTabPin,
  type DocumentWorkspaceTab,
} from '@/lib/document-workspace-tabs'

const tabs = (ids: string[]): DocumentWorkspaceTab[] => ids.map((id, index) => ({ id, pinned: false, openedAt: index + 1 }))

describe('document workspace tabs', () => {
  it('normalizes valid unique lightweight records', () => {
    expect(normalizeDocumentWorkspaceTabs([
      { id: 'a', pinned: true, openedAt: 3 },
      { id: 'a', pinned: false, openedAt: 4 },
      { id: 'missing', pinned: true },
      null,
    ], ['a', 'b'])).toEqual([{ id: 'a', pinned: true, openedAt: 3 }])
  })

  it('bounds the strip and evicts the least recent unpinned tab', () => {
    const full = tabs(Array.from({ length: MAX_DOCUMENT_WORKSPACE_TABS }, (_, index) => `d${index}`))
    full[0]!.pinned = true
    const opened = openDocumentWorkspaceTab(full, 'new', 100)
    expect(opened).toHaveLength(MAX_DOCUMENT_WORKSPACE_TABS)
    expect(opened.some((tab) => tab.id === 'd0')).toBe(true)
    expect(opened.some((tab) => tab.id === 'd1')).toBe(false)
    expect(opened.at(-1)?.id).toBe('new')
  })

  it('selects a stable neighbor when the active tab closes', () => {
    const result = closeDocumentWorkspaceTab(tabs(['a', 'b', 'c']), 'b', 'b')
    expect(result.tabs.map((tab) => tab.id)).toEqual(['a', 'c'])
    expect(result.nextActiveId).toBe('c')
    expect(closeDocumentWorkspaceTab(tabs(['a', 'b', 'c']), 'c', 'c').nextActiveId).toBe('b')
  })

  it('keeps pinned tabs during bulk close and cycles in both directions', () => {
    const source = tabs(['a', 'b', 'c', 'd'])
    source[3]!.pinned = true
    expect(closeOtherDocumentWorkspaceTabs(source, 'b').map((tab) => tab.id)).toEqual(['b', 'd'])
    expect(closeDocumentWorkspaceTabsToRight(source, 'b').map((tab) => tab.id)).toEqual(['a', 'b', 'd'])
    expect(toggleDocumentWorkspaceTabPin(source, 'b')[1]?.pinned).toBe(true)
    expect(adjacentDocumentWorkspaceTab(source, 'd', 1)?.id).toBe('a')
    expect(adjacentDocumentWorkspaceTab(source, 'a', -1)?.id).toBe('d')
  })

  it('keeps one evictable slot when pinning reaches the workspace limit', () => {
    const source = Array.from({ length: MAX_DOCUMENT_WORKSPACE_TABS }, (_, index) => ({
      id: `doc-${index}`,
      pinned: index < MAX_PINNED_DOCUMENT_WORKSPACE_TABS,
      openedAt: index + 1,
    }))
    expect(toggleDocumentWorkspaceTabPin(source, `doc-${MAX_DOCUMENT_WORKSPACE_TABS - 1}`)).toBe(source)

    const normalized = normalizeDocumentWorkspaceTabs(
      source.map((tab) => ({ ...tab, pinned: true })),
      source.map((tab) => tab.id),
    )
    expect(normalized.filter((tab) => tab.pinned)).toHaveLength(MAX_PINNED_DOCUMENT_WORKSPACE_TABS)
    expect(normalized.find((tab) => tab.id === 'doc-0')?.pinned).toBe(false)
  })
})
