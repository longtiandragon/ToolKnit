<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { RouterLink, useRoute, useRouter, type RouteLocationRaw } from 'vue-router'
import AppIcon from '@/components/AppIcon.vue'
import PageHeader from '@/components/PageHeader.vue'
import { createAsyncSearchGate } from '@/lib/async-search-gate'
import { clampMenuPosition, isContextMenuShortcut, nextMenuItemIndex } from '@/lib/desktop-menu'
import { knowledgeSnippetParts, type KnowledgeSnippetPart } from '@/lib/knowledge-search'
import { knowledgeAreaActions, knowledgeWorkflowActions, type KnowledgeAreaId, type KnowledgeWorkflowAction } from '@/lib/knowledge-workflows'
import { listDesktopVisualProjects, type DesktopVaultSearchResult, type DesktopVisualProjectSummary } from '@/lib/native'
import { useWorkbenchStore } from '@/stores/workbench'
import { useUiStore } from '@/stores/ui'

type KnowledgeKind = 'note' | 'question' | 'word' | 'source' | 'diagram'
type KnowledgeArea = { id: KnowledgeAreaId; label: string; detail: string; icon: string; count: number; to: string }
type KnowledgeItem = {
  id: string
  kind: KnowledgeKind
  title: string
  detail: string
  timestamp: string
  to: RouteLocationRaw
  snippetParts?: KnowledgeSnippetPart[]
}

const store = useWorkbenchStore()
const ui = useUiStore()
const router = useRouter()
const route = useRoute()
const query = ref('')
const activeKind = ref<'all' | KnowledgeKind>('all')
const favoritesOnly = ref(route.query.filter === 'favorites')
const recentsOnly = ref(route.query.filter === 'recent')
const indexedResults = ref<DesktopVaultSearchResult[]>([])
const searchPending = ref(false)
const searchError = ref('')
const menu = ref<{ item: KnowledgeItem; x: number; y: number } | null>(null)
const menuElement = ref<HTMLElement>()
const areaMenu = ref<{ area: KnowledgeArea; actions: KnowledgeWorkflowAction[]; x: number; y: number } | null>(null)
const areaMenuElement = ref<HTMLElement>()
const visualProjects = shallowRef<DesktopVisualProjectSummary[]>([])
const searchGate = createAsyncSearchGate()
let menuTrigger: HTMLElement | undefined
let areaMenuTrigger: HTMLElement | undefined
let searchTimer: number | undefined

const notes = computed(() => store.documents.filter((document) => document.kind === 'note'))
const questions = computed(() => store.documents.filter((document) => document.kind === 'question'))
const dueCount = computed(() => store.dueQuestionCards.length + store.dueVocabularyCards.length)

const areas = computed<KnowledgeArea[]>(() => [
  { id: 'note' as const, label: 'Markdown 笔记', detail: '源码、分屏、阅读与图谱', icon: 'book', count: notes.value.length, to: '/documents?kind=note' },
  { id: 'question' as const, label: '题目与错题', detail: '题干、答案、解析与错因', icon: 'review', count: questions.value.length, to: '/documents?kind=question' },
  { id: 'word' as const, label: '结构化单词', detail: '词形、词性、多义项与卡片', icon: 'sort', count: store.vocabulary.length, to: '/words' },
  { id: 'source' as const, label: '资料与摘录', detail: 'PDF、图片、代码与文本来源', icon: 'inbox', count: store.sources.length, to: '/library' },
])

const allItems = computed<KnowledgeItem[]>(() => [
  ...store.documents.map((document) => ({
    id: document.id,
    kind: document.kind,
    title: document.title,
    detail: document.kind === 'note' ? `${document.folder || document.subject || '未分类'} · Markdown` : `${document.subject || '未分类'} · 难度 ${document.difficulty}`,
    timestamp: document.updatedAt,
    to: { path: '/documents', query: { kind: document.kind, document: document.id } },
  } satisfies KnowledgeItem)),
  ...store.vocabulary.map((entry) => ({
    id: entry.id,
    kind: 'word' as const,
    title: entry.lemma,
    detail: `${entry.language} · ${entry.senses.length} 个义项`,
    timestamp: entry.updatedAt,
    to: { path: '/words', query: { word: entry.id } },
  })),
  ...store.sources.map((source) => ({
    id: source.id,
    kind: 'source' as const,
    title: source.name,
    detail: `${source.kind.toUpperCase()} · ${source.tags.slice(0, 2).join(' · ') || '未加标签'}`,
    timestamp: source.lastOpenedAt || source.importedAt,
    to: { path: '/library', query: { source: source.id } },
  })),
  ...visualProjects.value.map((project) => ({
    id: project.id,
    kind: 'diagram' as const,
    title: project.title,
    detail: `${project.imageCount} 张源图 · ${project.annotationCount} 个标注`,
    timestamp: project.updatedAt,
    to: { path: '/visual', query: { project: project.id } },
  })),
])
const favoriteCount = computed(() => allItems.value.filter((item) => store.isContentFavorite(item.kind, item.id)).length)
const recentOpenedAt = computed(() => new Map(store.contentRecents.map((item) => [`${item.itemKind}:${item.itemId}`, item.openedAt])))
const recentCount = computed(() => allItems.value.filter((item) => store.isContentRecent(item.kind, item.id)).length)
function recentTimestamp(item: KnowledgeItem) {
  return recentOpenedAt.value.get(`${item.kind}:${item.id}`) ?? item.timestamp
}
function matchesActiveFilters(item: KnowledgeItem) {
  return (activeKind.value === 'all' || item.kind === activeKind.value)
    && (!favoritesOnly.value || store.isContentFavorite(item.kind, item.id))
    && (!recentsOnly.value || store.isContentRecent(item.kind, item.id))
}

const filteredItems = computed(() => {
  const needle = query.value.trim().toLocaleLowerCase('zh-CN')
  if (!needle) {
    return allItems.value
      .filter(matchesActiveFilters)
      .slice()
      .sort((left, right) => (recentsOnly.value ? recentTimestamp(right).localeCompare(recentTimestamp(left)) : right.timestamp.localeCompare(left.timestamp)))
      .slice(0, 8)
  }

  // If the native index is unavailable, keep a deliberately bounded metadata
  // fallback. Desktop success never scans Markdown bodies in the renderer.
  const indexedItems: KnowledgeItem[] = searchError.value
    ? allItems.value.filter((item) => `${item.title} ${item.detail}`.toLocaleLowerCase('zh-CN').includes(needle))
    : indexedResults.value.map((result) => ({
        id: result.id,
        kind: result.kind,
        title: result.title,
        detail: result.kind === 'word'
          ? `${result.subject || '单词'} · ${result.tags.slice(0, 2).join(' · ') || '结构化词义'}`
          : result.kind === 'source'
            ? `${result.subject.toUpperCase() || '资料'} · ${result.tags.slice(0, 2).join(' · ') || '正文索引'}`
            : `${result.subject || '未分类'} · ${result.kind === 'question' ? '题目与解析' : 'Markdown'}`,
        timestamp: result.updatedAt,
        to: result.kind === 'word'
          ? { path: '/words', query: { word: result.id } }
          : result.kind === 'source'
            ? { path: '/library', query: { source: result.id } }
            : { path: '/documents', query: { kind: result.kind, document: result.id } },
        snippetParts: knowledgeSnippetParts(result.snippet),
      }))

  const indexedSourceIds = new Set(indexedResults.value.filter((result) => result.kind === 'source').map((result) => result.id))
  const sourceItems = searchError.value ? [] : allItems.value
    .filter((item) => (item.kind === 'diagram' || (item.kind === 'source' && !indexedSourceIds.has(item.id))) && `${item.title} ${item.detail}`.toLocaleLowerCase('zh-CN').includes(needle))
    .sort((left, right) => right.timestamp.localeCompare(left.timestamp))

  return [...indexedItems, ...sourceItems]
    .filter(matchesActiveFilters)
    .slice(0, 20)
})

const totalCount = computed(() => store.documents.length + store.vocabulary.length + store.sources.length + visualProjects.value.length)

/* The health panel used to be three hand-written rows with an inline
   `--value` custom property each. Same three numbers, one loop. */
const healthMetrics = computed(() => [
  {
    label: store.vaultReady ? '资料库就绪' : '正在连接资料库',
    value: '100%',
    detail: '桌面数据写入 SQLite 与 Markdown Vault',
  },
  {
    label: `${store.relations.length} 条手动关联`,
    value: `${Math.min(100, store.relations.length * 8)}%`,
    detail: '双链与完整关系可在知识关系图谱中浏览',
  },
  {
    label: dueCount.value ? `${dueCount.value} 张卡片到期` : '当前没有到期卡片',
    value: `${Math.min(100, dueCount.value * 10)}%`,
    detail: '题目与词义按各自节奏安排复习',
  },
])
const kindLabels: Record<KnowledgeKind, string> = { note: '笔记', question: '题目', word: '单词', source: '资料', diagram: '画布' }
const kindIcons: Record<KnowledgeKind, string> = { note: 'book', question: 'review', word: 'sort', source: 'inbox', diagram: 'palette' }

function scheduleIndexedSearch(value: string) {
  if (searchTimer !== undefined) window.clearTimeout(searchTimer)
  const sequence = searchGate.begin()
  const normalized = value.trim()
  indexedResults.value = []
  searchError.value = ''
  if (!normalized) { searchPending.value = false; return }
  searchPending.value = true
  searchTimer = window.setTimeout(async () => {
    try {
      const results = await store.searchDocuments(normalized)
      if (searchGate.isCurrent(sequence)) indexedResults.value = results
    } catch {
      if (searchGate.isCurrent(sequence)) searchError.value = '正文索引暂时不可用，当前只匹配标题与元数据。'
    } finally {
      if (searchGate.isCurrent(sequence)) searchPending.value = false
    }
  }, 140)
}

watch(query, scheduleIndexedSearch)
onBeforeUnmount(() => {
  searchGate.invalidate()
  if (searchTimer !== undefined) window.clearTimeout(searchTimer)
})

function formatDate(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '最近'
  const now = new Date()
  if (date.toDateString() === now.toDateString()) return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
  return date.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })
}
function selectKind(kind: 'all' | KnowledgeKind) {
  if (favoritesOnly.value || recentsOnly.value) {
    favoritesOnly.value = false
    recentsOnly.value = false
    void router.replace({ path: '/knowledge' })
  }
  activeKind.value = activeKind.value === kind && kind !== 'all' ? 'all' : kind
}
function toggleFavoritesFilter() {
  favoritesOnly.value = !favoritesOnly.value
  recentsOnly.value = false
  if (favoritesOnly.value) activeKind.value = 'all'
  void router.replace({ path: '/knowledge', query: favoritesOnly.value ? { filter: 'favorites' } : {} })
}
function toggleRecentsFilter() {
  recentsOnly.value = !recentsOnly.value
  favoritesOnly.value = false
  if (recentsOnly.value) activeKind.value = 'all'
  void router.replace({ path: '/knowledge', query: recentsOnly.value ? { filter: 'recent' } : {} })
}
watch(() => route.query.filter, (value) => {
  favoritesOnly.value = value === 'favorites'
  recentsOnly.value = value === 'recent'
})
function closeMenu(restoreFocus = false) {
  menu.value = null
  if (restoreFocus) void nextTick(() => menuTrigger?.focus({ preventScroll: true }))
}
function closeAreaMenu(restoreFocus = false) {
  areaMenu.value = null
  if (restoreFocus) void nextTick(() => areaMenuTrigger?.focus({ preventScroll: true }))
}
function closeKnowledgeMenus() {
  closeMenu()
  closeAreaMenu()
}
function showAreaMenu(event: MouseEvent | KeyboardEvent, area: KnowledgeArea) {
  event.preventDefault()
  event.stopPropagation()
  closeMenu()
  areaMenuTrigger = event.currentTarget instanceof HTMLElement ? event.currentTarget : undefined
  const bounds = areaMenuTrigger?.getBoundingClientRect()
  const x = 'clientX' in event && event.clientX ? event.clientX : (bounds?.left ?? 18) + 42
  const y = 'clientY' in event && event.clientY ? event.clientY : (bounds?.top ?? 18) + 42
  const actions = knowledgeAreaActions(area.id)
  areaMenu.value = { area, actions, ...clampMenuPosition(x, y, { menuWidth: 268, menuHeight: 58 + actions.length * 52, margin: 12 }) }
  void nextTick(() => areaMenuElement.value?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus({ preventScroll: true }))
}
function showAreaMenuFromKeyboard(event: KeyboardEvent, area: KnowledgeArea) {
  if (isContextMenuShortcut(event)) showAreaMenu(event, area)
}
function handleAreaMenuKeydown(event: KeyboardEvent) {
  const items = [...(areaMenuElement.value?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [])]
  if (event.key === 'Escape') { event.preventDefault(); closeAreaMenu(true); return }
  const index = nextMenuItemIndex(event.key, items.indexOf(document.activeElement as HTMLButtonElement), items.length)
  if (index === undefined) return
  event.preventDefault()
  items[index]?.focus({ preventScroll: true })
}
async function runAreaAction(action: KnowledgeWorkflowAction) {
  closeAreaMenu()
  await router.push(action.to)
}
function menuActionCount(item: KnowledgeItem) {
  const documentModes = item.kind === 'note' ? 3 : item.kind === 'question' ? 2 : 0
  return 4 + documentModes + Number(store.isContentRecent(item.kind, item.id))
}
function showMenu(event: MouseEvent | KeyboardEvent, item: KnowledgeItem) {
  event.preventDefault()
  event.stopPropagation()
  menuTrigger = event.currentTarget instanceof HTMLElement ? event.currentTarget : undefined
  const bounds = menuTrigger?.getBoundingClientRect()
  const x = 'clientX' in event && event.clientX ? event.clientX : (bounds?.left ?? 18) + 38
  const y = 'clientY' in event && event.clientY ? event.clientY : (bounds?.top ?? 18) + 38
  menu.value = { item, ...clampMenuPosition(x, y, { menuWidth: 252, menuHeight: 57 + menuActionCount(item) * 39, margin: 12 }) }
  void nextTick(() => menuElement.value?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus())
}
function showMenuFromKeyboard(event: KeyboardEvent, item: KnowledgeItem) {
  if (isContextMenuShortcut(event)) showMenu(event, item)
}
function handleMenuKeydown(event: KeyboardEvent) {
  const items = [...(menuElement.value?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [])]
  if (event.key === 'Escape') { event.preventDefault(); closeMenu(true); return }
  const index = nextMenuItemIndex(event.key, items.indexOf(document.activeElement as HTMLButtonElement), items.length)
  if (index === undefined) return
  event.preventDefault()
  items[index]?.focus({ preventScroll: true })
}
async function openItem(item: KnowledgeItem) {
  closeMenu()
  await router.push(item.to)
}
async function openDocumentMode(item: KnowledgeItem, mode: 'edit' | 'preview' | 'mindmap') {
  if (item.kind !== 'note' && item.kind !== 'question') return
  closeMenu()
  await router.push({ path: '/documents', query: { kind: item.kind, document: item.id, mode } })
}
async function copyReference(item: KnowledgeItem) {
  const reference = item.kind === 'source' || item.kind === 'diagram' ? item.title : `[[${item.title}]]`
  try {
    await navigator.clipboard.writeText(reference)
    ui.toast(item.kind === 'source' ? '已复制资料名称' : item.kind === 'diagram' ? '已复制画布名称' : '双链已复制', reference, 'success')
  } catch {
    ui.toast('暂时无法复制', '系统剪贴板当前不可用。', 'error')
  }
  closeMenu()
}
async function createRelatedNote(item: KnowledgeItem) {
  const note = store.createNote(`关于 ${item.title}`, undefined, `# 关于 ${item.title}\n\n来源：${item.title}\n\n## 要点\n\n`)
  if (item.kind !== 'source') store.createRelation(note.id, item.id, 'related')
  closeMenu()
  await router.push({ path: '/documents', query: { kind: 'note', document: note.id, mode: 'edit' } })
}
async function toggleItemFavorite(item: KnowledgeItem) {
  try {
    const favorite = await store.toggleContentFavorite(item.kind, item.id)
    ui.toast(favorite ? '已收藏内容' : '已取消收藏', favorite ? '可从知识库、今天或 Ctrl K 快速返回。' : '内容本身没有被删除。', 'success')
  } catch (error) {
    ui.toast('收藏状态没有保存', error instanceof Error ? error.message : '本地资料库暂时没有响应。', 'error')
  } finally {
    closeMenu()
  }
}
async function removeItemFromRecents(item: KnowledgeItem) {
  try {
    await store.removeFromContentRecents(item.kind, item.id)
    ui.toast('已从最近使用移除', '内容本身没有被删除。', 'success')
  } catch (error) {
    ui.toast('最近使用没有更新', error instanceof Error ? error.message : '本地资料库暂时没有响应。', 'error')
  } finally {
    closeMenu()
  }
}
async function clearRecents() {
  try {
    await store.clearContentRecents()
    ui.toast('已清空最近使用', '笔记、题目、单词、资料和画布都仍保留在本地。', 'success')
  } catch (error) {
    ui.toast('无法清空最近使用', error instanceof Error ? error.message : '本地资料库暂时没有响应。', 'error')
  }
}
function resetEmptyState() {
  query.value = ''
  if (favoritesOnly.value) toggleFavoritesFilter()
  else if (recentsOnly.value) toggleRecentsFilter()
  else activeKind.value = 'all'
}
function closeKnowledgeMenu() { closeKnowledgeMenus() }

onMounted(async () => {
  window.addEventListener('knitspace:close-context-menus', closeKnowledgeMenu)
  try { visualProjects.value = await listDesktopVisualProjects(60) }
  catch { visualProjects.value = [] }
})
onBeforeUnmount(() => window.removeEventListener('knitspace:close-context-menus', closeKnowledgeMenu))
</script>

<template>
  <!-- No `knowledge-space__*` classes; the scoped block goes with them.

       Three separate bands used to sit above the actual library: five area
       cards, eight "quick task" links under a heading that introduced them,
       and a five-item "快速开始" list in the sidebar that repeated most of
       the same destinations. The area cards are the filter row now, the quick
       tasks are one strip, and the duplicated sidebar list is gone. -->
  <div class="page-enter mx-auto w-full max-w-320 px-8 py-6" @click="closeKnowledgeMenus()">
    <PageHeader
      title="知识空间"
      :subtitle="store.vaultError ? '本地资料库需要处理' : '笔记、题目、单词、资料和画布在同一个库里互相引用'"
      :stats="[
        { label: '知识条目', value: totalCount },
        { label: '手动关联', value: store.relations.length },
        { label: '待复习', value: dueCount, tone: dueCount ? 'warn' : undefined },
      ]"
    >
      <template #actions>
        <RouterLink class="btn-default" to="/relations"><AppIcon name="link" :size="15" />关系图谱</RouterLink>
        <RouterLink class="btn-default" to="/quick">快速捕获</RouterLink>
        <RouterLink class="btn-primary" to="/documents?kind=note&create=note"><AppIcon name="plus" :size="15" />新建笔记</RouterLink>
      </template>
    </PageHeader>

    <nav class="grid gap-2 mb-4 grid-cols-2 md:grid-cols-4 2xl:grid-cols-8" aria-label="知识空间常用任务">
      <RouterLink
        v-for="action in knowledgeWorkflowActions"
        :key="action.id"
        v-memo="[action.id]"
        :to="action.to"
        class="row gap-2 px-2.5 py-2 rounded-md panel transition-colors duration-120 hover:border-accent hover:bg-accent-soft"
      >
        <span class="center w-7 h-7 shrink-0 rounded-sm bg-surface-2 text-accent"><AppIcon :name="action.icon" :size="14" /></span>
        <span class="stack gap-0.5 min-w-0 flex-1">
          <b class="text-[12px] font-medium truncate text-fg">{{ action.label }}</b>
          <small class="text-[11px] truncate text-fg-3">{{ action.detail }}</small>
        </span>
      </RouterLink>
    </nav>

    <div class="grid gap-4 grid-cols-1 xl:grid-cols-[minmax(0,1fr)_minmax(260px,300px)]">
      <section class="pane min-w-0" aria-label="知识内容">
        <div class="row flex-wrap gap-x-3 gap-y-2 shrink-0 px-3 py-2 border-b border-line">
          <label class="row gap-1.5 min-w-48 flex-1 max-w-104 h-8 px-2.5 rounded-sm bg-well border border-line focus-within:border-accent">
            <AppIcon name="search" :size="14" class="shrink-0 text-fg-3" />
            <input v-model="query" class="min-w-0 flex-1 bg-transparent border-0 text-[12px] text-fg focus:outline-none" aria-label="搜索知识正文与结构化内容" placeholder="搜索正文、题干、解析、词义、标签或资料…" />
            <button v-if="query" class="center w-5 h-5 shrink-0 rounded-sm text-fg-3 hover:text-fg" aria-label="清空搜索" @click="query = ''"><AppIcon name="close" :size="11" /></button>
          </label>
          <small class="ml-auto shrink-0 text-[11px] text-fg-3" aria-live="polite">
            {{ query.trim()
              ? (searchPending ? '正在检索正文…' : `${filteredItems.length} 项匹配`)
              : favoritesOnly ? `${favoriteCount} 项收藏`
              : recentsOnly ? `${recentCount} 项最近打开`
              : '最近更新' }}
          </small>
        </div>

        <!-- The area cards were a band of their own above the library. They
             are filters, so they live with the other filters. -->
        <nav class="row flex-wrap gap-1.5 shrink-0 px-3 py-2 border-b border-line" aria-label="知识类型筛选">
          <button
            class="row gap-1.5 h-7 px-2.5 rounded-full border text-[11px] whitespace-nowrap transition-colors duration-120"
            :class="activeKind === 'all' && !favoritesOnly && !recentsOnly ? 'border-accent bg-accent-soft text-accent font-medium' : 'border-line text-fg-2 hover:border-line-strong hover:text-fg'"
            @click="selectKind('all')"
          >
            全部 <span class="tabular-nums text-fg-3">{{ totalCount }}</span>
          </button>
          <button
            v-for="area in areas"
            :key="area.id"
            class="row gap-1.5 h-7 px-2.5 rounded-full border text-[11px] whitespace-nowrap transition-colors duration-120"
            :class="activeKind === area.id ? 'border-accent bg-accent-soft text-accent font-medium' : 'border-line text-fg-2 hover:border-line-strong hover:text-fg'"
            aria-haspopup="menu"
            :aria-expanded="areaMenu?.area.id === area.id"
            :title="`${area.label}；右键或 Shift+F10 查看新建与导入操作`"
            @click="selectKind(area.id)"
            @contextmenu="showAreaMenu($event, area)"
            @keydown="showAreaMenuFromKeyboard($event, area)"
          >
            <AppIcon :name="area.icon" :size="13" />{{ area.label }}
            <span class="tabular-nums text-fg-3">{{ area.count }}</span>
          </button>
          <i class="w-px h-5 mx-1 bg-line" aria-hidden="true" />
          <button
            class="row gap-1.5 h-7 px-2.5 rounded-full border text-[11px] whitespace-nowrap transition-colors duration-120"
            :class="favoritesOnly ? 'border-accent bg-accent-soft text-accent font-medium' : 'border-line text-fg-2 hover:border-line-strong hover:text-fg'"
            @click="toggleFavoritesFilter"
          >
            <AppIcon name="star" :size="12" />收藏 <span class="tabular-nums text-fg-3">{{ favoriteCount }}</span>
          </button>
          <button
            class="row gap-1.5 h-7 px-2.5 rounded-full border text-[11px] whitespace-nowrap transition-colors duration-120"
            :class="recentsOnly ? 'border-accent bg-accent-soft text-accent font-medium' : 'border-line text-fg-2 hover:border-line-strong hover:text-fg'"
            @click="toggleRecentsFilter"
          >
            <AppIcon name="clock" :size="12" />最近 <span class="tabular-nums text-fg-3">{{ recentCount }}</span>
          </button>
          <button v-if="recentsOnly && recentCount" class="btn-tool" @click="clearRecents">清空记录</button>
        </nav>

        <p v-if="searchError && query.trim()" class="row gap-2 shrink-0 px-3 py-2 border-b border-line bg-warn-soft text-[11px] leading-relaxed text-warn" role="status">
          <AppIcon name="warning" :size="13" class="shrink-0 mt-0.5" />{{ searchError }}
        </p>

        <div v-if="query.trim() && searchPending" class="stack items-center gap-2 px-6 py-14 text-center" role="status" aria-live="polite">
          <i class="w-2 h-2 rounded-full bg-accent animate-pulse" aria-hidden="true" />
          <b class="text-[13px] font-medium text-fg">正在检索本地知识索引</b>
          <small class="max-w-96 text-[11px] leading-relaxed text-fg-3">查询笔记正文、题目解析、错因、词义与例句，不读取整篇内容到页面。</small>
        </div>

        <div v-else-if="filteredItems.length" class="stack gap-0.5 p-1.5">
          <RouterLink
            v-for="item in filteredItems"
            :key="`${item.kind}:${item.id}`"
            v-memo="[item.kind, item.id, item.title, item.detail, item.timestamp, item.snippetParts, store.isContentFavorite(item.kind, item.id)]"
            :to="item.to"
            class="row gap-2.5 px-2 py-2 rounded-sm transition-colors duration-120 hover:bg-surface-2"
            aria-haspopup="menu"
            :aria-expanded="menu?.item.id === item.id && menu?.item.kind === item.kind"
            :aria-label="`${item.title}；右键可打开快捷菜单`"
            @contextmenu="showMenu($event, item)"
            @keydown="showMenuFromKeyboard($event, item)"
          >
            <span class="center w-8 h-8 shrink-0 rounded-sm bg-surface-2 text-fg-2"><AppIcon :name="kindIcons[item.kind]" :size="15" /></span>
            <span class="stack gap-0.5 min-w-0 flex-1">
              <b class="text-[12px] font-medium truncate text-fg">{{ item.title }}</b>
              <small class="text-[11px] truncate text-fg-3">{{ item.detail }}</small>
              <p v-if="item.snippetParts?.length" class="text-[11px] leading-relaxed line-clamp-2 text-fg-3">
                <template v-for="(part, index) in item.snippetParts" :key="`${index}:${part.text}`">
                  <mark v-if="part.highlighted" class="rounded-[3px] px-0.5 bg-accent-soft text-accent">{{ part.text }}</mark>
                  <span v-else>{{ part.text }}</span>
                </template>
              </p>
            </span>
            <i class="row gap-1 shrink-0 text-[11px] not-italic" :class="store.isContentFavorite(item.kind, item.id) ? 'text-warn' : 'text-fg-3'">
              <AppIcon v-if="store.isContentFavorite(item.kind, item.id)" name="star" :size="11" />{{ kindLabels[item.kind] }}
            </i>
            <time class="shrink-0 text-[11px] tabular-nums text-fg-3">{{ formatDate(recentsOnly ? recentTimestamp(item) : item.timestamp) }}</time>
          </RouterLink>
        </div>

        <div v-else class="stack items-center gap-2 px-6 py-14 text-center">
          <span class="center w-11 h-11 rounded-lg bg-surface-2 text-fg-3">
            <AppIcon :name="favoritesOnly ? 'star' : recentsOnly ? 'clock' : 'search'" :size="20" />
          </span>
          <b class="text-[13px] font-medium text-fg">
            {{ favoritesOnly ? '还没有收藏内容' : recentsOnly ? '还没有最近打开的内容' : totalCount ? '没有匹配的内容' : '知识库还是空的' }}
          </b>
          <p class="max-w-96 text-[11px] leading-relaxed text-fg-3">
            {{ favoritesOnly ? '在任意知识条目上右键或按 Shift+F10，即可加入收藏。'
              : recentsOnly ? '打开一篇笔记、一道题目、一个单词、一份资料或一个画布后，它会自动出现在这里。'
              : totalCount ? '换一个关键词或内容类型继续查找。'
              : '先新建一篇笔记、记录一个单词，或收进一份资料。' }}
          </p>
          <button class="btn-default btn-sm" @click="resetEmptyState">
            {{ favoritesOnly || recentsOnly ? '返回最近更新' : totalCount ? '查看全部内容' : '查看开始方式' }}
          </button>
        </div>
      </section>

      <aside class="pane self-start" aria-label="知识库健康度">
        <header class="pane-head">
          <span class="pane-title">知识状态</span>
          <RouterLink to="/review" class="text-[11px] text-accent hover:underline underline-offset-2">去复习</RouterLink>
        </header>
        <div class="stack gap-3 p-3">
          <div v-for="metric in healthMetrics" :key="metric.label" class="stack gap-1.5">
            <div class="row-between gap-2">
              <b class="text-[12px] font-medium text-fg">{{ metric.label }}</b>
            </div>
            <div class="h-1 rounded-full bg-surface-2 overflow-hidden">
              <i class="block h-full rounded-full bg-accent-solid" :style="{ width: metric.value }" aria-hidden="true" />
            </div>
            <small class="text-[11px] leading-relaxed text-fg-3">{{ metric.detail }}</small>
          </div>
        </div>
      </aside>
    </div>

    <Teleport to="body">
      <section
        v-if="menu"
        ref="menuElement"
        class="menu-panel w-64"
        role="menu"
        :aria-label="`${menu.item.title}操作菜单`"
        :style="{ left: `${menu.x}px`, top: `${menu.y}px` }"
        @click.stop
        @contextmenu.prevent
        @keydown.stop="handleMenuKeydown"
      >
        <p class="menu-title">{{ kindLabels[menu.item.kind] }}<small class="min-w-0 truncate font-normal">{{ menu.item.title }}</small></p>
        <button class="menu-item" role="menuitem" @click="openItem(menu.item)"><span class="row gap-2"><AppIcon name="arrow-right" :size="14" />继续打开</span></button>
        <template v-if="menu.item.kind === 'note' || menu.item.kind === 'question'">
          <button class="menu-item" role="menuitem" @click="openDocumentMode(menu.item, 'edit')"><span class="row gap-2"><AppIcon name="code" :size="14" />{{ menu.item.kind === 'note' ? '源码编辑' : '编辑题目' }}</span></button>
          <button class="menu-item" role="menuitem" @click="openDocumentMode(menu.item, 'preview')"><span class="row gap-2"><AppIcon name="book" :size="14" />{{ menu.item.kind === 'note' ? '阅读预览' : '阅读题目与解析' }}</span></button>
          <button v-if="menu.item.kind === 'note'" class="menu-item" role="menuitem" @click="openDocumentMode(menu.item, 'mindmap')"><span class="row gap-2"><AppIcon name="sort" :size="14" />思维图谱</span></button>
        </template>
        <i class="menu-sep" aria-hidden="true" />
        <button class="menu-item" role="menuitem" @click="toggleItemFavorite(menu.item)"><span class="row gap-2"><AppIcon name="star" :size="14" />{{ store.isContentFavorite(menu.item.kind, menu.item.id) ? '取消收藏' : '加入收藏' }}</span></button>
        <button v-if="store.isContentRecent(menu.item.kind, menu.item.id)" class="menu-item" role="menuitem" @click="removeItemFromRecents(menu.item)"><span class="row gap-2"><AppIcon name="clock" :size="14" />从最近使用移除</span></button>
        <button class="menu-item" role="menuitem" @click="createRelatedNote(menu.item)"><span class="row gap-2"><AppIcon name="link" :size="14" />创建关联笔记</span></button>
        <button class="menu-item" role="menuitem" @click="copyReference(menu.item)">
          <span class="row gap-2"><AppIcon name="duplicate" :size="14" />{{ menu.item.kind === 'source' ? '复制资料名称' : menu.item.kind === 'diagram' ? '复制画布名称' : '复制双链' }}</span>
        </button>
      </section>

      <section
        v-if="areaMenu"
        ref="areaMenuElement"
        class="menu-panel w-72"
        role="menu"
        :aria-label="`${areaMenu.area.label}开始菜单`"
        :style="{ left: `${areaMenu.x}px`, top: `${areaMenu.y}px` }"
        @click.stop
        @contextmenu.prevent
        @keydown.stop="handleAreaMenuKeydown"
      >
        <p class="menu-title">{{ areaMenu.area.label }}<small class="font-normal tabular-nums">{{ areaMenu.area.count }} 项本地内容</small></p>
        <button v-for="action in areaMenu.actions" :key="action.id" class="menu-item" role="menuitem" @click="runAreaAction(action)">
          <span class="row gap-2 min-w-0">
            <AppIcon :name="action.icon" :size="14" class="shrink-0" />
            <span class="stack gap-0.5 min-w-0"><b class="font-medium">{{ action.label }}</b><small class="text-[11px] text-fg-3">{{ action.detail }}</small></span>
          </span>
          <AppIcon name="arrow-right" :size="12" class="shrink-0" />
        </button>
      </section>
    </Teleport>
  </div>
</template>
