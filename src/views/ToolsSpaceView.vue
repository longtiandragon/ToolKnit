<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import AppIcon from '@/components/AppIcon.vue'
import PageHeader from '@/components/PageHeader.vue'
import { personalPackEnabled } from '@/lib/build-profile'
import { clampMenuPosition, isContextMenuShortcut, nextMenuItemIndex } from '@/lib/desktop-menu'
import { historyOutputPaths, historyReplayLocation } from '@/lib/history-list'
import { revealDesktopFile } from '@/lib/native'
import { toolCatalog, toolCatalogOwnerLocation, toolSpaceQuickTools, type ToolCatalogItem, type ToolSpaceFilterId } from '@/lib/tool-catalog'
import { useWorkbenchStore } from '@/stores/workbench'
import { useUiStore } from '@/stores/ui'
import type { Job } from '@/types'

const router = useRouter()
const route = useRoute()
const store = useWorkbenchStore()
const ui = useUiStore()
const query = ref('')
const activeFilter = ref<ToolSpaceFilterId>('all')
const visibleLimit = ref(14)
const focusedToolId = ref('')
const toolMenu = ref<{ tool: ToolCatalogItem; x: number; y: number } | null>(null)
const toolMenuElement = ref<HTMLElement>()
let toolMenuTrigger: HTMLElement | undefined
const jobMenu = ref<{ job: Job; x: number; y: number } | null>(null)
const jobMenuElement = ref<HTMLElement>()
let jobMenuTrigger: HTMLElement | undefined

const filters: { id: ToolSpaceFilterId; label: string; icon: string }[] = [
  { id: 'all', label: '全部工具', icon: 'toolbox' },
  { id: 'favorite', label: '我的收藏', icon: 'star' },
  { id: 'pdf', label: 'PDF 与文件', icon: 'file-pdf' },
  { id: 'image-media', label: '图片与媒体', icon: 'image' },
  { id: 'text-organize', label: '文本与整理', icon: 'sort' },
  { id: 'developer', label: '开发与脚本', icon: 'code' },
]

// Derive the directory and its categories from the same five-space ownership
// rule used by Ctrl+K. A newly added utility can no longer increase the total
// while disappearing from every category card.
const workspaceTools = toolCatalog.filter((tool) => toolCatalogOwnerLocation(tool).path === '/tool-space')
function catalogFilter(tool: ToolCatalogItem) { return toolCatalogOwnerLocation(tool).query?.filter as ToolSpaceFilterId | undefined }
const quickTools = toolSpaceQuickTools()
const favoriteIds = computed(() => new Set(store.favorites.map((favorite) => favorite.toolId)))
const categoryStats = computed(() => filters.slice(2).map((filter) => ({
  ...filter,
  count: workspaceTools.filter((tool) => catalogFilter(tool) === filter.id).length,
})))
const normalizedQuery = computed(() => query.value.trim().toLocaleLowerCase('zh-CN'))
const filteredTools = computed(() => workspaceTools.filter((tool) => {
  const filter = filters.find((item) => item.id === activeFilter.value)
  const matchesCategory = activeFilter.value === 'all'
    || (activeFilter.value === 'favorite' ? favoriteIds.value.has(tool.id) : catalogFilter(tool) === filter?.id)
  if (!matchesCategory) return false
  if (!normalizedQuery.value) return true
  return [tool.title, tool.description, tool.group, ...tool.keywords].join(' ').toLocaleLowerCase('zh-CN').includes(normalizedQuery.value)
}))
const visibleTools = computed(() => filteredTools.value.slice(0, visibleLimit.value))
const recentJobs = computed(() => store.jobs.slice().sort((left, right) => right.createdAt.localeCompare(left.createdAt)).slice(0, 6))
const runningCount = computed(() => store.jobs.filter((job) => job.status === 'running' || job.status === 'queued').length)
const completedCount = computed(() => store.jobs.filter((job) => job.status === 'succeeded').length)
const recentToolIds = computed(() => [...new Set(store.toolUsages.slice().sort((left, right) => right.usedAt.localeCompare(left.usedAt)).map((usage) => usage.toolId))].slice(0, 5))
const recentTools = computed(() => recentToolIds.value.flatMap((id) => {
  const tool = toolCatalog.find((item) => item.id === id)
  return tool ? [tool] : []
}))

watch([query, activeFilter], () => { visibleLimit.value = 14 })

function isFavorite(tool: ToolCatalogItem) { return favoriteIds.value.has(tool.id) }
function selectFilter(filter: ToolSpaceFilterId) { focusedToolId.value = ''; activeFilter.value = filter }
function routeToolFilter(value: unknown): ToolSpaceFilterId {
  return filters.some((filter) => filter.id === value) ? value as ToolSpaceFilterId : 'all'
}
async function revealRouteTool() {
  const focus = typeof route.query.focus === 'string' ? route.query.focus : ''
  if (!focus || !workspaceTools.some((tool) => tool.id === focus)) { focusedToolId.value = ''; return }
  query.value = ''
  activeFilter.value = routeToolFilter(route.query.filter)
  let index = filteredTools.value.findIndex((tool) => tool.id === focus)
  if (index < 0) {
    activeFilter.value = 'all'
    index = filteredTools.value.findIndex((tool) => tool.id === focus)
  }
  visibleLimit.value = Math.max(14, index + 1)
  focusedToolId.value = focus
  await nextTick()
  const target = [...document.querySelectorAll<HTMLElement>('[data-tool-id]')].find((element) => element.dataset.toolId === focus)
  target?.focus({ preventScroll: true })
  target?.scrollIntoView({ behavior: 'auto', block: 'center' })
}
function closeToolMenu(restoreFocus = false) {
  toolMenu.value = null
  if (restoreFocus) void nextTick(() => toolMenuTrigger?.focus({ preventScroll: true }))
}
function openToolMenu(event: MouseEvent | KeyboardEvent, tool: ToolCatalogItem) {
  event.preventDefault()
  event.stopPropagation()
  toolMenuTrigger = event.currentTarget instanceof HTMLElement ? event.currentTarget : undefined
  const bounds = toolMenuTrigger?.getBoundingClientRect()
  const x = 'clientX' in event && event.clientX ? event.clientX : (bounds?.left ?? 18) + 34
  const y = 'clientY' in event && event.clientY ? event.clientY : (bounds?.top ?? 18) + 40
  jobMenu.value = null
  toolMenu.value = { tool, ...clampMenuPosition(x, y, { menuWidth: 238, menuHeight: 198, margin: 12 }) }
  void nextTick(() => toolMenuElement.value?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus())
}
function openToolMenuFromKeyboard(event: KeyboardEvent, tool: ToolCatalogItem) {
  if (isContextMenuShortcut(event)) openToolMenu(event, tool)
}
function handleToolMenuKeydown(event: KeyboardEvent) {
  const items = [...(toolMenuElement.value?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [])]
  if (event.key === 'Escape') { event.preventDefault(); closeToolMenu(true); return }
  const nextIndex = nextMenuItemIndex(event.key, items.indexOf(document.activeElement as HTMLButtonElement), items.length)
  if (nextIndex === undefined) return
  event.preventDefault()
  items[nextIndex]?.focus({ preventScroll: true })
}
async function openTool(tool: ToolCatalogItem) {
  closeToolMenu()
  store.recordToolUsage(tool.id, router.resolve(tool.to).fullPath)
  await router.push(tool.to)
}
function toggleFavorite(tool: ToolCatalogItem) {
  const wasFavorite = isFavorite(tool)
  store.toggleFavorite(tool.id)
  closeToolMenu()
  ui.toast(wasFavorite ? '已取消收藏' : '已加入收藏', wasFavorite ? `${tool.title}仍可通过搜索找到。` : '它会出现在今天和 Ctrl + K 中。', 'success')
}
async function copyToolName(tool: ToolCatalogItem) {
  try { await navigator.clipboard.writeText(tool.title); ui.toast('工具名称已复制', tool.title, 'success') }
  catch { ui.toast('无法写入剪贴板', '当前系统没有授予剪贴板权限。', 'error') }
  closeToolMenu()
}
function closeJobMenu(restoreFocus = false) {
  jobMenu.value = null
  if (restoreFocus) void nextTick(() => jobMenuTrigger?.focus({ preventScroll: true }))
}
function openJobMenu(event: MouseEvent | KeyboardEvent, job: Job) {
  event.preventDefault()
  event.stopPropagation()
  jobMenuTrigger = event.currentTarget instanceof HTMLElement ? event.currentTarget : undefined
  const bounds = jobMenuTrigger?.getBoundingClientRect()
  const x = 'clientX' in event && event.clientX ? event.clientX : (bounds?.left ?? 18) + 34
  const y = 'clientY' in event && event.clientY ? event.clientY : (bounds?.top ?? 18) + 34
  toolMenu.value = null
  jobMenu.value = { job, ...clampMenuPosition(x, y, { menuWidth: 252, menuHeight: 286, margin: 12 }) }
  void nextTick(() => jobMenuElement.value?.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')?.focus())
}
function openJobMenuFromKeyboard(event: KeyboardEvent, job: Job) {
  if (isContextMenuShortcut(event)) openJobMenu(event, job)
}
function handleJobMenuKeydown(event: KeyboardEvent) {
  const items = [...(jobMenuElement.value?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? [])]
  if (event.key === 'Escape') { event.preventDefault(); closeJobMenu(true); return }
  const nextIndex = nextMenuItemIndex(event.key, items.indexOf(document.activeElement as HTMLButtonElement), items.length)
  if (nextIndex === undefined) return
  event.preventDefault()
  items[nextIndex]?.focus({ preventScroll: true })
}
function closeToolsMenus() { closeToolMenu(); closeJobMenu() }
function openJob(job: Job) { closeJobMenu(); void router.push(job.route || '/history') }
function replayJob(job: Job) {
  closeJobMenu()
  void router.push(historyReplayLocation(job))
}
function openJobHistory() { closeJobMenu(); void router.push('/history') }
async function revealJobOutput(job: Job) {
  const path = historyOutputPaths(job)[0]
  closeJobMenu()
  if (!path) return
  try { await revealDesktopFile(path) }
  catch (error) { ui.toast('无法打开输出位置', error instanceof Error ? error.message : '文件可能已经移动。', 'error') }
}
async function copyJobOutputs(job: Job) {
  const paths = historyOutputPaths(job)
  closeJobMenu()
  if (!paths.length) return
  try {
    await navigator.clipboard.writeText(paths.join('\n'))
    ui.toast(paths.length > 1 ? `已复制 ${paths.length} 个输出路径` : '输出路径已复制', paths.length > 1 ? '每行一个，可直接粘贴到终端。' : paths[0], 'success')
  } catch { ui.toast('无法复制输出路径', '当前系统没有授予剪贴板权限。', 'error') }
}
async function removeJobRecord(job: Job) {
  closeJobMenu()
  const approved = await ui.confirm({ title: '删除这条任务记录？', message: '只移除 Knitspace 中的历史记录，不会删除输入或输出文件。', confirmLabel: '删除记录', danger: true })
  if (approved) store.removeJob(job.id)
}
function jobStatus(job: Job) {
  return job.status === 'running' ? `${job.progress}%` : job.status === 'succeeded' ? '已完成' : job.status === 'failed' ? '失败' : job.status === 'cancelled' ? '已取消' : '等待中'
}
function jobIcon(job: Job) {
  if (job.kind === 'pdf') return 'file-pdf'
  if (job.kind === 'media') return 'play'
  if (job.kind === 'script') return 'terminal'
  if (job.kind === 'image') return 'image'
  return 'toolbox'
}

watch(() => [route.query.filter, route.query.focus], () => { void revealRouteTool() }, { immediate: true, flush: 'post' })
onMounted(() => window.addEventListener('knitspace:close-context-menus', closeToolsMenus))
onBeforeUnmount(() => window.removeEventListener('knitspace:close-context-menus', closeToolsMenus))
</script>

<template>
  <!-- No `tools-space__*` classes; the scoped block goes with them. The page
       also drops a section heading that only announced the block beneath it
       ("直接开始，不用先翻目录") — the eight cards say that by existing. -->
  <div class="page-enter mx-auto w-full max-w-320 px-8 py-6" @click="closeToolsMenus()">
    <PageHeader
      title="工具空间"
      subtitle="按类别浏览全部工具，或直接搜索文件格式与操作名"
      :stats="[
        { label: '可用工具', value: workspaceTools.length },
        { label: '已收藏', value: favoriteIds.size },
        { label: '已完成', value: completedCount },
        { label: '运行中', value: runningCount, tone: runningCount ? 'accent' : undefined },
      ]"
    >
      <template #actions>
        <RouterLink class="btn-default" to="/history">处理历史</RouterLink>
        <RouterLink class="btn-primary" to="/quick"><AppIcon name="inbox" :size="15" />万能处理入口</RouterLink>
      </template>
    </PageHeader>

    <div class="grid gap-4 grid-cols-1 xl:grid-cols-[minmax(0,1fr)_minmax(280px,320px)]">
      <div class="stack gap-4 min-w-0">
        <nav class="grid gap-2 grid-cols-2 md:grid-cols-3 2xl:grid-cols-4" aria-label="常用工具直达">
          <RouterLink
            v-for="tool in quickTools"
            :key="tool.id"
            v-memo="[tool.id, isFavorite(tool)]"
            :to="tool.to"
            class="row gap-2.5 px-3 py-2.5 rounded-md panel transition-colors duration-120 hover:border-accent hover:bg-accent-soft"
            aria-haspopup="menu"
            :aria-expanded="toolMenu?.tool.id === tool.id"
            :aria-label="`${tool.title}；右键可收藏或打开菜单`"
            @click="store.recordToolUsage(tool.id, router.resolve(tool.to).fullPath)"
            @contextmenu="openToolMenu($event, tool)"
            @keydown="openToolMenuFromKeyboard($event, tool)"
          >
            <span class="center w-8 h-8 shrink-0 rounded-sm bg-surface-2 text-accent"><AppIcon :name="tool.icon" :size="15" /></span>
            <span class="stack gap-0.5 min-w-0 flex-1">
              <b class="text-[12px] font-medium truncate text-fg">{{ tool.title }}</b>
              <small class="text-[11px] truncate text-fg-3">{{ tool.description }}</small>
            </span>
            <AppIcon v-if="isFavorite(tool)" name="star" :size="12" class="shrink-0 text-warn" />
          </RouterLink>
        </nav>

        <section class="pane" aria-label="工具列表">
          <div class="row flex-wrap gap-x-3 gap-y-2 shrink-0 px-3 py-2 border-b border-line">
            <label class="row gap-1.5 min-w-48 flex-1 max-w-96 h-8 px-2.5 rounded-sm bg-well border border-line focus-within:border-accent">
              <AppIcon name="search" :size="14" class="shrink-0 text-fg-3" />
              <input v-model="query" class="min-w-0 flex-1 bg-transparent border-0 text-[12px] text-fg focus:outline-none" aria-label="搜索本地工具" placeholder="搜索合并 PDF、压缩图片、JSON、时间戳…" />
              <button v-if="query" type="button" class="center w-5 h-5 shrink-0 rounded-sm text-fg-3 hover:text-fg" aria-label="清空搜索" @click="query = ''"><AppIcon name="close" :size="11" /></button>
            </label>
            <nav class="row gap-1 shrink-0" aria-label="工具筛选">
              <button
                v-for="filter in filters.slice(0, 2)"
                :key="filter.id"
                class="btn-tool"
                :class="activeFilter === filter.id ? 'btn-tool-active' : ''"
                @click="selectFilter(filter.id)"
              >
                <AppIcon :name="filter.icon" :size="13" />{{ filter.label }}
              </button>
            </nav>
            <small class="ml-auto shrink-0 text-[11px] tabular-nums text-fg-3">{{ filteredTools.length }} 项结果</small>
          </div>

          <!-- Categories are a filter, so they sit with the search that also
               filters, not in a separate band above the panel. -->
          <div class="row flex-wrap gap-1.5 shrink-0 px-3 py-2 border-b border-line" role="group" aria-label="工具分类">
            <button
              v-for="category in categoryStats"
              :key="category.id"
              class="row gap-1.5 h-7 px-2.5 rounded-full border text-[11px] whitespace-nowrap transition-colors duration-120"
              :class="activeFilter === category.id ? 'border-accent bg-accent-soft text-accent font-medium' : 'border-line text-fg-2 hover:border-line-strong hover:text-fg'"
              :aria-pressed="activeFilter === category.id"
              @click="selectFilter(category.id)"
            >
              <AppIcon :name="category.icon" :size="13" />{{ category.label }}
              <span class="tabular-nums text-fg-3">{{ category.count }}</span>
            </button>
          </div>

          <div v-if="visibleTools.length" class="grid gap-2 p-3 grid-cols-1 md:grid-cols-2 2xl:grid-cols-3">
            <RouterLink
              v-for="tool in visibleTools"
              :key="tool.id"
              v-memo="[tool.id, isFavorite(tool), focusedToolId === tool.id]"
              :to="tool.to"
              class="row gap-2.5 p-2.5 rounded-md border bg-well transition-colors duration-120 hover:border-accent hover:bg-accent-soft"
              :class="focusedToolId === tool.id ? 'border-accent' : 'border-line'"
              :data-tool-id="tool.id"
              aria-haspopup="menu"
              :aria-expanded="toolMenu?.tool.id === tool.id"
              :aria-label="`${tool.title}；右键可收藏或打开菜单`"
              @click="store.recordToolUsage(tool.id, router.resolve(tool.to).fullPath)"
              @contextmenu="openToolMenu($event, tool)"
              @keydown="openToolMenuFromKeyboard($event, tool)"
            >
              <span class="center w-9 h-9 shrink-0 rounded-sm bg-surface border border-line text-accent"><AppIcon :name="tool.icon" :size="16" /></span>
              <span class="stack gap-0.5 min-w-0 flex-1">
                <b class="row gap-1.5 text-[12px] font-medium text-fg">
                  <span class="min-w-0 truncate">{{ tool.title }}</span>
                  <AppIcon v-if="isFavorite(tool)" name="star" :size="11" class="shrink-0 text-warn" />
                </b>
                <p class="text-[11px] leading-relaxed line-clamp-2 text-fg-3">{{ tool.description }}</p>
              </span>
              <small class="shrink-0 text-[11px] text-fg-3">{{ tool.group }}</small>
            </RouterLink>
          </div>
          <div v-else class="stack items-center gap-2 px-6 py-14 text-center">
            <span class="center w-11 h-11 rounded-lg bg-surface-2 text-fg-3"><AppIcon name="search" :size="20" /></span>
            <b class="text-[13px] font-medium text-fg">{{ activeFilter === 'favorite' ? '还没有收藏工具' : '没有匹配的工具' }}</b>
            <p class="max-w-80 text-[11px] leading-relaxed text-fg-3">
              {{ activeFilter === 'favorite' ? '在任意工具卡上右键，即可把常用能力固定到这里。' : '换一个关键词，或切回全部工具继续浏览。' }}
            </p>
            <button class="btn-default btn-sm" @click="query = ''; activeFilter = 'all'">查看全部工具</button>
          </div>

          <footer v-if="visibleTools.length < filteredTools.length" class="row justify-center shrink-0 px-3 pb-3">
            <button class="btn-default btn-sm" @click="visibleLimit += 12">再显示 {{ Math.min(12, filteredTools.length - visibleTools.length) }} 项</button>
          </footer>
        </section>
      </div>

      <aside class="stack gap-4 min-w-0">
        <section class="pane">
          <header class="pane-head">
            <span class="pane-title">最近运行</span>
            <RouterLink to="/history" class="tap text-[11px] text-accent hover:underline underline-offset-2">全部</RouterLink>
          </header>
          <div v-if="recentJobs.length" class="stack gap-0.5 p-1.5">
            <button
              v-for="job in recentJobs"
              :key="job.id"
              v-memo="[job.id, job.status, job.progress, job.detail, job.outputs]"
              class="row gap-2 px-2 py-1.5 rounded-sm text-left transition-colors duration-120 hover:bg-surface-2"
              aria-haspopup="menu"
              :aria-expanded="jobMenu?.job.id === job.id"
              :aria-label="`${job.label}，${jobStatus(job)}；右键或 Shift 加 F10 查看任务操作`"
              @click="openJob(job)"
              @contextmenu="openJobMenu($event, job)"
              @keydown="openJobMenuFromKeyboard($event, job)"
            >
              <span class="center w-7 h-7 shrink-0 rounded-sm bg-surface-2 text-fg-2"><AppIcon :name="jobIcon(job)" :size="14" /></span>
              <span class="stack gap-0.5 min-w-0 flex-1">
                <b class="text-[12px] font-medium truncate text-fg">{{ job.label }}</b>
                <small class="text-[11px] truncate text-fg-3">{{ job.detail || job.inputNames?.join('、') || '本地任务' }}</small>
              </span>
              <i
                class="shrink-0 text-[11px] not-italic"
                :class="job.status === 'failed' ? 'text-danger' : job.status === 'running' ? 'text-accent' : job.status === 'succeeded' ? 'text-success' : 'text-fg-3'"
              >
                {{ jobStatus(job) }}
              </i>
            </button>
          </div>
          <div v-else class="stack items-center gap-1.5 px-4 py-8 text-center">
            <AppIcon name="clock" :size="18" class="text-fg-3" />
            <b class="text-[12px] font-medium text-fg">还没有处理记录</b>
            <small class="text-[11px] text-fg-3">完成的输出会集中出现在这里。</small>
          </div>
        </section>

        <section class="pane">
          <header class="pane-head"><span class="pane-title">最近使用</span></header>
          <div v-if="recentTools.length" class="stack gap-0.5 p-1.5">
            <button
              v-for="tool in recentTools"
              :key="tool.id"
              class="row gap-2 px-2 h-8 rounded-sm text-left text-[12px] text-fg-2 transition-colors duration-120 hover:bg-surface-2 hover:text-fg"
              aria-haspopup="menu"
              :aria-expanded="toolMenu?.tool.id === tool.id"
              :aria-label="`${tool.title}；右键或 Shift 加 F10 查看工具操作`"
              @click="openTool(tool)"
              @contextmenu="openToolMenu($event, tool)"
              @keydown="openToolMenuFromKeyboard($event, tool)"
            >
              <AppIcon :name="tool.icon" :size="14" class="shrink-0 text-fg-3" />
              <span class="min-w-0 flex-1 truncate">{{ tool.title }}</span>
              <AppIcon name="arrow-right" :size="12" class="shrink-0 text-fg-3" />
            </button>
          </div>
          <p v-else class="px-3 py-4 text-[11px] leading-relaxed text-fg-3">打开工具后，常用入口会在这里自动形成。</p>
        </section>

        <section class="row gap-2.5 p-3 panel">
          <span class="center w-8 h-8 shrink-0 rounded-sm bg-accent-soft text-accent"><AppIcon name="flask" :size="16" /></span>
          <span class="stack gap-0.5 min-w-0 flex-1">
            <b class="text-[12px] font-medium text-fg">本机能力与实验</b>
            <p class="text-[11px] leading-relaxed text-fg-3">检查 Vault、FFmpeg、输出目录与本机转写引擎的真实边界。</p>
          </span>
          <RouterLink to="/lab" class="btn-tool shrink-0">检查</RouterLink>
        </section>

        <section v-if="personalPackEnabled" class="stack gap-2 p-3 panel">
          <div class="row gap-2.5">
            <span class="center w-8 h-8 shrink-0 rounded-sm bg-accent-soft text-accent"><AppIcon name="terminal" :size="16" /></span>
            <span class="stack gap-0.5 min-w-0 flex-1">
              <b class="text-[12px] font-medium text-fg">私人工具包</b>
              <p class="text-[11px] leading-relaxed text-fg-3">外部 JSON 清单、Dry Run、日志与取消由统一执行器负责。</p>
            </span>
          </div>
          <nav class="row gap-1.5" aria-label="私人工具快捷入口">
            <RouterLink to="/private-tools?action=choose-manifest" class="btn-default btn-sm flex-1">加载</RouterLink>
            <RouterLink to="/history?kind=script" class="btn-default btn-sm flex-1">历史</RouterLink>
          </nav>
        </section>
      </aside>
    </div>

    <Teleport to="body">
      <section
        v-if="toolMenu"
        ref="toolMenuElement"
        class="menu-panel w-60"
        role="menu"
        :aria-label="`${toolMenu.tool.title}操作菜单`"
        :style="{ left: `${toolMenu.x}px`, top: `${toolMenu.y}px` }"
        @click.stop
        @contextmenu.prevent
        @keydown.stop="handleToolMenuKeydown"
      >
        <p class="menu-title">{{ toolMenu.tool.group }}<small class="min-w-0 truncate font-normal">{{ toolMenu.tool.title }}</small></p>
        <button class="menu-item" role="menuitem" @click="openTool(toolMenu.tool)"><span class="row gap-2"><AppIcon name="arrow-right" :size="14" />打开工具</span></button>
        <button class="menu-item" role="menuitem" @click="toggleFavorite(toolMenu.tool)"><span class="row gap-2"><AppIcon name="star" :size="14" />{{ isFavorite(toolMenu.tool) ? '取消收藏' : '加入收藏' }}</span></button>
        <button class="menu-item" role="menuitem" @click="copyToolName(toolMenu.tool)"><span class="row gap-2"><AppIcon name="duplicate" :size="14" />复制工具名称</span></button>
      </section>

      <section
        v-if="jobMenu"
        ref="jobMenuElement"
        class="menu-panel w-68"
        role="menu"
        :aria-label="`${jobMenu.job.label}任务操作菜单`"
        :style="{ left: `${jobMenu.x}px`, top: `${jobMenu.y}px` }"
        @click.stop
        @contextmenu.prevent
        @keydown.stop="handleJobMenuKeydown"
      >
        <p class="menu-title">
          {{ jobMenu.job.kind.toUpperCase() }} · {{ jobStatus(jobMenu.job) }}
          <small class="min-w-0 truncate font-normal">{{ jobMenu.job.label }}</small>
        </p>
        <button class="menu-item" role="menuitem" @click="openJob(jobMenu.job)"><span class="row gap-2"><AppIcon name="arrow-right" :size="14" />打开任务页面</span></button>
        <button class="menu-item" role="menuitem" :disabled="!jobMenu.job.retryable && !jobMenu.job.route" @click="replayJob(jobMenu.job)"><span class="row gap-2"><AppIcon name="rotate" :size="14" />恢复上次参数</span></button>
        <button class="menu-item" role="menuitem" :disabled="!historyOutputPaths(jobMenu.job).length" @click="revealJobOutput(jobMenu.job)"><span class="row gap-2"><AppIcon name="folder" :size="14" />打开输出位置</span></button>
        <button class="menu-item" role="menuitem" :disabled="!historyOutputPaths(jobMenu.job).length" @click="copyJobOutputs(jobMenu.job)">
          <span class="row gap-2"><AppIcon name="duplicate" :size="14" />{{ historyOutputPaths(jobMenu.job).length > 1 ? `复制全部 ${historyOutputPaths(jobMenu.job).length} 个路径` : '复制输出路径' }}</span>
        </button>
        <button class="menu-item" role="menuitem" @click="openJobHistory"><span class="row gap-2"><AppIcon name="clock" :size="14" />查看完整处理记录</span></button>
        <i class="menu-sep" aria-hidden="true" />
        <button class="menu-item menu-item-danger" role="menuitem" @click="removeJobRecord(jobMenu.job)"><span class="row gap-2"><AppIcon name="trash" :size="14" />删除历史记录</span></button>
      </section>
    </Teleport>
  </div>
</template>
