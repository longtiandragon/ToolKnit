import { describe, expect, it } from 'vitest'
import { externalWorkspaceContentSearchReady, externalWorkspaceEntryContainsPath, externalWorkspaceMoveTargetAllowed, externalWorkspacePathKey, externalWorkspaceRefreshTargets, externalWorkspaceSearchOpenTarget, externalWorkspaceSearchReady, remapExternalWorkspacePath } from './external-workspace'
import { externalWorkspaceQaContentSearch, externalWorkspaceQaMarkdown, externalWorkspaceQaSearch, EXTERNAL_WORKSPACE_QA_ROOT } from './external-workspace-qa'

describe('external workspace path remapping', () => {
  it('matches removed files and directory descendants without sibling-prefix collisions', () => {
    expect(externalWorkspaceEntryContainsPath('C:\\Notes\\算法', 'c:/notes/算法/二分.md', 'directory')).toBe(true)
    expect(externalWorkspaceEntryContainsPath('C:\\Notes\\算法', 'c:/notes/算法题/二分.md', 'directory')).toBe(false)
    expect(externalWorkspaceEntryContainsPath('C:\\Notes\\a.md', 'c:/notes/A.md', 'markdown')).toBe(true)
    expect(externalWorkspaceEntryContainsPath('C:\\Notes\\a.md', 'c:/notes/a.md/child', 'markdown')).toBe(false)
  })

  it('allows cross-folder moves but rejects the current parent and directory descendants', () => {
    expect(externalWorkspaceMoveTargetAllowed('算法/二分.md', 'markdown', '归档')).toBe(true)
    expect(externalWorkspaceMoveTargetAllowed('算法/二分.md', 'markdown', '算法')).toBe(false)
    expect(externalWorkspaceMoveTargetAllowed('算法', 'directory', '算法/图论')).toBe(false)
    expect(externalWorkspaceMoveTargetAllowed('算法', 'directory', '算法题')).toBe(true)
    expect(externalWorkspaceMoveTargetAllowed('算法/二分.md', 'markdown', '')).toBe(true)
    expect(externalWorkspaceMoveTargetAllowed('根目录.md', 'markdown', '')).toBe(false)
  })
  it('matches Windows paths case-insensitively', () => {
    expect(externalWorkspacePathKey('F:\\Notes\\算法\\A.md')).toBe('f:/notes/算法/a.md')
    expect(remapExternalWorkspacePath('F:\\Notes\\A.md', 'f:\\notes\\a.md', 'F:\\Notes\\B.md', 'markdown')).toBe('F:\\Notes\\B.md')
  })

  it('updates linked Markdown beneath a renamed directory', () => {
    expect(remapExternalWorkspacePath('F:\\Notes\\算法\\二分.md', 'F:\\Notes\\算法', 'F:\\Notes\\数据结构', 'directory')).toBe('F:\\Notes\\数据结构\\二分.md')
  })

  it('does not capture similarly named sibling directories', () => {
    expect(remapExternalWorkspacePath('F:\\Notes\\算法-备份\\二分.md', 'F:\\Notes\\算法', 'F:\\Notes\\数据结构', 'directory')).toBeUndefined()
  })

  it('does not rewrite descendants for a file rename', () => {
    expect(remapExternalWorkspacePath('F:\\Notes\\A.md\\child.md', 'F:\\Notes\\A.md', 'F:\\Notes\\B.md', 'markdown')).toBeUndefined()
  })

  it('refreshes only loaded parents affected by native workspace events', () => {
    const loaded = ['', '算法', '算法/图论', '英语']
    expect(externalWorkspaceRefreshTargets(['README.md', '算法/二分.md', '未展开/深层.md'], loaded)).toEqual(['', '算法'])
    expect(externalWorkspaceRefreshTargets(['算法\\图论\\Dijkstra.md'], loaded)).toEqual(['算法/图论'])
    expect(externalWorkspaceRefreshTargets(['anything'], loaded, true, 2)).toEqual(['', '算法'])
  })

  it('starts quick-open for one CJK character or two other characters', () => {
    expect(externalWorkspaceSearchReady('算')).toBe(true)
    expect(externalWorkspaceSearchReady('a')).toBe(false)
    expect(externalWorkspaceSearchReady('md')).toBe(true)
    expect(externalWorkspaceSearchReady('  ')).toBe(false)
    expect(externalWorkspaceContentSearchReady('算')).toBe(false)
    expect(externalWorkspaceContentSearchReady('算法')).toBe(true)
    expect(externalWorkspaceContentSearchReady('md')).toBe(false)
    expect(externalWorkspaceContentSearchReady('run')).toBe(true)
  })

  it('carries a bounded body-search location without changing filename opens', () => {
    expect(externalWorkspaceSearchOpenTarget({ path: 'F:\\Notes\\Dijkstra.md', line: 5.2 }, '  松弛 操作  ')).toEqual({
      path: 'F:\\Notes\\Dijkstra.md',
      line: 5,
      query: '松弛 操作',
    })
    expect(externalWorkspaceSearchOpenTarget({ path: 'F:\\Notes\\Dijkstra.md' }, 'Dijkstra')).toEqual({ path: 'F:\\Notes\\Dijkstra.md' })
    expect(externalWorkspaceSearchOpenTarget({ path: 'F:\\Notes\\Dijkstra.md', line: Number.NaN }, '松弛')).toEqual({ path: 'F:\\Notes\\Dijkstra.md' })
  })

  it('searches collapsed QA directories without hydrating their tree levels', () => {
    const result = externalWorkspaceQaSearch(EXTERNAL_WORKSPACE_QA_ROOT, '最短 Dijkstra', 10)
    expect(result.entries.map(entry => entry.relativePath)).toEqual(['算法与数据结构/最短路/Dijkstra.md'])
    expect(result.truncated).toBe(false)
  })

  it('provides exact duplicate titles and cross-file heading links in the QA workspace', () => {
    const duplicate = externalWorkspaceQaSearch(EXTERNAL_WORKSPACE_QA_ROOT, '重复标题', 10)
    expect(duplicate.entries.map(entry => entry.relativePath)).toEqual([
      '算法与数据结构/重复标题.md',
      '英语学习/重复标题.md',
    ])

    const dijkstra = externalWorkspaceQaMarkdown(
      EXTERNAL_WORKSPACE_QA_ROOT,
      `${EXTERNAL_WORKSPACE_QA_ROOT}\\算法与数据结构\\最短路\\Dijkstra.md`,
    )
    expect(dijkstra.content).toContain('[[二分边界#边界条件]]')
    expect(dijkstra.content).toContain('[[重复标题]]')
  })

  it('returns a bounded line excerpt for QA Markdown body search', () => {
    const result = externalWorkspaceQaContentSearch(EXTERNAL_WORKSPACE_QA_ROOT, '松弛 操作', 10)
    expect(result.matches).toHaveLength(1)
    expect(result.matches[0]).toMatchObject({
      relativePath: '算法与数据结构/最短路/Dijkstra.md',
      line: 5,
    })
    expect(result.matches[0].preview).toContain('松弛操作')
    expect(result.scannedBytes).toBeGreaterThan(0)
  })
})
