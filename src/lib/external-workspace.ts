export type ExternalWorkspaceEntryKind = 'directory' | 'markdown'

export type ExternalWorkspaceOpenTarget = {
  path: string
  line?: number
  query?: string
}

/** Keep the location handoff small before it crosses the component boundary. */
export function externalWorkspaceSearchOpenTarget(entry: { path: string; line?: unknown }, query: string): ExternalWorkspaceOpenTarget {
  const line = typeof entry.line === 'number' && Number.isFinite(entry.line)
    ? Math.max(1, Math.round(entry.line))
    : undefined
  const normalizedQuery = query.trim().slice(0, 160)
  return {
    path: entry.path,
    ...(line ? { line } : {}),
    ...(line && normalizedQuery ? { query: normalizedQuery } : {}),
  }
}

export function externalWorkspacePathKey(path: string) {
  return path.replace(/\\/g, '/').toLocaleLowerCase('en-US')
}

export function externalWorkspaceEntryContainsPath(entryPath: string, currentPath: string, kind: ExternalWorkspaceEntryKind) {
  const entry = externalWorkspacePathKey(entryPath).replace(/\/$/, '')
  const current = externalWorkspacePathKey(currentPath)
  return current === entry || (kind === 'directory' && current.startsWith(`${entry}/`))
}

export function externalWorkspaceMoveTargetAllowed(sourceRelativePath: string, kind: ExternalWorkspaceEntryKind, targetParentRelativePath: string) {
  const source = externalWorkspacePathKey(sourceRelativePath).replace(/^\/+|\/+$/g, '')
  const target = externalWorkspacePathKey(targetParentRelativePath).replace(/^\/+|\/+$/g, '')
  const sourceParent = source.split('/').slice(0, -1).join('/')
  if (target === sourceParent) return false
  return kind !== 'directory' || (target !== source && !target.startsWith(`${source}/`))
}

function normalizedRelativeWorkspacePath(path: string) {
  return path.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
}

/** Maps a bounded native change batch to directory levels that are already
 * mounted in the lazy tree. A change inside a collapsed/unread directory does
 * not trigger I/O until that directory is intentionally expanded. */
export function externalWorkspaceRefreshTargets(changedRelativePaths: string[], loadedDirectoryPaths: string[], overflow = false, limit = 64) {
  const loaded = new Map(loadedDirectoryPaths.map((path) => [externalWorkspacePathKey(normalizedRelativeWorkspacePath(path)), path]))
  const targets = new Set<string>()
  const append = (path: string) => {
    const loadedPath = loaded.get(externalWorkspacePathKey(path))
    if (loadedPath !== undefined && targets.size < Math.max(1, limit)) targets.add(loadedPath)
  }
  if (overflow) {
    loadedDirectoryPaths.forEach((path) => append(path))
    return [...targets]
  }
  for (const changedPath of changedRelativePaths) {
    const normalized = normalizedRelativeWorkspacePath(changedPath)
    const parent = normalized.split('/').slice(0, -1).join('/')
    append(parent)
  }
  return [...targets]
}

/** One CJK character is usually a meaningful filename query; Latin searches
 * wait for two characters to avoid walking a large workspace for every key. */
export function externalWorkspaceSearchReady(query: string) {
  const normalized = query.trim()
  return /[\u3400-\u9fff\uf900-\ufaff]/u.test(normalized) || normalized.length >= 2
}

/** Body search reads bounded Markdown bytes on a native worker, so it waits
 * for a little more intent than filename quick-open. Two CJK characters or
 * three other characters avoid expensive one-character workspace sweeps. */
export function externalWorkspaceContentSearchReady(query: string) {
  const normalized = query.trim()
  const cjkCount = [...normalized.matchAll(/[\u3400-\u9fff\uf900-\ufaff]/gu)].length
  return cjkCount >= 2 || normalized.length >= 3
}

/** Rewrites a linked Markdown path after one workspace file or directory is
 * renamed. Directory matching requires a separator boundary, so similarly
 * named siblings are never captured by accident. */
export function remapExternalWorkspacePath(currentPath: string, oldPath: string, newPath: string, kind: ExternalWorkspaceEntryKind) {
  const current = currentPath.replace(/\\/g, '/')
  const old = oldPath.replace(/\\/g, '/')
  const currentKey = current.toLocaleLowerCase('en-US')
  const oldKey = old.toLocaleLowerCase('en-US')
  const exact = currentKey === oldKey
  if (!exact && (kind !== 'directory' || !currentKey.startsWith(`${oldKey}/`))) return undefined
  const suffix = current.slice(old.length)
  const separator = newPath.includes('\\') ? '\\' : '/'
  return `${newPath}${suffix.replace(/\//g, separator)}`
}
