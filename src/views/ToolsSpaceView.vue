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
  <div class="tools-space page-enter mx-auto w-full max-w-320 px-8 py-6" @click="closeToolsMenus()">
    <PageHeader
      title="工具空间"
      subtitle="按类别浏览全部工具,或直接搜索文件格式与操作名"
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

    <section class="tools-space__quick" aria-labelledby="tools-quick-heading">
      <header>
        <div><p class="eyebrow">从这里开始</p><h3 id="tools-quick-heading">直接开始，不用先翻目录</h3></div>
        <p>八项常用任务覆盖文件、图片、文字、媒体和开发处理；右键可收藏。</p>
      </header>
      <nav aria-label="常用工具直达">
        <RouterLink
          v-for="tool in quickTools"
          :key="tool.id"
          v-memo="[tool.id, isFavorite(tool)]"
          :to="tool.to"
          aria-haspopup="menu"
          :aria-expanded="toolMenu?.tool.id === tool.id"
          :aria-label="`${tool.title}；右键可收藏或打开菜单`"
          @click="store.recordToolUsage(tool.id, router.resolve(tool.to).fullPath)"
          @contextmenu="openToolMenu($event, tool)"
          @keydown="openToolMenuFromKeyboard($event, tool)"
        >
          <span><AppIcon :name="tool.icon" :size="15" /></span>
          <div><b>{{ tool.title }}</b><small>{{ tool.description }}</small></div>
          <AppIcon v-if="isFavorite(tool)" class="tools-space__quick-favorite" name="star" :size="11" />
          <AppIcon v-else name="arrow-right" :size="11" />
        </RouterLink>
      </nav>
    </section>

    <section class="tools-space__categories" aria-label="工具分类">
      <button v-for="category in categoryStats" :key="category.id" :class="{ active: activeFilter === category.id }" @click="selectFilter(category.id)">
        <span><AppIcon :name="category.icon" :size="17" /></span><b>{{ category.label }}</b><small>{{ category.count }} 项</small>
      </button>
    </section>

    <section class="tools-space__body">
      <main>
        <header class="tools-space__toolbar">
          <label><AppIcon name="search" :size="16" /><input v-model="query" aria-label="搜索本地工具" placeholder="搜索合并 PDF、压缩图片、JSON、时间戳…" /><button v-if="query" type="button" aria-label="清空搜索" @click="query = ''">×</button></label>
          <nav aria-label="工具筛选">
            <button v-for="filter in filters.slice(0, 2)" :key="filter.id" :class="{ active: activeFilter === filter.id }" @click="selectFilter(filter.id)"><AppIcon :name="filter.icon" :size="13" />{{ filter.label }}</button>
          </nav>
          <span>{{ filteredTools.length }} 项结果</span>
        </header>

        <section v-if="visibleTools.length" class="tools-space__grid" aria-label="工具列表">
          <RouterLink
            v-for="tool in visibleTools"
            :key="tool.id"
            v-memo="[tool.id, isFavorite(tool), focusedToolId === tool.id]"
            :to="tool.to"
            class="tools-space__tool"
            :class="{ 'tools-space__tool--focused': focusedToolId === tool.id }"
            :data-tool-id="tool.id"
            aria-haspopup="menu"
            :aria-expanded="toolMenu?.tool.id === tool.id"
            :aria-label="`${tool.title}；右键可收藏或打开菜单`"
            @click="store.recordToolUsage(tool.id, router.resolve(tool.to).fullPath)"
            @contextmenu="openToolMenu($event, tool)"
            @keydown="openToolMenuFromKeyboard($event, tool)"
          >
            <span><AppIcon :name="tool.icon" :size="17" /></span>
            <div><b>{{ tool.title }}</b><p>{{ tool.description }}</p></div>
            <small>{{ tool.group }}</small><AppIcon v-if="isFavorite(tool)" class="tools-space__favorite" name="star" :size="12" />
          </RouterLink>
        </section>
        <section v-else class="tools-space__empty"><span><AppIcon name="search" :size="22" /></span><b>{{ activeFilter === 'favorite' ? '还没有收藏工具' : '没有匹配的工具' }}</b><p>{{ activeFilter === 'favorite' ? '在任意工具卡上右键，即可把常用能力固定到这里。' : '换一个关键词，或切回全部工具继续浏览。' }}</p><button class="quiet-button" @click="query = ''; activeFilter = 'all'">查看全部工具</button></section>
        <button v-if="visibleTools.length < filteredTools.length" class="tools-space__more quiet-button" @click="visibleLimit += 12">再显示 {{ Math.min(12, filteredTools.length - visibleTools.length) }} 项</button>
      </main>

      <aside class="tools-space__side">
        <section>
          <header><div><p class="eyebrow">最近运行</p><h3>最近任务</h3></div><RouterLink to="/history">全部</RouterLink></header>
          <div v-if="recentJobs.length" class="tools-space__jobs">
            <button v-for="job in recentJobs" :key="job.id" v-memo="[job.id, job.status, job.progress, job.detail, job.outputs]" aria-haspopup="menu" :aria-expanded="jobMenu?.job.id === job.id" :aria-label="`${job.label}，${jobStatus(job)}；右键或 Shift 加 F10 查看任务操作`" @click="openJob(job)" @contextmenu="openJobMenu($event, job)" @keydown="openJobMenuFromKeyboard($event, job)"><span><AppIcon :name="jobIcon(job)" :size="15" /></span><div><b>{{ job.label }}</b><small>{{ job.detail || job.inputNames?.join('、') || '本地任务' }}</small></div><i :class="job.status">{{ jobStatus(job) }}</i></button>
          </div>
          <div v-else class="tools-space__side-empty"><AppIcon name="clock" :size="18" /><span><b>还没有处理记录</b><small>完成的输出会集中出现在这里。</small></span></div>
        </section>
        <section>
          <header><div><p class="eyebrow">最近工具</p><h3>最近使用</h3></div></header>
          <div v-if="recentTools.length" class="tools-space__recent-tools"><button v-for="tool in recentTools" :key="tool.id" aria-haspopup="menu" :aria-expanded="toolMenu?.tool.id === tool.id" :aria-label="`${tool.title}；右键或 Shift 加 F10 查看工具操作`" @click="openTool(tool)" @contextmenu="openToolMenu($event, tool)" @keydown="openToolMenuFromKeyboard($event, tool)"><AppIcon :name="tool.icon" :size="14" /><span>{{ tool.title }}</span><AppIcon name="arrow-right" :size="12" /></button></div>
          <p v-else class="tools-space__hint">打开工具后，常用入口会在这里自动形成。</p>
        </section>
        <section class="tools-space__capabilities"><span><AppIcon name="flask" :size="17" /></span><div><b>本机能力与实验</b><p>检查 Vault、FFmpeg、输出目录与本机转写引擎的真实边界。</p></div><RouterLink to="/lab">检查</RouterLink></section>
        <section v-if="personalPackEnabled" class="tools-space__private"><span><AppIcon name="terminal" :size="17" /></span><div><b>私人工具包</b><p>外部 JSON 清单、Dry Run、日志与取消由统一执行器负责。</p></div><nav aria-label="私人工具快捷入口"><RouterLink to="/private-tools?action=choose-manifest">加载</RouterLink><RouterLink to="/history?kind=script">历史</RouterLink></nav></section>
      </aside>
    </section>

    <section v-if="toolMenu" ref="toolMenuElement" class="tools-space__menu" role="menu" :aria-label="`${toolMenu.tool.title}操作菜单`" :style="{ left: `${toolMenu.x}px`, top: `${toolMenu.y}px` }" @click.stop @contextmenu.prevent @keydown.stop="handleToolMenuKeydown">
      <header><span>{{ toolMenu.tool.group }}</span><b>{{ toolMenu.tool.title }}</b></header>
      <button role="menuitem" @click="openTool(toolMenu.tool)"><AppIcon name="arrow-right" :size="15" /><span>打开工具</span></button>
      <button role="menuitem" @click="toggleFavorite(toolMenu.tool)"><AppIcon name="star" :size="15" /><span>{{ isFavorite(toolMenu.tool) ? '取消收藏' : '加入收藏' }}</span></button>
      <button role="menuitem" @click="copyToolName(toolMenu.tool)"><AppIcon name="duplicate" :size="15" /><span>复制工具名称</span></button>
    </section>
    <section v-if="jobMenu" ref="jobMenuElement" class="tools-space__menu tools-space__job-menu" role="menu" :aria-label="`${jobMenu.job.label}任务操作菜单`" :style="{ left: `${jobMenu.x}px`, top: `${jobMenu.y}px` }" @click.stop @contextmenu.prevent @keydown.stop="handleJobMenuKeydown">
      <header><span>{{ jobMenu.job.kind.toUpperCase() }} · {{ jobStatus(jobMenu.job) }}</span><b>{{ jobMenu.job.label }}</b></header>
      <button role="menuitem" @click="openJob(jobMenu.job)"><AppIcon name="arrow-right" :size="15" /><span>打开任务页面</span></button>
      <button role="menuitem" :disabled="!jobMenu.job.retryable && !jobMenu.job.route" @click="replayJob(jobMenu.job)"><AppIcon name="rotate" :size="15" /><span>恢复上次参数</span></button>
      <button role="menuitem" :disabled="!historyOutputPaths(jobMenu.job).length" @click="revealJobOutput(jobMenu.job)"><AppIcon name="folder" :size="15" /><span>打开输出位置</span></button>
      <button role="menuitem" :disabled="!historyOutputPaths(jobMenu.job).length" @click="copyJobOutputs(jobMenu.job)"><AppIcon name="duplicate" :size="15" /><span>{{ historyOutputPaths(jobMenu.job).length > 1 ? `复制全部 ${historyOutputPaths(jobMenu.job).length} 个路径` : '复制输出路径' }}</span></button>
      <button role="menuitem" @click="openJobHistory"><AppIcon name="clock" :size="15" /><span>查看完整处理记录</span></button>
      <button role="menuitem" class="danger" @click="removeJobRecord(jobMenu.job)"><AppIcon name="trash" :size="15" /><span>删除历史记录</span></button>
    </section>
  </div>
</template>

<style scoped>
.tools-space{max-width:1460px;margin:0 auto;padding:26px 30px 54px;color:var(--text)}
.tools-space__hero{grid-template-columns:minmax(0,1fr) 255px;overflow:hidden;box-shadow:0 20px 48px var(--accent-soft)}
.tools-space__hero>div{position:relative;display:flex;align-items:flex-start;flex-direction:column;justify-content:center;padding:31px 39px;background-size:28px 28px}.tools-space__hero>div:after{display:none}.tools-space__hero .eyebrow{}.tools-space__hero h2{position:relative;z-index:1;max-width:760px;margin:10px 0 11px;font:720 clamp(29px,3.3vw,44px)/1.1 var(--font-display);letter-spacing:-.045em}.tools-space__hero h2 em{font-style:normal}.tools-space__hero>div>p:not(.eyebrow){position:relative;z-index:1;max-width:720px;font-size:12px;line-height:1.72}.tools-space__hero-actions{z-index:1;gap:8px;margin-top:19px}.tools-space__hero-actions a{display:inline-flex;align-items:center;gap:7px;min-height:37px;padding:0 13px}.tools-space__hero-actions .primary-button{}.tools-space__hero-actions .quiet-button{color:var(--fg);}
.tools-space__hero>aside{display:grid;grid-template-rows:auto 1fr auto;padding:22px;border-left:1px solid var(--surface-2)}.tools-space__hero>aside>span{display:flex;align-items:center;gap:7px;font-size:9px}.tools-space__hero>aside>span i{width:7px;height:7px;box-shadow:0 0 0 4px var(--accent-soft)}.tools-space__hero>aside>span i.active{box-shadow:0 0 0 4px var(--warn-soft)}.tools-space__hero>aside>div{align-self:center;display:grid}.tools-space__hero>aside>div b{font:760 50px/1 var(--font-mono);letter-spacing:-.07em}.tools-space__hero>aside>div small{margin-top:5px;font:9px var(--font-mono);letter-spacing:.09em}.tools-space__hero>aside footer{display:grid;grid-template-columns:1fr 1fr;padding-top:13px;border-top:1px solid var(--surface-2);font-size:9px}.tools-space__hero>aside footer span+span{padding-left:13px;border-left:1px solid var(--surface-2)}.tools-space__hero>aside footer strong{display:block;margin-bottom:3px;font:700 16px var(--font-mono)}
.tools-space__quick{display:grid;grid-template-columns:250px minmax(0,1fr);gap:12px;align-items:stretch;margin-top:14px}.tools-space__quick>header{display:flex;align-items:flex-start;flex-direction:column;justify-content:center;padding:14px 16px;border:1px solid var(--accent-soft);border-radius:14px;background:linear-gradient(135deg,var(--green-bg),var(--surface))}.tools-space__quick h3{margin-top:5px;font:710 15px/1.2 var(--font-display);letter-spacing:-.02em}.tools-space__quick>header>p:last-child{margin:7px 0 0;color:var(--muted);font-size:9px;line-height:1.55}.tools-space__quick>nav{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:1px;overflow:hidden;border:1px solid var(--line);border-radius:14px;background:var(--line);box-shadow:0 8px 22px var(--accent-soft)}.tools-space__quick a{display:grid;grid-template-columns:29px minmax(0,1fr) auto;align-items:center;gap:8px;min-height:55px;padding:8px 10px;color:var(--text);background:var(--surface);outline:0}.tools-space__quick a:hover,.tools-space__quick a:focus-visible{color:var(--green-strong);background:var(--green-bg)}.tools-space__quick a:focus-visible{box-shadow:inset 0 0 0 2px color-mix(in srgb,var(--green) 48%,transparent)}.tools-space__quick a>span{display:grid;width:29px;height:29px;place-items:center;border:1px solid var(--accent-soft);border-radius:8px;color:var(--green-strong);background:var(--surface)}.tools-space__quick a>div{display:grid;min-width:0;gap:3px}.tools-space__quick b,.tools-space__quick small{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.tools-space__quick b{font:670 10px var(--font-ui)}.tools-space__quick small{color:var(--muted);font-size:9px}.tools-space__quick a>svg{color:var(--muted)}.tools-space__quick .tools-space__quick-favorite{color:var(--warn);fill:var(--warn-soft)}
.tools-space__categories{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:9px;padding:17px 0}.tools-space__categories button{display:grid;grid-template-columns:32px minmax(0,1fr) auto;align-items:center;gap:9px;min-height:58px;padding:9px 11px;border:1px solid var(--line);border-radius:12px;color:var(--text-secondary);background:var(--surface-2);text-align:left}.tools-space__categories button:hover,.tools-space__categories button:focus-visible{border-color:var(--accent);color:var(--green-strong);background:var(--surface)}.tools-space__categories button.active{border-color:var(--accent);color:var(--green-strong);background:var(--green-bg);box-shadow:inset 3px 0 var(--green)}.tools-space__categories button>span{display:grid;width:31px;height:31px;place-items:center;border-radius:9px;color:var(--green-strong);background:var(--accent-soft)}.tools-space__categories b{overflow:hidden;font:680 11px var(--font-ui);text-overflow:ellipsis;white-space:nowrap}.tools-space__categories small{color:var(--muted);font:9px var(--font-mono)}
.tools-space__body{display:grid;grid-template-columns:minmax(0,1fr) 294px;gap:14px;align-items:start}.tools-space__body>main{min-width:0;overflow:hidden;border:1px solid var(--line);border-radius:16px;background:var(--surface-2);box-shadow:0 12px 30px var(--accent-soft)}.tools-space__toolbar{display:grid;grid-template-columns:minmax(260px,1fr) auto auto;align-items:center;gap:10px;padding:13px;border-bottom:1px solid var(--line-weak)}.tools-space__toolbar label{display:flex;min-width:0;align-items:center;gap:8px;height:38px;padding:0 11px;border:1px solid var(--line);border-radius:10px;color:var(--muted);background:var(--canvas)}.tools-space__toolbar label:focus-within{border-color:var(--green);box-shadow:0 0 0 3px color-mix(in srgb,var(--green) 12%,transparent)}.tools-space__toolbar input{min-width:0;flex:1;border:0;outline:0;color:var(--text);background:transparent;font-size:11px}.tools-space__toolbar label button{width:24px;height:24px;padding:0;border:0;color:var(--muted);background:transparent}.tools-space__toolbar nav{display:flex;gap:5px}.tools-space__toolbar nav button{display:flex;align-items:center;gap:5px;min-height:31px;padding:0 9px;border:1px solid transparent;border-radius:8px;color:var(--muted);background:transparent;font-size:9px}.tools-space__toolbar nav button:hover,.tools-space__toolbar nav button.active{border-color:var(--accent-soft);color:var(--green-strong);background:var(--green-bg)}.tools-space__toolbar>span{color:var(--muted);font:9px var(--font-mono);white-space:nowrap}
.tools-space__grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:0;padding:5px 13px 9px}.tools-space__tool{position:relative;display:grid;grid-template-columns:34px minmax(0,1fr) auto;align-items:center;gap:10px;min-height:76px;padding:11px 9px;border-bottom:1px solid var(--line-weak);color:var(--text);cursor:context-menu}.tools-space__tool:nth-child(odd){padding-right:15px;border-right:1px solid var(--line-weak)}.tools-space__tool:nth-child(even){padding-left:15px}.tools-space__tool:hover,.tools-space__tool:focus-visible{color:var(--green-strong);background:linear-gradient(90deg,var(--green-bg),transparent)}.tools-space__tool:focus-visible{z-index:1;outline:2px solid color-mix(in srgb,var(--green) 46%,transparent);outline-offset:-2px}.tools-space__tool--focused{z-index:1;color:var(--green-strong);background:linear-gradient(90deg,color-mix(in srgb,var(--green-bg) 90%,var(--surface)),var(--surface-2));box-shadow:inset 3px 0 var(--green)}.tools-space__tool>span{display:grid;width:34px;height:34px;place-items:center;border:1px solid var(--accent-soft);border-radius:9px;color:var(--green-strong);background:var(--accent-soft)}.tools-space__tool>div{display:grid;min-width:0;gap:4px}.tools-space__tool b,.tools-space__tool p{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.tools-space__tool b{font:670 11px var(--font-ui)}.tools-space__tool p{margin:0;color:var(--muted);font-size:9px}.tools-space__tool>small{align-self:start;margin-top:2px;padding:3px 5px;border-radius:5px;color:var(--muted);background:var(--surface-2);font:9px var(--font-mono)}.tools-space__favorite{position:absolute;right:9px;bottom:9px;color:var(--warn);fill:var(--warn-soft)}.tools-space__more{display:flex;margin:6px auto 14px;min-height:31px;color:var(--green-strong);background:var(--green-bg)}.tools-space__empty{display:grid;min-height:330px;place-content:center;justify-items:center;padding:35px;color:var(--muted);text-align:center}.tools-space__empty>span{display:grid;width:46px;height:46px;margin-bottom:12px;place-items:center;border-radius:14px;color:var(--green-strong);background:var(--green-bg)}.tools-space__empty b{color:var(--text);font:700 15px var(--font-ui)}.tools-space__empty p{max-width:330px;margin:7px 0 14px;font-size:10px;line-height:1.6}
.tools-space__side{display:grid;gap:11px}.tools-space__side>section{overflow:hidden;border:1px solid var(--line);border-radius:14px;background:var(--surface-2);box-shadow:0 8px 22px var(--accent-soft)}.tools-space__side>section>header{display:flex;align-items:flex-end;justify-content:space-between;gap:10px;padding:13px;border-bottom:1px solid var(--line-weak)}.tools-space__side h3{margin-top:4px;font:700 14px var(--font-display)}.tools-space__side>section>header>a{color:var(--green-strong);font-size:9px}.tools-space__jobs{display:grid}.tools-space__jobs button{display:grid;width:100%;grid-template-columns:29px minmax(0,1fr) auto;align-items:center;gap:8px;min-height:57px;padding:8px 11px;border:0;border-bottom:1px solid var(--line-weak);color:var(--text);background:transparent;text-align:left}.tools-space__jobs button:last-child{border-bottom:0}.tools-space__jobs button:hover,.tools-space__jobs button:focus-visible{color:var(--green-strong);background:var(--green-bg)}.tools-space__jobs button>span{display:grid;width:28px;height:28px;place-items:center;border-radius:8px;color:var(--green-strong);background:var(--accent-soft)}.tools-space__jobs button>div{display:grid;min-width:0;gap:3px}.tools-space__jobs b,.tools-space__jobs small{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.tools-space__jobs b{font:650 10px var(--font-ui)}.tools-space__jobs small{color:var(--muted);font-size:9px}.tools-space__jobs i{color:var(--muted);font:9px var(--font-mono);font-style:normal}.tools-space__jobs i.running{color:var(--warn)}.tools-space__jobs i.succeeded{color:var(--green-strong)}.tools-space__jobs i.failed{color:var(--danger)}.tools-space__side-empty{display:flex;align-items:center;justify-content:center;gap:9px;min-height:94px;padding:16px;color:var(--green-strong)}.tools-space__side-empty span{display:grid;gap:3px}.tools-space__side-empty b{color:var(--text);font-size:10px}.tools-space__side-empty small{color:var(--muted);font-size:9px}.tools-space__recent-tools{display:grid;padding:5px 10px 9px}.tools-space__recent-tools button{display:grid;grid-template-columns:22px minmax(0,1fr) auto;align-items:center;gap:7px;min-height:34px;padding:0 5px;border:0;border-bottom:1px solid var(--line-weak);color:var(--text-secondary);background:transparent;text-align:left;font-size:9px}.tools-space__recent-tools button:hover,.tools-space__recent-tools button:focus-visible{color:var(--green-strong);background:var(--green-bg)}.tools-space__hint{margin:0;padding:18px;color:var(--muted);font-size:9px;line-height:1.55}.tools-space__capabilities,.tools-space__private{display:grid!important;grid-template-columns:32px minmax(0,1fr) auto;align-items:center;gap:9px;padding:13px!important}.tools-space__capabilities{border-color:var(--warn-soft)!important;background:linear-gradient(135deg,var(--surface-2),var(--surface))!important}.tools-space__private{border-color:var(--accent-soft)!important;background:linear-gradient(135deg,var(--green-bg),var(--surface))!important}.tools-space__capabilities>span,.tools-space__private>span{display:grid;width:31px;height:31px;place-items:center;border-radius:9px;color:var(--fg);background:var(--green-strong)}.tools-space__capabilities>span{color:var(--warn);background:var(--warn)}.tools-space__capabilities>div,.tools-space__private>div{display:grid;gap:3px;min-width:0}.tools-space__capabilities b,.tools-space__private b{font-size:10px}.tools-space__capabilities p,.tools-space__private p{margin:0;color:var(--muted);font-size:9px;line-height:1.5}.tools-space__capabilities>a,.tools-space__private>a{color:var(--green-strong);font:700 9px var(--font-ui)}.tools-space__capabilities>a:focus-visible,.tools-space__private>a:focus-visible{border-radius:4px;outline:2px solid color-mix(in srgb,var(--green) 45%,transparent);outline-offset:3px}
.tools-space__menu{position:fixed;z-index:145;width:238px;overflow:hidden;border:1px solid var(--accent-soft);border-radius:12px;background:var(--surface);box-shadow:var(--shadow-lg);animation:tool-menu-in .14s ease-out both}.tools-space__menu>header{display:grid;gap:3px;padding:11px 13px 9px;border-bottom:1px solid var(--line-weak);background:linear-gradient(125deg,var(--green-bg),var(--surface-2))}.tools-space__menu>header span{color:var(--green-strong);font:700 9px var(--font-mono);letter-spacing:.1em}.tools-space__menu>header b{overflow:hidden;font:700 12px var(--font-ui);text-overflow:ellipsis;white-space:nowrap}.tools-space__menu button{display:flex;width:100%;min-height:39px;align-items:center;gap:9px;padding:0 13px;border:0;border-bottom:1px solid var(--line-weak);color:var(--text-secondary);background:transparent;font:650 10px var(--font-ui);text-align:left}.tools-space__menu button:last-child{border-bottom:0}.tools-space__menu button:hover,.tools-space__menu button:focus-visible{color:var(--green-strong);background:var(--green-bg)}.tools-space__menu button:focus-visible{outline:2px solid color-mix(in srgb,var(--green) 48%,transparent);outline-offset:-2px}.tools-space__menu button:disabled{cursor:not-allowed;color:var(--faint);background:transparent}.tools-space__menu button.danger{color:var(--danger)}.tools-space__menu button.danger:hover,.tools-space__menu button.danger:focus-visible{color:var(--danger);background:var(--danger-soft)}.tools-space__job-menu{width:252px}.tools-space__job-menu>header span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}@keyframes tool-menu-in{from{opacity:0;transform:translateY(-4px) scale(.985)}to{opacity:1;transform:none}}
@media(max-width:1120px){.tools-space__quick{grid-template-columns:1fr}.tools-space__quick>header{display:grid;grid-template-columns:auto minmax(0,1fr);column-gap:14px}.tools-space__quick>header>p:last-child{grid-column:2;margin:0}.tools-space__body{grid-template-columns:minmax(0,1fr) 270px}.tools-space__toolbar{grid-template-columns:1fr auto}.tools-space__toolbar>span{display:none}.tools-space__categories{grid-template-columns:repeat(2,minmax(0,1fr))}}
.tools-space__private>nav{display:grid;gap:5px;text-align:right}.tools-space__private>nav a{color:var(--green-strong);font:700 9px var(--font-ui)}.tools-space__private>nav a:focus-visible{border-radius:4px;outline:2px solid color-mix(in srgb,var(--green) 45%,transparent);outline-offset:3px}

/* Desktop readability pass: keep metadata compact without turning the tool
   directory into a wall of 9px labels. These overrides intentionally stay
   after the structural rules so the warm-paper layout remains unchanged. */
.tools-space__hero>div>p:not(.eyebrow){font-size:13px}
.tools-space__hero>aside>span{font-size:11px}.tools-space__hero>aside>div small{font-size:10px}.tools-space__hero>aside footer{font-size:10px}
.tools-space__quick>header>p:last-child{font-size:11px}.tools-space__quick a{min-height:68px}.tools-space__quick b{font-size:11px}.tools-space__quick small{display:-webkit-box;overflow:hidden;font-size:10px;line-height:1.35;white-space:normal;-webkit-box-orient:vertical;-webkit-line-clamp:2}
.tools-space__categories b{font-size:12px}.tools-space__categories small{font-size:10px}
.tools-space__toolbar input{font-size:12px}.tools-space__toolbar nav button{font-size:10px}.tools-space__toolbar>span{font-size:10px}
.tools-space__tool{min-height:82px;cursor:pointer}.tools-space__tool b{font-size:12px}.tools-space__tool p{display:-webkit-box;overflow:hidden;font-size:10px;line-height:1.45;white-space:normal;-webkit-box-orient:vertical;-webkit-line-clamp:2}.tools-space__tool>small{font-size:10px}
.tools-space__empty p{font-size:11px}.tools-space__side>section>header>a{font-size:10px}
.tools-space__jobs b{font-size:11px}.tools-space__jobs small,.tools-space__jobs i{font-size:10px}.tools-space__side-empty b{font-size:11px}.tools-space__side-empty small{font-size:10px}
.tools-space__recent-tools button{font-size:10px}.tools-space__hint{font-size:10px}
.tools-space__capabilities b,.tools-space__private b{font-size:11px}.tools-space__capabilities p,.tools-space__private p{font-size:10px}.tools-space__capabilities>a,.tools-space__private>a,.tools-space__private>nav a{font-size:10px}
.tools-space__menu>header span{font-size:10px}.tools-space__menu button{font-size:11px}

@media(max-width:1320px){.tools-space__quick{grid-template-columns:1fr}.tools-space__quick>header{display:grid;grid-template-columns:auto minmax(0,1fr);column-gap:14px}.tools-space__quick>header>p:last-child{grid-column:2;margin:0}.tools-space__quick>nav{grid-template-columns:repeat(4,minmax(0,1fr))}}
@media(max-width:960px){.tools-space{padding:22px 18px 46px}.tools-space__hero{}.tools-space__hero>aside{display:none}.tools-space__quick>nav{grid-template-columns:repeat(2,minmax(0,1fr))}.tools-space__body{grid-template-columns:1fr}.tools-space__side{grid-template-columns:repeat(2,minmax(0,1fr))}.tools-space__capabilities,.tools-space__private{grid-column:1/-1}.tools-space__grid{grid-template-columns:1fr}.tools-space__tool:nth-child(odd),.tools-space__tool:nth-child(even){padding-inline:9px;border-right:0}.tools-space__toolbar{grid-template-columns:1fr}.tools-space__toolbar nav{justify-content:flex-start}}
@media(max-width:640px){.tools-space__quick>header{display:block}.tools-space__quick>header>p:last-child{margin-top:7px}.tools-space__quick>nav{grid-template-columns:repeat(2,minmax(0,1fr))}}
</style>
