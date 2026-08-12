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
  <div class="create-space page-enter mx-auto w-full max-w-320 px-8 py-6" @click="closeCreateMenus()">
    <section class="create-space__hero">
    <PageHeader
      title="创作空间"
      subtitle="从一段文字、一张图或一段代码开始,七类工作流直接进入"
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
      <aside class="create-space__recent" aria-label="最近创作">
        <header><div><span>最近工作</span><b>最近创作</b></div><small>{{ noteCount }} 篇笔记 · {{ visualProjects.length }} 个近期画布</small></header>
        <div v-if="recentWork.length" class="create-space__recent-list" :aria-busy="recentProjectsPending">
          <RouterLink v-for="item in recentWork" :key="item.id" v-memo="[item.id, item.title, item.subtitle, item.activityAt, recentMenu?.item.id === item.id]" :to="item.to" aria-haspopup="menu" :aria-expanded="recentMenu?.item.id === item.id" :title="`继续“${item.title}”；右键或 Shift+F10 查看更多操作`" @contextmenu="openRecentMenu($event,item)" @keydown="openRecentMenuFromKeyboard($event,item)">
            <span><b>{{ item.title }}</b><small>{{ item.subtitle }}</small></span><time><span>{{ item.activityLabel }}</span>{{ formatDate(item.activityAt) }}</time>
          </RouterLink>
        </div>
        <div v-else class="create-space__recent-empty" :aria-busy="recentProjectsPending"><AppIcon :name="recentProjectsPending ? 'clock' : 'book'" :size="20" /><span><b>{{ recentProjectsPending ? '正在读取最近创作' : '还没有创作记录' }}</b><small>{{ recentProjectsPending ? '只加载笔记与画布摘要。' : '第一篇内容会成为今后的知识入口。' }}</small></span></div>
      </aside>
    </section>

    <nav class="create-quick-starts" aria-label="常用创作动作">
      <RouterLink v-for="item in createQuickStarts" :key="item.id" v-memo="[item.id]" :to="item.to">
        <span><AppIcon :name="item.icon" :size="17" /></span>
        <div><b>{{ item.label }}</b><small>{{ item.detail }}</small></div>
        <AppIcon name="arrow-right" :size="14" />
      </RouterLink>
    </nav>

    <section class="create-space__section-heading">
      <div><p class="eyebrow">工作流</p><h3>七类工作流，具体能力不再隐藏</h3></div>
      <p>上方高频动作可直接进入；下方工作流左键打开默认任务，右键或 Shift + F10 查看完整开始方式。</p>
    </section>

    <section class="create-workflows" aria-label="创作工作流">
      <RouterLink
        v-for="workflow in workflows"
        :key="workflow.id"
        v-memo="[workflow.id, menu?.workflow.id === workflow.id]"
        :to="workflow.to"
        class="create-workflow"
        :class="{ 'create-workflow--featured': workflow.featured }"
        :aria-label="`${workflow.title}；右键可选择其他开始方式`"
        aria-haspopup="menu"
        :aria-expanded="menu?.workflow.id === workflow.id"
        @contextmenu="openMenu($event, workflow)"
        @keydown="openMenuFromKeyboard($event, workflow)"
      >
        <header><span><AppIcon :name="workflow.icon" :size="18" /></span><p>{{ workflow.overline }}</p><small>{{ workflow.status }}</small></header>
        <div><h3>{{ workflow.title }}</h3><p>{{ workflow.description }}</p></div>
        <footer><span>进入工作流</span><AppIcon name="arrow-right" :size="16" /></footer>
      </RouterLink>
    </section>

    <section v-if="menu" ref="menuElement" class="create-workflow-menu" role="menu" :aria-label="`${menu.workflow.title}快捷操作`" :style="{ left: `${menu.x}px`, top: `${menu.y}px` }" @click.stop @contextmenu.prevent @keydown.stop="handleMenuKeydown">
      <header><span>{{ menu.workflow.overline }}</span><b>{{ menu.workflow.title }}</b></header>
      <button v-for="action in menu.workflow.actions" :key="action.to + action.label" role="menuitem" @click="runAction(action)"><span><b>{{ action.label }}</b><small>{{ action.detail }}</small></span><AppIcon name="arrow-right" :size="14" /></button>
    </section>
    <section v-if="recentMenu" ref="recentMenuElement" class="create-workflow-menu create-recent-menu" role="menu" :aria-label="`${recentMenu.item.title}创作操作`" :style="{ left: `${recentMenu.x}px`, top: `${recentMenu.y}px` }" @click.stop @contextmenu.prevent @keydown.stop="handleRecentMenuKeydown">
      <header><span>{{ recentMenu.item.kind === 'note' ? 'MARKDOWN' : 'VISUAL PROJECT' }}</span><b>{{ recentMenu.item.title }}</b></header>
      <button role="menuitem" @click="runRecentAction('open')"><span><b>继续打开</b><small>{{ recentMenu.item.activityLabel }} · {{ formatDate(recentMenu.item.activityAt) }}</small></span><AppIcon name="arrow-right" :size="14" /></button>
      <template v-if="recentMenu.item.kind === 'note'">
        <button role="menuitem" @click="runRecentAction('edit')"><span><b>源码编辑</b><small>回到 CodeMirror 编辑模式</small></span><AppIcon name="rename" :size="14" /></button>
        <button role="menuitem" @click="runRecentAction('read')"><span><b>阅读预览</b><small>只显示排版后的 Markdown</small></span><AppIcon name="book" :size="14" /></button>
        <button role="menuitem" @click="runRecentAction('mindmap')"><span><b>查看思维图谱</b><small>按标题层级生成可交互图谱</small></span><AppIcon name="sort" :size="14" /></button>
      </template>
      <button role="menuitem" @click="runRecentAction('favorite')"><span><b>{{ store.isContentFavorite(recentMenu.item.kind === 'note' ? 'note' : 'diagram',recentMenu.item.itemId) ? '取消收藏' : '加入收藏' }}</b><small>同步到今天、知识库与 Ctrl K</small></span><AppIcon name="star" :size="14" /></button>
      <button role="menuitem" @click="runRecentAction('copy-title')"><span><b>{{ recentMenu.item.kind === 'note' ? '复制双链' : '复制画布名称' }}</b><small>{{ recentMenu.item.kind === 'note' ? `[[${recentMenu.item.title}]]` : '复制为纯文本' }}</small></span><AppIcon name="link" :size="14" /></button>
    </section>
  </div>
</template>

<style scoped>
.create-space{max-width:1450px;margin:0 auto;padding:27px 30px 54px;color:var(--text)}
.create-space__hero{grid-template-columns:minmax(0,1.35fr) minmax(330px,.65fr);overflow:hidden;box-shadow:0 22px 54px var(--accent-soft)}
.create-space__intro{position:relative;display:flex;align-items:flex-start;flex-direction:column;justify-content:center;padding:37px 42px;color:var(--fg);background-image:radial-gradient(var(--surface-2) 1px,transparent 1px);background-size:25px 25px}
.create-space__intro:after{position:absolute;content:'';right:-80px;bottom:-155px;width:310px;height:310px;border:1px solid var(--surface-2);border-radius:50%;box-shadow:0 0 0 34px var(--surface-2),0 0 0 68px var(--surface-2);pointer-events:none}
.create-space__intro>.eyebrow{color:var(--accent)}
.create-space__intro h2{position:relative;z-index:1;max-width:710px;margin:11px 0 12px;color:var(--fg);font:720 clamp(31px,3.6vw,48px)/1.08 var(--font-display);letter-spacing:-.045em}
.create-space__intro h2 em{color:var(--accent);font-style:normal}
.create-space__intro>p:not(.eyebrow){position:relative;z-index:1;max-width:680px;margin:0;color:var(--fg);font-size:13px;line-height:1.75}
.create-space__actions{position:relative;z-index:1;display:flex;gap:9px;margin-top:21px}.create-space__actions a{display:inline-flex;align-items:center;gap:7px;min-height:38px;padding:0 14px}.create-space__actions .primary-button{color:var(--accent);background:var(--surface)}.create-space__actions .quiet-button{border-color:var(--fg);color:var(--fg);background:var(--surface-2)}.create-space__actions .quiet-button:hover{background:var(--surface-2)}
.create-space__recent{display:grid;grid-template-rows:auto minmax(0,1fr);padding:23px;background:var(--line-strong);border-left:1px solid var(--surface-2);backdrop-filter:blur(5px)}
.create-space__recent>header{display:flex;align-items:flex-start;justify-content:space-between;gap:10px;padding-bottom:13px;border-bottom:1px solid var(--surface-2)}.create-space__recent>header div{display:grid;gap:3px}.create-space__recent>header span{color:var(--accent);font:700 9px var(--font-mono);letter-spacing:.11em}.create-space__recent>header b{color:var(--fg);font:680 14px var(--font-ui)}.create-space__recent>header small{color:var(--fg);font:9px var(--font-mono)}
.create-space__recent-list{display:grid;align-content:start}.create-space__recent-list>a{display:flex;min-width:0;align-items:center;justify-content:space-between;gap:13px;padding:11px 2px;border-bottom:1px solid var(--surface-2);color:var(--fg)}.create-space__recent-list>a:hover,.create-space__recent-list>a:focus-visible{padding-left:7px;color:var(--accent);background:var(--surface-2)}.create-space__recent-list span{display:grid;min-width:0;gap:3px}.create-space__recent-list b,.create-space__recent-list small{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.create-space__recent-list b{font:650 11px var(--font-ui)}.create-space__recent-list small{color:var(--fg);font-size:9.5px}.create-space__recent-list time{display:grid;flex:0 0 auto;justify-items:end;gap:3px;color:var(--fg);font:9px var(--font-mono)}.create-space__recent-list time span{color:var(--accent);font:700 9px var(--font-ui)}
.create-space__recent-empty{display:flex;align-items:center;justify-content:center;gap:11px;color:var(--accent)}.create-space__recent-empty span{display:grid;gap:3px}.create-space__recent-empty b{color:var(--fg);font-size:11px}.create-space__recent-empty small{color:var(--fg);font-size:9px}
.create-quick-starts{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:1px;margin-top:14px;overflow:hidden;border:1px solid var(--line);border-radius:15px;background:var(--line);box-shadow:0 9px 24px var(--accent-soft)}
.create-quick-starts>a{display:grid;grid-template-columns:32px minmax(0,1fr) auto;align-items:center;gap:9px;min-height:62px;padding:10px 12px;color:var(--text);background:var(--surface);outline:0;transition:color .16s ease,background .16s ease}
.create-quick-starts>a:hover,.create-quick-starts>a:focus-visible{color:var(--green-strong);background:var(--green-bg)}.create-quick-starts>a:focus-visible{box-shadow:inset 0 0 0 2px color-mix(in srgb,var(--green) 48%,transparent)}
.create-quick-starts>a>span{display:grid;width:31px;height:31px;place-items:center;border:1px solid var(--accent-soft);border-radius:9px;color:var(--green-strong);background:var(--surface)}.create-quick-starts>a>div{display:grid;min-width:0;gap:3px}.create-quick-starts b,.create-quick-starts small{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.create-quick-starts b{font:680 10px var(--font-ui)}.create-quick-starts small{color:var(--muted);font-size:9px}.create-quick-starts>a>svg{color:var(--muted)}
.create-space__section-heading{display:flex;align-items:flex-end;justify-content:space-between;gap:28px;padding:28px 2px 15px}.create-space__section-heading h3{margin-top:5px;font:700 21px var(--font-display);letter-spacing:-.025em}.create-space__section-heading>p{max-width:460px;color:var(--muted);font-size:10px;line-height:1.55;text-align:right}
.create-workflows{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}.create-workflow{display:grid;grid-template-rows:auto minmax(0,1fr) auto;min-height:210px;padding:18px;border:1px solid var(--line);border-radius:16px;color:var(--text);background:linear-gradient(145deg,var(--surface),var(--surface-2));box-shadow:0 9px 24px var(--accent-soft);cursor:context-menu;outline:0;transition:border-color .16s ease,box-shadow .16s ease,background .16s ease}.create-workflow:hover{border-color:var(--accent);background:var(--surface);box-shadow:0 15px 34px var(--accent-soft)}.create-workflow:focus-visible{border-color:var(--green);box-shadow:0 0 0 3px color-mix(in srgb,var(--green) 16%,transparent)}.create-workflow>header{display:grid;grid-template-columns:34px auto 1fr;align-items:center;gap:9px}.create-workflow>header>span{display:grid;width:34px;height:34px;place-items:center;border:1px solid var(--accent-soft);border-radius:10px;color:var(--green-strong);background:var(--green-bg)}.create-workflow>header p{color:var(--green-strong);font:740 9px var(--font-mono);letter-spacing:.1em}.create-workflow>header small{justify-self:end;color:var(--muted);font:9px var(--font-mono);text-align:right}.create-workflow>div{align-self:center;padding:18px 0 15px}.create-workflow h3{margin:0 0 7px;font:700 18px var(--font-display);letter-spacing:-.025em}.create-workflow>div p{margin:0;color:var(--muted);font-size:11px;line-height:1.65}.create-workflow>footer{display:flex;align-items:center;justify-content:space-between;padding-top:12px;border-top:1px solid var(--line-weak);color:var(--green-strong);font:700 10px var(--font-ui)}
.create-workflow--featured{grid-column:span 2;background:linear-gradient(135deg,var(--accent-soft),var(--surface) 48%,var(--surface-2));border-color:var(--accent-soft)}.create-workflow--featured h3{font-size:22px}.create-workflow--featured>div p{max-width:680px;font-size:12px}
.create-workflow-menu{position:fixed;z-index:145;width:262px;overflow:hidden;border:1px solid var(--accent-soft);border-radius:13px;background:var(--surface);box-shadow:var(--shadow-lg);animation:create-menu-in .14s ease-out both}.create-workflow-menu>header{display:grid;gap:3px;padding:11px 13px 9px;border-bottom:1px solid var(--line-weak);background:linear-gradient(125deg,var(--accent-soft),var(--surface-2) 72%)}.create-workflow-menu>header span{color:var(--green-strong);font:700 9px var(--font-mono);letter-spacing:.11em}.create-workflow-menu>header b{font:700 13px var(--font-ui)}.create-workflow-menu button{display:grid;width:100%;min-height:55px;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:10px;padding:8px 13px;border:0;border-bottom:1px solid var(--line-weak);color:var(--text-secondary);background:transparent;text-align:left}.create-workflow-menu button:last-child{border-bottom:0}.create-workflow-menu button:hover,.create-workflow-menu button:focus-visible{color:var(--green-strong);background:var(--green-bg)}.create-workflow-menu button:focus-visible{outline:2px solid color-mix(in srgb,var(--green) 48%,transparent);outline-offset:-2px}.create-workflow-menu button span{display:grid;min-width:0;gap:3px}.create-workflow-menu button b,.create-workflow-menu button small{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.create-workflow-menu button b{color:inherit;font:650 11px var(--font-ui)}.create-workflow-menu button small{color:var(--muted);font-size:9px}@keyframes create-menu-in{from{opacity:0;transform:translateY(-4px) scale(.985)}to{opacity:1;transform:none}}
/* Keep compact metadata readable on a desktop display without changing the
   quiet paper-and-green visual language or adding decorative animation. */
.create-space__intro>p:not(.eyebrow){color:var(--fg)}
.create-space__recent>header span{font-size:10px}.create-space__recent>header small{font-size:10px}.create-space__recent-list b{font-size:12px}.create-space__recent-list small,.create-space__recent-list time,.create-space__recent-list time span{font-size:10px}.create-space__recent-empty b{font-size:12px}.create-space__recent-empty small{font-size:10px}
.create-quick-starts>a{min-height:68px}.create-quick-starts b{font-size:12px}.create-quick-starts small{display:-webkit-box;overflow:hidden;font-size:10px;line-height:1.35;white-space:normal;-webkit-box-orient:vertical;-webkit-line-clamp:2}
.create-space__section-heading>p{font-size:11px}.create-workflow{cursor:pointer}.create-workflow>header p,.create-workflow>header small{font-size:10px}.create-workflow>div p{font-size:12px}.create-workflow>footer{font-size:11px}
.create-workflow-menu>header span{font-size:10px}.create-workflow-menu button b{font-size:12px}.create-workflow-menu button small{font-size:10px}
@media(min-width:1101px){.create-workflow:last-child{grid-column:span 2}}
@media(max-width:1100px){.create-space__hero{}.create-workflows{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media(max-width:820px){.create-space{padding:22px 18px 46px}.create-space__hero{}.create-space__recent{border-top:1px solid var(--surface-2);border-left:0}.create-space__recent-list{grid-template-columns:repeat(2,minmax(0,1fr));column-gap:18px}.create-quick-starts{grid-template-columns:repeat(2,minmax(0,1fr))}.create-space__section-heading{align-items:flex-start;flex-direction:column;gap:8px}.create-space__section-heading>p{text-align:left}.create-workflow--featured{grid-column:auto}}
</style>
