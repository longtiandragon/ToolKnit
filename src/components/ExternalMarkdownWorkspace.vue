<script setup lang="ts">
import { computed, defineAsyncComponent, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { open } from '@tauri-apps/plugin-dialog'
import AppIcon from '@/components/AppIcon.vue'
import { clampMenuPosition, isContextMenuShortcut, nextMenuItemIndex } from '@/lib/desktop-menu'
import { externalWorkspaceContentSearchReady, externalWorkspaceMoveTargetAllowed, externalWorkspacePathKey, externalWorkspaceRefreshTargets, externalWorkspaceSearchOpenTarget, externalWorkspaceSearchReady } from '@/lib/external-workspace'
import { fixedRowVirtualWindow } from '@/lib/virtual-window'
import { useUiStore } from '@/stores/ui'
import {
  createExternalMarkdownEntry,
  duplicateExternalMarkdownEntry,
  isDesktop,
  listenDesktopEvent,
  listExternalMarkdownDirectory,
  moveExternalMarkdownEntry,
  renameExternalMarkdownEntry,
  revealDesktopFile,
  searchExternalMarkdownContent,
  searchExternalMarkdownWorkspace,
  trashExternalMarkdownEntry,
  unwatchDesktopExternalMarkdownWorkspace,
  watchDesktopExternalMarkdownWorkspace,
  type ExternalMarkdownDirectory,
  type ExternalMarkdownDirectoryEntry,
  type ExternalMarkdownContentMatch,
  type ExternalMarkdownWorkspaceChange,
} from '@/lib/native'

type VisibleWorkspaceEntry = ExternalMarkdownDirectoryEntry & Partial<Pick<ExternalMarkdownContentMatch, 'line' | 'preview'>> & { depth: number; matchQuery?: string }
type WorkspaceEntryDialogState = {
  mode: 'create-markdown' | 'create-directory' | 'rename-markdown' | 'rename-directory'
  parentRelativePath: string
  entry?: VisibleWorkspaceEntry
}
type WorkspaceWatchMode = 'starting' | 'native' | 'manual'
type WorkspaceSearchScope = 'name' | 'content'
type WorkspaceSearchEntry = ExternalMarkdownDirectoryEntry & Partial<Pick<ExternalMarkdownContentMatch, 'line' | 'preview'>>

const WorkspaceEntryDialog = defineAsyncComponent(() => import('@/components/WorkspaceEntryDialog.vue'))

const props = defineProps<{ root: string; activePath?: string; qa?: boolean }>()
const emit = defineEmits<{
  (event: 'update:root', root: string): void
  (event: 'open-file', path: string, line?: number, query?: string): void
  (event: 'entry-renamed', payload: { kind: ExternalMarkdownDirectoryEntry['kind']; oldPath: string; newPath: string; oldRelativePath: string; newRelativePath: string; newName: string }): void
  (event: 'entry-trashed', payload: { kind: ExternalMarkdownDirectoryEntry['kind']; path: string; relativePath: string; name: string }): void
}>()

const ui = useUiStore()

const directories = ref<Record<string, ExternalMarkdownDirectory>>({})
const expanded = ref(new Set<string>())
const loading = ref(new Set<string>())
const errors = ref<Record<string, string>>({})
const treeElement = ref<HTMLElement>()
const menuElement = ref<HTMLElement>()
const menu = ref<{ entry: VisibleWorkspaceEntry; x: number; y: number } | null>(null)
const rootMenuElement = ref<HTMLElement>()
const rootMenu = ref<{ x: number; y: number } | null>(null)
const cutEntry = ref<ExternalMarkdownDirectoryEntry>()
const entryDialog = ref<WorkspaceEntryDialogState | null>(null)
const entryDialogBusy = ref(false)
const entryDialogError = ref('')
const scrollTop = ref(0)
const viewportHeight = ref(360)
const workspaceWatchMode = ref<WorkspaceWatchMode>('manual')
const workspaceSyncing = ref(false)
const workspaceLastSyncedAt = ref('')
const searchInputElement = ref<HTMLInputElement>()
const searchQuery = ref('')
const searchScope = ref<WorkspaceSearchScope>('name')
const searchResults = ref<WorkspaceSearchEntry[]>([])
const searchPending = ref(false)
const searchError = ref('')
const searchScanned = ref(0)
const searchScannedBytes = ref(0)
const searchSkippedLarge = ref(0)
const searchTruncated = ref(false)
const ROW_HEIGHT = 30
const MAX_VISIBLE_TREE_ENTRIES = 10_000
let resizeObserver: ResizeObserver | undefined
let loadRevision = 0
let menuTrigger: HTMLElement | undefined
let rootMenuTrigger: HTMLElement | undefined
let workspaceWatchRevision = 0
let workspaceWatchRoot = ''
let workspaceWatchUnlisten: (() => void) | undefined
let workspaceWatchDebounceTimer: number | undefined
let workspaceWatchMutation = Promise.resolve()
let searchTimer: number | undefined
let searchRevision = 0
let contentSearchInFlight = false
let contentSearchQueued = false
const pendingWorkspaceRefreshes = new Set<string>()

const rootName = computed(() => props.root.split(/[\\/]/).filter(Boolean).at(-1) || props.root || '未选择资料夹')
const treeProjection = computed(() => {
  const result: VisibleWorkspaceEntry[] = []
  let limitReached = false
  const visit = (relativePath: string, depth: number) => {
    if (result.length >= MAX_VISIBLE_TREE_ENTRIES) { limitReached = true; return }
    const directory = directories.value[relativePath]
    if (!directory) return
    for (const entry of directory.entries) {
      if (result.length >= MAX_VISIBLE_TREE_ENTRIES) { limitReached = true; break }
      result.push({ ...entry, depth })
      if (entry.kind === 'directory' && expanded.value.has(entry.relativePath)) visit(entry.relativePath, depth + 1)
    }
  }
  visit('', 0)
  return { entries: result, limitReached }
})
const visibleEntries = computed<VisibleWorkspaceEntry[]>(() => treeProjection.value.entries)
const treeWindow = computed(() => fixedRowVirtualWindow(visibleEntries.value.length, scrollTop.value, viewportHeight.value, ROW_HEIGHT, 8))
const renderedEntries = computed(() => visibleEntries.value.slice(treeWindow.value.start, treeWindow.value.end))
const workspaceLoading = computed(() => loading.value.has(''))
const workspaceError = computed(() => errors.value[''])
const hasTruncatedDirectory = computed(() => Object.values(directories.value).some(directory => directory.truncated))
const workspaceWatchLabel = computed(() => workspaceSyncing.value
  ? '正在同步'
  : workspaceWatchMode.value === 'native'
    ? '实时同步'
    : workspaceWatchMode.value === 'starting'
      ? '连接中'
      : '手动同步')
const searchReady = computed(() => searchScope.value === 'content'
  ? externalWorkspaceContentSearchReady(searchQuery.value)
  : externalWorkspaceSearchReady(searchQuery.value))
const searchInputLabel = computed(() => searchScope.value === 'content' ? '搜索工作区 Markdown 正文' : '按名称快速打开工作区 Markdown')
const searchPlaceholder = computed(() => searchScope.value === 'content' ? '搜索 Markdown 正文…' : '快速打开 Markdown…')
const searchFooterLabel = computed(() => {
  if (!searchQuery.value.trim() || !searchReady.value) return '按需读取 · 变更只刷新已展开层级'
  if (searchScope.value === 'name') return `仅查文件名 · 已检查 ${searchScanned.value.toLocaleString('zh-CN')} 项`
  const mib = searchScannedBytes.value / (1024 * 1024)
  const bytes = mib >= .1 ? `${mib.toFixed(1)} MiB` : `${Math.max(0, Math.round(searchScannedBytes.value / 1024))} KiB`
  return `正文 · ${searchScanned.value.toLocaleString('zh-CN')} 个文件 / ${bytes}${searchSkippedLarge.value ? ` · 跳过 ${searchSkippedLarge.value} 个大文件` : ''}`
})

function readableError(error: unknown) {
  return error instanceof Error ? error.message : '资料夹暂时无法读取。'
}

function clearWorkspaceSearch() {
  searchRevision += 1
  if (searchTimer !== undefined) window.clearTimeout(searchTimer)
  searchTimer = undefined
  searchQuery.value = ''
  searchResults.value = []
  searchPending.value = false
  searchError.value = ''
  searchScanned.value = 0
  searchScannedBytes.value = 0
  searchSkippedLarge.value = 0
  searchTruncated.value = false
  void nextTick(() => searchInputElement.value?.focus({ preventScroll: true }))
}

async function runWorkspaceSearch(revision: number, root: string, query: string, scope: WorkspaceSearchScope) {
  searchTimer = undefined
  searchPending.value = true
  searchError.value = ''
  if (scope === 'content' && contentSearchInFlight) {
    contentSearchQueued = true
    return
  }
  if (scope === 'content') contentSearchInFlight = true
  try {
    if (scope === 'content') {
      const result = props.qa && import.meta.env.DEV
        ? (await import('@/lib/external-workspace-qa')).externalWorkspaceQaContentSearch(root, query, 40)
        : await searchExternalMarkdownContent(root, query, 40)
      if (revision !== searchRevision || root !== props.root || query !== searchQuery.value.trim() || scope !== searchScope.value) return
      searchResults.value = result.matches
      searchScanned.value = result.scanned
      searchScannedBytes.value = result.scannedBytes
      searchSkippedLarge.value = result.skippedLarge
      searchTruncated.value = result.truncated
    } else {
      const result = props.qa && import.meta.env.DEV
        ? (await import('@/lib/external-workspace-qa')).externalWorkspaceQaSearch(root, query, 40)
        : await searchExternalMarkdownWorkspace(root, query, 40)
      if (revision !== searchRevision || root !== props.root || query !== searchQuery.value.trim() || scope !== searchScope.value) return
      searchResults.value = result.entries
      searchScanned.value = result.scanned
      searchScannedBytes.value = 0
      searchSkippedLarge.value = 0
      searchTruncated.value = result.truncated
    }
  } catch (error) {
    if (revision !== searchRevision) return
    searchResults.value = []
    searchScanned.value = 0
    searchScannedBytes.value = 0
    searchSkippedLarge.value = 0
    searchTruncated.value = false
    searchError.value = readableError(error)
  } finally {
    if (scope === 'content') {
      contentSearchInFlight = false
      if (contentSearchQueued) {
        contentSearchQueued = false
        if (props.root && searchScope.value === 'content' && searchReady.value) scheduleWorkspaceSearch()
        return
      }
    }
    if (revision === searchRevision) searchPending.value = false
  }
}

function scheduleWorkspaceSearch() {
  const revision = ++searchRevision
  if (searchTimer !== undefined) window.clearTimeout(searchTimer)
  searchTimer = undefined
  searchResults.value = []
  searchError.value = ''
  searchScanned.value = 0
  searchScannedBytes.value = 0
  searchSkippedLarge.value = 0
  searchTruncated.value = false
  const query = searchQuery.value.trim()
  if (!props.root || !searchReady.value) {
    searchPending.value = false
    return
  }
  searchPending.value = true
  const scope = searchScope.value
  searchTimer = window.setTimeout(() => void runWorkspaceSearch(revision, props.root, query, scope), scope === 'content' ? 320 : 220)
}

function setSearchScope(scope: WorkspaceSearchScope) {
  if (searchScope.value === scope) return
  searchScope.value = scope
  scheduleWorkspaceSearch()
  void nextTick(() => searchInputElement.value?.focus({ preventScroll: true }))
}

function searchableEntry(entry: WorkspaceSearchEntry): VisibleWorkspaceEntry {
  return { ...entry, depth: Math.max(0, entry.relativePath.split('/').length - 1), ...(entry.line ? { matchQuery: searchQuery.value.trim() } : {}) }
}

function focusSearchResult(index: number) {
  const rows = [...document.querySelectorAll<HTMLButtonElement>('[data-workspace-search-row]')]
  rows[Math.max(0, Math.min(index, rows.length - 1))]?.focus({ preventScroll: true })
}

function handleSearchInputKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape' && searchQuery.value) { event.preventDefault(); clearWorkspaceSearch(); return }
  if (event.key === 'ArrowDown' && searchResults.value.length) { event.preventDefault(); focusSearchResult(0) }
}

function handleSearchResultKeydown(event: KeyboardEvent, index: number, entry: WorkspaceSearchEntry) {
  if (isContextMenuShortcut(event)) { openMenuFromKeyboard(event, searchableEntry(entry)); return }
  if (event.key === 'Escape') { event.preventDefault(); searchInputElement.value?.focus({ preventScroll: true }); return }
  if (event.key === 'ArrowDown') { event.preventDefault(); focusSearchResult(index + 1); return }
  if (event.key === 'ArrowUp') { event.preventDefault(); index === 0 ? searchInputElement.value?.focus({ preventScroll: true }) : focusSearchResult(index - 1); return }
  if (event.key === 'Home') { event.preventDefault(); focusSearchResult(0); return }
  if (event.key === 'End') { event.preventDefault(); focusSearchResult(searchResults.value.length - 1) }
}

function replaceSet(source: Set<string>, value: string, add: boolean) {
  const next = new Set(source)
  if (add) next.add(value)
  else next.delete(value)
  return next
}

async function loadDirectory(relativePath: string, revision = loadRevision) {
  if (!props.root || (!isDesktop() && !props.qa)) return
  loading.value = replaceSet(loading.value, relativePath, true)
  const nextErrors = { ...errors.value }
  delete nextErrors[relativePath]
  errors.value = nextErrors
  try {
    let directory: ExternalMarkdownDirectory
    if (props.qa && import.meta.env.DEV) {
      const { externalWorkspaceQaDirectory } = await import('@/lib/external-workspace-qa')
      directory = externalWorkspaceQaDirectory(props.root, relativePath)
    } else {
      directory = await listExternalMarkdownDirectory(props.root, relativePath)
    }
    if (revision !== loadRevision) return
    directories.value = { ...directories.value, [relativePath]: directory }
  } catch (error) {
    if (revision !== loadRevision) return
    errors.value = { ...errors.value, [relativePath]: readableError(error) }
  } finally {
    if (revision === loadRevision) loading.value = replaceSet(loading.value, relativePath, false)
  }
}

function pruneDisconnectedDirectoryCache() {
  if (!directories.value['']) return
  const reachable = new Set([''])
  const queue = ['']
  while (queue.length) {
    const current = queue.shift()!
    for (const entry of directories.value[current]?.entries ?? []) {
      if (entry.kind !== 'directory' || !directories.value[entry.relativePath] || reachable.has(entry.relativePath)) continue
      reachable.add(entry.relativePath)
      queue.push(entry.relativePath)
    }
  }
  const next = Object.fromEntries(Object.entries(directories.value).filter(([path]) => reachable.has(path)))
  if (Object.keys(next).length !== Object.keys(directories.value).length) directories.value = next
  expanded.value = new Set([...expanded.value].filter(path => reachable.has(path)))
}

async function refreshLoadedDirectories(paths: string[], announce = false) {
  const unique = [...new Set(paths)].filter(path => path === '' || directories.value[path])
  if (!unique.length) return
  workspaceSyncing.value = true
  const revision = loadRevision
  try {
    for (let index = 0; index < unique.length; index += 8) {
      await Promise.all(unique.slice(index, index + 8).map(path => loadDirectory(path, revision)))
      if (revision !== loadRevision) return
    }
    pruneDisconnectedDirectoryCache()
    workspaceLastSyncedAt.value = new Date().toISOString()
    if (announce) ui.toast('Markdown 工作区已同步', `${unique.length} 个已展开层级已重新读取；正文没有被扫描。`, 'success')
  } finally {
    if (revision === loadRevision) workspaceSyncing.value = false
  }
}

function flushWorkspaceRefreshes() {
  workspaceWatchDebounceTimer = undefined
  const targets = [...pendingWorkspaceRefreshes]
  pendingWorkspaceRefreshes.clear()
  void refreshLoadedDirectories(targets)
}

function scheduleWorkspaceRefresh(change: ExternalMarkdownWorkspaceChange) {
  if (externalWorkspacePathKey(change.root) !== externalWorkspacePathKey(props.root)) return
  const targets = externalWorkspaceRefreshTargets(change.relativePaths, Object.keys(directories.value), change.overflow)
  targets.forEach(path => pendingWorkspaceRefreshes.add(path))
  if (!pendingWorkspaceRefreshes.size) return
  if (workspaceWatchDebounceTimer !== undefined) window.clearTimeout(workspaceWatchDebounceTimer)
  workspaceWatchDebounceTimer = window.setTimeout(flushWorkspaceRefreshes, 180)
  if (searchReady.value) scheduleWorkspaceSearch()
}

async function stopWorkspaceWatcher() {
  if (workspaceWatchDebounceTimer !== undefined) window.clearTimeout(workspaceWatchDebounceTimer)
  workspaceWatchDebounceTimer = undefined
  pendingWorkspaceRefreshes.clear()
  workspaceWatchUnlisten?.()
  workspaceWatchUnlisten = undefined
  const root = workspaceWatchRoot
  workspaceWatchRoot = ''
  if (root) await unwatchDesktopExternalMarkdownWorkspace(root).catch(() => undefined)
}

async function syncWorkspaceWatcher(root: string, revision: number) {
  await stopWorkspaceWatcher()
  if (revision !== workspaceWatchRevision || !root) return
  if (props.qa && import.meta.env.DEV) { workspaceWatchMode.value = 'native'; return }
  if (!isDesktop()) { workspaceWatchMode.value = 'manual'; return }
  workspaceWatchMode.value = 'starting'
  let unlisten: (() => void) | undefined
  try {
    unlisten = await listenDesktopEvent<ExternalMarkdownWorkspaceChange>('knitspace://external-markdown-workspace-change', scheduleWorkspaceRefresh)
    if (revision !== workspaceWatchRevision) { unlisten(); return }
    await watchDesktopExternalMarkdownWorkspace(root)
    if (revision !== workspaceWatchRevision) {
      unlisten()
      await unwatchDesktopExternalMarkdownWorkspace(root).catch(() => undefined)
      return
    }
    workspaceWatchRoot = root
    workspaceWatchUnlisten = unlisten
    workspaceWatchMode.value = 'native'
  } catch {
    unlisten?.()
    if (revision === workspaceWatchRevision) workspaceWatchMode.value = 'manual'
  }
}

function updateWorkspaceWatcher(root: string) {
  const revision = ++workspaceWatchRevision
  workspaceWatchMutation = workspaceWatchMutation.catch(() => undefined).then(() => syncWorkspaceWatcher(root, revision))
}

async function refreshWorkspace() {
  closeRootMenu()
  const loaded = Object.keys(directories.value)
  const targets = (loaded.length ? loaded : ['']).slice(0, 64)
  await refreshLoadedDirectories(targets, true)
  if (loaded.length > targets.length) ui.toast('大型工作区已分批同步', `本次重新读取前 64 个已展开层级；其余层级在再次展开时读取。`, 'info')
}

async function chooseWorkspace() {
  closeRootMenu()
  if (!isDesktop()) return
  const selected = await open({ title: '选择 Markdown 工作区', directory: true, multiple: false })
  if (typeof selected === 'string') emit('update:root', selected)
}

async function toggleDirectory(entry: VisibleWorkspaceEntry) {
  if (entry.kind !== 'directory') return
  if (expanded.value.has(entry.relativePath)) {
    expanded.value = replaceSet(expanded.value, entry.relativePath, false)
    return
  }
  expanded.value = replaceSet(expanded.value, entry.relativePath, true)
  if (!directories.value[entry.relativePath] || errors.value[entry.relativePath]) await loadDirectory(entry.relativePath)
}

function activate(entry: VisibleWorkspaceEntry) {
  if (entry.kind === 'directory') void toggleDirectory(entry)
  else {
    const target = externalWorkspaceSearchOpenTarget(entry, entry.matchQuery ?? '')
    emit('open-file', target.path, target.line, target.query)
  }
}

function closeMenu(restoreFocus = false) {
  menu.value = null
  if (restoreFocus) void nextTick(() => menuTrigger?.focus())
}

function closeRootMenu(restoreFocus = false) {
  rootMenu.value = null
  if (restoreFocus) void nextTick(() => rootMenuTrigger?.focus())
}

function openRootMenu(event: MouseEvent | KeyboardEvent) {
  closeMenu()
  rootMenuTrigger = event.currentTarget instanceof HTMLElement ? event.currentTarget : undefined
  const bounds = rootMenuTrigger?.getBoundingClientRect()
  const x = event instanceof MouseEvent ? event.clientX : (bounds?.right ?? 0) + 8
  const y = event instanceof MouseEvent ? event.clientY : (bounds?.top ?? 0) + 18
  rootMenu.value = { ...clampMenuPosition(x, y, { menuWidth: 244, menuHeight: 226, margin: 10 }) }
  void nextTick(() => rootMenuElement.value?.querySelector<HTMLElement>('[role="menuitem"]')?.focus())
}

function openRootMenuFromKeyboard(event: KeyboardEvent) {
  if (!isContextMenuShortcut(event)) return
  event.preventDefault()
  event.stopPropagation()
  openRootMenu(event)
}

function handleRootMenuKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') { event.preventDefault(); closeRootMenu(true); return }
  const items = [...(rootMenuElement.value?.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled)') ?? [])]
  const activeIndex = items.findIndex(item => item === document.activeElement)
  const next = nextMenuItemIndex(event.key, activeIndex, items.length)
  if (next === undefined) return
  event.preventDefault()
  items[next]?.focus()
}

async function revealWorkspaceRoot() {
  closeRootMenu()
  await revealDesktopFile(props.root)
}

function parentRelativePath(entry: Pick<ExternalMarkdownDirectoryEntry, 'relativePath'>) {
  return entry.relativePath.split('/').slice(0, -1).join('/')
}

function isCutEntry(entry: Pick<ExternalMarkdownDirectoryEntry, 'relativePath'>) {
  return cutEntry.value?.relativePath === entry.relativePath
}

function canMoveCutTo(targetParentRelativePath = '') {
  const staged = cutEntry.value
  return Boolean(staged && externalWorkspaceMoveTargetAllowed(staged.relativePath, staged.kind, targetParentRelativePath))
}

function stageMove(entry: ExternalMarkdownDirectoryEntry) {
  cutEntry.value = { ...entry }
  closeMenu()
  ui.toast(`已剪切 ${entry.name}`, '右键目标资料夹并选择“移动到此处”，也可以移到工作区根目录。', 'info')
}

function cancelMove() {
  cutEntry.value = undefined
  closeMenu()
}

async function moveCutEntry(targetParentRelativePath = '') {
  const staged = cutEntry.value
  if (!staged || !canMoveCutTo(targetParentRelativePath)) return
  closeMenu()
  try {
    const moved = await moveExternalMarkdownEntry(props.root, staged.relativePath, targetParentRelativePath)
    const sourceParent = parentRelativePath(staged)
    if (staged.kind === 'directory') discardCachedDirectoryTree(staged.relativePath)
    await Promise.all([...new Set([sourceParent, targetParentRelativePath])].map(path => loadDirectory(path)))
    emit('entry-renamed', {
      kind: staged.kind,
      oldPath: staged.path,
      newPath: moved.path,
      oldRelativePath: staged.relativePath,
      newRelativePath: moved.relativePath,
      newName: moved.name,
    })
    cutEntry.value = undefined
    ui.toast(`已移动 ${moved.name}`, targetParentRelativePath || rootName.value, 'success')
  } catch (error) {
    ui.toast('无法移动工作区项目', `${readableError(error)}；剪切状态已保留，可以选择其他资料夹。`, 'error')
  }
}

function openCreateDialog(kind: 'markdown' | 'directory', parent = '') {
  closeMenu()
  closeRootMenu()
  entryDialogError.value = ''
  entryDialog.value = { mode: kind === 'markdown' ? 'create-markdown' : 'create-directory', parentRelativePath: parent }
}

function openRenameDialog(entry: VisibleWorkspaceEntry) {
  closeMenu()
  entryDialogError.value = ''
  entryDialog.value = { mode: entry.kind === 'markdown' ? 'rename-markdown' : 'rename-directory', parentRelativePath: parentRelativePath(entry), entry }
}

function closeEntryDialog() {
  if (entryDialogBusy.value) return
  entryDialog.value = null
  entryDialogError.value = ''
}

function discardCachedDirectoryTree(relativePath: string) {
  const nextDirectories = { ...directories.value }
  for (const key of Object.keys(nextDirectories)) {
    if (key === relativePath || key.startsWith(`${relativePath}/`)) delete nextDirectories[key]
  }
  directories.value = nextDirectories
  expanded.value = new Set([...expanded.value].filter(path => path !== relativePath && !path.startsWith(`${relativePath}/`)))
}

async function submitEntryDialog(name: string) {
  const dialog = entryDialog.value
  if (!dialog || entryDialogBusy.value) return
  entryDialogBusy.value = true
  entryDialogError.value = ''
  try {
    if (dialog.mode.startsWith('create')) {
      const kind = dialog.mode === 'create-markdown' ? 'markdown' : 'directory'
      const created = await createExternalMarkdownEntry(props.root, dialog.parentRelativePath, name, kind)
      if (dialog.parentRelativePath) expanded.value = replaceSet(expanded.value, dialog.parentRelativePath, true)
      await loadDirectory(dialog.parentRelativePath)
      entryDialog.value = null
      ui.toast(kind === 'markdown' ? `已新建 ${created.name}` : `已新建资料夹 ${created.name}`, dialog.parentRelativePath || rootName.value, 'success')
      if (kind === 'markdown') emit('open-file', created.path)
      return
    }
    const entry = dialog.entry
    if (!entry) return
    const renamed = await renameExternalMarkdownEntry(props.root, entry.relativePath, name)
    if (isCutEntry(entry)) cutEntry.value = undefined
    if (entry.kind === 'directory') discardCachedDirectoryTree(entry.relativePath)
    await loadDirectory(dialog.parentRelativePath)
    entryDialog.value = null
    emit('entry-renamed', {
      kind: entry.kind,
      oldPath: entry.path,
      newPath: renamed.path,
      oldRelativePath: entry.relativePath,
      newRelativePath: renamed.relativePath,
      newName: renamed.name,
    })
    ui.toast(`已重命名为 ${renamed.name}`, dialog.parentRelativePath || rootName.value, 'success')
  } catch (error) {
    entryDialogError.value = readableError(error)
  } finally {
    entryDialogBusy.value = false
  }
}

function openMenu(event: MouseEvent | KeyboardEvent, entry: VisibleWorkspaceEntry) {
  closeRootMenu()
  menuTrigger = event.currentTarget instanceof HTMLElement ? event.currentTarget : undefined
  const fallback = menuTrigger?.getBoundingClientRect()
  const x = event instanceof MouseEvent ? event.clientX : (fallback?.left ?? 0) + 18
  const y = event instanceof MouseEvent ? event.clientY : (fallback?.top ?? 0) + 18
  menu.value = { entry, ...clampMenuPosition(x, y, { menuWidth: 244, menuHeight: 356, margin: 10 }) }
  void nextTick(() => menuElement.value?.querySelector<HTMLElement>('[role="menuitem"]')?.focus())
}

function openMenuFromKeyboard(event: KeyboardEvent, entry: VisibleWorkspaceEntry) {
  if (!isContextMenuShortcut(event)) return
  event.preventDefault()
  event.stopPropagation()
  openMenu(event, entry)
}

function handleMenuKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') { event.preventDefault(); closeMenu(true); return }
  const items = [...(menuElement.value?.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled)') ?? [])]
  const activeIndex = items.findIndex(item => item === document.activeElement)
  const next = nextMenuItemIndex(event.key, activeIndex, items.length)
  if (next === undefined) return
  event.preventDefault()
  items[next]?.focus()
}

async function refreshEntry(entry: VisibleWorkspaceEntry) {
  closeMenu()
  const relativePath = entry.kind === 'directory'
    ? entry.relativePath
    : entry.relativePath.split('/').slice(0, -1).join('/')
  await loadDirectory(relativePath)
}

async function revealEntry(entry: VisibleWorkspaceEntry) {
  closeMenu()
  await revealDesktopFile(entry.path)
}

async function copyEntryPath(entry: VisibleWorkspaceEntry) {
  await window.navigator.clipboard.writeText(entry.path)
  closeMenu()
}

async function duplicateEntry(entry: VisibleWorkspaceEntry) {
  closeMenu()
  try {
    const duplicate = await duplicateExternalMarkdownEntry(props.root, entry.relativePath)
    await loadDirectory(parentRelativePath(entry))
    ui.toast(`已创建 ${duplicate.name}`, '副本保留原始 Markdown 正文和扩展名。', 'success', '打开副本', () => emit('open-file', duplicate.path))
  } catch (error) {
    ui.toast('无法复制 Markdown', readableError(error), 'error')
  }
}

async function trashEntry(entry: VisibleWorkspaceEntry) {
  closeMenu()
  const approved = await ui.confirm({
    title: `将“${entry.name}”移入回收站？`,
    message: entry.kind === 'directory'
      ? '资料夹及其中内容会一起进入 Windows 回收站。已关联的文档仍保留在 Knitspace Vault 中，但恢复资料夹前不会再与磁盘同步；若当前磁盘无法回收，Windows 会再次警告。'
      : '文件会进入 Windows 回收站。已关联的文档仍保留在 Knitspace Vault 中，但恢复文件前不会再与磁盘同步；若当前磁盘无法回收，Windows 会再次警告。',
    confirmLabel: '移入回收站',
    danger: true,
  })
  if (!approved) return
  try {
    await trashExternalMarkdownEntry(props.root, entry.relativePath)
    if (isCutEntry(entry)) cutEntry.value = undefined
    if (entry.kind === 'directory') discardCachedDirectoryTree(entry.relativePath)
    await loadDirectory(parentRelativePath(entry))
    emit('entry-trashed', { kind: entry.kind, path: entry.path, relativePath: entry.relativePath, name: entry.name })
    ui.toast(`已移入回收站：${entry.name}`, '可在 Windows 回收站中恢复。', 'success')
  } catch (error) {
    ui.toast('无法移入回收站', readableError(error), 'error')
  }
}

function closeMenuFromWindow() {
  closeMenu()
  closeRootMenu()
}

function focusEntry(index: number) {
  const targetIndex = Math.max(0, Math.min(visibleEntries.value.length - 1, index))
  treeElement.value?.scrollTo({ top: Math.max(0, targetIndex * ROW_HEIGHT - viewportHeight.value * .36), behavior: 'auto' })
  void nextTick(() => {
    const targetPath = visibleEntries.value[targetIndex]?.relativePath
    const rows = treeElement.value?.querySelectorAll<HTMLElement>('[data-workspace-row]') ?? []
    ;[...rows].find(row => row.dataset.workspacePath === targetPath)?.focus()
  })
}

function handleTreeKeydown(event: KeyboardEvent, entry: VisibleWorkspaceEntry) {
  if (isContextMenuShortcut(event)) { openMenuFromKeyboard(event, entry); return }
  const index = visibleEntries.value.findIndex(item => item.relativePath === entry.relativePath)
  if (event.key === 'ArrowDown') { event.preventDefault(); focusEntry(index + 1); return }
  if (event.key === 'ArrowUp') { event.preventDefault(); focusEntry(index - 1); return }
  if (event.key === 'Home') { event.preventDefault(); focusEntry(0); return }
  if (event.key === 'End') { event.preventDefault(); focusEntry(visibleEntries.value.length - 1); return }
  if (event.key === 'ArrowRight' && entry.kind === 'directory') {
    event.preventDefault()
    if (!expanded.value.has(entry.relativePath)) void toggleDirectory(entry)
    else focusEntry(index + 1)
    return
  }
  if (event.key === 'ArrowLeft') {
    event.preventDefault()
    if (entry.kind === 'directory' && expanded.value.has(entry.relativePath)) {
      void toggleDirectory(entry)
      return
    }
    const parent = entry.relativePath.split('/').slice(0, -1).join('/')
    const parentIndex = visibleEntries.value.findIndex(item => item.relativePath === parent)
    if (parentIndex >= 0) focusEntry(parentIndex)
    return
  }
  if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); activate(entry) }
}

function updateViewport() {
  viewportHeight.value = Math.max(1, treeElement.value?.clientHeight ?? 360)
}

watch(() => props.root, root => {
  loadRevision += 1
  directories.value = {}
  expanded.value = new Set()
  loading.value = new Set()
  errors.value = {}
  cutEntry.value = undefined
  rootMenu.value = null
  scrollTop.value = 0
  workspaceSyncing.value = false
  workspaceLastSyncedAt.value = ''
  searchRevision += 1
  if (searchTimer !== undefined) window.clearTimeout(searchTimer)
  searchTimer = undefined
  searchQuery.value = ''
  searchResults.value = []
  searchPending.value = false
  searchError.value = ''
  searchScanned.value = 0
  searchScannedBytes.value = 0
  searchSkippedLarge.value = 0
  searchTruncated.value = false
  contentSearchQueued = false
  workspaceWatchMode.value = root ? 'starting' : 'manual'
  updateWorkspaceWatcher(root)
  if (root) void loadDirectory('', loadRevision)
}, { immediate: true })
watch(searchQuery, scheduleWorkspaceSearch)

onMounted(() => {
  window.addEventListener('pointerdown', closeMenuFromWindow)
  void nextTick(() => {
    updateViewport()
    if (!treeElement.value) return
    resizeObserver = new ResizeObserver(updateViewport)
    resizeObserver.observe(treeElement.value)
  })
})
onBeforeUnmount(() => {
  window.removeEventListener('pointerdown', closeMenuFromWindow)
  resizeObserver?.disconnect()
  loadRevision += 1
  workspaceWatchRevision += 1
  searchRevision += 1
  if (searchTimer !== undefined) window.clearTimeout(searchTimer)
  void stopWorkspaceWatcher()
})
</script>

<template>
  <!-- The file tree lives in the 288px list column of /documents, so every
       decision here is about that width: one line per entry, depth carried by
       padding rather than nested boxes, and names that truncate instead of
       wrapping into a second row the virtualiser does not account for. -->
  <section class="stack flex-1 min-h-0 min-w-0" aria-label="外部 Markdown 工作区">
    <!-- Not configured. No folder has ever been chosen, so there is nothing to
         retry and nothing to refresh — only one thing to do. -->
    <div v-if="!root" class="stack items-center justify-center gap-2 flex-1 min-h-0 px-6 py-10 text-center">
      <span class="center w-11 h-11 shrink-0 rounded-md bg-accent-soft text-accent"><AppIcon name="folder" :size="22" /></span>
      <b class="text-[13px] font-semibold text-fg">打开你的 Markdown 资料夹</b>
      <p class="max-w-56 text-[12px] leading-relaxed text-fg-3">只读取你展开的层级；正文会在点开文件时才载入。</p>
      <button class="btn-primary btn-sm mt-1" @click="chooseWorkspace">选择资料夹</button>
    </div>

    <template v-else>
      <header
        class="row-between gap-2 shrink-0 px-2.5 h-10 border-b border-line transition-colors duration-120 focus-visible:bg-accent-soft"
        tabindex="0"
        role="group"
        aria-label="Markdown 工作区；右键或菜单键打开根目录操作"
        aria-haspopup="menu"
        :aria-expanded="Boolean(rootMenu)"
        @contextmenu.prevent.stop="openRootMenu"
        @keydown="openRootMenuFromKeyboard"
      >
        <span class="row gap-2 min-w-0">
          <AppIcon name="folder-open" :size="14" class="shrink-0 text-accent" />
          <b class="min-w-0 truncate text-[13px] font-semibold text-fg" :title="root">{{ rootName }}</b>
        </span>
        <span class="row gap-0.5 shrink-0">
          <button class="center w-7 h-7 rounded-sm text-fg-3 hover:bg-surface-2 hover:text-fg" title="在根目录新建 Markdown" aria-label="在根目录新建 Markdown" @click="openCreateDialog('markdown')"><AppIcon name="plus" :size="14" /></button>
          <button class="center w-7 h-7 rounded-sm text-fg-3 hover:bg-surface-2 hover:text-fg" title="在根目录新建资料夹" aria-label="在根目录新建资料夹" @click="openCreateDialog('directory')"><AppIcon name="folder" :size="14" /></button>
          <button class="btn-default btn-sm h-7 px-2" title="更换 Markdown 工作区" @click="chooseWorkspace">更换</button>
        </span>
      </header>

      <!-- Where the tree is reading from, and whether it is still in step with
           the disk. The dot is the state; the words say the same thing for
           anyone who cannot use the colour. -->
      <div class="row gap-1.5 shrink-0 px-2.5 h-8 border-b border-line">
        <span class="min-w-0 flex-1 truncate font-mono text-[11px] text-fg-3" :title="root">{{ root }}</span>
        <small
          class="row gap-1 shrink-0 text-[11px] font-medium"
          :class="workspaceWatchMode === 'native' ? 'text-success' : workspaceWatchMode === 'starting' ? 'text-warn' : 'text-fg-3'"
          :title="workspaceLastSyncedAt ? `最近同步：${new Date(workspaceLastSyncedAt).toLocaleTimeString('zh-CN')}` : workspaceWatchLabel"
        >
          <i class="w-1.5 h-1.5 shrink-0 rounded-full" :class="workspaceWatchMode === 'native' ? 'bg-success' : workspaceWatchMode === 'starting' ? 'bg-warn' : 'bg-line-strong'" aria-hidden="true"></i>{{ workspaceWatchLabel }}
        </small>
        <button class="center w-7 h-7 shrink-0 rounded-sm text-fg-3 hover:bg-surface-2 hover:text-fg disabled:opacity-45 disabled:cursor-wait" title="同步已展开的工作区层级" aria-label="同步已展开的工作区层级" :disabled="workspaceSyncing" @click="refreshWorkspace"><AppIcon name="refresh" :size="13" /></button>
      </div>

      <!-- Search, then what it is allowed to read. The scope sits under the
           field because it modifies the field, and the note on its right is
           the privacy promise: a name search never opens a file. -->
      <div class="stack gap-1.5 shrink-0 p-2 border-b border-line">
        <label class="row gap-2 h-8 px-2.5 rounded-sm bg-well border border-line transition-colors duration-120 focus-within:border-accent">
          <AppIcon name="search" :size="13" class="shrink-0 text-fg-3" />
          <input
            ref="searchInputElement"
            v-model="searchQuery"
            type="search"
            autocomplete="off"
            spellcheck="false"
            class="min-w-0 flex-1 appearance-none bg-transparent border-0 text-[12px] text-fg focus:outline-none [&::-webkit-search-cancel-button]:hidden"
            :aria-label="searchInputLabel"
            :placeholder="searchPlaceholder"
            @keydown="handleSearchInputKeydown"
          />
          <small v-if="searchPending" class="shrink-0 text-[11px] text-fg-3">查找中</small>
          <small v-else-if="searchQuery.trim() && searchReady" class="shrink-0 text-[11px] tabular-nums text-fg-3">{{ searchResults.length }} 项</small>
          <button v-if="searchQuery" type="button" class="center w-5 h-5 shrink-0 rounded-sm text-fg-3 hover:bg-surface-2 hover:text-fg" title="清除搜索" aria-label="清除工作区搜索" @click="clearWorkspaceSearch"><AppIcon name="close" :size="11" /></button>
          <kbd v-else class="kbd shrink-0">{{ searchScope === 'content' ? '正文' : '名称' }}</kbd>
        </label>
        <div class="row gap-2">
          <div class="row gap-0.5 shrink-0 p-0.5 rounded-sm bg-surface-2 border border-line" role="tablist" aria-label="工作区搜索范围">
            <button type="button" role="tab" class="center h-6 px-2.5 rounded-[4px] text-[11px] transition-colors duration-120" :class="searchScope === 'name' ? 'bg-surface text-accent font-medium' : 'text-fg-3 hover:text-fg'" :aria-selected="searchScope === 'name'" @click="setSearchScope('name')">名称</button>
            <button type="button" role="tab" class="center h-6 px-2.5 rounded-[4px] text-[11px] transition-colors duration-120" :class="searchScope === 'content' ? 'bg-surface text-accent font-medium' : 'text-fg-3 hover:text-fg'" :aria-selected="searchScope === 'content'" @click="setSearchScope('content')">正文</button>
          </div>
          <small class="min-w-0 flex-1 truncate text-right text-[11px] text-fg-3">{{ searchScope === 'content' ? '后台受限读取' : '不读取正文' }}</small>
        </div>
      </div>

      <!-- A staged move is a mode: it changes what right-clicking a folder
           does, so it stays on screen until it is used or cancelled. -->
      <div v-if="cutEntry" class="stack gap-1.5 shrink-0 p-2 border-b border-line bg-accent-soft" role="status" aria-live="polite">
        <div class="row gap-1.5 min-w-0">
          <AppIcon name="cut" :size="13" class="shrink-0 text-accent" />
          <small class="shrink-0 text-[11px] font-medium text-accent">待移动</small>
          <b class="min-w-0 flex-1 truncate text-[12px] font-medium text-fg" :title="cutEntry.relativePath">{{ cutEntry.name }}</b>
          <button class="center w-7 h-7 shrink-0 rounded-sm text-fg-3 hover:bg-surface-2 hover:text-fg" title="取消剪切" aria-label="取消剪切" @click="cancelMove"><AppIcon name="close" :size="13" /></button>
        </div>
        <button class="btn-default btn-sm w-full" :disabled="!canMoveCutTo('')" @click="moveCutEntry('')">{{ canMoveCutTo('') ? '移到根目录' : '已在根目录' }}</button>
      </div>

      <!-- One slot, eight states. Each says what is true of *this* state: too
           few characters, a failed read, a search still running, an empty
           result, an empty folder, a folder that will not open. -->
      <div v-if="searchQuery.trim() && !searchReady" class="stack items-center justify-center gap-2 flex-1 min-h-0 px-6 text-center" role="status">
        <AppIcon name="search" :size="18" class="shrink-0 text-fg-3" />
        <p class="text-[12px] leading-relaxed text-fg-3">{{ searchScope === 'content' ? '正文搜索请输入至少 2 个中文字符或 3 个其他字符。' : '中文可输入 1 个字；英文或数字再输入 1 个字符开始查找。' }}</p>
      </div>
      <div v-else-if="searchQuery.trim() && searchError" class="stack items-center justify-center gap-2 flex-1 min-h-0 px-6 text-center" role="alert">
        <span class="center w-11 h-11 shrink-0 rounded-md bg-danger-soft text-danger"><AppIcon name="warning" :size="20" /></span>
        <b class="text-[13px] font-medium text-danger">这次搜索没有完成</b>
        <p class="text-[12px] leading-relaxed text-fg-3">{{ searchError }}</p>
        <button class="btn-default btn-sm mt-1" @click="scheduleWorkspaceSearch">重试</button>
      </div>
      <div v-else-if="searchQuery.trim() && searchPending && !searchResults.length" class="stack items-center justify-center gap-2 flex-1 min-h-0 px-6 text-center" role="status">
        <AppIcon name="search" :size="18" class="shrink-0 text-fg-3" />
        <p class="text-[12px] leading-relaxed text-fg-3">{{ searchScope === 'content' ? '正在后台查找正文；单文件与累计读取量都有安全上限…' : '正在后台查找文件名；不会读取正文…' }}</p>
      </div>
      <nav v-else-if="searchQuery.trim() && searchResults.length" class="flex-1 min-h-0 overflow-y-auto" aria-label="工作区 Markdown 搜索结果">
        <button
          v-for="(entry, index) in searchResults"
          :key="entry.relativePath"
          v-memo="[entry.relativePath, entry.size, entry.line, entry.preview, activePath === entry.path]"
          data-workspace-search-row
          class="flex gap-2 w-full px-2.5 py-2 text-left border-l-2 transition-colors duration-120"
          :class="[
            activePath === entry.path ? 'border-l-accent bg-accent-soft' : 'border-l-transparent hover:bg-surface-2',
            searchScope === 'content' ? 'items-start' : 'items-center',
          ]"
          :title="`${entry.relativePath}${entry.line ? `，点击打开并定位到第 ${entry.line} 行` : ''}；右键查看更多操作`"
          aria-haspopup="menu"
          @click="activate(searchableEntry(entry))"
          @contextmenu.prevent.stop="openMenu($event, searchableEntry(entry))"
          @keydown="handleSearchResultKeydown($event, index, entry)"
        >
          <AppIcon name="file-text" :size="14" class="shrink-0 mt-0.5" :class="activePath === entry.path ? 'text-accent' : 'text-fg-3'" />
          <span class="stack gap-0.5 min-w-0 flex-1">
            <b class="truncate text-[12px] font-medium" :class="activePath === entry.path ? 'text-accent' : 'text-fg'">{{ entry.name }}</b>
            <small class="truncate text-[11px] text-fg-3">{{ entry.relativePath.split('/').slice(0, -1).join(' / ') || rootName }}<template v-if="entry.line"> · 第 {{ entry.line }} 行</template></small>
            <em v-if="entry.preview" class="mt-0.5 line-clamp-2 not-italic text-[12px] leading-snug text-fg-2">{{ entry.preview }}</em>
          </span>
          <i class="shrink-0 not-italic text-[11px] tabular-nums text-fg-3">{{ entry.line ? `L${entry.line}` : typeof entry.size === 'number' ? `${Math.max(1, Math.round(entry.size / 1024))} KB` : 'MD' }}</i>
        </button>
      </nav>
      <div v-else-if="searchQuery.trim()" class="stack items-center justify-center gap-2 flex-1 min-h-0 px-6 text-center">
        <AppIcon name="search" :size="18" class="shrink-0 text-fg-3" />
        <p class="text-[12px] leading-relaxed text-fg-3">{{ searchScope === 'content' ? '在安全读取范围内没有找到匹配正文。' : '没有匹配的 Markdown 文件。' }}</p>
        <button class="btn-default btn-sm mt-1" @click="clearWorkspaceSearch">返回文件树</button>
      </div>
      <div v-else-if="workspaceLoading && !directories['']" class="stack items-center justify-center gap-2 flex-1 min-h-0 px-6 text-center" role="status">
        <AppIcon name="refresh" :size="18" class="shrink-0 text-fg-3" />
        <p class="text-[12px] leading-relaxed text-fg-3">正在读取当前层级…</p>
      </div>
      <div v-else-if="workspaceError && !directories['']" class="stack items-center justify-center gap-2 flex-1 min-h-0 px-6 text-center" role="alert">
        <span class="center w-11 h-11 shrink-0 rounded-md bg-danger-soft text-danger"><AppIcon name="shield" :size="20" /></span>
        <b class="text-[13px] font-medium text-danger">读不到这个资料夹</b>
        <p class="text-[12px] leading-relaxed text-fg-2">{{ workspaceError }}</p>
        <p class="max-w-60 text-[11px] leading-relaxed text-fg-3">确认资料夹仍在原处、没有被移走或卸载，并且当前账户有读取权限；也可以在上方更换成别的资料夹。</p>
        <button class="btn-default btn-sm mt-1" @click="loadDirectory('')">重试</button>
      </div>
      <div v-else-if="!visibleEntries.length" class="stack items-center justify-center gap-2 flex-1 min-h-0 px-6 text-center">
        <span class="center w-11 h-11 shrink-0 rounded-md bg-surface-2 text-fg-3"><AppIcon name="folder-open" :size="20" /></span>
        <b class="text-[13px] font-medium text-fg">这个资料夹里还没有 Markdown</b>
        <p class="max-w-60 text-[12px] leading-relaxed text-fg-3">用上方的新建按钮建一份，或者把已有的 .md 文件放进这个资料夹再重新读取。</p>
        <button class="btn-default btn-sm mt-1" @click="loadDirectory('')">重新读取</button>
      </div>
      <div
        v-else
        id="external-workspace-tree"
        ref="treeElement"
        class="flex-1 min-h-0 overflow-auto [overflow-anchor:none] [scrollbar-gutter:stable]"
        role="tree"
        aria-label="Markdown 文件树"
        @scroll.passive="scrollTop = ($event.currentTarget as HTMLElement).scrollTop"
      >
        <div :style="{ height: `${treeWindow.before}px` }" aria-hidden="true" />
        <!-- Rows are exactly ROW_HEIGHT (30px) tall: the virtual window
             multiplies by that number, so h-7.5 here is load-bearing.
             Indentation is capped at eight levels — past that the step would
             cost more than the filename it is describing, and `aria-level`
             still carries the real depth. -->
        <button
          v-for="entry in renderedEntries"
          :key="entry.relativePath"
          v-memo="[entry.relativePath, entry.kind, entry.size, expanded.has(entry.relativePath), loading.has(entry.relativePath), errors[entry.relativePath], activePath === entry.path, cutEntry?.relativePath]"
          data-workspace-row
          :data-workspace-path="entry.relativePath"
          role="treeitem"
          :aria-level="entry.depth + 1"
          :aria-expanded="entry.kind === 'directory' ? expanded.has(entry.relativePath) : undefined"
          :aria-selected="entry.kind === 'markdown' && activePath === entry.path"
          class="row gap-1.5 w-full h-7.5 pr-2 text-left border-l-2 transition-colors duration-120 focus-visible:[outline-offset:-2px]"
          :class="activePath === entry.path ? 'border-l-accent bg-accent-soft' : 'border-l-transparent hover:bg-surface-2'"
          :style="{ paddingLeft: `${8 + Math.min(entry.depth, 8) * 12}px` }"
          :title="`${entry.relativePath}；右键查看更多操作`"
          aria-haspopup="menu"
          :aria-controls="entry.kind === 'directory' && expanded.has(entry.relativePath) ? 'external-workspace-tree' : undefined"
          @click="activate(entry)"
          @contextmenu.prevent.stop="openMenu($event, entry)"
          @keydown="handleTreeKeydown($event, entry)"
        >
          <i class="center w-3.5 shrink-0 text-fg-3 transition-transform duration-150" :class="[entry.kind === 'directory' ? '' : 'invisible', entry.kind === 'directory' && expanded.has(entry.relativePath) ? 'rotate-90' : '']"><AppIcon name="chevron" :size="12" /></i>
          <AppIcon
            :name="entry.kind === 'directory' && expanded.has(entry.relativePath) ? 'folder-open' : entry.kind === 'directory' ? 'folder' : 'file-text'"
            :size="14"
            class="shrink-0"
            :class="entry.kind === 'directory' ? 'text-warn' : activePath === entry.path ? 'text-accent' : 'text-fg-3'"
          />
          <!-- Weight is the folder/file signal that survives at 12px: folders
               are medium and full-strength ink, files are regular and one step
               back. `<b>` would otherwise inherit the UA's bold and flatten
               the two together. -->
          <b
            class="min-w-0 flex-1 truncate text-[12px]"
            :class="isCutEntry(entry)
              ? 'font-normal line-through text-fg-3'
              : activePath === entry.path
                ? 'font-medium text-accent'
                : entry.kind === 'directory'
                  ? 'font-medium text-fg'
                  : 'font-normal text-fg-2'"
          >{{ entry.name }}</b>
          <small v-if="isCutEntry(entry)" class="shrink-0 text-[11px] font-medium text-accent">待移动</small><small v-else-if="loading.has(entry.relativePath)" class="shrink-0 text-[11px] text-fg-3">读取中</small><small v-else-if="errors[entry.relativePath]" class="shrink-0 text-[11px] font-medium text-danger">重试</small>
        </button>
        <div :style="{ height: `${treeWindow.after}px` }" aria-hidden="true" />
      </div>

      <p v-if="hasTruncatedDirectory || treeProjection.limitReached" class="row gap-2 shrink-0 px-2.5 py-2 border-t border-line bg-warn-soft text-[11px] leading-relaxed text-fg-2" role="status">
        <AppIcon name="warning" :size="13" class="shrink-0 mt-0.5 text-warn" />
        <span>{{ treeProjection.limitReached ? '已展开的树超过 10,000 项，暂时停止继续渲染；折叠部分资料夹后可继续浏览。' : '当前层级规模过大，仅显示前 500 个 Markdown 或资料夹；可整理为子资料夹后继续浏览。' }}</span>
      </p>
      <p v-if="searchQuery.trim() && searchReady && searchTruncated" class="row gap-2 shrink-0 px-2.5 py-2 border-t border-line bg-warn-soft text-[11px] leading-relaxed text-fg-2" role="status">
        <AppIcon name="warning" :size="13" class="shrink-0 mt-0.5 text-warn" />
        <span>{{ searchScope === 'content' ? '正文搜索已达到文件数、读取量或结果上限；补充关键词可缩小范围。' : '结果已达到安全上限；继续补充资料夹或文件名可以缩小范围。' }}</span>
      </p>

      <footer class="row-between gap-1.5 shrink-0 pl-2.5 pr-1.5 h-9 border-t border-line">
        <span class="min-w-0 truncate text-[11px] text-fg-3" :title="searchFooterLabel">{{ searchFooterLabel }}</span>
        <button class="btn-ghost btn-sm shrink-0 px-1.5" @click="revealWorkspaceRoot">在资源管理器中查看</button>
      </footer>
    </template>

    <!-- Both menus are teleported: this panel scrolls and clips its own
         overflow, which would cut a fixed menu off at the column edge. -->
    <Teleport to="body">
      <div v-if="menu" ref="menuElement" class="menu-panel w-61" role="menu" :style="{ left: `${menu.x}px`, top: `${menu.y}px` }" @pointerdown.stop @click.stop @contextmenu.prevent @keydown.stop="handleMenuKeydown">
        <p class="menu-title">
          <span class="min-w-0 truncate">{{ menu.entry.name }}</span>
          <small class="shrink-0 font-normal">{{ menu.entry.kind === 'directory' ? '资料夹' : 'Markdown' }}</small>
        </p>
        <template v-if="cutEntry && menu.entry.kind === 'directory'">
          <button class="menu-item" :class="canMoveCutTo(menu.entry.relativePath) ? 'bg-accent-soft text-accent font-medium' : ''" role="menuitem" :disabled="!canMoveCutTo(menu.entry.relativePath)" @click="moveCutEntry(menu.entry.relativePath)">
            <span class="min-w-0 truncate">{{ canMoveCutTo(menu.entry.relativePath) ? `移动“${cutEntry.name}”到此处` : '不能移动到这个资料夹' }}</span>
          </button>
          <i class="menu-sep" aria-hidden="true" />
        </template>
        <button class="menu-item" role="menuitem" @click="activate(menu.entry); closeMenu()">
          <span class="min-w-0 truncate">{{ menu.entry.kind === 'directory' ? expanded.has(menu.entry.relativePath) ? '折叠资料夹' : '展开资料夹' : menu.entry.line ? `打开并定位到第 ${menu.entry.line} 行` : '在 Knitspace 中打开' }}</span>
        </button>
        <button v-if="menu.entry.kind === 'markdown'" class="menu-item" role="menuitem" @click="duplicateEntry(menu.entry)">创建 Markdown 副本</button>
        <button v-if="menu.entry.kind === 'directory'" class="menu-item" role="menuitem" @click="openCreateDialog('markdown', menu.entry.relativePath)">在此新建 Markdown</button>
        <button v-if="menu.entry.kind === 'directory'" class="menu-item" role="menuitem" @click="openCreateDialog('directory', menu.entry.relativePath)">新建子资料夹</button>
        <i class="menu-sep" aria-hidden="true" />
        <button class="menu-item" role="menuitem" @click="isCutEntry(menu.entry) ? cancelMove() : stageMove(menu.entry)">{{ isCutEntry(menu.entry) ? '取消剪切' : '剪切以移动' }}</button>
        <button class="menu-item" role="menuitem" @click="openRenameDialog(menu.entry)">重命名</button>
        <button class="menu-item" role="menuitem" @click="revealEntry(menu.entry)">在资源管理器中显示</button>
        <button class="menu-item" role="menuitem" @click="refreshEntry(menu.entry)">{{ menu.entry.kind === 'directory' ? '刷新此资料夹' : '刷新所在资料夹' }}</button>
        <button v-if="menu.entry.kind === 'markdown'" class="menu-item" role="menuitem" @click="copyEntryPath(menu.entry)">复制文件路径</button>
        <i class="menu-sep" aria-hidden="true" />
        <button class="menu-item menu-item-danger" role="menuitem" @click="trashEntry(menu.entry)">移入 Windows 回收站</button>
      </div>

      <div v-if="rootMenu" ref="rootMenuElement" class="menu-panel w-61" role="menu" aria-label="Markdown 工作区操作" :style="{ left: `${rootMenu.x}px`, top: `${rootMenu.y}px` }" @pointerdown.stop @click.stop @contextmenu.prevent @keydown.stop="handleRootMenuKeydown">
        <p class="menu-title">
          <span class="min-w-0 truncate">{{ rootName }}</span>
          <small class="shrink-0 font-normal">{{ workspaceWatchLabel }}</small>
        </p>
        <button class="menu-item" role="menuitem" :disabled="workspaceSyncing" @click="refreshWorkspace">立即同步已展开层级</button>
        <button class="menu-item" role="menuitem" @click="openCreateDialog('markdown')">在根目录新建 Markdown</button>
        <button class="menu-item" role="menuitem" @click="openCreateDialog('directory')">在根目录新建资料夹</button>
        <button class="menu-item" role="menuitem" @click="revealWorkspaceRoot">在资源管理器中查看</button>
        <i class="menu-sep" aria-hidden="true" />
        <button class="menu-item" role="menuitem" @click="chooseWorkspace">更换工作区…</button>
      </div>
    </Teleport>

    <WorkspaceEntryDialog v-if="entryDialog" :mode="entryDialog.mode" :initial-name="entryDialog.entry?.name" :parent-label="entryDialog.parentRelativePath || rootName" :busy="entryDialogBusy" :server-error="entryDialogError" @change="entryDialogError = ''" @cancel="closeEntryDialog" @submit="submitEntryDialog" />
  </section>
</template>
