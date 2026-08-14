<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import type { Job } from '@/types'
import { clampMenuPosition, isContextMenuShortcut, nextMenuItemIndex } from '@/lib/desktop-menu'
import { filterHistoryActivities, filterHistoryJobs, historyActivityKindFromQuery, historyJobSummary, historyKindFromQuery, historyOutputPaths, historyReplayLocation, historyStatusFromQuery, historyViewFromQuery, historyWindow, toggleHistorySelection, type HistoryActivityFilter, type HistoryKindFilter, type HistoryStatusFilter, type HistoryView } from '@/lib/history-list'
import { revealDesktopFile, saveOutputAs } from '@/lib/native'
import { useWorkbenchStore } from '@/stores/workbench'
import { useUiStore } from '@/stores/ui'
import AppBreadcrumbs from '@/components/AppBreadcrumbs.vue'
import EmptyState from '@/components/EmptyState.vue'
import AppIcon from '@/components/AppIcon.vue'
import PageHeader from '@/components/PageHeader.vue'

const store = useWorkbenchStore()
const ui = useUiStore()
const router = useRouter()
const route = useRoute()
const initialQuery = typeof route.query.q === 'string' ? route.query.q : ''
const activeView = ref<HistoryView>(historyViewFromQuery(route.query.view))
const query = ref(initialQuery)
const appliedQuery = ref(initialQuery)
const status = ref<HistoryStatusFilter>(historyStatusFromQuery(route.query.status))
const kind = ref<HistoryKindFilter>(historyKindFromQuery(route.query.kind))
const activityKind = ref<HistoryActivityFilter>(historyActivityKindFromQuery(route.query.activity))
const selectedJobIds = ref<Set<string>>(new Set())
const selectionMode = ref(false)
const searchPending = computed(() => query.value.trim() !== appliedQuery.value.trim())
const historyViewport = ref<HTMLElement>()
const listScrollTop = ref(0)
const listViewportHeight = ref(0)
const contextMenu = ref<{ job: Job; x: number; y: number }>()
const contextMenuElement = ref<HTMLElement>()
let contextMenuTrigger: HTMLElement | undefined
let searchTimer: number | undefined
let scrollFrame: number | undefined

// Must match the row height in the template; the virtual window
// computes its offsets from it.
const historyRowHeight = 96
const historyOverscan = 5
const jobs = computed(() => filterHistoryJobs(store.jobs, { query: appliedQuery.value, status: status.value, kind: kind.value }))
const activities = computed(() => filterHistoryActivities(store.activities, appliedQuery.value, activityKind.value))
const windowedHistory = computed(() => historyWindow(jobs.value.length, listScrollTop.value, listViewportHeight.value, historyRowHeight, historyOverscan))
const visibleJobs = computed(() => jobs.value.slice(windowedHistory.value.start, windowedHistory.value.end))
const hasActiveFilters = computed(() => Boolean(query.value.trim() || (activeView.value === 'jobs' ? status.value !== 'all' || kind.value !== 'all' : activityKind.value !== 'all')))
const selectedCount = computed(() => selectedJobIds.value.size)
const selectableJobs = computed(() => jobs.value.filter((job) => !['queued', 'running'].includes(job.status)))
const allFilteredSelected = computed(() => Boolean(selectableJobs.value.length) && selectableJobs.value.every((job) => selectedJobIds.value.has(job.id)))
const statusOptions: { value: HistoryStatusFilter; label: string }[] = [
  { value: 'all', label: '全部状态' }, { value: 'succeeded', label: '已完成' }, { value: 'failed', label: '失败' },
  { value: 'running', label: '执行中' }, { value: 'queued', label: '等待中' }, { value: 'cancelled', label: '已取消' },
]
const kindOptions: { value: HistoryKindFilter; label: string }[] = [
  { value: 'all', label: '全部类型' }, { value: 'pdf', label: 'PDF' }, { value: 'image', label: '图片' },
  { value: 'media', label: '音视频' }, { value: 'text', label: '文本' }, { value: 'code', label: '代码' },
  { value: 'ocr', label: 'OCR' }, { value: 'ai', label: 'AI' }, { value: 'archive', label: '归档' }, { value: 'script', label: '脚本' },
]
const activityKindOptions: { value: HistoryActivityFilter; label: string }[] = [
  { value: 'all', label: '全部活动' }, { value: 'tool', label: '打开工具' }, { value: 'job', label: '任务' },
  { value: 'source', label: '资料' }, { value: 'output', label: '输出' }, { value: 'clipboard', label: '剪贴板' },
  { value: 'backup', label: '备份' }, { value: 'system', label: '系统' },
]

const statusLabel = (value: string) => ({ succeeded: '已完成', failed: '失败', running: '执行中', queued: '等待中', cancelled: '已取消' }[value] ?? value)
const formatTime = (value: string) => new Date(value).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })

function syncHistoryViewport() {
  listViewportHeight.value = historyViewport.value?.clientHeight ?? 0
}

function handleHistoryScroll() {
  if (scrollFrame) return
  scrollFrame = window.requestAnimationFrame(() => {
    listScrollTop.value = historyViewport.value?.scrollTop ?? 0
    scrollFrame = undefined
  })
}

function resetScroll() {
  listScrollTop.value = 0
  if (historyViewport.value) historyViewport.value.scrollTop = 0
  void nextTick(syncHistoryViewport)
}

function syncRouteQuery() {
  const next: Record<string, string> = {}
  if (activeView.value === 'activity') next.view = 'activity'
  if (appliedQuery.value.trim()) next.q = appliedQuery.value.trim()
  if (activeView.value === 'jobs') {
    if (status.value !== 'all') next.status = status.value
    if (kind.value !== 'all') next.kind = kind.value
  } else if (activityKind.value !== 'all') next.activity = activityKind.value
  const current = Object.fromEntries(Object.entries(route.query).flatMap(([key, value]) => typeof value === 'string' ? [[key, value]] : []))
  if (JSON.stringify(current) !== JSON.stringify(next)) void router.replace({ query: next })
}

function clearSelection() {
  selectionMode.value = false
  selectedJobIds.value = new Set()
}

function selectView(view: HistoryView) {
  if (activeView.value === view) return
  activeView.value = view
  clearSelection()
  resetScroll()
}

function clearFilters() {
  window.clearTimeout(searchTimer)
  query.value = ''
  appliedQuery.value = ''
  status.value = 'all'
  kind.value = 'all'
  activityKind.value = 'all'
  clearSelection()
  resetScroll()
}

function toggleSelected(id: string) {
  selectedJobIds.value = toggleHistorySelection(selectedJobIds.value, id)
}

function toggleSelectAll() {
  if (allFilteredSelected.value) selectedJobIds.value = new Set()
  else selectedJobIds.value = new Set(selectableJobs.value.map((job) => job.id))
}

async function removeSelected() {
  if (!selectedCount.value) return
  const approved = await ui.confirm({ title: `删除选中的 ${selectedCount.value} 条记录？`, message: '只移除 Knitspace 中的处理记录，不会删除输入或输出文件；执行中和等待中的任务不会被选中。', danger: true, confirmLabel: '删除记录' })
  if (!approved) return
  store.removeJobs(selectedJobIds.value)
  clearSelection()
}

function historyOutputPath(job: Job) { return historyOutputPaths(job)[0] }
function historyOutputName(job: Job) { return job.outputs?.find((output) => output.path)?.name }
function historyOutputCount(job: Job) { return historyOutputPaths(job).length }

async function rerun(id: string) {
  const job = store.jobs.find((item) => item.id === id)
  if (!job) return
  await router.push(historyReplayLocation(job))
}

async function reveal(path?: string) {
  if (!path) return
  try { await revealDesktopFile(path) }
  catch (error) { ui.toast('无法打开文件位置', error instanceof Error ? error.message : '文件可能已移动。', 'error') }
}

async function remove(id: string) {
  const approved = await ui.confirm({ title: '删除历史记录？', message: '只删除 Knitspace 中的记录，不会删除输入或输出文件。', danger: true, confirmLabel: '删除记录' })
  if (approved) store.removeJob(id)
}

async function copyOutputs(job: Job) {
  const paths = historyOutputPaths(job)
  if (!paths.length) return
  try {
    await navigator.clipboard.writeText(paths.join('\n'))
    ui.toast(paths.length > 1 ? `已复制 ${paths.length} 个输出路径` : '路径已复制', paths.length > 1 ? '每行一个，可直接粘贴到终端或清单。' : paths[0], 'success')
  } catch (error) { ui.toast('复制路径失败', error instanceof Error ? error.message : '系统剪贴板暂时不可用。', 'error') }
}

async function saveAs(path?: string, name?: string) {
  if (!path || !name) return
  try {
    const destination = await saveOutputAs(path, name)
    if (destination) ui.toast('已另存输出', destination, 'success')
  } catch (error) { ui.toast('另存失败', error instanceof Error ? error.message : '无法复制输出文件。', 'error') }
}

function closeContext(restoreFocus = false) {
  contextMenu.value = undefined
  if (restoreFocus) void nextTick(() => contextMenuTrigger?.focus({ preventScroll: true }))
}

function showContext(job: Job, x: number, y: number, trigger: HTMLElement) {
  contextMenuTrigger = trigger
  contextMenu.value = { job, ...clampMenuPosition(x, y, { menuWidth: 220, menuHeight: 272, margin: 12 }) }
  void nextTick(() => contextMenuElement.value?.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')?.focus())
}

function openContext(event: MouseEvent, job: Job) {
  event.preventDefault()
  showContext(job, event.clientX, event.clientY, event.currentTarget as HTMLElement)
}

function handleHistoryCardKeydown(event: KeyboardEvent, job: Job) {
  if (!isContextMenuShortcut(event)) return
  event.preventDefault()
  event.stopPropagation()
  const trigger = event.currentTarget as HTMLElement
  const bounds = trigger.getBoundingClientRect()
  showContext(job, bounds.right - 22, bounds.top + 24, trigger)
}

function handleContextKeydown(event: KeyboardEvent) {
  const items = [...(contextMenuElement.value?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? [])]
  if (event.key === 'Escape') { event.preventDefault(); closeContext(true); return }
  const next = nextMenuItemIndex(event.key, items.indexOf(document.activeElement as HTMLButtonElement), items.length)
  if (next === undefined) return
  event.preventDefault()
  items[next]?.focus()
}

async function contextRerun() { const job = contextMenu.value?.job; closeContext(); if (job) await rerun(job.id) }
async function contextReveal() { const job = contextMenu.value?.job; closeContext(); if (job) await reveal(historyOutputPath(job)) }
async function contextSaveAs() { const job = contextMenu.value?.job; closeContext(); if (job) await saveAs(historyOutputPath(job), historyOutputName(job)) }
async function contextCopy() { const job = contextMenu.value?.job; closeContext(); if (job) await copyOutputs(job) }
function contextToggleSelection() { const job = contextMenu.value?.job; closeContext(); if (!job || ['queued', 'running'].includes(job.status)) return; selectionMode.value = true; toggleSelected(job.id) }
async function contextRemove() { const job = contextMenu.value?.job; closeContext(); if (job) await remove(job.id) }

watch(query, (value) => {
  window.clearTimeout(searchTimer)
  searchTimer = window.setTimeout(() => { appliedQuery.value = value; clearSelection(); resetScroll(); syncRouteQuery() }, 140)
})
watch([status, kind, activityKind, activeView], () => { clearSelection(); resetScroll(); syncRouteQuery() })
watch(() => route.query, (routeQuery) => {
  const nextView = historyViewFromQuery(routeQuery.view)
  const nextQuery = typeof routeQuery.q === 'string' ? routeQuery.q : ''
  const nextStatus = historyStatusFromQuery(routeQuery.status)
  const nextKind = historyKindFromQuery(routeQuery.kind)
  const nextActivityKind = historyActivityKindFromQuery(routeQuery.activity)
  if (activeView.value !== nextView) activeView.value = nextView
  if (query.value !== nextQuery) { query.value = nextQuery; appliedQuery.value = nextQuery }
  if (status.value !== nextStatus) status.value = nextStatus
  if (kind.value !== nextKind) kind.value = nextKind
  if (activityKind.value !== nextActivityKind) activityKind.value = nextActivityKind
}, { deep: true })
watch(jobs, () => {
  if (listScrollTop.value >= Math.max(0, jobs.value.length * historyRowHeight - historyRowHeight)) resetScroll()
  void nextTick(syncHistoryViewport)
}, { flush: 'post' })

onMounted(() => {
  window.addEventListener('resize', syncHistoryViewport)
  void nextTick(syncHistoryViewport)
})
onBeforeUnmount(() => {
  window.removeEventListener('resize', syncHistoryViewport)
  window.clearTimeout(searchTimer)
  if (scrollFrame) window.cancelAnimationFrame(scrollFrame)
})
</script>

<template>
  <div class="history-view page-enter mx-auto w-full max-w-320 px-8 py-6" @click="closeContext()">
    <AppBreadcrumbs :items="[{ label: '工作', to: '/' }, { label: '处理历史' }]" />
    <PageHeader
      title="处理历史"
      subtitle="每次处理的参数和输出路径都留着,可以一键重跑"
    >
      <template #actions>
        <RouterLink class="btn-primary" to="/tools"><AppIcon name="plus" :size="15" />新建处理</RouterLink>
      </template>
    </PageHeader>

    <!-- Two records, one page. A segmented switch says they are alternatives;
         the old pair of full-width cards read as two separate features. -->
    <nav class="row gap-0.5 p-0.5 mb-3 w-fit rounded-sm bg-surface-2 border border-line" aria-label="历史记录视图">
      <button
        v-for="view in ([['jobs', 'clock', '处理记录', `${store.jobs.length} 条`], ['activity', 'sort', '操作日志', `${store.activities.length} 条`]] as const)"
        :key="view[0]"
        class="row gap-1.5 h-8 px-3 rounded-[4px] text-[13px] transition-colors"
        :class="activeView === view[0] ? 'bg-surface text-fg font-medium shadow-sm' : 'text-fg-3 hover:text-fg'"
        :aria-current="activeView === view[0] ? 'page' : undefined"
        @click="selectView(view[0])"
      >
        <AppIcon :name="view[1]" :size="15" />{{ view[2] }}
        <span class="text-[12px] tabular-nums opacity-70">{{ view[3] }}</span>
      </button>
    </nav>

    <section class="row gap-2 flex-wrap mb-3 p-2 panel" :aria-busy="searchPending">
      <label class="row gap-2 flex-1 min-w-60 h-9 px-3 rounded-sm bg-well border border-line focus-within:border-accent">
        <AppIcon name="search" :size="15" class="shrink-0 text-fg-3" />
        <span class="sr-only">搜索{{ activeView === 'jobs' ? '处理历史' : '操作日志' }}</span>
        <input
          v-model="query"
          class="flex-1 min-w-0 bg-transparent border-0 outline-none text-[13px]"
          :placeholder="activeView === 'jobs' ? '搜索工具、输入或输出文件…' : '搜索操作或详情…'"
        />
      </label>
      <template v-if="activeView === 'jobs'">
        <select v-model="status" class="field w-28" aria-label="按状态筛选">
          <option v-for="option in statusOptions" :key="option.value" :value="option.value">{{ option.label }}</option>
        </select>
        <select v-model="kind" class="field w-28" aria-label="按类型筛选">
          <option v-for="option in kindOptions" :key="option.value" :value="option.value">{{ option.label }}</option>
        </select>
      </template>
      <select v-else v-model="activityKind" class="field w-32" aria-label="按活动类型筛选">
        <option v-for="option in activityKindOptions" :key="option.value" :value="option.value">{{ option.label }}</option>
      </select>
      <span class="row px-2 text-[12px] tabular-nums text-fg-3" aria-live="polite">
        {{ activeView === 'jobs' ? jobs.length : activities.length }} 条{{ searchPending ? ' · 筛选中' : '' }}
      </span>
      <button v-if="hasActiveFilters" class="btn-ghost btn-sm" @click="clearFilters">清除筛选</button>
    </section>

    <section v-if="activeView === 'jobs' && jobs.length" class="pane">
      <header class="pane-head">
        <div class="row gap-2 min-w-0">
          <button class="btn-ghost btn-sm" @click="selectionMode ? clearSelection() : selectionMode = true">
            {{ selectionMode ? '退出选择' : '批量管理' }}
          </button>
          <template v-if="selectionMode">
            <button class="btn-ghost btn-sm" :disabled="!selectableJobs.length" @click="toggleSelectAll">
              {{ allFilteredSelected ? '取消全选' : `全选可清理项 · ${selectableJobs.length}` }}
            </button>
            <span class="text-[12px] tabular-nums text-fg-3" aria-live="polite">已选 {{ selectedCount }} 条</span>
          </template>
        </div>
        <button v-if="selectionMode" class="btn-danger btn-sm" :disabled="!selectedCount" @click="removeSelected">删除所选</button>
        <small v-else class="text-[11px] text-fg-3 truncate">右键单条记录可恢复参数、打开或复制输出路径</small>
      </header>

      <!-- Virtualised: the spacer holds the full scroll height, the window is
           translated to the visible slice. `historyRowHeight` in the script
           has to match the row height set here. -->
      <div
        ref="historyViewport"
        class="overflow-y-auto h-[calc(100vh-var(--titlebar-h)-23rem)] min-h-80"
        aria-label="处理历史记录"
        @scroll.passive="handleHistoryScroll"
      >
        <div class="relative" :style="{ height: `${windowedHistory.height}px` }">
          <div class="absolute inset-x-0 top-0" :style="{ transform: `translateY(${windowedHistory.offset}px)` }">
            <article
              v-for="job in visibleJobs"
              :key="job.id"
              v-memo="[job.id, job.status, job.progress, job.detail, job.completedAt, job.outputs, job.outputNames, selectionMode, selectedJobIds.has(job.id)]"
              class="group row gap-3 h-24 px-3 border-b border-line transition-colors"
              :class="selectedJobIds.has(job.id) ? 'bg-accent-soft' : 'hover:bg-surface-2'"
              tabindex="0"
              aria-haspopup="menu"
              :aria-expanded="contextMenu?.job.id === job.id"
              :aria-selected="selectionMode ? selectedJobIds.has(job.id) : undefined"
              :aria-label="`${job.label}，${statusLabel(job.status)}；右键或 Shift 加 F10 打开操作`"
              @click="selectionMode && !['queued', 'running'].includes(job.status) ? toggleSelected(job.id) : undefined"
              @contextmenu.stop="openContext($event, job)"
              @keydown="handleHistoryCardKeydown($event, job)"
            >
              <button
                v-if="selectionMode"
                class="center w-5 h-5 shrink-0 rounded-[4px] border transition-colors"
                :class="selectedJobIds.has(job.id) ? 'border-accent bg-accent text-white' : 'border-line-strong text-transparent'"
                :disabled="['queued', 'running'].includes(job.status)"
                :aria-label="selectedJobIds.has(job.id) ? `取消选择 ${job.label}` : `选择 ${job.label}`"
                @click.stop="toggleSelected(job.id)"
              >
                <AppIcon name="check" :size="12" />
              </button>

              <div class="stack gap-1 w-20 shrink-0">
                <span
                  class="row gap-1.5 text-[12px] font-medium"
                  :class="job.status === 'succeeded' ? 'text-success'
                    : job.status === 'failed' ? 'text-danger'
                      : job.status === 'running' ? 'text-accent'
                        : job.status === 'cancelled' ? 'text-warn' : 'text-fg-3'"
                >
                  <i class="w-1.5 h-1.5 rounded-full bg-current shrink-0" />{{ statusLabel(job.status) }}
                </span>
                <small class="text-[11px] tabular-nums text-fg-3">{{ formatTime(job.completedAt || job.createdAt) }}</small>
              </div>

              <div class="stack gap-1 min-w-0 flex-1">
                <p class="text-[11px] text-fg-3 truncate">{{ job.kind.toUpperCase() }} · {{ job.toolId || '本地工具' }}</p>
                <h3 class="text-[13px] font-medium text-fg truncate">{{ job.label }}</h3>
                <p class="row gap-2 text-[11px] text-fg-3 min-w-0">
                  <span class="truncate max-w-60"><b class="font-normal text-fg-2">输入</b> {{ historyJobSummary(job, 'input') }}</span>
                  <AppIcon name="arrow-right" :size="11" class="shrink-0" />
                  <span class="truncate max-w-60"><b class="font-normal text-fg-2">输出</b> {{ historyJobSummary(job, 'output') }}</span>
                </p>
              </div>

              <!-- Six buttons on every row is a wall. They stay in the DOM for
                   the keyboard and appear on hover for the mouse; the same
                   actions are on the context menu either way. -->
              <div class="row gap-1 shrink-0 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity">
                <button class="btn-default btn-sm" :disabled="!job.retryable && !job.route" @click.stop="rerun(job.id)">恢复参数</button>
                <button class="btn-ghost btn-sm" :disabled="!historyOutputPath(job)" @click.stop="reveal(historyOutputPath(job))">打开位置</button>
                <button class="btn-ghost btn-sm" :disabled="!historyOutputPath(job)" @click.stop="saveAs(historyOutputPath(job), historyOutputName(job))">
                  {{ historyOutputCount(job) > 1 ? '另存首个' : '另存为' }}
                </button>
                <button
                  class="btn-ghost btn-sm btn-icon"
                  :disabled="!historyOutputPath(job)"
                  :title="historyOutputCount(job) > 1 ? `复制全部 ${historyOutputCount(job)} 个输出路径` : '复制输出路径'"
                  :aria-label="historyOutputCount(job) > 1 ? `复制全部 ${historyOutputCount(job)} 个输出路径` : '复制输出路径'"
                  @click.stop="copyOutputs(job)"
                >
                  <AppIcon name="duplicate" :size="14" />
                </button>
                <button class="btn-ghost btn-sm btn-icon hover:text-danger" title="删除记录" aria-label="删除历史记录" @click.stop="remove(job.id)">
                  <AppIcon name="trash" :size="14" />
                </button>
              </div>
            </article>
          </div>
        </div>
      </div>
    </section>

    <EmptyState v-else-if="activeView === 'jobs' && store.jobs.length && hasActiveFilters" icon="search" title="没有匹配的处理记录" description="试试清除搜索，或放宽状态与类型筛选。" action="清除筛选" @action="clearFilters" />
    <EmptyState v-else-if="activeView === 'jobs'" icon="clock" title="还没有处理记录" description="拖入一份 PDF、图片或文本，完成后的参数与输出会出现在这里。" action="开始第一次处理" @action="router.push('/tools')" />

    <section v-else-if="activities.length" class="pane" aria-label="操作日志">
      <article
        v-for="item in activities"
        :key="item.id"
        v-memo="[item.id, item.title, item.detail, item.route]"
        class="row gap-3 px-4 py-3 border-b border-line last:border-b-0"
        :class="item.route ? 'cursor-pointer hover:bg-surface-2' : ''"
        :role="item.route ? 'link' : undefined"
        :tabindex="item.route ? 0 : undefined"
        :aria-label="item.route ? `${item.title}；打开相关页面` : undefined"
        @click="item.route ? router.push(item.route) : undefined"
        @keydown.enter="item.route ? router.push(item.route) : undefined"
        @keydown.space.prevent="item.route ? router.push(item.route) : undefined"
      >
        <b class="center w-14 h-6 shrink-0 rounded-full bg-surface-2 text-[10px] font-semibold tracking-wide text-fg-3">{{ item.kind.toUpperCase() }}</b>
        <span class="stack gap-0.5 min-w-0 flex-1">
          <strong class="text-[13px] font-medium text-fg truncate">{{ item.title }}</strong>
          <small class="text-[11px] text-fg-3 truncate">{{ item.detail || 'Knitspace 本地操作' }}</small>
        </span>
        <time class="text-[11px] tabular-nums text-fg-3 shrink-0">{{ formatTime(item.createdAt) }}</time>
        <AppIcon v-if="item.route" name="arrow-right" :size="14" class="shrink-0 text-fg-3" />
      </article>
    </section>

    <EmptyState v-else-if="store.activities.length && hasActiveFilters" icon="search" title="没有匹配的操作日志" description="日志仍在本机；清除搜索或换个活动类型即可查看。" action="清除筛选" @action="clearFilters" />
    <EmptyState v-else icon="sort" title="还没有操作日志" description="打开工具、处理资料或生成输出后，最近活动会保存在本机。" />

    <Teleport to="body">
      <div
        v-if="contextMenu"
        ref="contextMenuElement"
        class="fixed z-[120] w-60 p-1 rounded-md bg-surface border border-line-strong shadow-lg"
        role="menu"
        :aria-label="`${contextMenu.job.label} 操作`"
        :style="{ left: `${contextMenu.x}px`, top: `${contextMenu.y}px` }"
        @click.stop
        @contextmenu.prevent
        @keydown.stop="handleContextKeydown"
      >
        <p class="px-2.5 py-1.5 text-[11px] text-fg-3 truncate">{{ contextMenu.job.label }}</p>
        <button class="nav-item w-full" role="menuitem" :disabled="!contextMenu.job.retryable && !contextMenu.job.route" @click="contextRerun">恢复上次参数</button>
        <button class="nav-item w-full" role="menuitem" :disabled="!historyOutputPath(contextMenu.job)" @click="contextReveal">打开输出位置</button>
        <button class="nav-item w-full" role="menuitem" :disabled="!historyOutputPath(contextMenu.job)" @click="contextSaveAs">
          {{ historyOutputCount(contextMenu.job) > 1 ? '另存首个输出…' : '另存为…' }}
        </button>
        <button class="nav-item w-full" role="menuitem" :disabled="!historyOutputPath(contextMenu.job)" @click="contextCopy">
          {{ historyOutputCount(contextMenu.job) > 1 ? `复制全部 ${historyOutputCount(contextMenu.job)} 个输出路径` : '复制输出路径' }}
        </button>
        <button class="nav-item w-full" role="menuitem" :disabled="['queued', 'running'].includes(contextMenu.job.status)" @click="contextToggleSelection">
          {{ selectedJobIds.has(contextMenu.job.id) ? '取消选择此记录' : '选择此记录' }}
        </button>
        <button class="nav-item w-full hover:bg-danger-soft hover:text-danger" role="menuitem" @click="contextRemove">删除历史记录</button>
      </div>
    </Teleport>
  </div>
</template>
