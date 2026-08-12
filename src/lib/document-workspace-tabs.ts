export const MAX_DOCUMENT_WORKSPACE_TABS = 10
export const MAX_PINNED_DOCUMENT_WORKSPACE_TABS = MAX_DOCUMENT_WORKSPACE_TABS - 1

export interface DocumentWorkspaceTab {
  id: string
  pinned: boolean
  openedAt: number
}

function validTimestamp(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0
}

export function normalizeDocumentWorkspaceTabs(value: unknown, validIds: Iterable<string>) {
  if (!Array.isArray(value)) return []
  const allowed = new Set(validIds)
  const seen = new Set<string>()
  const result: DocumentWorkspaceTab[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object') continue
    const candidate = item as Partial<DocumentWorkspaceTab>
    if (typeof candidate.id !== 'string' || !allowed.has(candidate.id) || seen.has(candidate.id)) continue
    seen.add(candidate.id)
    result.push({ id: candidate.id, pinned: candidate.pinned === true, openedAt: validTimestamp(candidate.openedAt) })
  }
  const bounded = result.slice(-MAX_DOCUMENT_WORKSPACE_TABS)
  const pinned = bounded.filter((tab) => tab.pinned).sort((left, right) => left.openedAt - right.openedAt)
  const releaseCount = Math.max(0, pinned.length - MAX_PINNED_DOCUMENT_WORKSPACE_TABS)
  const pinsToRelease = new Set(pinned.slice(0, releaseCount).map((tab) => tab.id))
  return pinsToRelease.size ? bounded.map((tab) => pinsToRelease.has(tab.id) ? { ...tab, pinned: false } : tab) : bounded
}

export function openDocumentWorkspaceTab(tabs: DocumentWorkspaceTab[], id: string, openedAt = Date.now()) {
  const existing = tabs.find((tab) => tab.id === id)
  const next = existing
    ? tabs.map((tab) => tab.id === id ? { ...tab, openedAt } : tab)
    : [...tabs, { id, pinned: false, openedAt }]
  if (next.length <= MAX_DOCUMENT_WORKSPACE_TABS) return next
  const evictable = next
    .filter((tab) => !tab.pinned && tab.id !== id)
    .sort((left, right) => left.openedAt - right.openedAt)[0]
  return evictable ? next.filter((tab) => tab.id !== evictable.id) : next.slice(-MAX_DOCUMENT_WORKSPACE_TABS)
}

export function closeDocumentWorkspaceTab(tabs: DocumentWorkspaceTab[], id: string, activeId: string) {
  const index = tabs.findIndex((tab) => tab.id === id)
  if (index < 0) return { tabs, nextActiveId: activeId }
  const next = tabs.filter((tab) => tab.id !== id)
  if (activeId !== id) return { tabs: next, nextActiveId: activeId }
  return { tabs: next, nextActiveId: next[Math.min(index, next.length - 1)]?.id ?? '' }
}

export function closeOtherDocumentWorkspaceTabs(tabs: DocumentWorkspaceTab[], id: string) {
  return tabs.filter((tab) => tab.id === id || tab.pinned)
}

export function closeDocumentWorkspaceTabsToRight(tabs: DocumentWorkspaceTab[], id: string) {
  const index = tabs.findIndex((tab) => tab.id === id)
  if (index < 0) return tabs
  return tabs.filter((tab, tabIndex) => tabIndex <= index || tab.pinned)
}

export function toggleDocumentWorkspaceTabPin(tabs: DocumentWorkspaceTab[], id: string) {
  const target = tabs.find((tab) => tab.id === id)
  if (!target || (!target.pinned && tabs.filter((tab) => tab.pinned).length >= MAX_PINNED_DOCUMENT_WORKSPACE_TABS)) return tabs
  return tabs.map((tab) => tab.id === id ? { ...tab, pinned: !tab.pinned } : tab)
}

export function adjacentDocumentWorkspaceTab(tabs: DocumentWorkspaceTab[], activeId: string, direction: 1 | -1) {
  if (!tabs.length) return undefined
  const index = tabs.findIndex((tab) => tab.id === activeId)
  return tabs[(Math.max(0, index) + direction + tabs.length) % tabs.length]
}
