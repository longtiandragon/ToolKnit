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
  <div class="knowledge-space page-enter mx-auto w-full max-w-320 px-8 py-6" @click="closeKnowledgeMenus()">
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

    <section class="knowledge-space__areas" aria-label="知识内容分类">
      <RouterLink v-for="area in areas" :key="area.id" :to="area.to" aria-haspopup="menu" :aria-expanded="areaMenu?.area.id === area.id" :title="`${area.label}；右键或 Shift+F10 查看新建与导入操作`" @click="selectKind(area.id)" @contextmenu="showAreaMenu($event, area)" @keydown="showAreaMenuFromKeyboard($event, area)">
        <span><AppIcon :name="area.icon" :size="18" /></span>
        <div><b>{{ area.label }}</b><small>{{ area.detail }}</small></div>
        <strong>{{ area.count }}</strong>
      </RouterLink>
    </section>

    <section class="knowledge-space__starts" aria-labelledby="knowledge-starts-heading">
      <header><div><p class="eyebrow">先选一件事</p><h3 id="knowledge-starts-heading">创建、导入与打开，都在这里开始</h3></div><p>八个高频任务直接进入真实工作流；分类卡右键也能找到同一组动作。</p></header>
      <nav aria-label="知识空间常用任务">
        <RouterLink v-for="action in knowledgeWorkflowActions" :key="action.id" v-memo="[action.id]" :to="action.to">
          <span><AppIcon :name="action.icon" :size="15" /></span><div><b>{{ action.label }}</b><small>{{ action.detail }}</small></div><AppIcon name="arrow-right" :size="12" />
        </RouterLink>
      </nav>
    </section>

    <section class="knowledge-space__body">
      <main>
        <header class="knowledge-space__toolbar">
          <label><AppIcon name="search" :size="16" /><input v-model="query" aria-label="搜索知识正文与结构化内容" placeholder="搜索正文、题干、解析、词义、标签或资料…" /><button v-if="query" aria-label="清空搜索" @click="query = ''">×</button></label>
          <nav aria-label="知识类型筛选">
            <button :class="{ active: activeKind === 'all' }" @click="selectKind('all')">全部</button>
            <button class="knowledge-space__favorite-filter" :class="{ active: favoritesOnly }" @click="toggleFavoritesFilter"><AppIcon name="star" :size="12" />收藏 {{ favoriteCount }}</button>
            <button class="knowledge-space__recent-filter" :class="{ active: recentsOnly }" @click="toggleRecentsFilter"><AppIcon name="clock" :size="12" />最近 {{ recentCount }}</button>
            <button v-for="area in areas" :key="area.id" :class="{ active: activeKind === area.id }" @click="selectKind(area.id)">{{ kindLabels[area.id] }}</button>
            <button v-if="recentsOnly && recentCount" class="knowledge-space__clear-recents" @click="clearRecents">清空记录</button>
          </nav>
          <small aria-live="polite">{{ query.trim() ? searchPending ? '正在检索正文…' : `${filteredItems.length} 项匹配` : favoritesOnly ? `${favoriteCount} 项收藏` : recentsOnly ? `${recentCount} 项最近打开` : '最近更新' }}</small>
        </header>

        <p v-if="searchError && query.trim()" class="knowledge-space__search-notice" role="status"><AppIcon name="warning" :size="14" />{{ searchError }}</p>
        <section v-if="query.trim() && searchPending" class="knowledge-space__searching" role="status" aria-live="polite"><span></span><div><b>正在检索本地知识索引</b><small>查询笔记正文、题目解析、错因、词义与例句，不读取整篇内容到页面。</small></div></section>
        <section v-else-if="filteredItems.length" class="knowledge-space__items" aria-label="知识内容">
          <RouterLink
            v-for="item in filteredItems"
            :key="`${item.kind}:${item.id}`"
            v-memo="[item.kind, item.id, item.title, item.detail, item.timestamp, item.snippetParts, store.isContentFavorite(item.kind, item.id)]"
            :to="item.to"
            class="knowledge-space__item"
            aria-haspopup="menu"
            :aria-expanded="menu?.item.id === item.id && menu?.item.kind === item.kind"
            :aria-label="`${item.title}；右键可打开快捷菜单`"
            @contextmenu="showMenu($event, item)"
            @keydown="showMenuFromKeyboard($event, item)"
          >
            <span><AppIcon :name="kindIcons[item.kind]" :size="17" /></span>
            <div><b>{{ item.title }}</b><small>{{ item.detail }}</small><p v-if="item.snippetParts?.length" class="knowledge-space__match"><template v-for="(part, index) in item.snippetParts" :key="`${index}:${part.text}`"><mark v-if="part.highlighted">{{ part.text }}</mark><span v-else>{{ part.text }}</span></template></p></div>
            <i :class="{ favorite: store.isContentFavorite(item.kind, item.id) }"><AppIcon v-if="store.isContentFavorite(item.kind, item.id)" name="star" :size="10" />{{ kindLabels[item.kind] }}</i>
            <time>{{ formatDate(recentsOnly ? recentTimestamp(item) : item.timestamp) }}</time>
          </RouterLink>
        </section>
        <section v-else class="knowledge-space__empty">
          <span><AppIcon :name="favoritesOnly ? 'star' : recentsOnly ? 'clock' : 'search'" :size="22" /></span><b>{{ favoritesOnly ? '还没有收藏内容' : recentsOnly ? '还没有最近打开的内容' : totalCount ? '没有匹配的内容' : '知识库还是空的' }}</b>
          <p>{{ favoritesOnly ? '在任意知识条目上右键或按 Shift+F10，即可加入收藏。' : recentsOnly ? '打开一篇笔记、一道题目、一个单词、一份资料或一个画布后，它会自动出现在这里。' : totalCount ? '换一个关键词或内容类型继续查找。' : '先新建一篇笔记、记录一个单词，或收进一份资料。' }}</p>
          <button class="quiet-button" @click="resetEmptyState">{{ favoritesOnly || recentsOnly ? '返回最近更新' : totalCount ? '查看全部内容' : '查看开始方式' }}</button>
        </section>
      </main>

      <aside class="knowledge-space__side">
        <section>
          <header><div><p class="eyebrow">从这里开始</p><h3>快速开始</h3></div></header>
          <RouterLink to="/documents?kind=note&create=note"><span><AppIcon name="book" :size="15" /></span><div><b>写一篇 Markdown</b><small>标准 .md 与本地 Vault</small></div><AppIcon name="arrow-right" :size="13" /></RouterLink>
          <RouterLink to="/documents?kind=question&create=question"><span><AppIcon name="review" :size="15" /></span><div><b>记录一道错题</b><small>保留答案、解析与错因</small></div><AppIcon name="arrow-right" :size="13" /></RouterLink>
          <RouterLink to="/words"><span><AppIcon name="sort" :size="15" /></span><div><b>添加结构化单词</b><small>多词性、多义项、独立卡片</small></div><AppIcon name="arrow-right" :size="13" /></RouterLink>
          <RouterLink to="/library"><span><AppIcon name="inbox" :size="15" /></span><div><b>收进资料</b><small>PDF、图片、代码与文本</small></div><AppIcon name="arrow-right" :size="13" /></RouterLink>
          <RouterLink to="/visual"><span><AppIcon name="palette" :size="15" /></span><div><b>打开图片画布</b><small>拼图、标注与可继续编辑项目</small></div><AppIcon name="arrow-right" :size="13" /></RouterLink>
        </section>
        <section class="knowledge-space__health">
          <header><div><p class="eyebrow">知识库健康度</p><h3>知识状态</h3></div><RouterLink to="/review">去复习</RouterLink></header>
          <div><span><i style="--value: 100%"></i></span><p><b>{{ store.vaultReady ? '资料库就绪' : '正在连接资料库' }}</b><small>桌面数据写入 SQLite 与 Markdown Vault</small></p></div>
          <div><span><i :style="{ '--value': `${Math.min(100, store.relations.length * 8)}%` }"></i></span><p><b>{{ store.relations.length }} 条手动关联</b><small>双链与完整关系可在知识关系图谱中浏览</small></p></div>
          <div><span><i :style="{ '--value': `${Math.min(100, dueCount * 10)}%` }"></i></span><p><b>{{ dueCount ? `${dueCount} 张卡片到期` : '当前没有到期卡片' }}</b><small>题目与词义按各自节奏安排复习</small></p></div>
        </section>
      </aside>
    </section>

    <section v-if="menu" ref="menuElement" class="knowledge-space__menu" role="menu" :aria-label="`${menu.item.title}操作菜单`" :style="{ left: `${menu.x}px`, top: `${menu.y}px` }" @click.stop @contextmenu.prevent @keydown.stop="handleMenuKeydown">
      <header><span>{{ kindLabels[menu.item.kind] }}</span><b>{{ menu.item.title }}</b></header>
      <button role="menuitem" @click="openItem(menu.item)"><AppIcon name="arrow-right" :size="15" />继续打开</button>
      <template v-if="menu.item.kind === 'note' || menu.item.kind === 'question'">
        <button role="menuitem" @click="openDocumentMode(menu.item, 'edit')"><AppIcon name="code" :size="15" />{{ menu.item.kind === 'note' ? '源码编辑' : '编辑题目' }}</button>
        <button role="menuitem" @click="openDocumentMode(menu.item, 'preview')"><AppIcon name="book" :size="15" />{{ menu.item.kind === 'note' ? '阅读预览' : '阅读题目与解析' }}</button>
        <button v-if="menu.item.kind === 'note'" role="menuitem" @click="openDocumentMode(menu.item, 'mindmap')"><AppIcon name="sort" :size="15" />思维图谱</button>
      </template>
      <button role="menuitem" @click="toggleItemFavorite(menu.item)"><AppIcon name="star" :size="15" />{{ store.isContentFavorite(menu.item.kind, menu.item.id) ? '取消收藏' : '加入收藏' }}</button>
      <button v-if="store.isContentRecent(menu.item.kind, menu.item.id)" role="menuitem" @click="removeItemFromRecents(menu.item)"><AppIcon name="clock" :size="15" />从最近使用移除</button>
      <button role="menuitem" @click="createRelatedNote(menu.item)"><AppIcon name="link" :size="15" />创建关联笔记</button>
      <button role="menuitem" @click="copyReference(menu.item)"><AppIcon name="duplicate" :size="15" />{{ menu.item.kind === 'source' ? '复制资料名称' : menu.item.kind === 'diagram' ? '复制画布名称' : '复制双链' }}</button>
    </section>
    <section v-if="areaMenu" ref="areaMenuElement" class="knowledge-space__area-menu" role="menu" :aria-label="`${areaMenu.area.label}开始菜单`" :style="{ left: `${areaMenu.x}px`, top: `${areaMenu.y}px` }" @click.stop @contextmenu.prevent @keydown.stop="handleAreaMenuKeydown">
      <header><span>{{ areaMenu.area.count }} 项本地内容</span><b>{{ areaMenu.area.label }}</b></header>
      <button v-for="action in areaMenu.actions" :key="action.id" role="menuitem" @click="runAreaAction(action)"><AppIcon :name="action.icon" :size="15" /><span><b>{{ action.label }}</b><small>{{ action.detail }}</small></span><AppIcon name="arrow-right" :size="12" /></button>
    </section>
  </div>
</template>

<style scoped>
.knowledge-space{max-width:1460px;margin:0 auto;padding:26px 30px 54px;color:var(--text)}
.knowledge-space__hero{grid-template-columns:minmax(0,1fr) 255px;overflow:hidden;box-shadow:0 20px 48px var(--accent-soft)}
.knowledge-space__intro{position:relative;display:flex;align-items:flex-start;flex-direction:column;justify-content:center;padding:31px 39px;background-image:radial-gradient(var(--surface-2) 1px,transparent 1px);background-size:25px 25px}.knowledge-space__intro:after{position:absolute;content:'';right:-55px;top:-155px;width:310px;height:310px;border:1px solid var(--surface-2);border-radius:50%;box-shadow:0 0 0 35px var(--surface-2),0 0 0 70px var(--surface-2);pointer-events:none}.knowledge-space__hero .eyebrow{}.knowledge-space__hero h2{position:relative;z-index:1;max-width:760px;margin:10px 0 11px;font:720 clamp(29px,3.3vw,44px)/1.1 var(--font-display);letter-spacing:-.045em}.knowledge-space__hero h2 em{font-style:normal}.knowledge-space__intro>p:not(.eyebrow){position:relative;z-index:1;max-width:720px;color:var(--fg);font-size:12px;line-height:1.72}.knowledge-space__actions{position:relative;z-index:1;display:flex;gap:8px;margin-top:19px}.knowledge-space__actions a{display:inline-flex;align-items:center;gap:7px;min-height:37px;padding:0 13px}.knowledge-space__actions .primary-button{color:var(--accent);background:var(--surface)}.knowledge-space__actions .quiet-button{border-color:var(--fg);color:var(--fg);background:var(--surface-2)}
.knowledge-space__hero>aside{display:grid;grid-template-rows:auto 1fr auto;padding:22px;border-left:1px solid var(--surface-2)}.knowledge-space__hero>aside>span{display:flex;align-items:center;gap:7px;font-size:9px}.knowledge-space__hero>aside>span i{width:7px;height:7px;box-shadow:0 0 0 4px var(--accent-soft)}.knowledge-space__hero>aside>span i.warning{}.knowledge-space__hero>aside>div{align-self:center;display:grid}.knowledge-space__hero>aside>div b{font:760 50px/1 var(--font-mono);letter-spacing:-.07em}.knowledge-space__hero>aside>div small{margin-top:5px;font:8px var(--font-mono);letter-spacing:.09em}.knowledge-space__hero>aside footer{display:grid;grid-template-columns:1fr 1fr;padding-top:13px;border-top:1px solid var(--surface-2);font-size:9px}.knowledge-space__hero>aside footer span+span{padding-left:13px;border-left:1px solid var(--surface-2)}.knowledge-space__hero>aside footer strong{display:block;margin-bottom:3px;font:700 16px var(--font-mono)}
.knowledge-space__areas{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:9px;padding:17px 0}.knowledge-space__areas>a{display:grid;grid-template-columns:34px minmax(0,1fr) auto;align-items:center;gap:10px;min-height:64px;padding:10px 12px;border:1px solid var(--line);border-radius:13px;color:var(--text-secondary);background:var(--surface-2);box-shadow:0 6px 18px var(--accent-soft)}.knowledge-space__areas>a:hover,.knowledge-space__areas>a:focus-visible{border-color:var(--accent);color:var(--green-strong);background:var(--surface)}.knowledge-space__areas>a>span{display:grid;width:34px;height:34px;place-items:center;border-radius:10px;color:var(--green-strong);background:var(--green-bg)}.knowledge-space__areas>a>div{display:grid;min-width:0;gap:3px}.knowledge-space__areas b,.knowledge-space__areas small{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.knowledge-space__areas b{font:680 11px var(--font-ui)}.knowledge-space__areas small{color:var(--muted);font-size:8px}.knowledge-space__areas strong{color:var(--green-strong);font:720 17px var(--font-mono)}
.knowledge-space__starts{display:grid;grid-template-columns:250px minmax(0,1fr);gap:10px;margin:0 0 14px}.knowledge-space__starts>header{display:flex;align-items:flex-start;flex-direction:column;justify-content:center;padding:13px 15px;border:1px solid var(--accent-soft);border-radius:14px;background:linear-gradient(135deg,var(--green-bg),var(--surface))}.knowledge-space__starts h3{margin-top:5px;font:700 15px/1.25 var(--font-display);letter-spacing:-.02em}.knowledge-space__starts>header>p:last-child{margin:7px 0 0;color:var(--muted);font-size:9px;line-height:1.5}.knowledge-space__starts>nav{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:1px;overflow:hidden;border:1px solid var(--line);border-radius:14px;background:var(--line);box-shadow:0 8px 22px var(--accent-soft)}.knowledge-space__starts a{display:grid;grid-template-columns:28px minmax(0,1fr) auto;align-items:center;gap:8px;min-height:55px;padding:8px 9px;color:var(--text);background:var(--surface);outline:0}.knowledge-space__starts a:hover,.knowledge-space__starts a:focus-visible{color:var(--green-strong);background:var(--green-bg)}.knowledge-space__starts a:focus-visible{box-shadow:inset 0 0 0 2px color-mix(in srgb,var(--green) 48%,transparent)}.knowledge-space__starts a>span{display:grid;width:28px;height:28px;place-items:center;border:1px solid var(--accent-soft);border-radius:8px;color:var(--green-strong);background:var(--surface)}.knowledge-space__starts a>div{display:grid;min-width:0;gap:3px}.knowledge-space__starts b,.knowledge-space__starts small{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.knowledge-space__starts b{font:670 10px var(--font-ui)}.knowledge-space__starts small{color:var(--muted);font-size:9px}.knowledge-space__starts a>.app-icon{color:var(--muted)}
.knowledge-space__body{display:grid;grid-template-columns:minmax(0,1fr) 294px;gap:14px;align-items:start}.knowledge-space__body>main,.knowledge-space__side>section{overflow:hidden;border:1px solid var(--line);border-radius:16px;background:var(--surface-2);box-shadow:0 12px 30px var(--accent-soft)}.knowledge-space__toolbar{display:grid;grid-template-columns:minmax(240px,1fr) auto;align-items:center;gap:8px 10px;padding:13px;border-bottom:1px solid var(--line-weak)}.knowledge-space__toolbar label{display:flex;min-width:0;align-items:center;gap:8px;height:38px;padding:0 11px;border:1px solid var(--line);border-radius:10px;color:var(--muted);background:var(--canvas)}.knowledge-space__toolbar label:focus-within{border-color:var(--green);box-shadow:0 0 0 3px color-mix(in srgb,var(--green) 12%,transparent)}.knowledge-space__toolbar input{min-width:0;flex:1;border:0;outline:0;color:var(--text);background:transparent;font-size:11px}.knowledge-space__toolbar label button{width:24px;height:24px;padding:0;border:0;color:var(--muted);background:transparent}.knowledge-space__toolbar nav{display:flex;grid-row:2;grid-column:1/-1;gap:3px;overflow-x:auto;scrollbar-width:thin}.knowledge-space__toolbar nav button{min-height:30px;flex:0 0 auto;padding:0 7px;border:1px solid transparent;border-radius:7px;color:var(--muted);background:transparent;font-size:8px;white-space:nowrap}.knowledge-space__toolbar nav button:hover,.knowledge-space__toolbar nav button.active{border-color:var(--accent-soft);color:var(--green-strong);background:var(--green-bg)}.knowledge-space__toolbar>small{grid-row:1;grid-column:2;color:var(--muted);font:8px var(--font-mono);white-space:nowrap}
.knowledge-space__search-notice{display:flex;align-items:center;gap:7px;margin:0;padding:9px 14px;border-bottom:1px solid var(--warn-soft);color:var(--danger);background:var(--warn-soft);font-size:9px}.knowledge-space__searching{display:flex;min-height:248px;align-items:center;justify-content:center;gap:13px;padding:34px;color:var(--muted)}.knowledge-space__searching>span{width:18px;height:18px;border:2px solid var(--accent-soft);border-top-color:var(--green);border-radius:50%;animation:knowledge-search-spin .8s linear infinite}.knowledge-space__searching>div{display:grid;gap:4px}.knowledge-space__searching b{color:var(--text);font-size:12px}.knowledge-space__searching small{max-width:410px;font-size:9px;line-height:1.5}@keyframes knowledge-search-spin{to{transform:rotate(1turn)}}
.knowledge-space__items{display:grid;padding:5px 13px 9px}.knowledge-space__item{display:grid;grid-template-columns:34px minmax(0,1fr) auto 42px;align-items:center;gap:10px;min-height:66px;padding:9px;border-bottom:1px solid var(--line-weak);color:var(--text);cursor:context-menu}.knowledge-space__item:hover,.knowledge-space__item:focus-visible{color:var(--green-strong);background:linear-gradient(90deg,var(--green-bg),transparent)}.knowledge-space__item:focus-visible{outline:2px solid color-mix(in srgb,var(--green) 46%,transparent);outline-offset:-2px}.knowledge-space__item>span{display:grid;width:33px;height:33px;place-items:center;border-radius:9px;color:var(--green-strong);background:var(--accent-soft)}.knowledge-space__item>div{display:grid;min-width:0;gap:4px}.knowledge-space__item b,.knowledge-space__item small{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.knowledge-space__item b{font:670 11px var(--font-ui)}.knowledge-space__item small{color:var(--muted);font-size:9px}.knowledge-space__item>i{padding:3px 6px;border-radius:5px;color:var(--green-strong);background:var(--green-bg);font:8px var(--font-ui);font-style:normal}.knowledge-space__item time{color:var(--muted);font:8px var(--font-mono);text-align:right}.knowledge-space__empty{display:grid;min-height:300px;place-content:center;justify-items:center;padding:36px;color:var(--muted);text-align:center}.knowledge-space__empty>span{display:grid;width:46px;height:46px;margin-bottom:12px;place-items:center;border-radius:14px;color:var(--green-strong);background:var(--green-bg)}.knowledge-space__empty b{color:var(--text);font:700 15px var(--font-ui)}.knowledge-space__empty p{max-width:340px;margin:7px 0 14px;font-size:10px;line-height:1.6}
.knowledge-space__match{overflow:hidden;margin:0;color:var(--text-secondary);font:9px/1.45 var(--font-ui);text-overflow:ellipsis;white-space:nowrap}.knowledge-space__match mark{padding:1px 2px;border-radius:3px;color:var(--accent);background:var(--accent-soft);font-weight:750}@media(prefers-reduced-motion:reduce){.knowledge-space__searching>span{animation:none;border-color:var(--accent-soft);border-top-color:var(--green)}}
.knowledge-space__side{display:grid;gap:11px}.knowledge-space__side>section>header{display:flex;align-items:flex-end;justify-content:space-between;gap:10px;padding:13px;border-bottom:1px solid var(--line-weak)}.knowledge-space__side h3{margin-top:4px;font:700 14px var(--font-display)}.knowledge-space__side>section>header>a{color:var(--green-strong);font-size:9px}.knowledge-space__side>section>a{display:grid;grid-template-columns:29px minmax(0,1fr) auto;align-items:center;gap:8px;min-height:56px;padding:8px 11px;border-bottom:1px solid var(--line-weak);color:var(--text)}.knowledge-space__side>section>a:hover,.knowledge-space__side>section>a:focus-visible{color:var(--green-strong);background:var(--green-bg)}.knowledge-space__side>section>a>span{display:grid;width:29px;height:29px;place-items:center;border-radius:8px;color:var(--green-strong);background:var(--accent-soft)}.knowledge-space__side>section>a>div{display:grid;min-width:0;gap:3px}.knowledge-space__side>section>a b,.knowledge-space__side>section>a small{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.knowledge-space__side>section>a b{font-size:10px}.knowledge-space__side>section>a small{color:var(--muted);font-size:8px}.knowledge-space__health>div{display:grid;grid-template-columns:42px minmax(0,1fr);align-items:center;gap:9px;padding:11px 13px;border-bottom:1px solid var(--line-weak)}.knowledge-space__health>div:last-child{border-bottom:0}.knowledge-space__health>div>span{position:relative;display:block;width:40px;height:5px;overflow:hidden;border-radius:9px;background:var(--surface-2)}.knowledge-space__health>div>span i{position:absolute;inset:0 auto 0 0;width:var(--value);border-radius:inherit;background:var(--green)}.knowledge-space__health p{display:grid;gap:3px;margin:0}.knowledge-space__health b{font-size:9px}.knowledge-space__health small{color:var(--muted);font-size:8px;line-height:1.4}
.knowledge-space__menu{position:fixed;z-index:145;width:252px;overflow:hidden;border:1px solid var(--accent-soft);border-radius:12px;background:var(--surface);box-shadow:var(--shadow-lg);animation:knowledge-menu-in .14s ease-out both}.knowledge-space__menu>header{display:grid;gap:3px;padding:11px 13px 9px;border-bottom:1px solid var(--line-weak);background:linear-gradient(125deg,var(--green-bg),var(--surface-2))}.knowledge-space__menu>header span{color:var(--green-strong);font:700 8px var(--font-mono);letter-spacing:.1em}.knowledge-space__menu>header b{overflow:hidden;font:700 12px var(--font-ui);text-overflow:ellipsis;white-space:nowrap}.knowledge-space__menu button{display:flex;width:100%;min-height:39px;align-items:center;gap:9px;padding:0 13px;border:0;border-bottom:1px solid var(--line-weak);color:var(--text-secondary);background:transparent;font:650 10px var(--font-ui);text-align:left}.knowledge-space__menu button:last-child{border-bottom:0}.knowledge-space__menu button:hover,.knowledge-space__menu button:focus-visible{color:var(--green-strong);background:var(--green-bg)}.knowledge-space__menu button:focus-visible{outline:2px solid color-mix(in srgb,var(--green) 48%,transparent);outline-offset:-2px}@keyframes knowledge-menu-in{from{opacity:0;transform:translateY(-4px) scale(.985)}to{opacity:1;transform:none}}
.knowledge-space__area-menu{position:fixed;z-index:145;width:268px;overflow:hidden;border:1px solid var(--accent-soft);border-radius:13px;background:var(--surface);box-shadow:var(--shadow-lg);animation:knowledge-menu-in .14s ease-out both}.knowledge-space__area-menu>header{display:grid;gap:3px;padding:11px 13px 9px;border-bottom:1px solid var(--line-weak);background:linear-gradient(125deg,var(--green-bg),var(--surface-2))}.knowledge-space__area-menu>header span{color:var(--green-strong);font:700 9px var(--font-mono);letter-spacing:.08em}.knowledge-space__area-menu>header b{font:700 13px var(--font-ui)}.knowledge-space__area-menu>button{display:grid;width:100%;min-height:52px;grid-template-columns:25px minmax(0,1fr) auto;align-items:center;gap:8px;padding:7px 12px;border:0;border-bottom:1px solid var(--line-weak);color:var(--text-secondary);background:transparent;text-align:left}.knowledge-space__area-menu>button:last-child{border-bottom:0}.knowledge-space__area-menu>button:hover,.knowledge-space__area-menu>button:focus-visible{color:var(--green-strong);background:var(--green-bg)}.knowledge-space__area-menu>button:focus-visible{outline:2px solid color-mix(in srgb,var(--green) 48%,transparent);outline-offset:-2px}.knowledge-space__area-menu>button>span{display:grid;min-width:0;gap:3px}.knowledge-space__area-menu>button b,.knowledge-space__area-menu>button small{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.knowledge-space__area-menu>button b{font:660 11px var(--font-ui)}.knowledge-space__area-menu>button small{color:var(--muted);font-size:9px}
.knowledge-space__intro>p:not(.eyebrow){color:var(--fg);font-size:13px}
.knowledge-space__hero>aside>span{font-size:11px}.knowledge-space__hero>aside>div small{font-size:10px}.knowledge-space__hero>aside footer{font-size:10px}
.knowledge-space__areas b{font-size:12px}.knowledge-space__areas small{font-size:10px}
.knowledge-space__starts>header>p:last-child{font-size:11px;line-height:1.55}.knowledge-space__starts b{font-size:11px}.knowledge-space__starts small{font-size:10px}
.knowledge-space__toolbar input{font-size:12px}.knowledge-space__toolbar nav button,.knowledge-space__toolbar>small{font-size:10px}
.knowledge-space__search-notice{font-size:11px}.knowledge-space__searching small{font-size:11px;line-height:1.55}
.knowledge-space__item{cursor:pointer}.knowledge-space__item b{font-size:12px}.knowledge-space__item small{font-size:10px}.knowledge-space__item>i,.knowledge-space__item time{font-size:10px}.knowledge-space__match{font-size:10px;line-height:1.5}.knowledge-space__empty p{font-size:11px}
.knowledge-space__side>section>header>a{font-size:10px}.knowledge-space__side>section>a b{font-size:11px}.knowledge-space__side>section>a small,.knowledge-space__health small{font-size:10px}.knowledge-space__health b{font-size:11px}
.knowledge-space__menu>header span,.knowledge-space__area-menu>header span{font-size:10px}.knowledge-space__menu button{font-size:11px}.knowledge-space__area-menu>button b{font-size:12px}.knowledge-space__area-menu>button small{font-size:10px}
.knowledge-space__toolbar nav button{display:inline-flex;align-items:center;gap:4px}.knowledge-space__toolbar nav button.knowledge-space__favorite-filter.active{border-color:var(--warn-soft);color:var(--warn);background:var(--warn-soft)}.knowledge-space__item>i{display:inline-flex;align-items:center;gap:4px}.knowledge-space__item>i.favorite{color:var(--warn);background:var(--warn-soft)}
.knowledge-space__toolbar nav button.knowledge-space__recent-filter.active{border-color:var(--accent-soft);color:var(--green-strong);background:var(--green-bg)}.knowledge-space__toolbar nav button.knowledge-space__clear-recents{margin-left:auto;color:var(--danger);background:var(--danger-soft)}
@media(max-width:1320px){.knowledge-space__starts{grid-template-columns:1fr}.knowledge-space__starts>header{display:grid;grid-template-columns:auto minmax(0,1fr);column-gap:13px}.knowledge-space__starts>header>p:last-child{grid-column:2;margin:0}.knowledge-space__starts>nav{grid-template-columns:repeat(4,minmax(0,1fr))}}
@media(max-width:1120px){.knowledge-space__body{grid-template-columns:minmax(0,1fr) 270px}.knowledge-space__toolbar>small{display:none}.knowledge-space__areas{grid-template-columns:repeat(2,minmax(0,1fr))}.knowledge-space__starts{grid-template-columns:1fr}.knowledge-space__starts>header{display:grid;grid-template-columns:auto minmax(0,1fr);column-gap:13px}.knowledge-space__starts>header>p:last-child{grid-column:2;margin:0}}
@media(max-width:960px){.knowledge-space{padding:22px 18px 46px}.knowledge-space__hero{}.knowledge-space__hero>aside{display:none}.knowledge-space__starts>nav{grid-template-columns:repeat(2,minmax(0,1fr))}.knowledge-space__body{grid-template-columns:1fr}.knowledge-space__side{grid-template-columns:repeat(2,minmax(0,1fr))}.knowledge-space__toolbar{grid-template-columns:1fr}.knowledge-space__toolbar nav{overflow-x:auto}.knowledge-space__item{grid-template-columns:34px minmax(0,1fr) auto}.knowledge-space__item time{display:none}}
@media(max-width:640px){.knowledge-space__starts>header{display:block}.knowledge-space__starts>header>p:last-child{margin-top:7px}.knowledge-space__starts>nav{grid-template-columns:repeat(2,minmax(0,1fr))}}
</style>
