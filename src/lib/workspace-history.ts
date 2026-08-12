export type WorkspaceHistoryEntry = {
  path: string
  label: string
}

export type WorkspaceHistoryState = {
  entries: WorkspaceHistoryEntry[]
  index: number
}

const DEFAULT_HISTORY_LIMIT = 48

function cleanEntry(entry: WorkspaceHistoryEntry): WorkspaceHistoryEntry {
  return {
    path: entry.path.trim() || '/',
    label: entry.label.trim() || 'Knitspace',
  }
}

export function createWorkspaceHistory(entry: WorkspaceHistoryEntry): WorkspaceHistoryState {
  return { entries: [cleanEntry(entry)], index: 0 }
}

/** Records normal navigation while recognizing an adjacent browser back/forward
 * move. The bounded immutable state stays cheap to expose through Vue refs. */
export function recordWorkspaceHistory(
  state: WorkspaceHistoryState,
  rawEntry: WorkspaceHistoryEntry,
  limit = DEFAULT_HISTORY_LIMIT,
): WorkspaceHistoryState {
  const entry = cleanEntry(rawEntry)
  const current = state.entries[state.index]
  if (current?.path === entry.path) {
    const entries = state.entries.slice()
    entries[state.index] = entry
    return { entries, index: state.index }
  }

  const previousIndex = state.index - 1
  const nextIndex = state.index + 1
  const adjacentIndex = state.entries[previousIndex]?.path === entry.path
    ? previousIndex
    : state.entries[nextIndex]?.path === entry.path
      ? nextIndex
      : -1
  if (adjacentIndex >= 0) {
    const entries = state.entries.slice()
    entries[adjacentIndex] = entry
    return { entries, index: adjacentIndex }
  }

  const boundedLimit = Math.max(2, Math.trunc(limit))
  const entries = [...state.entries.slice(0, state.index + 1), entry]
  const trimmed = entries.slice(-boundedLimit)
  return { entries: trimmed, index: trimmed.length - 1 }
}

export function workspaceHistoryTarget(state: WorkspaceHistoryState, delta: -1 | 1) {
  const index = state.index + delta
  const entry = state.entries[index]
  return entry ? { entry, index } : undefined
}

export function selectWorkspaceHistoryIndex(state: WorkspaceHistoryState, index: number): WorkspaceHistoryState {
  if (!Number.isInteger(index) || index < 0 || index >= state.entries.length) return state
  return { entries: state.entries, index }
}

export function workspaceHistoryMenuEntries(state: WorkspaceHistoryState, direction: -1 | 1, limit = 12) {
  const entries: Array<WorkspaceHistoryEntry & { index: number }> = []
  for (let index = state.index + direction; index >= 0 && index < state.entries.length && entries.length < limit; index += direction) {
    entries.push({ ...state.entries[index], index })
  }
  return entries
}
