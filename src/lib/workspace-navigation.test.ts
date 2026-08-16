import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { appRoutes } from '@/routes'
import { activeWorkspaceChildTarget, searchWorkspaceCommands, workspaceCommandCatalog, workspaceContextActionGroups, workspaceContextActions, workspaceDiscoverablePaths, workspaceFeatureGroups, workspaceNavGroups, workspaceRouteOwners } from './workspace-navigation'

describe('workspace navigation', () => {
  const rail = readFileSync(new URL('../components/AppRail.vue', import.meta.url), 'utf8')
  // Category pages are parameterised results inside the toolbox browser rather
  // than standalone product spaces, so the route itself is not advertised.
  const indirectToolBrowsePaths = new Set(['/c/:category'])

  /* A redirect is an old link kept working, not a page. `/tool-space` is one:
     it used to be a second tool browser and now lands on the toolbox. Asking
     navigation to expose it would be asking the product to advertise a
     forwarding address. */
  const renderedRoutes = appRoutes.filter(route => 'component' in route)

  it('keeps every implemented user-facing route visible in navigation or Ctrl+K', () => {
    const paths = workspaceDiscoverablePaths()
    const implementedPaths = renderedRoutes.map(route => route.path).filter(path => !indirectToolBrowsePaths.has(path))
    expect(implementedPaths.filter(path => !paths.has(path))).toEqual([])
  })

  it('gives every primary space persistent child entries', () => {
    const items = workspaceNavGroups.flatMap(group => group.items)
    expect(items.map(item => item.label)).toEqual(['今天', '知识库', '创作', '复习', '工具'])
    expect(items.every(item => item.children.length >= 3)).toBe(true)
  })

  it('keeps every feature route owned by a primary space', () => {
    const owners = workspaceRouteOwners()
    const utilityPaths = new Set(['/settings', ...indirectToolBrowsePaths])
    expect(renderedRoutes.map(route => route.path).filter(path => !utilityPaths.has(path) && !owners.has(path))).toEqual([])
    expect(owners.get('/lab')).toEqual(['/'])
  })

  it('puts all five spaces in the empty Ctrl+K state', () => {
    expect(searchWorkspaceCommands().map(item => item.label)).toEqual(['今天', '知识库', '创作', '复习', '工具'])
  })

  it('renders the shared five-space model in the permanent rail', () => {
    expect(rail).toContain('workspaceNavGroups')
    expect(rail).toContain('v-for="space in spaces"')
    expect(rail).toContain('v-for="child in visibleChildren(space)"')
    expect(rail).toContain("emit('openSpaceContext', $event, space)")
    expect(rail).toContain("emit('openSpaceContextKeyboard', space")
    expect(rail).not.toContain('v-for="category in toolCategories"')
  })

  it('builds a complete browse map without repeating space overview links', () => {
    const groups = workspaceFeatureGroups()
    expect(groups.map(group => group.space.label)).toEqual(['今天', '知识库', '创作', '复习', '工具'])
    expect(groups.every(group => group.features.length >= 2)).toBe(true)
    expect(groups.flatMap(group => group.features).some(feature => feature.to === '/private-tools')).toBe(true)
    expect(groups.some(group => group.features.some(feature => feature.to === group.space.to))).toBe(false)
  })

  it('keeps the blank-workspace menu contextual, bounded and backed by navigation actions', () => {
    const spaces = workspaceNavGroups.flatMap(group => group.items)
    for (const space of spaces) {
      const actions = workspaceContextActions(space.to)
      expect(actions.length).toBeGreaterThanOrEqual(4)
      expect(actions.length).toBeLessThanOrEqual(5)
      expect(actions.every(action => space.children.some(child => child.to === action.to))).toBe(true)
    }
    expect(workspaceContextActions('/review').map(action => action.label)).toContain('单词库')
    expect(workspaceRouteOwners().get('/words')).toEqual(['/knowledge', '/review'])
    expect(workspaceContextActions('/unknown')).toEqual([])
  })

  it('can expose every current-space feature from the blank-workspace context menu', () => {
    const spaces = workspaceNavGroups.flatMap(group => group.items)
    for (const space of spaces) {
      const groups = workspaceContextActionGroups(space.to)
      const expected = space.children.filter(action => action.to !== space.to).map(action => action.to)
      const surfaced = [...groups.primary, ...groups.more].map(action => action.to)
      expect(new Set(surfaced)).toEqual(new Set(expected))
      expect(groups.primary.every(action => !groups.more.some(item => item.to === action.to))).toBe(true)
    }
    expect(workspaceContextActionGroups('/create').more.map(action => action.label)).toEqual(expect.arrayContaining(['LaTeX 公式编辑', '公式图片识别', 'AI 内容工作台']))
    expect(workspaceContextActionGroups('/').more.map(action => action.label)).toEqual(expect.arrayContaining(['剪贴板历史', '处理历史', '本机能力与实验']))
    expect(workspaceContextActionGroups('/unknown')).toEqual({ primary: [], more: [] })
  })

  it('finds direct workspace actions and familiar product vocabulary', () => {
    expect(searchWorkspaceCommands('音视频')[0]).toMatchObject({ label: '音视频转换', to: '/media' })
    expect(searchWorkspaceCommands('ocr')[0]).toMatchObject({ label: '离线 OCR 识别', to: '/ocr' })
    expect(searchWorkspaceCommands('latex')[0]).toMatchObject({ label: 'LaTeX 公式编辑', to: '/documents?kind=note&create=note&mode=split&insert=formula' })
    expect(searchWorkspaceCommands('打开本机 markdown')[0]).toMatchObject({ label: '打开本机 Markdown', to: '/documents?kind=note&action=open-file' })
    // The 今天 space is `/today`; `/` is the toolbox. These four entries used
    // to point at `/`, where the elements they scroll to do not exist.
    expect(searchWorkspaceCommands('番茄').some(item => item.to === '/today#today-focus-timer')).toBe(true)
    expect(searchWorkspaceCommands('补记时间')[0]).toMatchObject({ label: '补记时间', to: '/today?action=log-time#today-focus-ledger' })
    expect(searchWorkspaceCommands('codesnap').map(item => item.to)).toEqual(['/code-image', '/create'])
    expect(searchWorkspaceCommands('设置')[0]).toMatchObject({ label: '设置', to: '/settings' })
    expect(searchWorkspaceCommands('备份')[0]).toMatchObject({ label: '数据与备份', to: '/settings?section=backup' })
    expect(searchWorkspaceCommands('阅读外观')[0]).toMatchObject({ label: '阅读与外观', to: '/settings?section=appearance' })
    expect(searchWorkspaceCommands('api key')[0]).toMatchObject({ label: 'AI 服务与凭据', to: '/settings?section=ai' })
    expect(searchWorkspaceCommands('本机能力')[0]).toMatchObject({ label: '本机能力与实验', to: '/lab' })
    expect(searchWorkspaceCommands('语音转文字')[0]).toMatchObject({ label: '本机语音转写', to: '/subtitles?transcribe=1' })
    expect(searchWorkspaceCommands('录入单词')[0]).toMatchObject({ label: '录入新单词', to: '/words?action=create' })
    expect(searchWorkspaceCommands('whisper cli')[0]).toMatchObject({ label: '本机引擎', to: '/settings?section=engines' })
    expect(searchWorkspaceCommands('收藏内容')[0]).toMatchObject({ label: '收藏内容', to: '/knowledge?filter=favorites' })
    expect(searchWorkspaceCommands('最近打开')[0]).toMatchObject({ label: '最近打开', to: '/knowledge?filter=recent' })
    expect(searchWorkspaceCommands('知识图谱')[0]).toMatchObject({ label: '知识关系图谱', to: '/relations' })
  })

  it('does not duplicate a space overview as a second command', () => {
    const routes = workspaceCommandCatalog().map(item => item.to)
    expect(routes.filter(route => route === '/knowledge')).toHaveLength(1)
    expect(routes.filter(route => route === '/create')).toHaveLength(1)
    expect(routes.filter(route => route === '/lab')).toHaveLength(1)
  })

  it('selects only the most specific sidebar child for shared route paths', () => {
    const spaces = workspaceNavGroups.flatMap(group => group.items)
    const knowledge = spaces.find(item => item.to === '/knowledge')!
    const create = spaces.find(item => item.to === '/create')!
    const today = spaces.find(item => item.to === '/today')!

    expect(activeWorkspaceChildTarget(knowledge.children, { path: '/documents', query: { kind: 'note', document: 'note-1' } })).toBe('/documents?kind=note')
    expect(activeWorkspaceChildTarget(knowledge.children, { path: '/documents', query: { document: 'note-1' } })).toBe('/documents')
    expect(activeWorkspaceChildTarget(knowledge.children, { path: '/knowledge', query: { filter: 'favorites' } })).toBe('/knowledge?filter=favorites')
    expect(activeWorkspaceChildTarget(knowledge.children, { path: '/documents', query: { kind: 'note', action: 'open-file' } })).toBe('/documents?kind=note&action=open-file')
    expect(activeWorkspaceChildTarget(create.children, { path: '/documents', query: { kind: 'note', create: 'note', mode: 'split', insert: 'formula', recognize: 'formula' } })).toBe('/documents?kind=note&create=note&mode=split&insert=formula&recognize=formula')
    expect(activeWorkspaceChildTarget(today.children, { path: '/today', hash: '#today-focus-ledger' })).toBe('/today#today-focus-ledger')
  })
})
