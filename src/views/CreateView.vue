<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef } from 'vue'
import { RouterLink, useRouter } from 'vue-router'
import AppIcon from '@/components/AppIcon.vue'
import PageHeader from '@/components/PageHeader.vue'
import { createQuickStarts, recentCreateMenuHeight } from '@/lib/create-quick-starts'
import { clampMenuPosition, isContextMenuShortcut, nextMenuItemIndex } from '@/lib/desktop-menu'
import { isDesktop, listDesktopVisualProjects, type DesktopVisualProjectSummary } from '@/lib/native'
import { discoverVisualProjects, visualProjectRoute } from '@/lib/visual-project'
import { useWorkbenchStore } from '@/stores/workbench'
import { useUiStore } from '@/stores/ui'

type CreateAction = { label: string; detail: string; to: string }
type RecentCreateItem = { id: string; title: string; subtitle: string; activityAt: string; activityLabel: string; kind: 'note' | 'visual'; itemId: string; to: string | { path: string; query: Record<string, string> } }
type CreateWorkflow = {
  id: string
  overline: string
  title: string
  description: string
  icon: string
  to: string
  status: string
  featured?: boolean
  actions: CreateAction[]
}

const router = useRouter()
const store = useWorkbenchStore()
const ui = useUiStore()
const menu = ref<{ workflow: CreateWorkflow; x: number; y: number } | null>(null)
const menuElement = ref<HTMLElement>()
const recentMenu = ref<{ item: RecentCreateItem; x: number; y: number } | null>(null)
const recentMenuElement = ref<HTMLElement>()
const visualProjects = shallowRef<DesktopVisualProjectSummary[]>([])
const recentProjectsPending = ref(false)
let menuTrigger: HTMLElement | undefined
let recentMenuTrigger: HTMLElement | undefined

const workflows: CreateWorkflow[] = [
  {
    id: 'markdown', overline: 'WRITE', title: 'Markdown 写作', icon: 'book', status: '源码 · 分屏 · 阅读', featured: true,
    description: '用 CodeMirror 写长文档，在源码、分屏和阅读模式间切换；兼容公式、代码、表格、双链与外部 .md。',
    to: '/documents?kind=note&create=note',
    actions: [
      { label: '新建空白 Markdown', detail: '直接进入轻量源码编辑器', to: '/documents?kind=note&create=note' },
      { label: '从算法记录开始', detail: '带思路、复杂度和实现结构', to: '/documents?kind=note&template=algorithm&mode=split' },
      { label: '浏览全部笔记', detail: '打开本地 Markdown 资料库', to: '/documents?kind=note' },
    ],
  },
  {
    id: 'mindmap', overline: 'MAP', title: '思维图谱', icon: 'sort', status: 'Markmap · 按需加载',
    description: '把 Markdown 标题层级直接变成交互式图谱，不再维护另一份脑图文件。',
    to: '/documents?kind=note&template=mindmap&mode=mindmap',
    actions: [
      { label: '新建思维图谱', detail: '创建适合展开的标题骨架', to: '/documents?kind=note&template=mindmap&mode=mindmap' },
      { label: '从已有笔记生成', detail: '选择笔记后切换到图谱模式', to: '/documents?kind=note&mode=mindmap' },
    ],
  },
  {
    id: 'diagram', overline: 'DIAGRAM', title: '流程与结构图', icon: 'split', status: 'Mermaid · 视口渲染',
    description: '在普通 Markdown 中维护流程图、时序图、类图和 ER 图，图表进入视口后才绘制。',
    to: '/documents?kind=note&template=diagram&mode=split',
    actions: [
      { label: '新建 Mermaid 图表', detail: '用分屏模式边写边看', to: '/documents?kind=note&template=diagram&mode=split' },
      { label: '打开 Markdown 编辑器', detail: '在任意笔记中插入 mermaid 代码块', to: '/documents?kind=note&mode=split' },
    ],
  },
  {
    id: 'formula', overline: 'FORMULA', title: 'LaTeX 公式编辑', icon: 'math', status: 'KaTeX · 即时预览',
    description: '用可视化片段或公式截图生成可校对 LaTeX 草稿；确认后仍保存为标准 Markdown。',
    to: '/documents?kind=note&create=note&mode=split&insert=formula',
    actions: [
      { label: '新建公式草稿', detail: '打开分屏编辑与公式即时预览', to: '/documents?kind=note&create=note&mode=split&insert=formula' },
      { label: '从公式图片识别', detail: '明确确认发送后生成可编辑草稿', to: '/documents?kind=note&create=note&mode=split&insert=formula&recognize=formula' },
      { label: '浏览数学笔记', detail: '回到本地 Markdown 资料库', to: '/documents?kind=note' },
    ],
  },
  {
    id: 'image', overline: 'CANVAS', title: '视觉画布工作室', icon: 'palette', status: '自由画布 · 图片处理',
    description: '从空白画布或图片开始，完成方框、箭头、文字标注、拼图、裁剪与格式转换。',
    to: '/visual',
    actions: [
      { label: '新建自由画布', detail: '选择横向、方形或竖向尺寸', to: '/visual?canvas=blank' },
      { label: '打开图片画布', detail: '拼图、标题、箭头和文本标注', to: '/visual' },
      { label: '拼接滚动长图', detail: '识别连续截图重叠并生成 PNG', to: '/visual?tool=stitch' },
      { label: '裁剪图片', detail: '在本地画布框选输出区域', to: '/visual?tool=crop' },
      { label: '压缩与转换', detail: '预览真实输出效果', to: '/visual?tool=convert' },
      { label: '缩放图片', detail: '限制最大宽度并控制输出质量', to: '/visual?tool=resize' },
      { label: '旋转图片', detail: '批量调整图片方向', to: '/visual?tool=rotate' },
    ],
  },
  {
    id: 'code', overline: 'CODE', title: '代码分享工作室', icon: 'terminal', status: '长图 · 自动分页',
    description: '把算法和工程代码排成清晰长图；过长内容自动分页，不受普通截图高度限制。',
    to: '/code-image',
    actions: [
      { label: '制作代码长图', detail: '粘贴代码并实时排版', to: '/code-image' },
      { label: '从剪贴板收集', detail: '先整理最近复制的代码', to: '/clipboard' },
    ],
  },
  {
    id: 'ai', overline: 'ASSIST', title: 'AI 内容工作台', icon: 'sparkle', status: '确认后写入',
    description: '总结、翻译、改写与提取结构；输出先预览，只有确认后才进入你的本地内容。',
    to: '/ai',
    actions: [
      { label: '总结内容', detail: '整理长文本的重点与结构', to: '/ai?action=summarize' },
      { label: '翻译内容', detail: '保留 Markdown 结构进行翻译', to: '/ai?action=translate' },
      { label: '提取结构', detail: '转换为可继续编辑的提纲', to: '/ai?action=extract' },
    ],
  },
]

const noteCount = computed(() => store.documents.filter((document) => document.kind === 'note').length)
const notesById = computed(() => new Map(store.documents.filter((document) => document.kind === 'note').map((note) => [note.id, note])))
const recentNotes = computed(() => store.contentRecents.flatMap((pointer) => {
  if (pointer.itemKind !== 'note') return []
  const note = notesById.value.get(pointer.itemId)
  return note ? [{
    id: `note:${note.id}`,
    title: note.title,
    subtitle: note.folder || note.subject || 'Markdown 笔记',
    activityAt: pointer.openedAt,
    activityLabel: '最近打开',
    kind: 'note' as const,
    itemId: note.id,
    to: { path: '/documents', query: { kind: 'note', document: note.id } },
  }] : []
}))
const latestRecentNote = computed(() => recentNotes.value[0])
const continueNoteRoute = computed(() => latestRecentNote.value ? { path: '/documents', query: { kind: 'note', document: latestRecentNote.value.itemId, mode: 'edit' } } : { path: '/documents', query: { kind: 'note' } })
const continueNoteLabel = computed(() => latestRecentNote.value ? `继续「${latestRecentNote.value.title.length > 10 ? `${latestRecentNote.value.title.slice(0, 10)}…` : latestRecentNote.value.title}」` : '浏览全部笔记')
const recentWork = computed(() => [
  ...recentNotes.value,
  ...discoverVisualProjects(visualProjects.value, '', 12).map((project) => ({
    id: `visual:${project.id}`,
    title: project.title,
    subtitle: `画布 · ${project.imageCount} 张源图 · ${project.annotationCount} 个标注`,
    activityAt: project.updatedAt,
    activityLabel: '最近修改',
    kind: 'visual' as const,
    itemId: project.id,
    to: visualProjectRoute(project.id),
  })),
].sort((left, right) => right.activityAt.localeCompare(left.activityAt)).slice(0, 4))

onMounted(async () => {
  window.addEventListener('knitspace:close-context-menus', closeCreateMenus)
  if (!isDesktop()) return
  recentProjectsPending.value = true
  try { visualProjects.value = await listDesktopVisualProjects(12) }
  catch { visualProjects.value = [] }
  finally { recentProjectsPending.value = false }
})
onBeforeUnmount(() => window.removeEventListener('knitspace:close-context-menus', closeCreateMenus))

function formatDate(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '最近'
  const now = new Date()
  if (date.toDateString() === now.toDateString()) return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
  return date.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })
}
function closeMenu(restoreFocus = false) {
  menu.value = null
  if (restoreFocus) void nextTick(() => menuTrigger?.focus({ preventScroll: true }))
}
function closeRecentMenu(restoreFocus = false) {
  recentMenu.value = null
  if (restoreFocus) void nextTick(() => recentMenuTrigger?.focus({ preventScroll: true }))
}
function closeCreateMenus() { closeMenu(); closeRecentMenu() }
function openMenu(event: MouseEvent | KeyboardEvent, workflow: CreateWorkflow) {
  event.preventDefault()
  event.stopPropagation()
  closeRecentMenu()
  menuTrigger = event.currentTarget instanceof HTMLElement ? event.currentTarget : undefined
  const bounds = menuTrigger?.getBoundingClientRect()
  const x = 'clientX' in event && event.clientX ? event.clientX : (bounds?.left ?? 18) + 36
  const y = 'clientY' in event && event.clientY ? event.clientY : (bounds?.top ?? 18) + 42
  menu.value = { workflow, ...clampMenuPosition(x, y, { menuWidth: 262, menuHeight: 61 + workflow.actions.length * 55, margin: 12 }) }
  void nextTick(() => menuElement.value?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus())
}
function openRecentMenu(event: MouseEvent | KeyboardEvent, item: RecentCreateItem) {
  event.preventDefault()
  event.stopPropagation()
  closeMenu()
  recentMenuTrigger = event.currentTarget instanceof HTMLElement ? event.currentTarget : undefined
  const bounds = recentMenuTrigger?.getBoundingClientRect()
  const x = 'clientX' in event && event.clientX ? event.clientX : (bounds?.right ?? 280) - 22
  const y = 'clientY' in event && event.clientY ? event.clientY : (bounds?.top ?? 18) + 28
  // Recent actions share the 55px workflow-menu row. Reserve the rendered
  // height rather than the compact menu-row height so bottom cards never clip.
  recentMenu.value = { item, ...clampMenuPosition(x, y, { menuWidth: 252, menuHeight: recentCreateMenuHeight(item.kind), margin: 12 }) }
  void nextTick(() => recentMenuElement.value?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus({ preventScroll: true }))
}
function openRecentMenuFromKeyboard(event: KeyboardEvent, item: RecentCreateItem) {
  if (isContextMenuShortcut(event)) openRecentMenu(event, item)
}
function openMenuFromKeyboard(event: KeyboardEvent, workflow: CreateWorkflow) {
  if (!isContextMenuShortcut(event)) return
  openMenu(event, workflow)
}
function handleMenuKeydown(event: KeyboardEvent) {
  const items = [...(menuElement.value?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [])]
  if (event.key === 'Escape') { event.preventDefault(); closeMenu(true); return }
  const nextIndex = nextMenuItemIndex(event.key, items.indexOf(document.activeElement as HTMLButtonElement), items.length)
  if (nextIndex === undefined) return
  event.preventDefault()
  items[nextIndex]?.focus({ preventScroll: true })
}
function handleRecentMenuKeydown(event: KeyboardEvent) {
  const items = [...(recentMenuElement.value?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [])]
  if (event.key === 'Escape') { event.preventDefault(); closeRecentMenu(true); return }
  const nextIndex = nextMenuItemIndex(event.key, items.indexOf(document.activeElement as HTMLButtonElement), items.length)
  if (nextIndex === undefined) return
  event.preventDefault()
  items[nextIndex]?.focus({ preventScroll: true })
}
async function runAction(action: CreateAction) {
  closeMenu()
  await router.push(action.to)
}
async function runRecentAction(action: 'open' | 'edit' | 'read' | 'mindmap' | 'favorite' | 'copy-title') {
  const target = recentMenu.value?.item
  if (!target) return
  closeRecentMenu()
  if (action === 'open') { await router.push(target.to); return }
  if (target.kind === 'note' && action === 'edit') { await router.push({ path: '/documents', query: { kind: 'note', document: target.itemId, mode: 'edit' } }); return }
  if (target.kind === 'note' && action === 'read') { await router.push({ path: '/documents', query: { kind: 'note', document: target.itemId, mode: 'preview' } }); return }
  if (target.kind === 'note' && action === 'mindmap') { await router.push({ path: '/documents', query: { kind: 'note', document: target.itemId, mode: 'mindmap' } }); return }
  if (action === 'favorite') {
    const pointerKind = target.kind === 'note' ? 'note' : 'diagram'
    const wasFavorite = store.isContentFavorite(pointerKind, target.itemId)
    await store.toggleContentFavorite(pointerKind, target.itemId)
    ui.toast(wasFavorite ? '已取消收藏' : '已加入收藏', target.title, 'success')
    return
  }
  try {
    const text = target.kind === 'note' ? `[[${target.title}]]` : target.title
    await navigator.clipboard.writeText(text)
    ui.toast(target.kind === 'note' ? '双链已复制' : '画布名称已复制', text, 'success')
  } catch (error) { ui.toast('复制失败', error instanceof Error ? error.message : '系统剪贴板暂时不可用。', 'error') }
}
</script>

<template>
  <!-- No `create-space` / `create-workflows` classes; the scoped block goes
       with them. The page also loses a heading that only introduced the block
       under it ("七类工作流，具体能力不再隐藏") — a section that has to
       explain itself has not earned the space twice. -->
  <div class="page-enter mx-auto w-full max-w-320 px-8 py-6" @click="closeCreateMenus()">
    <PageHeader
      title="创作空间"
      subtitle="从一段文字、一张图或一段代码开始，七类工作流直接进入"
      :stats="[
        { label: '笔记', value: noteCount },
        { label: '近期画布', value: visualProjects.length },
      ]"
    >
      <template #actions>
        <RouterLink class="btn-default" :to="continueNoteRoute">{{ continueNoteLabel }}</RouterLink>
        <RouterLink class="btn-primary" to="/documents?kind=note&create=note"><AppIcon name="plus" :size="15" />新建 Markdown</RouterLink>
      </template>
    </PageHeader>

    <div class="grid gap-4 grid-cols-1 xl:grid-cols-[minmax(0,1fr)_minmax(300px,340px)]">
      <div class="stack gap-4 min-w-0">
        <!-- The eight high-frequency starts, as one strip rather than a nav
             that repeats the workflow grid below it. -->
        <nav class="grid gap-2 grid-cols-2 sm:grid-cols-3 2xl:grid-cols-4" aria-label="常用创作动作">
          <RouterLink
            v-for="item in createQuickStarts"
            :key="item.id"
            v-memo="[item.id]"
            :to="item.to"
            class="row gap-2.5 px-3 py-2.5 rounded-md panel transition-colors duration-120 hover:border-accent hover:bg-accent-soft"
          >
            <span class="center w-8 h-8 shrink-0 rounded-sm bg-surface-2 text-accent"><AppIcon :name="item.icon" :size="16" /></span>
            <span class="stack gap-0.5 min-w-0 flex-1">
              <b class="text-[12px] font-medium truncate text-fg">{{ item.label }}</b>
              <small class="text-[11px] truncate text-fg-3">{{ item.detail }}</small>
            </span>
          </RouterLink>
        </nav>

        <section class="stack gap-2" aria-label="创作工作流">
          <div class="row-between gap-3">
            <h3 class="text-[12px] font-semibold text-fg-3">工作流</h3>
            <small class="text-[11px] text-fg-3">左键打开默认任务 · 右键或 Shift+F10 查看全部开始方式</small>
          </div>
          <div class="grid gap-2 grid-cols-1 md:grid-cols-2 2xl:grid-cols-3">
            <RouterLink
              v-for="workflow in workflows"
              :key="workflow.id"
              v-memo="[workflow.id, menu?.workflow.id === workflow.id]"
              :to="workflow.to"
              class="stack gap-2 p-3 rounded-md panel transition-colors duration-120 hover:border-accent"
              :class="workflow.featured ? 'border-accent' : ''"
              :aria-label="`${workflow.title}；右键可选择其他开始方式`"
              aria-haspopup="menu"
              :aria-expanded="menu?.workflow.id === workflow.id"
              @contextmenu="openMenu($event, workflow)"
              @keydown="openMenuFromKeyboard($event, workflow)"
            >
              <header class="row gap-2">
                <span class="center w-8 h-8 shrink-0 rounded-sm bg-accent-soft text-accent"><AppIcon :name="workflow.icon" :size="16" /></span>
                <p class="min-w-0 flex-1 truncate text-[11px] font-semibold text-fg-3">{{ workflow.overline }}</p>
                <small class="shrink-0 text-[11px] text-fg-3">{{ workflow.status }}</small>
              </header>
              <div class="stack gap-1 min-w-0">
                <h3 class="text-[13px] font-semibold text-fg">{{ workflow.title }}</h3>
                <p class="text-[11px] leading-relaxed text-fg-3">{{ workflow.description }}</p>
              </div>
              <footer class="row gap-1.5 mt-auto pt-1 text-[11px] font-medium text-accent">
                进入工作流<AppIcon name="arrow-right" :size="13" />
              </footer>
            </RouterLink>
          </div>
        </section>
      </div>

      <aside class="pane self-start max-h-[calc(100vh_-_16rem)]" aria-label="最近创作">
        <header class="pane-head">
          <span class="pane-title">最近创作</span>
          <small class="text-[11px] tabular-nums text-fg-3">{{ noteCount }} 篇 · {{ visualProjects.length }} 画布</small>
        </header>
        <div v-if="recentWork.length" class="flex-1 min-h-0 overflow-y-auto stack gap-0.5 p-1.5" :aria-busy="recentProjectsPending">
          <RouterLink
            v-for="item in recentWork"
            :key="item.id"
            v-memo="[item.id, item.title, item.subtitle, item.activityAt, recentMenu?.item.id === item.id]"
            :to="item.to"
            class="stack gap-0.5 px-2 py-1.5 rounded-sm transition-colors duration-120 hover:bg-surface-2"
            aria-haspopup="menu"
            :aria-expanded="recentMenu?.item.id === item.id"
            :title="`继续“${item.title}”；右键或 Shift+F10 查看更多操作`"
            @contextmenu="openRecentMenu($event, item)"
            @keydown="openRecentMenuFromKeyboard($event, item)"
          >
            <b class="text-[12px] font-medium truncate text-fg">{{ item.title }}</b>
            <span class="row-between gap-2">
              <small class="min-w-0 truncate text-[11px] text-fg-3">{{ item.subtitle }}</small>
              <time class="shrink-0 text-[11px] tabular-nums text-fg-3">{{ item.activityLabel }} {{ formatDate(item.activityAt) }}</time>
            </span>
          </RouterLink>
        </div>
        <div v-else class="stack items-center gap-2 p-6 text-center" :aria-busy="recentProjectsPending">
          <AppIcon :name="recentProjectsPending ? 'clock' : 'book'" :size="20" class="text-fg-3" />
          <b class="text-[12px] font-medium text-fg">{{ recentProjectsPending ? '正在读取最近创作' : '还没有创作记录' }}</b>
          <small class="text-[11px] leading-relaxed text-fg-3">{{ recentProjectsPending ? '只加载笔记与画布摘要。' : '第一篇内容会成为今后的知识入口。' }}</small>
        </div>
      </aside>
    </div>

    <Teleport to="body">
      <section
        v-if="menu"
        ref="menuElement"
        class="menu-panel w-72"
        role="menu"
        :aria-label="`${menu.workflow.title}快捷操作`"
        :style="{ left: `${menu.x}px`, top: `${menu.y}px` }"
        @click.stop
        @contextmenu.prevent
        @keydown.stop="handleMenuKeydown"
      >
        <p class="menu-title">{{ menu.workflow.overline }}<small class="min-w-0 truncate font-normal">{{ menu.workflow.title }}</small></p>
        <button v-for="action in menu.workflow.actions" :key="action.to + action.label" class="menu-item" role="menuitem" @click="runAction(action)">
          <span class="stack gap-0.5 min-w-0">
            <b class="font-medium">{{ action.label }}</b>
            <small class="text-[11px] text-fg-3">{{ action.detail }}</small>
          </span>
          <AppIcon name="arrow-right" :size="13" class="shrink-0" />
        </button>
      </section>

      <section
        v-if="recentMenu"
        ref="recentMenuElement"
        class="menu-panel w-72"
        role="menu"
        :aria-label="`${recentMenu.item.title}创作操作`"
        :style="{ left: `${recentMenu.x}px`, top: `${recentMenu.y}px` }"
        @click.stop
        @contextmenu.prevent
        @keydown.stop="handleRecentMenuKeydown"
      >
        <p class="menu-title">
          {{ recentMenu.item.kind === 'note' ? 'Markdown' : '画布项目' }}
          <small class="min-w-0 truncate font-normal">{{ recentMenu.item.title }}</small>
        </p>
        <button class="menu-item" role="menuitem" @click="runRecentAction('open')">
          <span class="stack gap-0.5 min-w-0"><b class="font-medium">继续打开</b><small class="text-[11px] text-fg-3">{{ recentMenu.item.activityLabel }} · {{ formatDate(recentMenu.item.activityAt) }}</small></span>
          <AppIcon name="arrow-right" :size="13" class="shrink-0" />
        </button>
        <template v-if="recentMenu.item.kind === 'note'">
          <button class="menu-item" role="menuitem" @click="runRecentAction('edit')">
            <span class="stack gap-0.5 min-w-0"><b class="font-medium">源码编辑</b><small class="text-[11px] text-fg-3">回到 CodeMirror 编辑模式</small></span>
            <AppIcon name="rename" :size="13" class="shrink-0" />
          </button>
          <button class="menu-item" role="menuitem" @click="runRecentAction('read')">
            <span class="stack gap-0.5 min-w-0"><b class="font-medium">阅读预览</b><small class="text-[11px] text-fg-3">只显示排版后的 Markdown</small></span>
            <AppIcon name="book" :size="13" class="shrink-0" />
          </button>
          <button class="menu-item" role="menuitem" @click="runRecentAction('mindmap')">
            <span class="stack gap-0.5 min-w-0"><b class="font-medium">查看思维图谱</b><small class="text-[11px] text-fg-3">按标题层级生成可交互图谱</small></span>
            <AppIcon name="sort" :size="13" class="shrink-0" />
          </button>
        </template>
        <i class="menu-sep" aria-hidden="true" />
        <button class="menu-item" role="menuitem" @click="runRecentAction('favorite')">
          <span class="stack gap-0.5 min-w-0">
            <b class="font-medium">{{ store.isContentFavorite(recentMenu.item.kind === 'note' ? 'note' : 'diagram', recentMenu.item.itemId) ? '取消收藏' : '加入收藏' }}</b>
            <small class="text-[11px] text-fg-3">同步到今天、知识库与 Ctrl K</small>
          </span>
          <AppIcon name="star" :size="13" class="shrink-0" />
        </button>
        <button class="menu-item" role="menuitem" @click="runRecentAction('copy-title')">
          <span class="stack gap-0.5 min-w-0">
            <b class="font-medium">{{ recentMenu.item.kind === 'note' ? '复制双链' : '复制画布名称' }}</b>
            <small class="text-[11px] truncate text-fg-3">{{ recentMenu.item.kind === 'note' ? `[[${recentMenu.item.title}]]` : '复制为纯文本' }}</small>
          </span>
          <AppIcon name="link" :size="13" class="shrink-0" />
        </button>
      </section>
    </Teleport>
  </div>
</template>
