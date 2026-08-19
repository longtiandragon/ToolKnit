import { personalPackEnabled } from '@/lib/build-profile'

export type WorkspaceNavAction = { label: string; to: string; icon: string }
/** `children` are places the rail lists; `actions` are things you do on
 * arrival — a new subtitle, an import, a filtered view of a page that already
 * has that filter. Both are reachable from Ctrl+K and the right-click menu, but
 * only places belong in a permanent list of destinations. */
export type WorkspaceNavItem = { to: string; icon: string; label: string; children: WorkspaceNavAction[]; actions: WorkspaceNavAction[]; menu: WorkspaceNavAction[]; owns: string[] }
export type WorkspaceCommandItem = WorkspaceNavAction & { id: string; detail: string; kind: 'space' | 'action'; keywords: string }
export type WorkspaceFeatureGroup = { space: WorkspaceNavItem; features: WorkspaceNavAction[] }
export type WorkspaceContextActionGroups = { primary: WorkspaceNavAction[]; more: WorkspaceNavAction[] }
export type WorkspaceRouteLocation = { path: string; query?: Record<string, unknown>; hash?: string }

function navItem(to: string, icon: string, label: string, children: WorkspaceNavAction[], actions: WorkspaceNavAction[] = [], owns: string[] = []): WorkspaceNavItem {
  return { to, icon, label, children, actions, owns, menu: [{ label: `打开${label}`, to, icon }, ...children, ...actions] }
}

/** Everything a space leads to, listed or not. Every consumer except the rail
 * itself wants this — hiding a route from the rail must never hide it from
 * search, from the context menu, or from the reachability check. */
export function workspaceSpaceTargets(space: WorkspaceNavItem) {
  return [...space.children, ...space.actions]
}

function parsedWorkspaceTarget(to: string) {
  const [pathAndQuery, hash = ''] = to.split('#', 2)
  const [path, queryString = ''] = pathAndQuery.split('?', 2)
  return { path, query: [...new URLSearchParams(queryString).entries()], hash: hash ? `#${hash}` : '' }
}

/** Selects one visible child when several sidebar entries share a route.
 * Vue Router's inclusive matching makes `/documents` active together with
 * `/documents?kind=note`; ranking the matching siblings keeps the more
 * specific workflow selected while still ignoring transient ids. */
/** Whether one nav target is satisfied by the current location, and how
 *  specifically — more matched query keys and a matched hash rank higher. */
function targetScore(to: string, current: WorkspaceRouteLocation) {
  const target = parsedWorkspaceTarget(to)
  if (target.path !== current.path) return -1
  if (target.hash && target.hash !== (current.hash ?? '')) return -1
  if (!target.query.every(([key, value]) => String(current.query?.[key] ?? '') === value)) return -1
  return target.query.length * 2 + Number(Boolean(target.hash))
}

export function activeWorkspaceChildTarget(children: readonly WorkspaceNavAction[], current: WorkspaceRouteLocation) {
  return children
    .flatMap((child, index) => {
      const score = targetScore(child.to, current)
      return score < 0 ? [] : [{ to: child.to, score, index }]
    })
    .sort((left, right) => right.score - left.score || left.index - right.index)[0]?.to
}

/** Whether a space owns the current route, directly or through a child. */
export function workspaceSpaceOwnsRoute(space: WorkspaceNavItem, current: WorkspaceRouteLocation) {
  if (targetScore(space.to, current) >= 0) return true
  // A launcher hands you off to a page owned by another space: 创作 starts a
  // note and the document workspace takes over, rewriting the URL without the
  // parameters that started it. Owning the bare path is what keeps the rail
  // from yanking you into 知识库 the moment the note opens.
  if (space.owns.includes(current.path)) return true
  return workspaceSpaceTargets(space).some((child) => targetScore(child.to, current) >= 0)
}

/**
 * Which space the rail should show as active.
 *
 * Several routes are legitimately reachable from more than one space: `/words`
 * and `/documents?kind=question` are material that both 知识库 and 复习 lead to.
 * Picking the first space that owns the route — which is all this used to do —
 * answered with whichever was declared first, so opening 单词库 from 复习
 * collapsed 复习 and expanded 知识库 instead. From the user's side that reads as
 * clicking one thing and landing in another.
 *
 * `preferred` is the space already open. If it owns the new route, it wins; a
 * click stays in the space it was made in. Only a route that no open space owns
 * moves the rail, which is exactly when moving is right.
 */
export function activeWorkspaceSpace(
  spaces: readonly WorkspaceNavItem[],
  current: WorkspaceRouteLocation,
  preferred?: string,
) {
  const open = preferred ? spaces.find((space) => space.to === preferred) : undefined
  if (open && workspaceSpaceOwnsRoute(open, current)) return open
  return spaces.find((space) => workspaceSpaceOwnsRoute(space, current))
}

export const workspaceNavGroups: { label: string; items: WorkspaceNavItem[] }[] = [{
  label: '五个空间',
  items: [
    // `/today`, not `/`. `/` is the toolbox (`routes.ts` gives it the title
    // 工具箱); the focus timer, the ledger and the anniversaries all live on
    // `/today`. Under hash history `/#today-focus-ledger` resolved to path
    // `/`, so every one of these entries — and the 补记时间 command below —
    // landed on a page that does not contain the element it scrolls to.
    navItem('/today', 'dashboard', '今天', [
      { label: '专注计时', to: '/today#today-focus-timer', icon: 'clock' },
      { label: '时间账本', to: '/today#today-focus-ledger', icon: 'clock' },
      { label: '纪念日', to: '/today#today-anniversaries', icon: 'calendar' },
      { label: '快速捕获', to: '/quick', icon: 'plus' },
    ]),
    navItem('/knowledge', 'book', '知识库', [
      { label: '知识空间总览', to: '/knowledge', icon: 'book' },
      { label: '知识关系图谱', to: '/relations', icon: 'link' },
      { label: 'Markdown 笔记', to: '/documents?kind=note', icon: 'book' },
      { label: '全部学习内容', to: '/documents', icon: 'sort' },
      { label: '题目与错题', to: '/documents?kind=question', icon: 'review' },
      { label: '资料与摘录', to: '/library', icon: 'inbox' },
      { label: '单词库', to: '/words', icon: 'book' },
    ], [
      // The knowledge overview carries these two as its own filter chips.
      { label: '最近打开', to: '/knowledge?filter=recent', icon: 'clock' },
      { label: '收藏内容', to: '/knowledge?filter=favorites', icon: 'star' },
      { label: '打开本机 Markdown', to: '/documents?kind=note&action=open-file', icon: 'folder-open' },
      { label: '批量导入题目', to: '/documents?kind=question&import=1', icon: 'inbox' },
      { label: '录入新单词', to: '/words?action=create', icon: 'plus' },
      { label: '批量导入单词', to: '/words?import=1', icon: 'inbox' },
    ]),
    navItem('/create', 'palette', '创作', [
      { label: '创作空间总览', to: '/create', icon: 'palette' },
      { label: 'Markdown 写作', to: '/documents?kind=note&create=note', icon: 'book' },
      { label: '思维图谱', to: '/documents?kind=note&template=mindmap&mode=mindmap', icon: 'sort' },
      { label: '流程与结构图', to: '/documents?kind=note&template=diagram&mode=split', icon: 'split' },
      { label: 'LaTeX 公式编辑', to: '/documents?kind=note&create=note&mode=split&insert=formula', icon: 'math' },
      { label: '视觉画布工作室', to: '/visual', icon: 'palette' },
      { label: '滚动截图拼接', to: '/visual?tool=stitch', icon: 'sort' },
      { label: '代码分享工作室', to: '/code-image', icon: 'terminal' },
      { label: 'AI 内容工作台', to: '/ai', icon: 'sparkle' },
      { label: '资料库证据型 AI', to: '/evidence-ai', icon: 'search' },
    ], [
      { label: '公式图片识别', to: '/documents?kind=note&create=note&mode=split&insert=formula&recognize=formula', icon: 'math' },
      { label: '新建自由画布', to: '/visual?canvas=blank', icon: 'plus' },
    ], ['/documents', '/visual']),
    // 复习 is where you *do* a review; 知识库 is where the material is authored.
    //
    // Five of its seven entries used to be byte-identical to entries under
    // 知识库. Three of those — 批量导入题目, 录入新单词, 批量导入单词 — are
    // authoring, not reviewing, and belong to 知识库 alone; they are gone from
    // here. 单词库 and 题目与错题 stay, because reaching the material is a real
    // part of reviewing it and a space that cannot get to its own cards is
    // worse than a shared link.
    //
    // Sharing a `to` used to be actively harmful: the rail picked the active
    // space with a plain `find`, so opening 单词库 from 复习 collapsed 复习 and
    // expanded 知识库 instead. `AppRail.vue` now prefers the space that is
    // already open, which is what makes a shared destination safe.
    navItem('/review', 'review', '复习', [
      { label: '今日复习队列', to: '/review', icon: 'review' },
    ], [
      // Reaching the material from here still matters — it is simply the same
      // page 知识库 already lists, so it stops being a second row saying so.
      { label: '题目与错题', to: '/documents?kind=question', icon: 'book' },
      { label: '单词库', to: '/words', icon: 'book' },
      { label: '记录新错题', to: '/documents?kind=question&create=question', icon: 'plus' },
    ]),
    navItem('/', 'toolbox', '工具', [
      { label: '全部工具', to: '/', icon: 'toolbox' },
      { label: '文件处理中心', to: '/tools', icon: 'toolbox' },
      { label: 'AI 智能文件收件箱', to: '/tools?mode=smart-organizer', icon: 'sparkle' },
      { label: '音视频转换', to: '/media', icon: 'play' },
      { label: '字幕校对台', to: '/subtitles', icon: 'file-text' },
      { label: '本机语音转写', to: '/subtitles?transcribe=1', icon: 'play' },
      { label: '离线 OCR 识别', to: '/ocr', icon: 'file-text' },
      { label: '开发者工具', to: '/developer-tools', icon: 'code' },
      { label: '剪贴板历史', to: '/clipboard', icon: 'clipboard' },
      { label: '常用片段', to: '/clipboard?view=snippets', icon: 'star' },
      { label: '处理历史', to: '/history', icon: 'clock' },
      ...(personalPackEnabled ? [
        { label: '私人工具包', to: '/private-tools', icon: 'terminal' },
      ] : []),
      { label: '本机能力与实验', to: '/lab', icon: 'flask' },
    ], [
      { label: '打开字幕文件', to: '/subtitles?action=import', icon: 'folder-open' },
      { label: '粘贴字幕源码', to: '/subtitles?action=paste', icon: 'clipboard' },
      { label: '新建空白字幕', to: '/subtitles?action=create', icon: 'plus' },
      { label: '读取当前剪贴板', to: '/clipboard?action=capture', icon: 'clipboard' },
      { label: '新建常用片段', to: '/clipboard?action=create-snippet', icon: 'plus' },
      // `/history` already carries a tab switcher and status filters, so these
      // were three sidebar rows describing controls the page itself owns.
      { label: '失败任务', to: '/history?status=failed', icon: 'clock' },
      { label: '操作日志', to: '/history?view=activity', icon: 'sort' },
      ...(personalPackEnabled ? [
        { label: '加载私人工具清单', to: '/private-tools?action=choose-manifest', icon: 'folder-open' },
        { label: '复制私人工具模板', to: '/private-tools?action=copy-template', icon: 'duplicate' },
        { label: '脚本任务历史', to: '/history?kind=script', icon: 'clock' },
      ] : []),
    ]),
  ],
}]

const spaceAliases: Record<string, string> = {
  // These are 今天's words — 番茄, 纪念日, 快速捕获 — and they were filed under
  // '/' from back when '/' was the dashboard. The toolbox lives there now.
  '/today': '首页 dashboard 番茄 时间记录 纪念日 快速捕获 最近文档',
  '/knowledge': '知识 markdown 笔记 单词 题目 错题 资料 摘录 全文搜索 obsidian typora',
  '/create': '写作 脑图 思维导图 流程图 图片 标注 代码截图 长图 AI xmind visio codesnap',
  '/review': '背单词 背题 错题 fsrs anki 卡片 今日待复习',
  '/': 'pdf 图片转换 音频 视频 文件 开发 脚本 剪贴板 工具箱',
}

const actionAliases: Record<string, string> = {
  '/today#today-focus-timer': '番茄 时间记录 timer',
  '/today#today-focus-ledger': '补记时间 专注统计 一周 本周 focus ledger time tracking',
  '/today#today-anniversaries': '倒数日 重要日期 live marker',
  '/quick': '收件箱 inbox 快记',
  '/documents?kind=note': 'typora obsidian markdown 编辑器',
  '/documents?kind=note&action=open-file': '打开本机 markdown md typora 外部文件 保持兼容 local file',
  '/knowledge?filter=favorites': '收藏内容 星标 常用资料 pinned favorite starred',
  '/knowledge?filter=recent': '最近使用 最近打开 历史 recent opened history',
  '/relations': '知识图谱 关系网络 双链 回链 关联 obsidian graph relation backlinks',
  '/documents?kind=question': '错题本 题库',
  '/documents?kind=question&create=question': '新增题目 新建错题',
  '/documents?kind=question&import=1': '批量题目 导入题库 csv tsv 错题本 question import',
  '/documents?kind=note&create=note': 'typora markdown 新建笔记',
  '/documents?kind=note&template=mindmap&mode=mindmap': 'xmind markmap 脑图',
  '/documents?kind=note&template=diagram&mode=split': 'visio mermaid 流程图 时序图 类图 er图',
  '/documents?kind=note&create=note&mode=split&insert=formula': 'latex katex 数学公式 公式编辑 即时预览 equation math',
  '/documents?kind=note&create=note&mode=split&insert=formula&recognize=formula': '图片转公式 公式识别 latex vision mathpix 数学截图 可校对草稿',
  '/visual': 'ps 图片编辑 视觉画布 标注 裁剪 拼图',
  '/visual?canvas=blank': '自由画布 空白画布 箭头 方框 文字标注 visio canvas whiteboard',
  '/visual?tool=stitch': '滚动截图 长截图 网页截图 自动拼接 overlap stitch scrolling capture',
  '/code-image': 'codesnap code snap 代码截图 长图',
  '/review': 'anki fsrs 背单词 背题 卡片',
  '/words?import=1': '批量单词 导入词表 csv tsv 生词本 词典 vocabulary import',
  '/words?action=create': '新增单词 录入单词 新建词条 vocabulary word',
  '/tools': 'pdf 合并 拆分 提取 图片转换 文件处理',
  '/media': '音频 视频 ffmpeg 转码 压缩',
  '/subtitles': '字幕 srt vtt webvtt 校对 时间轴 平移 拆分 合并 subtitle caption transcript',
  '/subtitles?action=import': '打开 导入 srt vtt webvtt 字幕文件 subtitle import',
  '/subtitles?action=paste': '粘贴 字幕源码 时间轴 srt vtt source paste',
  '/subtitles?action=create': '新建 空白 字幕 时间轴 create subtitle',
  '/subtitles?transcribe=1': '语音转文字 音频转字幕 视频转字幕 whisper whisper.cpp 本机转写 speech to text transcript',
  '/ocr': 'ocr 离线识字 图片文字 扫描题 截图文字 提取文字 windows media ocr',
  '/developer-tools': 'json 正则 hash uuid base64',
  '/clipboard': '复制 粘贴 历史',
  '/clipboard?action=capture': '读取 保存 当前 系统剪贴板 capture clipboard',
  '/clipboard?action=create-snippet': '新建 常用片段 模板 地址 回复 命令 snippet',
  '/clipboard?view=snippets': '常用片段 固定 收藏 snippet pinned',
  '/history': '任务 历史 输出 处理记录 recent runs job ledger',
  '/history?status=failed': '失败任务 错误 重试 failed retry error',
  '/history?view=activity': '操作日志 活动轨迹 最近操作 activity audit ledger',
  '/private-tools': 'python script 私人脚本',
  '/private-tools?action=choose-manifest': '加载 选择 json manifest 私人工具 清单 本机脚本',
  '/private-tools?action=copy-template': '复制 示例 模板 manifest json dry run preview arguments',
  '/history?kind=script': '脚本任务 私人工具 执行历史 日志 输出 python history',
  '/lab': 'ocr 公式识别 实验功能 识图 数学公式 本机能力 ffmpeg vault 诊断 lab',
}

const utilityCommands: WorkspaceCommandItem[] = [
  { id: 'action:/today?action=log-time#today-focus-ledger', label: '补记时间', to: '/today?action=log-time#today-focus-ledger', icon: 'clock', detail: '今天 · 把刚完成的一段学习写入本地时间账本', kind: 'action', keywords: '时间记录 手动记录 专注统计 学习时长 focus ledger' },
  { id: 'action:/settings', label: '设置', to: '/settings', icon: 'settings', detail: '全局 · 桌面偏好与本地数据', kind: 'action', keywords: '配置 偏好 数据 备份 更新 主题 vault' },
  { id: 'action:/settings?section=config', label: '常规设置', to: '/settings?section=config', icon: 'settings', detail: '设置 · 输出目录、关闭行为与系统通知', kind: 'action', keywords: '输出目录 托盘 关闭窗口 彻底退出 通知 desktop preferences' },
  { id: 'action:/settings?section=appearance', label: '阅读与外观', to: '/settings?section=appearance', icon: 'palette', detail: '设置 · 字号、行距、阅读宽度、纸张与动态效果', kind: 'action', keywords: '阅读外观 字体 字号 行距 背景 纸张 暖纸 大字 阅读宽度 减少动画 appearance typography motion' },
  { id: 'action:/settings?section=clipboard', label: '剪贴板隐私', to: '/settings?section=clipboard', icon: 'clipboard', detail: '设置 · 后台监听与本地保留策略', kind: 'action', keywords: '剪贴板 监听 保留天数 密码 敏感内容 隐私 privacy' },
  { id: 'action:/settings?section=ai', label: 'AI 服务与凭据', to: '/settings?section=ai', icon: 'sparkle', detail: '设置 · 兼容接口、模型与系统凭据库', kind: 'action', keywords: 'api key apikey 密钥 凭据 模型 base url windows credential' },
  { id: 'action:/settings?section=engines', label: '本机引擎', to: '/settings?section=engines', icon: 'play', detail: '设置 · Whisper CLI、本机模型与默认识别语言', kind: 'action', keywords: 'whisper whisper.cpp cli 模型 语音转写 字幕 ffmpeg local engine' },
  { id: 'action:/settings?section=backup', label: '数据与备份', to: '/settings?section=backup', icon: 'archive', detail: '设置 · Vault 健康、完整归档与恢复', kind: 'action', keywords: 'vault sqlite 数据安全 健康检查 归档 zip json 备份 恢复 restore backup' },
  { id: 'action:/settings?section=update', label: '版本与更新', to: '/settings?section=update', icon: 'clock', detail: '设置 · 桌面版本与更新检查', kind: 'action', keywords: '版本 升级 github release 自动检查 update' },
]

/** A single metadata catalog powers the sidebar and Ctrl+K. Keeping navigation
 * commands here prevents implemented pages becoming hidden, duplicate islands. */
export function workspaceCommandCatalog(): WorkspaceCommandItem[] {
  const commands = workspaceNavGroups.flatMap((group) => group.items.flatMap((item) => [
    {
      id: `space:${item.to}`,
      label: item.label,
      to: item.to,
      icon: item.icon,
      detail: `${group.label} · ${item.children.map((child) => child.label).join('、')}`,
      kind: 'space' as const,
      keywords: `${spaceAliases[item.to] ?? ''} ${item.children.map((child) => child.label).join(' ')}`,
    },
    ...workspaceSpaceTargets(item).filter((child) => child.to !== item.to).map((child) => ({
      id: `action:${child.to}`,
      ...child,
      detail: `${item.label} · 直接打开`,
      kind: 'action' as const,
      keywords: `${item.label} ${actionAliases[child.to] ?? ''}`,
    })),
  ]))
  commands.push(...utilityCommands)
  return commands
}

export function searchWorkspaceCommands(query = '', limit = 10) {
  const normalized = query.trim().toLocaleLowerCase('zh-CN')
  const catalog = workspaceCommandCatalog()
  if (!normalized) return catalog.filter((item) => item.kind === 'space')
  const terms = normalized.split(/\s+/).filter(Boolean)
  return catalog
    .flatMap((item) => {
      const label = item.label.toLocaleLowerCase('zh-CN')
      const haystack = `${item.label} ${item.detail} ${item.keywords}`.toLocaleLowerCase('zh-CN')
      if (!terms.every((term) => haystack.includes(term))) return []
      const score = label === normalized ? 0 : label.startsWith(normalized) ? 1 : label.includes(normalized) ? 2 : 3
      return [{ item, score }]
    })
    .sort((left, right) => left.score - right.score || Number(left.item.kind === 'space') - Number(right.item.kind === 'space') || left.item.label.localeCompare(right.item.label, 'zh-CN'))
    .slice(0, Math.max(0, Math.trunc(limit)))
    .map(({ item }) => item)
}

export function workspaceNavigationPaths() {
  return new Set(workspaceNavGroups.flatMap(group => group.items.flatMap(item => [item.to, ...workspaceSpaceTargets(item).map(child => child.to)]).map(to => to.split(/[?#]/, 1)[0])))
}

/** A browsable map for people who do not yet know the command vocabulary.
 * Overview links stay in the group heading, so child features never repeat it. */
export function workspaceFeatureGroups(): WorkspaceFeatureGroup[] {
  return workspaceNavGroups.flatMap(group => group.items).map(space => ({
    space,
    features: workspaceSpaceTargets(space).filter(feature => feature.to !== space.to),
  }))
}

const workspaceContextTargets: Record<string, readonly string[]> = {
  '/today': ['/today#today-focus-timer', '/today#today-focus-ledger', '/today#today-anniversaries', '/quick'],
  '/knowledge': ['/documents?kind=note', '/documents?kind=question', '/words', '/relations', '/library'],
  '/create': ['/documents?kind=note&create=note', '/documents?kind=note&template=mindmap&mode=mindmap', '/documents?kind=note&template=diagram&mode=split', '/visual', '/evidence-ai'],
  '/review': ['/review', '/words', '/documents?kind=question', '/documents?kind=question&create=question', '/documents?kind=question&import=1'],
  '/': ['/tools?mode=smart-organizer', '/tools', '/media', '/ocr', '/developer-tools'],
}

/** High-frequency actions shown when the user right-clicks otherwise empty
 * workspace chrome. They remain references into the primary navigation model,
 * so the desktop menu cannot silently drift into a second feature catalog. */
export function workspaceContextActions(spaceTo: string) {
  const space = workspaceNavGroups.flatMap(group => group.items).find(item => item.to === spaceTo)
  if (!space) return []
  const children = new Map(workspaceSpaceTargets(space).map(action => [action.to, action]))
  return (workspaceContextTargets[spaceTo] ?? []).flatMap(target => children.get(target) ?? [])
}

/** Keeps the blank-workspace menu fast to scan while still making every
 * implemented feature in the current space reachable without opening a
 * separate feature browser. The overview itself is already the current page. */
export function workspaceContextActionGroups(spaceTo: string): WorkspaceContextActionGroups {
  const space = workspaceNavGroups.flatMap(group => group.items).find(item => item.to === spaceTo)
  if (!space) return { primary: [], more: [] }
  const primary = workspaceContextActions(spaceTo).filter(action => action.to !== space.to)
  const primaryTargets = new Set(primary.map(action => action.to))
  return {
    primary,
    more: workspaceSpaceTargets(space).filter(action => action.to !== space.to && !primaryTargets.has(action.to)),
  }
}

/** Maps each route to the primary spaces that own it. A route may appear in
 * several workflows, but feature pages must never become unowned islands. */
export function workspaceRouteOwners() {
  const owners = new Map<string, string[]>()
  for (const item of workspaceNavGroups.flatMap(group => group.items)) {
    for (const target of [item.to, ...item.children.map(child => child.to)]) {
      const path = target.split(/[?#]/, 1)[0]
      const routeOwners = owners.get(path) ?? []
      if (!routeOwners.includes(item.to)) routeOwners.push(item.to)
      owners.set(path, routeOwners)
    }
  }
  return owners
}

export function workspaceDiscoverablePaths() {
  return new Set([...workspaceNavigationPaths(), ...workspaceCommandCatalog().map(item => item.to.split(/[?#]/, 1)[0])])
}
