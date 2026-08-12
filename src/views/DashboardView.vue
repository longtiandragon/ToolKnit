<script setup lang="ts">
import { computed, nextTick, onActivated, onBeforeUnmount, onMounted, ref, shallowRef } from 'vue'
import { useRouter } from 'vue-router'
import { readClipboardPayload } from '@/lib/clipboard'
import { clampMenuPosition, isContextMenuShortcut, nextMenuItemIndex } from '@/lib/desktop-menu'
import { listDesktopVisualProjects, localAssetUrl, revealDesktopFile, type DesktopVisualProjectSummary } from '@/lib/native'
import { useWorkbenchStore } from '@/stores/workbench'
import { useUiStore } from '@/stores/ui'
import { toolCatalog } from '@/lib/tool-catalog'
import { nextAvailableNoteTitle, noteStarterTemplates, noteTemplateContent, type NoteStarterTemplate } from '@/lib/note-template'
import { calculateLearningPulse } from '@/lib/learning-pulse'
import { latestBackupRecord } from '@/lib/backup-status'
import { favoriteContentIcons, favoriteContentLabels, favoriteContentRoute, resolveFavoriteContent } from '@/lib/content-favorites'
import type { StudyDocument } from '@/types'
import AppIcon from '@/components/AppIcon.vue'
import EmptyState from '@/components/EmptyState.vue'
import TodayFocus from '@/components/TodayFocus.vue'

type QuickActionId = 'capture' | 'note' | 'question' | 'markdown' | 'code' | 'pdf'
type QuickAction = {
  id: QuickActionId
  icon: string
  label: string
  to: string
  secondary: { label: string; to?: string; create?: 'note' | 'question' }
  catalogId?: string
}
type QuickActionMenuItem = { id: string; label: string; template?: NoteStarterTemplate }
type RecentDocumentMenu = { document: StudyDocument; x: number; y: number }

const router = useRouter()
const store = useWorkbenchStore()
const ui = useUiStore()
const pasting = ref(false)
const quickCaptureText = ref('')
const quickCaptureSaving = ref(false)
const dragging = ref('')
const dragTarget = ref('')
const contextTool = ref('')
const favoritePickerOpen = ref(false)
const favoriteQuery = ref('')
const favoriteGroup = ref('全部')
const quickActionMenu = ref<{ action: QuickAction; x: number; y: number } | null>(null)
const quickActionMenuElement = ref<HTMLElement>()
const recentDocumentMenu = ref<RecentDocumentMenu | null>(null)
const recentDocumentMenuElement = ref<HTMLElement>()
const visualProjects = shallowRef<DesktopVisualProjectSummary[]>([])
let favoriteMenuTrigger: HTMLElement | undefined
let quickActionMenuTrigger: HTMLElement | undefined
let recentDocumentMenuTrigger: HTMLElement | undefined
let visualProjectsPending = false

const catalogMap = new Map(toolCatalog.map(item => [item.id, item]))
const favoriteToolIds = computed(() => new Set(store.favorites.map((item) => item.toolId)))
const favorites = computed(() => store.favorites.slice().sort((a, b) => a.order - b.order).map(item => ({ ...item, tool: catalogMap.get(item.toolId) })).filter(item => item.tool))
const suggested = computed(() => toolCatalog.filter(item => item.popular && !favoriteToolIds.value.has(item.id)).slice(0, 4))
const favoriteGroups = computed(() => ['全部', ...new Set(toolCatalog.map(item => item.group))])
const favoriteCandidates = computed(() => {
  const query = favoriteQuery.value.trim().toLocaleLowerCase('zh-CN')
  return toolCatalog.filter((tool) => {
    if (favoriteGroup.value !== '全部' && tool.group !== favoriteGroup.value) return false
    if (!query) return true
    return [tool.title, tool.description, tool.group, ...tool.keywords].join(' ').toLocaleLowerCase('zh-CN').includes(query)
  })
})
const recentTools = computed(() => store.toolUsages.map(item => ({ usage: item, tool: catalogMap.get(item.toolId) })).filter(item => item.tool).slice(0, 5))
const recentJobs = computed(() => store.jobs.slice(0, 5))
const recentSources = computed(() => store.sources.slice().sort((a, b) => (b.lastOpenedAt || b.importedAt).localeCompare(a.lastOpenedAt || a.importedAt)).slice(0, 4))
const documentsById = computed(() => new Map(store.documents.map((document) => [document.id, document])))
const recentDocumentOpenedAt = computed(() => new Map(store.contentRecents
  .filter((item) => item.itemKind === 'note' || item.itemKind === 'question')
  .map((item) => [item.itemId, item.openedAt])))
const recentDocuments = computed(() => store.contentRecents
  .filter((item) => item.itemKind === 'note' || item.itemKind === 'question')
  .flatMap((recent) => {
    const document = documentsById.value.get(recent.itemId)
    return document?.kind === recent.itemKind ? [document] : []
  })
  .slice(0, 4))
const favoriteContent = computed(() => resolveFavoriteContent(store.contentFavorites, store.documents, store.vocabulary, store.sources, 6, visualProjects.value))
const recentOutputs = computed(() => store.jobs.filter(j => j.status === 'succeeded' && (j.outputs?.length || j.outputNames?.length)).slice(0, 4))
const activeJobs = computed(() => store.jobs.filter(j => j.status === 'running' || j.status === 'queued').length)
const completedToday = computed(() => {
  const today = new Date().toDateString()
  return store.jobs.filter(job => job.status === 'succeeded' && new Date(job.createdAt).toDateString() === today).length
})
const localItemCount = computed(() => store.sources.length + store.documents.length)
const noteCount = computed(() => store.documents.reduce((count, document) => count + (document.kind === 'note' ? 1 : 0), 0))
const learningPulse = computed(() => calculateLearningPulse(store.documents, store.vocabulary))
const latestBackup = computed(() => latestBackupRecord(store.settings))
const latestBackupLabel = computed(() => latestBackup.value?.kind === 'automatic'
  ? '每日归档'
  : latestBackup.value?.kind === 'manual'
    ? '手动备份'
    : '最近备份')

async function refreshVisualProjectSummaries() {
  if (visualProjectsPending) return
  visualProjectsPending = true
  try { visualProjects.value = await listDesktopVisualProjects(60) }
  catch { visualProjects.value = [] }
  finally { visualProjectsPending = false }
}

const quickActions: QuickAction[] = [
  { id: 'capture', icon: 'inbox', label: '收集一条内容', to: '/quick', secondary: { label: '查看收集与归档', to: '/library' }, catalogId: 'universal-intake' },
  { id: 'note', icon: 'book', label: '新建笔记', to: '/documents?kind=note&create=note', secondary: { label: '浏览已有笔记', to: '/documents?kind=note' } },
  { id: 'question', icon: 'review', label: '记录错题', to: '/documents?kind=question&create=question', secondary: { label: '浏览错题与题目', to: '/documents?kind=question' } },
  { id: 'markdown', icon: 'book', label: '打开 Markdown', to: '/documents?kind=note', secondary: { label: '新建笔记', create: 'note' } },
  { id: 'code', icon: 'terminal', label: '制作代码长图', to: '/code-image', secondary: { label: '查看最近处理任务', to: '/history' }, catalogId: 'code-image' },
  { id: 'pdf', icon: 'toolbox', label: '文件处理中心', to: '/tools', secondary: { label: '浏览全部工具', to: '/tool-space' } },
]

const quickActionMenuItems = computed<QuickActionMenuItem[]>(() => {
  const action = quickActionMenu.value?.action
  if (!action) return []
  return quickActionMenuItemsFor(action)
})

function createQuickDocument(kind: 'note' | 'question') {
  if (kind === 'note') {
    const doc = store.createNote()
    router.push({ path: '/documents', query: { kind: 'note', document: doc.id, mode: 'edit' } })
  } else {
    const doc = store.createQuestion()
    router.push({ path: '/documents', query: { kind: 'question', document: doc.id, mode: 'edit' } })
  }
}

function createQuickTemplateNote(template: NoteStarterTemplate) {
  const title = nextAvailableNoteTitle(template.title, store.documents.map((document) => document.title))
  const document = store.createNote(title, undefined, noteTemplateContent(template, title))
  const next = { ...document, subject: template.subject, tags: [...template.tags] }
  store.saveDocument(next)
  store.addActivity('system', '从今天页创建模板笔记', title, '/documents', next.id)
  router.push({ path: '/documents', query: { kind: 'note', document: next.id, mode: 'edit' } })
  ui.toast('已创建“' + title + '”', '这是普通本地 Markdown，可随时调整结构。', 'success')
}

function openQuick(action: QuickAction) {
  if (action.id === 'note') createQuickDocument('note')
  else if (action.id === 'question') createQuickDocument('question')
  else router.push(action.to)
}

function openQuickSecondary(action: QuickAction) {
  if (action.secondary.create) createQuickDocument(action.secondary.create)
  else if (action.secondary.to) router.push(action.secondary.to)
}

function quickCaptureTitle(value: string) {
  const firstLine = value.split(/\r?\n/).find((line) => line.trim())?.trim().replace(/^#+\s*/, '') ?? ''
  if (!firstLine) return '快速记录'
  return firstLine.length > 42 ? `${firstLine.slice(0, 42)}…` : firstLine
}

function captureQuickThought() {
  const value = quickCaptureText.value.trim()
  if (!value || quickCaptureSaving.value) return
  quickCaptureSaving.value = true
  try {
    const title = quickCaptureTitle(value)
    const captureBody = value.replace(/^#+\s*/, '')
    const note = store.createNote(title, '收集箱', `# ${title}\n\n> ${captureBody}\n`)
    store.addActivity('system', '快速记录已收进收集箱', title, '/documents', note.id)
    quickCaptureText.value = ''
    ui.toast('已收进收集箱', '内容已作为本地 Markdown 笔记保存。', 'success')
  } finally {
    quickCaptureSaving.value = false
  }
}

function quickActionMenuItemsFor(action: QuickAction): QuickActionMenuItem[] {
  const items: QuickActionMenuItem[] = [
    { id: 'execute', label: action.label },
    { id: 'secondary', label: action.secondary.label },
  ]
  if (action.catalogId) items.push({ id: 'favorite', label: store.favorites.some((favorite) => favorite.toolId === action.catalogId) ? '移出常用工具' : '加入常用工具' })
  if (action.id === 'note' || action.id === 'markdown') {
    for (const template of noteStarterTemplates) {
      items.push({ id: 'template-' + template.id, label: template.label, template })
    }
  }
  return items
}

function supportsNoteStarterTemplates(action: QuickAction) {
  return action.id === 'note' || action.id === 'markdown'
}

function quickActionMenuHeight(items: QuickActionMenuItem[]) {
  return 54 + items.reduce((total, item) => total + (item.template ? 63 : 37), 0)
}

function closeQuickActionMenu(restoreFocus = false) {
  quickActionMenu.value = null
  if (restoreFocus) void nextTick(() => quickActionMenuTrigger?.focus({ preventScroll: true }))
}

function openQuickActionMenu(action: QuickAction, x: number, y: number, trigger: HTMLElement) {
  quickActionMenuTrigger = trigger
  const items = quickActionMenuItemsFor(action)
  const menuWidth = supportsNoteStarterTemplates(action) ? 306 : 226
  quickActionMenu.value = { action, ...clampMenuPosition(x, y, { menuWidth, menuHeight: quickActionMenuHeight(items), margin: 12 }) }
  void nextTick(() => quickActionMenuElement.value?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus())
}

function openQuickActionMenuFromPointer(event: MouseEvent, action: QuickAction) {
  openQuickActionMenu(action, event.clientX, event.clientY, event.currentTarget as HTMLElement)
}

function openQuickActionMenuFromKeyboard(event: KeyboardEvent, action: QuickAction) {
  if (!isContextMenuShortcut(event)) return
  event.preventDefault()
  const trigger = event.currentTarget as HTMLElement
  const bounds = trigger.getBoundingClientRect()
  openQuickActionMenu(action, bounds.left + 22, bounds.top + 30, trigger)
}

function handleQuickActionMenuKeydown(event: KeyboardEvent) {
  const items = [...(quickActionMenuElement.value?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [])]
  if (event.key === 'Escape') {
    event.preventDefault()
    closeQuickActionMenu(true)
    return
  }
  const nextIndex = nextMenuItemIndex(event.key, items.indexOf(document.activeElement as HTMLButtonElement), items.length)
  if (nextIndex === undefined) return
  event.preventDefault()
  items[nextIndex]?.focus()
}

function closeRecentDocumentMenu(restoreFocus = false) {
  recentDocumentMenu.value = null
  if (restoreFocus) void nextTick(() => recentDocumentMenuTrigger?.focus({ preventScroll: true }))
}

function openRecentDocument(document: StudyDocument, mode: 'preview' | 'edit' = 'preview') {
  closeRecentDocumentMenu()
  router.push({ path: '/documents', query: { kind: document.kind, document: document.id, mode } })
}

function openRecentDocumentKind(document: StudyDocument) {
  closeRecentDocumentMenu()
  router.push({ path: '/documents', query: { kind: document.kind } })
}

function openRecentDocumentMenu(document: StudyDocument, x: number, y: number, trigger: HTMLElement) {
  recentDocumentMenuTrigger = trigger
  recentDocumentMenu.value = {
    document,
    // Header plus six desktop actions needs its full height reserved before
    // placement, otherwise a menu opened near the bottom can be clipped.
    ...clampMenuPosition(x, y, { menuWidth: 244, menuHeight: 292, margin: 12 }),
  }
  void nextTick(() => recentDocumentMenuElement.value?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus())
}

function openRecentDocumentMenuFromPointer(event: MouseEvent, document: StudyDocument) {
  openRecentDocumentMenu(document, event.clientX, event.clientY, event.currentTarget as HTMLElement)
}

function openRecentDocumentMenuFromKeyboard(event: KeyboardEvent, document: StudyDocument) {
  if (!isContextMenuShortcut(event)) return
  event.preventDefault()
  event.stopPropagation()
  const trigger = event.currentTarget as HTMLElement
  const bounds = trigger.getBoundingClientRect()
  openRecentDocumentMenu(document, bounds.right - 24, bounds.bottom - 12, trigger)
}

async function copyRecentDocumentWikiLink(document: StudyDocument) {
  try {
    await navigator.clipboard.writeText(`[[${document.title}]]`)
    ui.toast('双链已复制', `可直接粘贴为 [[${document.title}]]。`, 'success')
  } catch (error) {
    ui.toast('无法写入剪贴板', error instanceof Error ? error.message : '请检查系统剪贴板权限。', 'error')
  } finally {
    closeRecentDocumentMenu()
  }
}

async function toggleRecentDocumentFavorite(document: StudyDocument) {
  try {
    const favorite = await store.toggleContentFavorite(document.kind, document.id)
    ui.toast(favorite ? '已收藏内容' : '已取消收藏', favorite ? '已加入今天与知识库的收藏入口。' : '文档本身没有被删除。', 'success')
  } catch (error) {
    ui.toast('收藏状态没有保存', error instanceof Error ? error.message : '本地资料库暂时没有响应。', 'error')
  } finally {
    closeRecentDocumentMenu()
  }
}

async function removeRecentDocument(document: StudyDocument) {
  try {
    await store.removeFromContentRecents(document.kind, document.id)
    ui.toast('已从最近打开移除', '文档本身没有被删除。', 'success')
  } catch (error) {
    ui.toast('最近打开没有更新', error instanceof Error ? error.message : '本地资料库暂时没有响应。', 'error')
  } finally {
    closeRecentDocumentMenu()
  }
}

function closeDashboardContextMenus() {
  closeQuickActionMenu()
  closeRecentDocumentMenu()
  contextTool.value = ''
}

onMounted(async () => {
  window.addEventListener('knitspace:close-context-menus', closeDashboardContextMenus)
  await refreshVisualProjectSummaries()
})
onActivated(() => { void refreshVisualProjectSummaries() })
onBeforeUnmount(() => window.removeEventListener('knitspace:close-context-menus', closeDashboardContextMenus))

function handleRecentDocumentMenuKeydown(event: KeyboardEvent) {
  const items = [...(recentDocumentMenuElement.value?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [])]
  if (event.key === 'Escape') {
    event.preventDefault()
    closeRecentDocumentMenu(true)
    return
  }
  const nextIndex = nextMenuItemIndex(event.key, items.indexOf(document.activeElement as HTMLButtonElement), items.length)
  if (nextIndex === undefined) return
  event.preventDefault()
  items[nextIndex]?.focus()
}

function runQuickActionMenu(item: QuickActionMenuItem) {
  const action = quickActionMenu.value?.action
  if (!action) return
  closeQuickActionMenu()
  if (item.template) createQuickTemplateNote(item.template)
  else if (item.id === 'execute') openQuick(action)
  else if (item.id === 'secondary') openQuickSecondary(action)
  else if (action.catalogId) toggleFavoriteFromPicker(action.catalogId)
}

function addFavorite(id: string) {
  store.toggleFavorite(id)
  ui.toast('已加入常用工具', '可用 Ctrl + Alt + 数字快速打开。', 'success')
}

function toggleFavoriteFromPicker(id: string) {
  const existed = store.favorites.some(item => item.toolId === id)
  store.toggleFavorite(id)
  ui.toast(existed ? '已移出常用工具' : '已加入常用工具', existed ? '仍可随时从这里重新添加。' : '可拖动卡片调整顺序。', 'success')
}

function startFavoriteDrag(event: DragEvent, toolId: string) {
  dragging.value = toolId
  dragTarget.value = ''
  event.dataTransfer?.setData('text/plain', toolId)
  if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'
}

function finishFavoriteDrag() {
  dragging.value = ''
  dragTarget.value = ''
}

function dropFavorite(target: string, event?: DragEvent) {
  const source = dragging.value || event?.dataTransfer?.getData('text/plain') || ''
  if (!source || source === target) { finishFavoriteDrag(); return }
  const ids = favorites.value.map(i => i.toolId)
  const from = ids.indexOf(source)
  const to = ids.indexOf(target)
  if (from < 0 || to < 0) { finishFavoriteDrag(); return }
  ids.splice(to, 0, ids.splice(from, 1)[0])
  store.reorderFavorites(ids)
  finishFavoriteDrag()
  ui.toast('常用工具顺序已调整', '新的快捷键顺序已经保存。', 'success')
}

function openFavorite(toolId: string) {
  const tool = catalogMap.get(toolId)
  if (tool) router.push(tool.to)
}

function moveFavorite(toolId: string, direction: -1 | 1) {
  const ids = favorites.value.map(item => item.toolId)
  const from = ids.indexOf(toolId)
  const to = from + direction
  if (from < 0 || to < 0 || to >= ids.length) return
  ;[ids[from], ids[to]] = [ids[to], ids[from]]
  store.reorderFavorites(ids)
  ui.toast('常用工具顺序已调整', `“${catalogMap.get(toolId)?.title ?? '工具'}”已移动到快捷位 ${to + 1}。`, 'success')
}

function handleFavoriteKey(event: KeyboardEvent, toolId: string) {
  if (isContextMenuShortcut(event)) {
    event.preventDefault()
    openFavoriteMenu(toolId, event.currentTarget as HTMLElement)
    return
  }
  if (!event.altKey || !['ArrowLeft', 'ArrowRight'].includes(event.key)) return
  event.preventDefault()
  moveFavorite(toolId, event.key === 'ArrowLeft' ? -1 : 1)
}

function openFavoriteMenu(toolId: string, trigger: HTMLElement) {
  contextTool.value = toolId
  favoriteMenuTrigger = trigger
  void nextTick(() => document.querySelector<HTMLButtonElement>('.favorite-card menu [role="menuitem"]')?.focus())
}

function closeFavoriteMenu(restoreFocus = false) {
  contextTool.value = ''
  if (restoreFocus) favoriteMenuTrigger?.focus({ preventScroll: true })
}

function handleFavoriteMenuKeydown(event: KeyboardEvent) {
  const menuItems = [...document.querySelectorAll<HTMLButtonElement>('.favorite-card menu [role="menuitem"]')]
  if (event.key === 'Escape') {
    event.preventDefault()
    closeFavoriteMenu(true)
    return
  }
  const nextIndex = nextMenuItemIndex(event.key, menuItems.indexOf(document.activeElement as HTMLButtonElement), menuItems.length)
  if (nextIndex === undefined) return
  event.preventDefault()
  menuItems[nextIndex]?.focus()
}

async function paste() {
  pasting.value = true
  try {
    const payload = await readClipboardPayload()
    if (!payload) throw new Error('剪贴板中没有支持的内容。')
    await store.addSource({
      name: payload.name,
      kind: payload.kind,
      mime: payload.kind === 'image' ? 'image/png' : 'text/plain',
      size: (payload.content ?? payload.preview ?? '').length,
      content: payload.content,
      preview: payload.preview ?? localAssetUrl(payload.assetPath),
      managedPath: payload.assetPath,
    })
    ui.toast('已收进资料库', payload.name, 'success')
    router.push('/library')
  } catch (error) {
    ui.toast('无法读取剪贴板', error instanceof Error ? error.message : '读取失败', 'warning')
  } finally {
    pasting.value = false
  }
}

async function openOutput(path?: string) {
  if (!path) { router.push('/history'); return }
  try { await revealDesktopFile(path) }
  catch (error) { ui.toast('无法打开文件位置', error instanceof Error ? error.message : '文件可能已移动。', 'error') }
}

const formatTime = (value: string) => new Date(value).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
const formatBytes = (value: number) => value < 1024
  ? '0 KB'
  : value < 1048576
    ? `${(value / 1024).toFixed(0)} KB`
    : value < 1073741824
      ? `${(value / 1048576).toFixed(1)} MB`
      : `${(value / 1073741824).toFixed(1)} GB`

</script>

<template>
  <div class="dashboard workbench-dashboard page-enter mx-auto w-full max-w-320 px-8 py-6" @click="contextTool = ''; quickActionMenu = null; closeRecentDocumentMenu(); favoritePickerOpen = false">
    <!-- The old header was a marketing hero: a 47px headline, a paragraph of
         positioning copy, and a floating status card. On a tool that opens
         every morning, none of that is read twice. What is used daily — the
         capture field and the four counts — is what remains. -->
    <header class="stack gap-4 mb-6">
      <div class="row-between gap-4 flex-wrap">
        <div class="stack gap-0.5">
          <h2 class="text-[20px] font-semibold tracking-tight font-display">今天</h2>
          <p class="text-[13px] text-fg-3">{{ store.activeVaultName }} · 内容只留在本机</p>
        </div>
        <div class="row gap-2">
          <button class="btn-default" :disabled="pasting" @click="paste">
            <AppIcon name="inbox" :size="15" />{{ pasting ? '读取中…' : '从剪贴板收集' }}
          </button>
          <RouterLink class="btn-primary" to="/quick"><AppIcon name="plus" :size="15" />快速捕获</RouterLink>
        </div>
      </div>

      <form class="row gap-2 h-11 px-3 rounded-md bg-well border border-line focus-within:border-accent" @submit.prevent="captureQuickThought">
        <AppIcon name="book" :size="16" class="text-fg-3 shrink-0" aria-hidden="true" />
        <input
          v-model="quickCaptureText"
          maxlength="2000"
          aria-label="快速记录"
          placeholder="现在想先记住什么？按 Enter 收进收集箱"
          :disabled="quickCaptureSaving"
          class="flex-1 min-w-0 bg-transparent border-0 outline-none text-[14px]"
          @keydown.enter.prevent="captureQuickThought"
        >
        <kbd class="kbd shrink-0">Enter</kbd>
        <button type="submit" class="btn-ghost btn-sm shrink-0" :disabled="!quickCaptureText.trim() || quickCaptureSaving">
          {{ quickCaptureSaving ? '保存中…' : '收进收集箱' }}
        </button>
      </form>

      <dl class="grid grid-cols-4 gap-px rounded-md bg-line border border-line overflow-hidden" aria-label="今日工作状态">
        <div class="stack gap-0.5 px-4 py-3 bg-surface">
          <dt class="text-[12px] text-fg-3">进行中</dt>
          <dd class="text-[20px] font-semibold tabular-nums" :class="activeJobs ? 'text-accent' : 'text-fg'">{{ activeJobs }}</dd>
        </div>
        <div class="stack gap-0.5 px-4 py-3 bg-surface">
          <dt class="text-[12px] text-fg-3">今日完成</dt>
          <dd class="text-[20px] font-semibold tabular-nums">{{ completedToday }}</dd>
        </div>
        <div class="stack gap-0.5 px-4 py-3 bg-surface">
          <dt class="text-[12px] text-fg-3">本地条目</dt>
          <dd class="text-[20px] font-semibold tabular-nums">{{ localItemCount }}</dd>
        </div>
        <RouterLink to="/review" class="stack gap-0.5 px-4 py-3 bg-surface transition-colors duration-120 hover:bg-surface-2">
          <dt class="text-[12px] text-fg-3">待复习</dt>
          <dd class="text-[20px] font-semibold tabular-nums" :class="learningPulse.dueCount ? 'text-warn' : 'text-fg'">{{ learningPulse.dueCount }}</dd>
        </RouterLink>
      </dl>
    </header>

    <TodayFocus />

    <section class="quick-launch">
      <header><div><p class="eyebrow">从这里开始</p><h3>从一件小事开始</h3></div><kbd>Ctrl K · 搜索全部</kbd></header>
      <div>
        <button v-for="action in quickActions" :key="action.id" aria-haspopup="menu" :aria-expanded="quickActionMenu?.action.id === action.id" :title="`${action.label}；右键或 Shift+F10 查看更多操作`" @click="openQuick(action)" @contextmenu.prevent.stop="openQuickActionMenuFromPointer($event, action)" @keydown="openQuickActionMenuFromKeyboard($event, action)">
          <b><AppIcon :name="action.icon" :size="19" /></b><span>{{ action.label }}</span><i>↗</i>
        </button>
      </div>
    </section>

    <section class="dashboard-module today-recent-documents">
      <header><div><p class="eyebrow">继续阅读</p><h3>继续最近的内容</h3></div><RouterLink to="/knowledge?filter=recent">全部记录 →</RouterLink></header>
      <div v-if="recentDocuments.length" class="today-recent-document-grid">
        <RouterLink v-for="document in recentDocuments" :key="document.id" v-memo="[document.id, document.title, document.kind, document.subject, document.updatedAt, recentDocumentOpenedAt.get(document.id), store.isContentFavorite(document.kind, document.id)]" :to="{ path: '/documents', query: { kind: document.kind, document: document.id } }" aria-haspopup="menu" :aria-expanded="recentDocumentMenu?.document.id === document.id" :title="`打开“${document.title}”；右键或 Shift+F10 查看更多操作`" @contextmenu.prevent.stop="openRecentDocumentMenuFromPointer($event, document)" @keydown="openRecentDocumentMenuFromKeyboard($event, document)">
          <b><AppIcon :name="document.kind === 'question' ? 'review' : 'book'" :size="16" /></b><span><strong>{{ document.title }}</strong><small>{{ document.kind === 'question' ? '错题' : document.subject || 'Markdown' }} · {{ formatTime(recentDocumentOpenedAt.get(document.id) || document.updatedAt) }}</small></span><i><AppIcon v-if="store.isContentFavorite(document.kind, document.id)" name="star" :size="12" /><template v-else>→</template></i>
        </RouterLink>
      </div>
      <div v-else class="today-recent-document-empty"><AppIcon name="book" :size="18" /><span><b>从知识库打开一篇内容</b><small>下次回到今天时，可以直接从这里继续阅读或编辑。</small></span><RouterLink to="/knowledge">浏览知识库</RouterLink></div>
    </section>

    <section class="dashboard-module favorites-module">
      <header><div><p class="eyebrow">常用工具</p><h3>我的常用工具</h3></div><div class="favorite-heading-actions"><small>拖动排序 · Ctrl Alt 1–9 打开</small><button type="button" :class="{ active: favoritePickerOpen }" @click.stop="favoritePickerOpen = !favoritePickerOpen"><AppIcon :name="favoritePickerOpen ? 'close' : 'plus'" :size="15" />{{ favoritePickerOpen ? '收起' : '添加工具' }}</button></div></header>
      <section v-if="favoritePickerOpen" class="favorite-picker" aria-label="添加常用工具" @click.stop>
        <header><label><AppIcon name="search" :size="16" /><input v-model="favoriteQuery" autofocus placeholder="搜索 PDF、图片、文本、开发工具…" /></label><span>{{ favoriteCandidates.length }} 个工具</span></header>
        <nav aria-label="工具分类"><button v-for="group in favoriteGroups" :key="group" :class="{ active: favoriteGroup === group }" @click="favoriteGroup = group">{{ group }}</button></nav>
        <div v-if="favoriteCandidates.length" class="favorite-picker-grid">
            <button v-for="tool in favoriteCandidates" :key="tool.id" v-memo="[tool.id, favoriteToolIds.has(tool.id)]" :class="{ selected: favoriteToolIds.has(tool.id) }" @click="toggleFavoriteFromPicker(tool.id)">
              <b><AppIcon :name="tool.icon" :size="17" /></b><span><strong>{{ tool.title }}</strong><small>{{ tool.description }}</small></span><i>{{ favoriteToolIds.has(tool.id) ? '已添加' : '＋ 添加' }}</i>
          </button>
        </div>
        <p v-else class="favorite-picker-empty">没有匹配的工具，换个关键词试试。</p>
      </section>
      <div v-if="favorites.length" class="favorite-grid">
        <article
          v-for="item in favorites"
          :key="item.toolId"
          class="favorite-card"
          :class="{ dragging: dragging === item.toolId, 'drag-target': dragTarget === item.toolId && dragging !== item.toolId }"
          draggable="true"
          role="link"
          tabindex="0"
          aria-haspopup="menu"
          :aria-expanded="contextTool === item.toolId"
          :title="`Alt + ←/→ 调整顺序；${item.shortcut || '收藏快捷键'} 打开`"
          @keydown="handleFavoriteKey($event, item.toolId)"
          @keydown.enter="openFavorite(item.toolId)"
          @keydown.space.prevent="openFavorite(item.toolId)"
          @click="openFavorite(item.toolId)"
          @dragstart="startFavoriteDrag($event, item.toolId)"
          @dragenter.prevent="dragTarget = item.toolId"
          @dragover.prevent
          @drop.prevent="dropFavorite(item.toolId, $event)"
          @dragend="finishFavoriteDrag"
          @contextmenu.prevent.stop="openFavoriteMenu(item.toolId, $event.currentTarget as HTMLElement)"
        >
          <span><b><AppIcon :name="item.tool!.icon" :size="20" /></b><kbd v-if="item.shortcut">{{ item.shortcut }}</kbd></span>
          <h4>{{ item.tool!.title }}</h4><p>{{ item.tool!.description }}</p><i>打开工具 →</i>
          <menu v-if="contextTool === item.toolId" role="menu" :aria-label="`${item.tool!.title} 操作`" @click.stop @keydown.stop="handleFavoriteMenuKeydown"><button role="menuitem" @click.prevent.stop="store.toggleFavorite(item.toolId)">取消收藏</button><button role="menuitem" @click.prevent.stop="router.push(item.tool!.to)">立即打开</button></menu>
        </article>
      </div>
      <div v-else class="favorite-empty"><span>还没有固定工具</span><div><button v-for="tool in suggested" :key="tool.id" @click="addFavorite(tool.id)"><AppIcon :name="tool.icon" :size="16" />加入 {{ tool.title }}</button></div></div>
    </section>

    <section class="dashboard-module content-favorites-module">
      <header><div><p class="eyebrow">已收藏</p><h3>收藏内容</h3></div><RouterLink to="/knowledge?filter=favorites">查看收藏夹 →</RouterLink></header>
      <div v-if="favoriteContent.length" class="content-favorites-list">
        <RouterLink v-for="item in favoriteContent" :key="`${item.itemKind}:${item.itemId}`" v-memo="[item.itemKind, item.itemId, item.title, item.detail, item.addedAt]" :to="favoriteContentRoute(item)">
          <b><AppIcon :name="favoriteContentIcons[item.itemKind]" :size="16" /></b><span><strong>{{ item.title }}</strong><small>{{ favoriteContentLabels[item.itemKind] }} · {{ item.detail }}</small></span><AppIcon name="star" :size="12" />
        </RouterLink>
      </div>
      <div v-else class="content-favorites-empty"><AppIcon name="star" :size="17" /><span><b>把真正会反复打开的内容放在这里</b><small>笔记、题目、单词、资料与画布都可通过右键收藏。</small></span><RouterLink to="/knowledge">去知识库</RouterLink></div>
    </section>

    <div class="dashboard-board">
      <section class="dashboard-module recent-task-module">
        <header><div><p class="eyebrow">最近运行</p><h3>最近任务</h3></div><RouterLink to="/history">全部历史 →</RouterLink></header>
        <div v-if="recentJobs.length" class="compact-task-list">
          <article v-for="job in recentJobs" :key="job.id"><span :class="job.status"><i></i>{{ job.status === 'succeeded' ? '完成' : job.status === 'failed' ? '失败' : job.status === 'running' ? `${job.progress}%` : '等待' }}</span><div><h4>{{ job.label }}</h4><p>{{ job.outputNames?.join('、') || job.detail || job.inputNames?.join('、') }}</p></div><time>{{ formatTime(job.createdAt) }}</time></article>
        </div>
        <EmptyState v-else icon="toolbox" title="还没有处理任务" description="拖入任意内容后，Knitspace 会把它收进合适的本地工作流。" action="快速捕获" @action="router.push('/quick')" />
      </section>

      <section class="dashboard-module recent-tool-module">
        <header><div><p class="eyebrow">最近工具</p><h3>最近使用</h3></div></header>
        <div v-if="recentTools.length" class="recent-tool-list"><RouterLink v-for="item in recentTools" :key="item.usage.toolId" :to="item.tool!.to"><b><AppIcon :name="item.tool!.icon" :size="17" /></b><span><strong>{{ item.tool!.title }}</strong><small>{{ formatTime(item.usage.usedAt) }}</small></span><i>→</i></RouterLink></div>
        <div v-else class="mini-empty">使用过的工具会自动留在这里。</div>
      </section>

      <section class="dashboard-module recent-source-module">
        <header><div><h3>最近资料</h3></div><RouterLink to="/library">资料库 →</RouterLink></header>
        <div v-if="recentSources.length" class="recent-source-list"><RouterLink v-for="source in recentSources" :key="source.id" :to="{ path: '/library', query: { source: source.id } }"><b>{{ source.kind.toUpperCase() }}</b><span><strong>{{ source.name }}</strong><small>{{ formatBytes(source.size) }} · {{ source.tags.join(' / ') || '未分类' }}</small></span></RouterLink></div>
        <div v-else class="mini-empty">拖入 PDF、图片或代码建立你的本地资料库。</div>
      </section>

      <section class="dashboard-module study-module">
        <header><div><p class="eyebrow">学习节奏</p><h3>学习进度</h3></div><RouterLink to="/review">开始复习 →</RouterLink></header>
        <div class="study-gauge" :style="{ '--progress': `${learningPulse.coveragePercent}%` }"><b>{{ learningPulse.coveragePercent }}<small>%</small></b><span>{{ learningPulse.reviewableCount ? `已复习 ${learningPulse.reviewedCount} / ${learningPulse.reviewableCount} 张卡` : '还没有加入复习的卡片' }}</span></div>
        <div class="study-stats"><span><b>{{ learningPulse.dueCount }}</b>今日待复习</span><span><b>{{ store.questionCount }}</b>累计错题</span><span><b>{{ noteCount }}</b>学习笔记</span></div>
      </section>

      <section class="dashboard-module recent-output-module">
        <header><div><p class="eyebrow">产物架</p><h3>最近生成</h3></div><RouterLink to="/history">查看目录 →</RouterLink></header>
        <div v-if="recentOutputs.length" class="output-list"><button v-for="job in recentOutputs" :key="job.id" @click="openOutput(job.outputs?.[0]?.path)"><b><AppIcon :name="job.kind === 'image' ? 'image' : job.kind === 'code' ? 'terminal' : 'file-text'" :size="17" /></b><span><strong>{{ job.outputs?.[0]?.name || job.outputNames?.[0] }}</strong><small>{{ job.label }}</small></span><i>→</i></button></div>
        <div v-else class="mini-empty">生成结果会集中出现在这里。</div>
      </section>
    </div>

    <footer class="system-strip">
      <span><i class="online"></i><b>本机模式</b> 文件不上传</span>
      <span><AppIcon name="file-text" :size="15" />剪贴板历史 <b>{{ store.clipboardItems.length }} 条</b></span>
      <RouterLink class="system-strip__backup" to="/settings?section=backup" :title="latestBackup ? `打开数据与备份；${latestBackupLabel} ${new Date(latestBackup.at).toLocaleString('zh-CN')}` : '打开数据与备份'"><AppIcon name="shield" :size="15" />{{ latestBackup ? `${latestBackupLabel} ${formatTime(latestBackup.at)}` : '尚无备份记录' }}</RouterLink>
      <RouterLink to="/settings">打开设置 →</RouterLink>
    </footer>

    <section v-if="quickActionMenu" ref="quickActionMenuElement" class="quick-action-context-menu" role="menu" :aria-label="quickActionMenu.action.label + ' 操作'" :style="{ left: quickActionMenu.x + 'px', top: quickActionMenu.y + 'px', '--quick-menu-width': supportsNoteStarterTemplates(quickActionMenu.action) ? '306px' : '226px' }" @click.stop @contextmenu.prevent @keydown.stop="handleQuickActionMenuKeydown">
      <header><span>快速入口</span><b>{{ quickActionMenu.action.label }}</b></header>
      <button v-for="item in quickActionMenuItems" :key="item.id" :class="{ 'quick-action-context-menu__template': Boolean(item.template) }" role="menuitem" @click="runQuickActionMenu(item)"><span><b>{{ item.label }}</b><small v-if="item.template">{{ item.template.description }}</small></span><i v-if="item.template">{{ item.template.subject }}</i></button>
    </section>
    <section v-if="recentDocumentMenu" ref="recentDocumentMenuElement" class="recent-document-context-menu" role="menu" :aria-label="`${recentDocumentMenu.document.title} 文档操作`" :style="{ left: recentDocumentMenu.x + 'px', top: recentDocumentMenu.y + 'px' }" @click.stop @contextmenu.prevent @keydown.stop="handleRecentDocumentMenuKeydown">
      <header><span>最近打开</span><b>{{ recentDocumentMenu.document.title }}</b></header>
      <button role="menuitem" @click="openRecentDocument(recentDocumentMenu.document)"><AppIcon name="book" :size="16" /><span>阅读预览</span></button>
      <button role="menuitem" @click="openRecentDocument(recentDocumentMenu.document, 'edit')"><AppIcon name="rename" :size="16" /><span>打开源码编辑</span></button>
      <button role="menuitem" @click="toggleRecentDocumentFavorite(recentDocumentMenu.document)"><AppIcon name="star" :size="16" /><span>{{ store.isContentFavorite(recentDocumentMenu.document.kind, recentDocumentMenu.document.id) ? '取消收藏' : '加入收藏' }}</span></button>
      <button role="menuitem" @click="removeRecentDocument(recentDocumentMenu.document)"><AppIcon name="clock" :size="16" /><span>从最近打开移除</span></button>
      <button role="menuitem" @click="copyRecentDocumentWikiLink(recentDocumentMenu.document)"><AppIcon name="link" :size="16" /><span>复制双链</span></button>
      <button role="menuitem" @click="openRecentDocumentKind(recentDocumentMenu.document)"><AppIcon name="book" :size="16" /><span>查看同类内容</span></button>
    </section>
  </div>
</template>

<style scoped>
.favorite-grid{align-items:stretch}.favorite-card{display:grid;grid-template-rows:auto auto minmax(38px,1fr) auto;min-height:178px;padding:16px;overflow:visible;cursor:grab;outline:none;transition:border-color .16s ease,box-shadow .16s ease,transform .16s ease,opacity .16s ease}.favorite-card:active{cursor:grabbing}.favorite-card:focus-visible{border-color:var(--accent);box-shadow:0 0 0 3px color-mix(in srgb,var(--accent) 14%,transparent)}.favorite-card h4{margin:13px 0 5px;line-height:1.3}.favorite-card p{min-width:0;margin:0;color:var(--muted);font-size:11px;line-height:1.5;overflow-wrap:anywhere}.favorite-card>i{position:static;align-self:end;left:auto;bottom:auto;margin-top:12px;color:var(--accent);font-size:10px;font-style:normal;font-weight:700}.favorite-card.dragging{opacity:.42;transform:scale(.97)}.favorite-card.drag-target{border-color:var(--accent);box-shadow:inset 4px 0 0 var(--accent),0 12px 28px color-mix(in srgb,var(--accent) 12%,transparent);transform:translateY(-3px)}
.favorite-heading-actions{display:flex;align-items:center;gap:12px}.favorite-heading-actions>small{color:var(--muted);font-size:10px}.favorite-heading-actions>button{display:flex;align-items:center;gap:7px;min-height:36px;padding:0 13px;border:1px solid color-mix(in srgb,var(--accent) 30%,var(--line));border-radius:10px;background:color-mix(in srgb,var(--accent) 6%,var(--surface));color:var(--accent);font-size:11px;font-weight:750;transition:.16s ease}.favorite-heading-actions>button:hover,.favorite-heading-actions>button.active{border-color:var(--accent);background:var(--accent);color:white;box-shadow:0 8px 22px color-mix(in srgb,var(--accent) 20%,transparent)}
.favorite-picker{margin:0 0 16px;padding:14px;border:1px solid color-mix(in srgb,var(--accent) 24%,var(--line));border-radius:14px;background:linear-gradient(145deg,color-mix(in srgb,var(--surface) 96%,var(--accent) 4%),var(--surface));box-shadow:0 18px 42px var(--accent-soft);animation:picker-in .16s ease-out}.favorite-picker>header{display:flex;align-items:center;gap:12px;margin-bottom:11px}.favorite-picker>header label{display:flex;align-items:center;gap:9px;min-width:0;flex:1;height:40px;padding:0 12px;border:1px solid var(--line);border-radius:10px;background:var(--canvas);color:var(--muted)}.favorite-picker>header label:focus-within{border-color:var(--accent);box-shadow:0 0 0 3px color-mix(in srgb,var(--accent) 12%,transparent)}.favorite-picker input{width:100%;border:0;outline:0;background:transparent;color:var(--ink);font-size:12px}.favorite-picker>header>span{color:var(--muted);font:10px ui-monospace,SFMono-Regular,Consolas,monospace}.favorite-picker>nav{display:flex;gap:6px;padding-bottom:12px;overflow-x:auto}.favorite-picker>nav button{flex:none;min-height:30px;padding:0 10px;border:1px solid transparent;border-radius:999px;background:transparent;color:var(--muted);font-size:10px}.favorite-picker>nav button:hover{background:color-mix(in srgb,var(--accent) 7%,var(--surface));color:var(--ink)}.favorite-picker>nav button.active{border-color:color-mix(in srgb,var(--accent) 30%,var(--line));background:color-mix(in srgb,var(--accent) 10%,var(--surface));color:var(--accent);font-weight:750}
.favorite-picker-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:7px;max-height:310px;overflow:auto;padding:1px 4px 3px 1px}.favorite-picker-grid>button{display:grid;grid-template-columns:34px minmax(0,1fr) auto;align-items:center;gap:9px;min-height:62px;padding:9px 10px;border:1px solid var(--line);border-radius:11px;background:var(--surface);color:var(--ink);text-align:left;transition:.14s ease}.favorite-picker-grid>button:hover{border-color:color-mix(in srgb,var(--accent) 46%,var(--line));transform:translateY(-1px)}.favorite-picker-grid>button.selected{border-color:color-mix(in srgb,var(--accent) 36%,var(--line));background:color-mix(in srgb,var(--accent) 7%,var(--surface))}.favorite-picker-grid>button>b{display:grid;place-items:center;width:34px;height:34px;border-radius:9px;background:color-mix(in srgb,var(--accent) 10%,var(--surface));color:var(--accent)}.favorite-picker-grid>button>span{display:grid;gap:3px;min-width:0}.favorite-picker-grid strong{overflow:hidden;font-size:11px;text-overflow:ellipsis;white-space:nowrap}.favorite-picker-grid small{overflow:hidden;color:var(--muted);font-size:9px;text-overflow:ellipsis;white-space:nowrap}.favorite-picker-grid i{color:var(--accent);font-size:9px;font-style:normal;font-weight:700}.favorite-picker-empty{margin:0;padding:28px;text-align:center;color:var(--muted);font-size:11px}@keyframes picker-in{from{opacity:0;transform:translateY(-5px)}to{opacity:1;transform:none}}@media(max-width:1050px){.favorite-picker-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:700px){.favorite-heading-actions>small{display:none}.favorite-picker-grid{grid-template-columns:1fr}}
.content-favorites-module{margin-top:14px}.content-favorites-list{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:7px}.content-favorites-list>a{display:grid;min-height:60px;grid-template-columns:32px minmax(0,1fr) auto;align-items:center;gap:9px;padding:9px 10px;border:1px solid var(--line);border-radius:11px;color:var(--text);background:var(--surface-2);transition:border-color .16s ease,background .16s ease,color .16s ease}.content-favorites-list>a:hover,.content-favorites-list>a:focus-visible{border-color:var(--accent-soft);color:var(--green-strong);background:var(--surface)}.content-favorites-list>a>b{display:grid;width:32px;height:32px;place-items:center;border-radius:9px;color:var(--green-strong);background:var(--green-bg)}.content-favorites-list>a>span{display:grid;min-width:0;gap:3px}.content-favorites-list strong,.content-favorites-list small{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.content-favorites-list strong{font:680 10px var(--font-ui)}.content-favorites-list small{color:var(--muted);font:8px var(--font-ui)}.content-favorites-list>a>.app-icon{color:var(--warn)}.content-favorites-empty{display:grid;min-height:62px;grid-template-columns:34px minmax(0,1fr) auto;align-items:center;gap:10px;padding:9px 11px;border:1px dashed var(--accent-soft);border-radius:11px;color:var(--green-strong);background:var(--surface-2)}.content-favorites-empty>span{display:grid;gap:3px}.content-favorites-empty b{color:var(--text-secondary);font:650 10px var(--font-ui)}.content-favorites-empty small{color:var(--muted);font:9px/1.4 var(--font-ui)}.content-favorites-empty>a{color:var(--green-strong);font:700 9px var(--font-ui)}@media(max-width:980px){.content-favorites-list{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:650px){.content-favorites-list{grid-template-columns:1fr}.content-favorites-empty{grid-template-columns:32px 1fr}.content-favorites-empty>a{grid-column:2}}
.quick-action-context-menu{position:fixed;z-index:var(--z-context-menu);width:var(--quick-menu-width,226px);overflow:hidden;border:1px solid color-mix(in srgb,var(--accent) 22%,var(--line));border-radius:13px;background:var(--surface);box-shadow:var(--shadow-lg);animation:picker-in .14s ease-out both}.quick-action-context-menu>header{display:grid;gap:3px;padding:11px 13px 9px;border-bottom:1px solid var(--line-weak)}.quick-action-context-menu>header span{color:var(--muted);font:700 9px var(--font-mono);letter-spacing:.09em}.quick-action-context-menu>header b{color:var(--text);font:700 13px var(--font-ui)}.quick-action-context-menu>button{display:flex;width:100%;min-height:37px;align-items:center;justify-content:space-between;gap:10px;padding:0 13px;border:0;color:var(--text-secondary);background:transparent;font:650 11px var(--font-ui);text-align:left}.quick-action-context-menu>button:hover,.quick-action-context-menu>button:focus-visible{color:var(--green-strong);background:var(--green-bg)}.quick-action-context-menu>button:focus-visible{outline:2px solid color-mix(in srgb,var(--accent) 48%,transparent);outline-offset:-2px}.quick-action-context-menu>button>span{display:grid;min-width:0;gap:3px}.quick-action-context-menu>button>span>b{overflow:hidden;color:inherit;font:inherit;text-overflow:ellipsis;white-space:nowrap}.quick-action-context-menu>button>span>small{overflow:hidden;color:var(--muted);font:10px/1.35 var(--font-sans);text-overflow:ellipsis;white-space:nowrap}.quick-action-context-menu>button>i{flex:0 0 auto;padding:3px 5px;border-radius:5px;color:var(--green-strong);background:var(--green-bg);font:700 8px/1 var(--font-mono);font-style:normal}.quick-action-context-menu>button.quick-action-context-menu__template{min-height:63px;padding-block:8px}.quick-action-context-menu>button.quick-action-context-menu__template:hover b,.quick-action-context-menu>button.quick-action-context-menu__template:focus-visible b{color:var(--green-strong)}
.recent-document-list{display:grid}.recent-document-list>a{display:grid;grid-template-columns:32px minmax(0,1fr) auto;align-items:center;gap:9px;padding:9px 0;border-top:1px solid var(--line);color:var(--text);transition:color .16s ease,background .16s ease}.recent-document-list>a:hover,.recent-document-list>a:focus-visible{color:var(--green-strong)}.recent-document-list>a>b{display:grid;width:29px;height:29px;place-items:center;border-radius:7px;color:var(--green-strong);background:var(--green-bg)}.recent-document-list span{min-width:0}.recent-document-list strong,.recent-document-list small{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.recent-document-list strong{font:650 10px/1.3 var(--font-ui)}.recent-document-list small{margin-top:3px;color:var(--muted);font:9px/1.35 var(--font-sans)}.recent-document-list i{color:var(--muted);font-size:11px;font-style:normal}.recent-document-list>a:hover i,.recent-document-list>a:focus-visible i{color:var(--green-strong)}
.recent-document-context-menu{position:fixed;z-index:var(--z-context-menu);width:244px;overflow:hidden;border:1px solid color-mix(in srgb,var(--accent) 22%,var(--line));border-radius:13px;background:var(--surface);box-shadow:var(--shadow-lg);animation:picker-in .14s ease-out both}.recent-document-context-menu>header{display:grid;gap:3px;padding:11px 13px 9px;border-bottom:1px solid var(--line-weak);background:linear-gradient(120deg,color-mix(in srgb,var(--green-bg) 76%,transparent),transparent 74%)}.recent-document-context-menu>header span{color:var(--muted);font:700 9px var(--font-mono);letter-spacing:.09em}.recent-document-context-menu>header b{overflow:hidden;color:var(--text);font:700 13px var(--font-ui);text-overflow:ellipsis;white-space:nowrap}.recent-document-context-menu>button{display:flex;width:100%;min-height:38px;align-items:center;gap:9px;padding:0 13px;border:0;color:var(--text-secondary);background:transparent;font:650 11px var(--font-ui);text-align:left}.recent-document-context-menu>button:hover,.recent-document-context-menu>button:focus-visible{color:var(--green-strong);background:var(--green-bg)}.recent-document-context-menu>button:focus-visible{outline:2px solid color-mix(in srgb,var(--accent) 48%,transparent);outline-offset:-2px}.recent-document-context-menu .app-icon{color:currentColor}
.hero-quick-capture{gap:9px;max-width:620px;margin-top:14px;padding:5px 6px 5px 13px;}.hero-quick-capture input{width:100%;min-width:0;height:32px;outline:0;font:600 12px var(--font-ui)}.hero-quick-capture input::placeholder{}.hero-quick-capture:focus-within{}.hero-quick-capture kbd{padding:3px 6px;border-radius:5px;font:700 9px var(--font-mono)}.hero-quick-capture button{min-height:32px;padding:0 11px;border-radius:8px;font:750 11px var(--font-ui);white-space:nowrap}.hero-quick-capture button:hover:not(:disabled){}.hero-quick-capture button:focus-visible{outline:2px solid var(--surface);outline-offset:2px}.hero-quick-capture button:disabled{opacity:.5}@media(max-width:720px){.hero-quick-capture{}.hero-quick-capture kbd{display:none}}

/* Today is a daily command surface, so its hero stays expressive without
   pushing the actual work below the first desktop viewport. */
.workbench-hero{min-height:264px;gap:22px;padding:28px 32px}.hero-copy h2{max-width:610px;margin-top:8px;font-size:clamp(28px,2.55vw,38px);line-height:1.14}.hero-copy>p:not(.eyebrow){margin:10px 0 14px;font-size:13px;line-height:1.65}.hero-actions .new-task,.hero-actions .secondary-action{min-height:36px}.hero-quick-capture{margin-top:10px}.hero-privacy{margin-top:8px}

.today-recent-documents{margin-top:14px;padding:16px 18px}.today-recent-documents>header{margin-bottom:10px}.today-recent-document-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:7px}.today-recent-document-grid>a{display:grid;min-width:0;min-height:66px;grid-template-columns:32px minmax(0,1fr) auto;align-items:center;gap:9px;padding:9px 10px;border:1px solid var(--line);border-radius:11px;color:var(--text);background:var(--surface-2);transition:border-color .16s ease,color .16s ease,background .16s ease}.today-recent-document-grid>a:hover,.today-recent-document-grid>a:focus-visible{border-color:var(--accent-soft);color:var(--green-strong);background:var(--surface)}.today-recent-document-grid>a>b{display:grid;width:32px;height:32px;place-items:center;border-radius:9px;color:var(--green-strong);background:var(--green-bg)}.today-recent-document-grid>a>span{display:grid;min-width:0;gap:4px}.today-recent-document-grid strong,.today-recent-document-grid small{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.today-recent-document-grid strong{font:680 12px var(--font-ui)}.today-recent-document-grid small{color:var(--muted);font:10px var(--font-ui)}.today-recent-document-grid>a>i{color:var(--muted);font-size:11px;font-style:normal}.today-recent-document-grid>a:hover>i,.today-recent-document-grid>a:focus-visible>i{color:var(--green-strong)}
.today-recent-document-empty{display:grid;min-height:66px;grid-template-columns:34px minmax(0,1fr) auto;align-items:center;gap:10px;padding:9px 11px;border:1px dashed var(--accent-soft);border-radius:11px;color:var(--green-strong);background:var(--surface-2)}.today-recent-document-empty>span{display:grid;gap:3px}.today-recent-document-empty b{color:var(--text-secondary);font:670 11px var(--font-ui)}.today-recent-document-empty small{color:var(--muted);font:10px/1.45 var(--font-ui)}.today-recent-document-empty>a{color:var(--green-strong);font:700 10px var(--font-ui)}

.favorite-picker-grid strong{font-size:12px}.favorite-picker-grid small,.favorite-picker-grid i{font-size:10px}.content-favorites-list strong{font-size:12px}.content-favorites-list small{font-size:10px}.content-favorites-empty b{font-size:11px}.content-favorites-empty small,.content-favorites-empty>a{font-size:10px}.quick-action-context-menu>header span,.recent-document-context-menu>header span{font-size:10px}.quick-action-context-menu>button>i{font-size:9px}.system-strip>span,.system-strip>a{font-size:10px}.system-strip b{font-size:10px}.system-strip>.system-strip__backup{margin-left:0;color:var(--text-secondary)}.system-strip>.system-strip__backup:hover,.system-strip>.system-strip__backup:focus-visible{color:var(--green-strong);background:var(--green-bg)}

@media(max-width:1100px){.today-recent-document-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media(max-width:1180px){.system-strip>.system-strip__backup{display:none}}
</style>
