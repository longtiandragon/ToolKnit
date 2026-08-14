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
import SectionCard from '@/components/SectionCard.vue'
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
          class="flex-1 self-stretch min-w-0 bg-transparent border-0 outline-none text-[14px]"
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

    <div class="stack gap-4 mt-4">
      <!-- ── Start something ─────────────────────────────────────────────── -->
      <SectionCard title="从一件小事开始">
        <template #actions><kbd class="kbd">Ctrl K</kbd></template>
        <div class="grid gap-2 grid-cols-2 sm:grid-cols-3 lg:grid-cols-6">
          <button
            v-for="action in quickActions"
            :key="action.id"
            aria-haspopup="menu"
            :aria-expanded="quickActionMenu?.action.id === action.id"
            :title="`${action.label}；右键或 Shift+F10 查看更多操作`"
            class="group stack items-start gap-2 p-3 rounded-md border border-line bg-surface-2 text-left transition-colors hover:border-line-strong hover:bg-surface-3"
            @click="openQuick(action)"
            @contextmenu.prevent.stop="openQuickActionMenuFromPointer($event, action)"
            @keydown="openQuickActionMenuFromKeyboard($event, action)"
          >
            <span class="center w-9 h-9 rounded-sm bg-surface text-fg-2 group-hover:text-accent"><AppIcon :name="action.icon" :size="19" /></span>
            <span class="text-[12px] font-medium text-fg leading-snug">{{ action.label }}</span>
          </button>
        </div>
      </SectionCard>

      <!-- ── Pick up where you left off ──────────────────────────────────── -->
      <SectionCard title="继续阅读" to="/knowledge?filter=recent" link-label="全部记录">
        <div v-if="recentDocuments.length" class="grid gap-2 grid-cols-1 sm:grid-cols-2 xl:grid-cols-4">
          <RouterLink
            v-for="document in recentDocuments"
            :key="document.id"
            v-memo="[document.id, document.title, document.kind, document.subject, document.updatedAt, recentDocumentOpenedAt.get(document.id), store.isContentFavorite(document.kind, document.id)]"
            :to="{ path: '/documents', query: { kind: document.kind, document: document.id } }"
            aria-haspopup="menu"
            :aria-expanded="recentDocumentMenu?.document.id === document.id"
            :title="`打开“${document.title}”；右键或 Shift+F10 查看更多操作`"
            class="row gap-2.5 p-2.5 rounded-md border border-line bg-surface-2 transition-colors hover:border-line-strong hover:bg-surface-3"
            @contextmenu.prevent.stop="openRecentDocumentMenuFromPointer($event, document)"
            @keydown="openRecentDocumentMenuFromKeyboard($event, document)"
          >
            <span class="center w-8 h-8 rounded-sm bg-surface text-fg-2 shrink-0">
              <AppIcon :name="document.kind === 'question' ? 'review' : 'book'" :size="16" />
            </span>
            <span class="stack gap-0.5 min-w-0 flex-1">
              <strong class="text-[13px] font-medium text-fg truncate">{{ document.title }}</strong>
              <small class="text-[11px] text-fg-3 truncate">
                {{ document.kind === 'question' ? '错题' : document.subject || 'Markdown' }} · {{ formatTime(recentDocumentOpenedAt.get(document.id) || document.updatedAt) }}
              </small>
            </span>
            <AppIcon v-if="store.isContentFavorite(document.kind, document.id)" name="star" :size="13" class="shrink-0 text-warn" />
          </RouterLink>
        </div>
        <div v-else class="row gap-3 p-4 rounded-md border border-dashed border-line-strong">
          <AppIcon name="book" :size="18" class="shrink-0 text-fg-3" />
          <span class="stack gap-0.5 flex-1 min-w-0">
            <b class="text-[13px] font-medium text-fg">从知识库打开一篇内容</b>
            <small class="text-[12px] text-fg-3">下次回到今天时，可以直接从这里继续。</small>
          </span>
          <RouterLink class="btn-default btn-sm shrink-0" to="/knowledge">浏览知识库</RouterLink>
        </div>
      </SectionCard>

      <!-- ── Pinned tools ────────────────────────────────────────────────── -->
      <SectionCard title="我的常用工具" hint="拖动排序 · Ctrl Alt 1–9 打开">
        <template #actions>
          <button
            type="button"
            class="btn-sm"
            :class="favoritePickerOpen ? 'btn-primary' : 'btn-default'"
            @click.stop="favoritePickerOpen = !favoritePickerOpen"
          >
            <AppIcon :name="favoritePickerOpen ? 'close' : 'plus'" :size="14" />{{ favoritePickerOpen ? '收起' : '添加工具' }}
          </button>
        </template>

        <section v-if="favoritePickerOpen" class="stack gap-3 mb-3 p-3 rounded-md border border-accent bg-accent-soft" aria-label="添加常用工具" @click.stop>
          <div class="row gap-2">
            <label class="row gap-2 flex-1 min-w-0 h-9 px-3 rounded-sm bg-surface border border-line focus-within:border-accent">
              <AppIcon name="search" :size="15" class="shrink-0 text-fg-3" />
              <input v-model="favoriteQuery" autofocus placeholder="搜索 PDF、图片、文本、开发工具…" class="flex-1 min-w-0 bg-transparent border-0 outline-none text-[13px]" />
            </label>
            <span class="text-[12px] tabular-nums text-fg-3 shrink-0">{{ favoriteCandidates.length }} 个</span>
          </div>
          <nav class="row gap-1 flex-wrap" aria-label="工具分类">
            <button
              v-for="group in favoriteGroups"
              :key="group"
              class="h-7 px-2.5 rounded-full text-[12px] transition-colors"
              :class="favoriteGroup === group ? 'bg-accent text-accent-fg font-medium' : 'text-fg-2 hover:bg-surface-2'"
              @click="favoriteGroup = group"
            >
              {{ group }}
            </button>
          </nav>
          <div v-if="favoriteCandidates.length" class="grid gap-2 grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 max-h-80 overflow-y-auto">
            <button
              v-for="tool in favoriteCandidates"
              :key="tool.id"
              v-memo="[tool.id, favoriteToolIds.has(tool.id)]"
              class="row gap-2.5 p-2.5 rounded-md border text-left transition-colors"
              :class="favoriteToolIds.has(tool.id) ? 'border-accent bg-surface' : 'border-line bg-surface hover:border-line-strong'"
              @click="toggleFavoriteFromPicker(tool.id)"
            >
              <span class="center w-8 h-8 rounded-sm bg-surface-2 text-fg-2 shrink-0"><AppIcon :name="tool.icon" :size="17" /></span>
              <span class="stack gap-0.5 min-w-0 flex-1">
                <strong class="text-[12px] font-medium text-fg truncate">{{ tool.title }}</strong>
                <small class="text-[11px] text-fg-3 truncate">{{ tool.description }}</small>
              </span>
              <i class="text-[11px] not-italic shrink-0" :class="favoriteToolIds.has(tool.id) ? 'text-accent' : 'text-fg-3'">
                {{ favoriteToolIds.has(tool.id) ? '已添加' : '添加' }}
              </i>
            </button>
          </div>
          <p v-else class="py-8 text-center text-[12px] text-fg-3">没有匹配的工具，换个关键词试试。</p>
        </section>

        <div v-if="favorites.length" class="grid gap-2 grid-cols-2 sm:grid-cols-3 xl:grid-cols-5">
          <article
            v-for="item in favorites"
            :key="item.toolId"
            class="relative stack gap-2 p-3 rounded-md border bg-surface-2 cursor-grab transition-all active:cursor-grabbing"
            :class="[
              dragging === item.toolId ? 'opacity-40 scale-97' : '',
              dragTarget === item.toolId && dragging !== item.toolId ? 'border-accent shadow-md -translate-y-0.5' : 'border-line hover:border-line-strong',
            ]"
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
            <span class="row-between gap-2">
              <b class="center w-9 h-9 rounded-sm bg-surface text-accent"><AppIcon :name="item.tool!.icon" :size="19" /></b>
              <kbd v-if="item.shortcut" class="kbd shrink-0">{{ item.shortcut }}</kbd>
            </span>
            <h4 class="text-[13px] font-medium text-fg leading-snug">{{ item.tool!.title }}</h4>
            <p class="text-[11px] leading-snug text-fg-3 line-clamp-2">{{ item.tool!.description }}</p>

            <menu
              v-if="contextTool === item.toolId"
              class="absolute right-2 top-2 z-10 m-0 w-36 p-1 rounded-md bg-surface border border-line-strong shadow-lg"
              role="menu"
              :aria-label="`${item.tool!.title} 操作`"
              @click.stop
              @keydown.stop="handleFavoriteMenuKeydown"
            >
              <button class="nav-item w-full" role="menuitem" @click.prevent.stop="store.toggleFavorite(item.toolId)">取消收藏</button>
              <button class="nav-item w-full" role="menuitem" @click.prevent.stop="router.push(item.tool!.to)">立即打开</button>
            </menu>
          </article>
        </div>
        <div v-else class="stack gap-2.5 p-4 rounded-md border border-dashed border-line-strong">
          <span class="text-[13px] text-fg-2">还没有固定工具，先放两个每天都要用的：</span>
          <div class="row gap-1.5 flex-wrap">
            <button v-for="tool in suggested" :key="tool.id" class="btn-default btn-sm" @click="addFavorite(tool.id)">
              <AppIcon :name="tool.icon" :size="14" />{{ tool.title }}
            </button>
          </div>
        </div>
      </SectionCard>

      <!-- ── Saved content ───────────────────────────────────────────────── -->
      <SectionCard title="收藏内容" to="/knowledge?filter=favorites" link-label="收藏夹">
        <div v-if="favoriteContent.length" class="grid gap-2 grid-cols-1 sm:grid-cols-2 xl:grid-cols-3">
          <RouterLink
            v-for="item in favoriteContent"
            :key="`${item.itemKind}:${item.itemId}`"
            v-memo="[item.itemKind, item.itemId, item.title, item.detail, item.addedAt]"
            :to="favoriteContentRoute(item)"
            class="row gap-2.5 p-2.5 rounded-md border border-line bg-surface-2 transition-colors hover:border-line-strong hover:bg-surface-3"
          >
            <span class="center w-8 h-8 rounded-sm bg-surface text-fg-2 shrink-0"><AppIcon :name="favoriteContentIcons[item.itemKind]" :size="16" /></span>
            <span class="stack gap-0.5 min-w-0 flex-1">
              <strong class="text-[13px] font-medium text-fg truncate">{{ item.title }}</strong>
              <small class="text-[11px] text-fg-3 truncate">{{ favoriteContentLabels[item.itemKind] }} · {{ item.detail }}</small>
            </span>
            <AppIcon name="star" :size="13" class="shrink-0 text-warn" />
          </RouterLink>
        </div>
        <div v-else class="row gap-3 p-4 rounded-md border border-dashed border-line-strong">
          <AppIcon name="star" :size="17" class="shrink-0 text-fg-3" />
          <span class="stack gap-0.5 flex-1 min-w-0">
            <b class="text-[13px] font-medium text-fg">把会反复打开的内容放在这里</b>
            <small class="text-[12px] text-fg-3">笔记、题目、单词、资料与画布都可以右键收藏。</small>
          </span>
          <RouterLink class="btn-default btn-sm shrink-0" to="/knowledge">去知识库</RouterLink>
        </div>
      </SectionCard>

      <!-- ── Activity ────────────────────────────────────────────────────── -->
      <div class="grid gap-4 grid-cols-1 xl:grid-cols-2 items-start">
        <SectionCard title="最近任务" to="/history" link-label="全部历史" flush>
          <ul v-if="recentJobs.length" class="stack">
            <li v-for="job in recentJobs" :key="job.id" class="row gap-3 px-4 py-2.5 border-b border-line last:border-b-0">
              <span
                class="row gap-1.5 shrink-0 w-14 text-[11px] tabular-nums"
                :class="job.status === 'succeeded' ? 'text-success' : job.status === 'failed' ? 'text-danger' : job.status === 'running' ? 'text-accent' : 'text-fg-3'"
              >
                <i class="w-1.5 h-1.5 rounded-full bg-current shrink-0" />
                {{ job.status === 'succeeded' ? '完成' : job.status === 'failed' ? '失败' : job.status === 'running' ? `${job.progress}%` : '等待' }}
              </span>
              <span class="stack gap-0.5 min-w-0 flex-1">
                <h4 class="text-[13px] font-medium text-fg truncate">{{ job.label }}</h4>
                <p class="text-[11px] text-fg-3 truncate">{{ job.outputNames?.join('、') || job.detail || job.inputNames?.join('、') }}</p>
              </span>
              <time class="text-[11px] tabular-nums text-fg-3 shrink-0">{{ formatTime(job.createdAt) }}</time>
            </li>
          </ul>
          <div v-else class="p-3">
            <EmptyState icon="toolbox" title="还没有处理任务" description="拖入任意内容，Knitspace 会把它收进合适的本地工作流。" action="快速捕获" @action="router.push('/quick')" />
          </div>
        </SectionCard>

        <SectionCard title="学习进度" to="/review" link-label="开始复习">
          <div class="stack gap-3">
            <div class="stack gap-1.5">
              <div class="row-between gap-2">
                <span class="text-[12px] text-fg-3">
                  {{ learningPulse.reviewableCount ? `已复习 ${learningPulse.reviewedCount} / ${learningPulse.reviewableCount} 张卡` : '还没有加入复习的卡片' }}
                </span>
                <b class="text-[16px] font-semibold tabular-nums text-fg">{{ learningPulse.coveragePercent }}%</b>
              </div>
              <div
                class="h-1.5 rounded-full bg-surface-3 overflow-hidden"
                role="progressbar"
                :aria-valuenow="learningPulse.coveragePercent"
                aria-valuemin="0"
                aria-valuemax="100"
                aria-label="复习覆盖率"
              >
                <span class="block h-full rounded-full bg-accent transition-[width] duration-300" :style="{ width: `${Math.max(2, learningPulse.coveragePercent)}%` }" />
              </div>
            </div>
            <dl class="grid grid-cols-3 gap-px rounded-md bg-line border border-line overflow-hidden">
              <div class="stack gap-0.5 px-3 py-2.5 bg-surface">
                <dt class="text-[11px] text-fg-3">今日待复习</dt>
                <dd class="text-[18px] font-semibold tabular-nums" :class="learningPulse.dueCount ? 'text-warn' : 'text-fg'">{{ learningPulse.dueCount }}</dd>
              </div>
              <div class="stack gap-0.5 px-3 py-2.5 bg-surface">
                <dt class="text-[11px] text-fg-3">累计错题</dt>
                <dd class="text-[18px] font-semibold tabular-nums text-fg">{{ store.questionCount }}</dd>
              </div>
              <div class="stack gap-0.5 px-3 py-2.5 bg-surface">
                <dt class="text-[11px] text-fg-3">学习笔记</dt>
                <dd class="text-[18px] font-semibold tabular-nums text-fg">{{ noteCount }}</dd>
              </div>
            </dl>
          </div>
        </SectionCard>
      </div>

      <div class="grid gap-4 grid-cols-1 lg:grid-cols-3 items-start">
        <SectionCard title="最近使用" flush>
          <ul v-if="recentTools.length" class="stack p-1.5 gap-0.5">
            <li v-for="item in recentTools" :key="item.usage.toolId">
              <RouterLink :to="item.tool!.to" class="row gap-2.5 px-2 py-2 rounded-sm hover:bg-surface-2">
                <span class="center w-8 h-8 rounded-sm bg-surface-2 text-fg-2 shrink-0"><AppIcon :name="item.tool!.icon" :size="16" /></span>
                <span class="stack gap-0.5 min-w-0 flex-1">
                  <strong class="text-[13px] font-medium text-fg truncate">{{ item.tool!.title }}</strong>
                  <small class="text-[11px] tabular-nums text-fg-3">{{ formatTime(item.usage.usedAt) }}</small>
                </span>
              </RouterLink>
            </li>
          </ul>
          <p v-else class="p-4 text-[12px] text-fg-3">用过的工具会自动留在这里。</p>
        </SectionCard>

        <SectionCard title="最近资料" to="/library" link-label="资料库" flush>
          <ul v-if="recentSources.length" class="stack p-1.5 gap-0.5">
            <li v-for="source in recentSources" :key="source.id">
              <RouterLink :to="{ path: '/library', query: { source: source.id } }" class="row gap-2.5 px-2 py-2 rounded-sm hover:bg-surface-2">
                <b class="center w-8 h-8 shrink-0 rounded-sm bg-surface-2 text-[10px] font-semibold text-fg-2">{{ source.kind.toUpperCase() }}</b>
                <span class="stack gap-0.5 min-w-0 flex-1">
                  <strong class="text-[13px] font-medium text-fg truncate">{{ source.name }}</strong>
                  <small class="text-[11px] text-fg-3 truncate">{{ formatBytes(source.size) }} · {{ source.tags.join(' / ') || '未分类' }}</small>
                </span>
              </RouterLink>
            </li>
          </ul>
          <p v-else class="p-4 text-[12px] text-fg-3">拖入 PDF、图片或代码，建立本地资料库。</p>
        </SectionCard>

        <SectionCard title="最近生成" to="/history" link-label="查看目录" flush>
          <ul v-if="recentOutputs.length" class="stack p-1.5 gap-0.5">
            <li v-for="job in recentOutputs" :key="job.id">
              <button class="w-full row gap-2.5 px-2 py-2 rounded-sm text-left hover:bg-surface-2" @click="openOutput(job.outputs?.[0]?.path)">
                <span class="center w-8 h-8 rounded-sm bg-surface-2 text-fg-2 shrink-0">
                  <AppIcon :name="job.kind === 'image' ? 'image' : job.kind === 'code' ? 'terminal' : 'file-text'" :size="16" />
                </span>
                <span class="stack gap-0.5 min-w-0 flex-1">
                  <strong class="text-[13px] font-medium text-fg truncate">{{ job.outputs?.[0]?.name || job.outputNames?.[0] }}</strong>
                  <small class="text-[11px] text-fg-3 truncate">{{ job.label }}</small>
                </span>
              </button>
            </li>
          </ul>
          <p v-else class="p-4 text-[12px] text-fg-3">生成的结果会集中出现在这里。</p>
        </SectionCard>
      </div>
    </div>

    <footer class="row gap-4 flex-wrap mt-5 pt-4 border-t border-line text-[12px] text-fg-3">
      <span class="row gap-1.5"><i class="w-1.5 h-1.5 rounded-full bg-success" /><b class="font-medium text-fg-2">本机模式</b>文件不上传</span>
      <span class="row gap-1.5"><AppIcon name="file-text" :size="14" />剪贴板历史 <b class="font-medium text-fg-2 tabular-nums">{{ store.clipboardItems.length }} 条</b></span>
      <RouterLink
        class="tap row gap-1.5 hover:text-accent"
        to="/settings?section=backup"
        :title="latestBackup ? `打开数据与备份；${latestBackupLabel} ${new Date(latestBackup.at).toLocaleString('zh-CN')}` : '打开数据与备份'"
      >
        <AppIcon name="shield" :size="14" />{{ latestBackup ? `${latestBackupLabel} ${formatTime(latestBackup.at)}` : '尚无备份记录' }}
      </RouterLink>
      <RouterLink class="tap ml-auto hover:text-accent" to="/settings">打开设置</RouterLink>
    </footer>

    <Teleport to="body">
      <div
        v-if="quickActionMenu"
        ref="quickActionMenuElement"
        class="fixed z-[120] p-1 rounded-md bg-surface border border-line-strong shadow-lg"
        role="menu"
        :aria-label="quickActionMenu.action.label + ' 操作'"
        :style="{ left: quickActionMenu.x + 'px', top: quickActionMenu.y + 'px', width: supportsNoteStarterTemplates(quickActionMenu.action) ? '306px' : '226px' }"
        @click.stop
        @contextmenu.prevent
        @keydown.stop="handleQuickActionMenuKeydown"
      >
        <p class="px-2.5 py-1.5 text-[11px] text-fg-3 truncate">快速入口 · {{ quickActionMenu.action.label }}</p>
        <button
          v-for="item in quickActionMenuItems"
          :key="item.id"
          class="row-between gap-2 w-full px-2.5 py-2 rounded-sm text-left text-fg-2 hover:bg-surface-2 hover:text-fg"
          role="menuitem"
          @click="runQuickActionMenu(item)"
        >
          <span class="stack gap-0.5 min-w-0">
            <b class="text-[13px] font-medium truncate">{{ item.label }}</b>
            <small v-if="item.template" class="text-[11px] text-fg-3 truncate">{{ item.template.description }}</small>
          </span>
          <i v-if="item.template" class="chip-accent shrink-0 not-italic">{{ item.template.subject }}</i>
        </button>
      </div>

      <div
        v-if="recentDocumentMenu"
        ref="recentDocumentMenuElement"
        class="fixed z-[120] w-60 p-1 rounded-md bg-surface border border-line-strong shadow-lg"
        role="menu"
        :aria-label="`${recentDocumentMenu.document.title} 文档操作`"
        :style="{ left: recentDocumentMenu.x + 'px', top: recentDocumentMenu.y + 'px' }"
        @click.stop
        @contextmenu.prevent
        @keydown.stop="handleRecentDocumentMenuKeydown"
      >
        <p class="px-2.5 py-1.5 text-[11px] text-fg-3 truncate">最近打开 · {{ recentDocumentMenu.document.title }}</p>
        <button class="nav-item w-full" role="menuitem" @click="openRecentDocument(recentDocumentMenu.document)"><AppIcon name="book" :size="15" />阅读预览</button>
        <button class="nav-item w-full" role="menuitem" @click="openRecentDocument(recentDocumentMenu.document, 'edit')"><AppIcon name="rename" :size="15" />打开源码编辑</button>
        <button class="nav-item w-full" role="menuitem" @click="toggleRecentDocumentFavorite(recentDocumentMenu.document)">
          <AppIcon name="star" :size="15" />{{ store.isContentFavorite(recentDocumentMenu.document.kind, recentDocumentMenu.document.id) ? '取消收藏' : '加入收藏' }}
        </button>
        <button class="nav-item w-full" role="menuitem" @click="copyRecentDocumentWikiLink(recentDocumentMenu.document)"><AppIcon name="link" :size="15" />复制双链</button>
        <button class="nav-item w-full" role="menuitem" @click="openRecentDocumentKind(recentDocumentMenu.document)"><AppIcon name="book" :size="15" />查看同类内容</button>
        <button class="nav-item w-full hover:bg-danger-soft hover:text-danger" role="menuitem" @click="removeRecentDocument(recentDocumentMenu.document)">
          <AppIcon name="clock" :size="15" />从最近打开移除
        </button>
      </div>
    </Teleport>
  </div>
</template>
