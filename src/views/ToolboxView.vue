<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import AppIcon from '@/components/AppIcon.vue'
import { clampMenuPosition, isContextMenuShortcut, nextMenuItemIndex } from '@/lib/desktop-menu'
import { findCategory } from '@/lib/toolbox-nav'
import { buildToolboxBoard, currentLayout, moveBefore, moveByStep, toggleKey, type ToolboxBlock } from '@/lib/toolbox-board'
import { searchTools, toolCatalog, toolCatalogOwnerLocation, type ToolCatalogItem } from '@/lib/tool-catalog'
import { useUiStore } from '@/stores/ui'
import { useWorkbenchStore } from '@/stores/workbench'

/**
 * The toolbox home.
 *
 * It used to be one flat grid: nine category sections, sixty-four equal cards,
 * a page three windows tall whose last two sections held one tool each. The
 * problem was altitude, not taxonomy — forty of those cards were operations of
 * four pages (`/tools?group=pdf`, `/developer-tools`, `/visual`, `/media`)
 * rendered as siblings of the pages themselves.
 *
 * So the board shows *workbenches*: about fifteen blocks, each one destination
 * and the operations it accepts, collapsed until asked. `toolbox-board.ts`
 * derives them from the catalogue, and everything the user rearranges — block
 * order, tool order inside a block, what is expanded, what is hidden — is a
 * preference layered over that derivation, never a replacement for it.
 *
 * `/c/:category` reuses the same board, narrowed to the blocks that hold that
 * category's tools and opened, so moving between "everything" and "PDF" is a
 * change of contents rather than a change of layout.
 */
const route = useRoute()
const router = useRouter()
const store = useWorkbenchStore()
const ui = useUiStore()
const query = ref('')

type MenuTarget =
  | { kind: 'tool'; tool: ToolCatalogItem; block?: ToolboxBlock }
  | { kind: 'block'; block: ToolboxBlock }
  | { kind: 'favorite'; tool: ToolCatalogItem }

const menu = ref<{ target: MenuTarget; x: number; y: number }>()
const menuElement = ref<HTMLElement>()
let menuTrigger: HTMLElement | undefined

/** What is being dragged, and what it is currently hovering. One pair for all
 *  three lists — nothing can be dragged from one list into another, because
 *  each drop handler only looks up ids inside its own. */
const dragId = ref('')
const dropId = ref('')

const activeCategory = computed(() =>
  typeof route.params.category === 'string' ? findCategory(route.params.category) : undefined,
)

const layout = computed(() => currentLayout(store.settings.toolboxBoard))
const board = computed(() => buildToolboxBoard(store.settings.toolboxBoard))

const searchTerm = computed(() => query.value.trim())

/** Search results are a flat list. Keeping the blocks while filtering left a
 *  column of one-row headers whose titles were not what was searched for. */
const searchResults = computed<ToolCatalogItem[]>(() => {
  if (!searchTerm.value) return []
  const found = searchTools(searchTerm.value, toolCatalog.length)
  const category = activeCategory.value
  return category ? found.filter((tool) => category.tools.some((item) => item.id === tool.id)) : found
})

/**
 * The board as rendered: hidden blocks removed, and — on a category route —
 * narrowed to that category's tools and forced open, since a category page
 * that opens collapsed shows nothing but the thing you already clicked.
 */
const visibleBlocks = computed<ToolboxBlock[]>(() => {
  const category = activeCategory.value
  if (!category) return board.value.filter((block) => !block.hidden)
  const ids = new Set(category.tools.map((tool) => tool.id))
  return board.value.flatMap((block) => {
    const tools = block.tools.filter((tool) => ids.has(tool.id))
    return tools.length ? [{ ...block, tools, single: tools.length === 1, hidden: false, expanded: true }] : []
  })
})

const hiddenBlocks = computed(() => (activeCategory.value ? [] : board.value.filter((block) => block.hidden)))
const blockOrderIds = computed(() => board.value.map((block) => block.key))

const favoriteIds = computed(() => new Set(store.favorites.map((favorite) => favorite.toolId)))
const catalogById = computed(() => new Map(toolCatalog.map((tool) => [tool.id, tool])))

/** Favourites in the order the user pinned them; `order` is what drives the
 *  Ctrl+Alt+1…9 shortcuts in App.vue, so the strip and the shortcuts agree. */
const favoriteTools = computed(() =>
  [...store.favorites]
    .sort((left, right) => left.order - right.order)
    .flatMap((favorite) => {
      const tool = catalogById.value.get(favorite.toolId)
      return tool ? [{ tool, shortcut: favorite.shortcut }] : []
    }),
)
const favoriteOrderIds = computed(() => favoriteTools.value.map((item) => item.tool.id))

/** Most recently opened first, and never something already pinned above. */
const recentTools = computed<ToolCatalogItem[]>(() => {
  const out: ToolCatalogItem[] = []
  const seen = new Set(favoriteOrderIds.value)
  for (const usage of store.toolUsages) {
    if (seen.has(usage.toolId)) continue
    const tool = catalogById.value.get(usage.toolId)
    if (!tool) continue
    seen.add(usage.toolId)
    out.push(tool)
    if (out.length === 6) break
  }
  return out
})

/** The personal strips only make sense on the unfiltered home view. */
const showPersonalRows = computed(() => !activeCategory.value && !searchTerm.value)
const arranged = computed(() =>
  Boolean(layout.value.blockOrder.length || layout.value.hiddenBlocks.length || layout.value.expandedBlocks.length || Object.keys(layout.value.toolOrder).length),
)

/* ── Layout writes ──────────────────────────────────────────────────────── */

function saveLayout(patch: Partial<ReturnType<typeof currentLayout>>) {
  store.updateSettings({ toolboxBoard: { ...layout.value, ...patch } })
}

function reorderBlocks(ids: string[], movedKey: string) {
  saveLayout({ blockOrder: ids })
  const position = ids.indexOf(movedKey) + 1
  ui.toast('工具箱顺序已保存', `“${board.value.find((block) => block.key === movedKey)?.label ?? '工作台'}”移动到第 ${position} 位。`, 'success')
}

function reorderTools(block: ToolboxBlock, ids: string[]) {
  saveLayout({ toolOrder: { ...layout.value.toolOrder, [block.key]: ids } })
}

function toggleExpanded(block: ToolboxBlock) {
  if (block.single) { void router.push(block.tools[0].to); return }
  saveLayout({ expandedBlocks: toggleKey(layout.value.expandedBlocks, block.key) })
}

function setBlockHidden(block: ToolboxBlock, hidden: boolean) {
  const next = hidden
    ? [...new Set([...layout.value.hiddenBlocks, block.key])]
    : layout.value.hiddenBlocks.filter((key) => key !== block.key)
  saveLayout({ hiddenBlocks: next })
  ui.toast(hidden ? '已从工具箱隐藏' : '已恢复显示', hidden ? `${block.label} 仍可通过搜索和 Ctrl+K 找到。` : block.label, 'success', hidden ? '撤销' : undefined, hidden ? () => setBlockHidden(block, false) : undefined)
}

function resetLayout() {
  store.updateSettings({ toolboxBoard: undefined })
  ui.toast('已恢复默认排版', '顺序、折叠和隐藏都已清除。', 'success')
}

/* ── Dragging ───────────────────────────────────────────────────────────── */

function startDrag(event: DragEvent, id: string) {
  dragId.value = id
  if (!event.dataTransfer) return
  event.dataTransfer.effectAllowed = 'move'
  event.dataTransfer.setData('text/plain', id)
}

function endDrag() { dragId.value = ''; dropId.value = '' }

function dropOnBlock(targetKey: string) {
  const source = dragId.value
  endDrag()
  if (!source || source === targetKey || !blockOrderIds.value.includes(source)) return
  reorderBlocks(moveBefore(blockOrderIds.value, source, targetKey), source)
}

function dropOnTool(block: ToolboxBlock, targetId: string) {
  const source = dragId.value
  endDrag()
  const ids = block.tools.map((tool) => tool.id)
  if (!source || source === targetId || !ids.includes(source)) return
  reorderTools(block, moveBefore(ids, source, targetId))
}

function dropOnFavorite(targetId: string) {
  const source = dragId.value
  endDrag()
  const ids = favoriteOrderIds.value
  if (!source || source === targetId || !ids.includes(source)) return
  store.reorderFavorites(moveBefore(ids, source, targetId))
  ui.toast('常用工具顺序已调整', '新的 Ctrl+Alt 快捷键顺序已经保存。', 'success')
}

/** Alt + ←/→ is the keyboard equivalent of every drag on this page. Without it
 *  the whole arrangement would be pointer-only. */
function moveBlockByKey(event: KeyboardEvent, block: ToolboxBlock) {
  if (!event.altKey || (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')) return false
  event.preventDefault()
  reorderBlocks(moveByStep(blockOrderIds.value, block.key, event.key === 'ArrowLeft' ? -1 : 1), block.key)
  return true
}

function moveToolByKey(event: KeyboardEvent, block: ToolboxBlock, tool: ToolCatalogItem) {
  if (!event.altKey || (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')) return false
  event.preventDefault()
  reorderTools(block, moveByStep(block.tools.map((item) => item.id), tool.id, event.key === 'ArrowLeft' ? -1 : 1))
  return true
}

function moveFavoriteByKey(event: KeyboardEvent, tool: ToolCatalogItem) {
  if (!event.altKey || (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')) return false
  event.preventDefault()
  store.reorderFavorites(moveByStep(favoriteOrderIds.value, tool.id, event.key === 'ArrowLeft' ? -1 : 1))
  return true
}

/* ── Context menus ──────────────────────────────────────────────────────── */

/** Tall enough for the longest menu (a tool inside a block); `clampMenuPosition`
 *  only needs an upper bound to keep the panel inside the viewport. */
const MENU_HEIGHT = 300

function showMenu(target: MenuTarget, x: number, y: number, trigger: HTMLElement) {
  window.dispatchEvent(new CustomEvent('knitspace:close-context-menus'))
  menuTrigger = trigger
  menu.value = { target, ...clampMenuPosition(x, y, { menuWidth: 252, menuHeight: MENU_HEIGHT, margin: 12 }) }
  void nextTick(() => menuElement.value?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus({ preventScroll: true }))
}

function closeMenu(restoreFocus = false) {
  menu.value = undefined
  if (restoreFocus) void nextTick(() => menuTrigger?.focus({ preventScroll: true }))
}
function closeMenuFromGlobal() { closeMenu() }

function openMenu(event: MouseEvent, target: MenuTarget) {
  event.preventDefault()
  event.stopPropagation()
  showMenu(target, event.clientX, event.clientY, event.currentTarget as HTMLElement)
}

function openMenuFromKeyboard(event: KeyboardEvent, target: MenuTarget) {
  if (!isContextMenuShortcut(event)) return false
  event.preventDefault()
  event.stopPropagation()
  const trigger = event.currentTarget as HTMLElement
  const bounds = trigger.getBoundingClientRect()
  showMenu(target, bounds.right - 18, bounds.top + 12, trigger)
  return true
}

function handleMenuKeydown(event: KeyboardEvent) {
  const items = [...(menuElement.value?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [])]
  if (event.key === 'Escape') { event.preventDefault(); closeMenu(true); return }
  const index = nextMenuItemIndex(event.key, items.indexOf(document.activeElement as HTMLButtonElement), items.length)
  if (index === undefined) return
  event.preventDefault()
  items[index]?.focus({ preventScroll: true })
}

/* Combined so the block header, its ⋯ button, a tool row and a favourite chip
   all reach the same handlers rather than growing four near-identical ones. */
function blockKeydown(event: KeyboardEvent, block: ToolboxBlock) {
  if (openMenuFromKeyboard(event, { kind: 'block', block })) return
  moveBlockByKey(event, block)
}

function toolKeydown(event: KeyboardEvent, block: ToolboxBlock, tool: ToolCatalogItem) {
  if (openMenuFromKeyboard(event, { kind: 'tool', tool, block })) return
  moveToolByKey(event, block, tool)
}

function favoriteKeydown(event: KeyboardEvent, tool: ToolCatalogItem) {
  if (openMenuFromKeyboard(event, { kind: 'favorite', tool })) return
  moveFavoriteByKey(event, tool)
}

async function copyDescription(tool: ToolCatalogItem) {
  const description = `${tool.title} — ${tool.description}`
  try {
    await navigator.clipboard.writeText(description)
    ui.toast('已复制工具说明', description, 'success')
  } catch (error) {
    ui.toast('复制失败', error instanceof Error ? error.message : '系统剪贴板暂时不可用。', 'error')
  }
}

function toggleFavorite(tool: ToolCatalogItem) {
  const wasFavorite = favoriteIds.value.has(tool.id)
  store.toggleFavorite(tool.id)
  ui.toast(wasFavorite ? '已取消收藏' : '已加入常用工具', tool.title, 'success')
}

type MenuAction =
  | 'open' | 'favorite' | 'copy' | 'owner'
  | 'expand' | 'hide' | 'show' | 'block-top' | 'block-up' | 'block-down' | 'category'
  | 'tool-top' | 'tool-up' | 'tool-down'

async function runMenuAction(action: MenuAction) {
  const target = menu.value?.target
  if (!target) return
  closeMenu()
  const tool = target.kind === 'block' ? undefined : target.tool
  const block = target.kind === 'tool' ? target.block : target.kind === 'block' ? target.block : undefined

  if (action === 'open') { await router.push(tool ? tool.to : block!.tools[0].to); return }
  if (action === 'favorite' && tool) { toggleFavorite(tool); return }
  if (action === 'copy' && tool) { await copyDescription(tool); return }
  if (action === 'owner' && tool) { await router.push(toolCatalogOwnerLocation(tool)); return }
  if (!block) return

  if (action === 'expand') { toggleExpanded(block); return }
  if (action === 'hide') { setBlockHidden(block, true); return }
  if (action === 'show') { setBlockHidden(block, false); return }
  if (action === 'category') { await router.push(`/c/${block.accent}`); return }
  if (action === 'block-top') {
    const ids = [block.key, ...blockOrderIds.value.filter((key) => key !== block.key)]
    reorderBlocks(ids, block.key)
    return
  }
  if (action === 'block-up' || action === 'block-down') {
    reorderBlocks(moveByStep(blockOrderIds.value, block.key, action === 'block-up' ? -1 : 1), block.key)
    return
  }
  if (!tool) return
  const ids = block.tools.map((item) => item.id)
  if (action === 'tool-top') reorderTools(block, [tool.id, ...ids.filter((id) => id !== tool.id)])
  if (action === 'tool-up' || action === 'tool-down') reorderTools(block, moveByStep(ids, tool.id, action === 'tool-up' ? -1 : 1))
}

onMounted(() => window.addEventListener('knitspace:close-context-menus', closeMenuFromGlobal))
onBeforeUnmount(() => window.removeEventListener('knitspace:close-context-menus', closeMenuFromGlobal))
</script>

<template>
  <div class="page-shell px-8 py-7" @click="closeMenu()">
    <header class="row-between gap-4 flex-wrap mb-5">
      <div class="stack gap-1 min-w-0">
        <h1 class="text-[26px] font-semibold tracking-tight font-display">
          {{ activeCategory ? activeCategory.label : '工具箱' }}
        </h1>
        <p class="text-[13px] text-fg-2">
          {{ activeCategory ? activeCategory.summary : '选一个工具开始。文件不离开这台机器。' }}
        </p>
      </div>
      <div class="row gap-2 shrink-0">
        <button v-if="arranged && !activeCategory" type="button" class="btn-ghost" @click="resetLayout">恢复默认排版</button>
        <RouterLink class="btn-default" to="/history">处理历史</RouterLink>
        <RouterLink class="btn-primary" to="/quick"><AppIcon name="inbox" :size="15" />万能处理入口</RouterLink>
      </div>
    </header>

    <div class="relative mb-6">
      <AppIcon name="search" :size="16" class="absolute left-3 top-1/2 -translate-y-1/2 text-fg-3 pointer-events-none" />
      <input
        v-model="query"
        type="search"
        class="field w-full h-11 pl-10 pr-3 text-[14px]"
        :placeholder="activeCategory ? `在 ${activeCategory.label} 中搜索…` : `搜索 ${toolCatalog.length} 个工具的名称、用途或格式…`"
        aria-label="搜索工具"
      >
    </div>

    <!-- ── Search: one flat list ─────────────────────────────────────────── -->
    <section v-if="searchTerm" class="mb-8">
      <h2 class="eyebrow mb-2.5">{{ searchResults.length }} 个结果</h2>
      <div v-if="searchResults.length" class="grid gap-2 grid-cols-[repeat(auto-fill,minmax(17rem,1fr))]">
        <RouterLink
          v-for="tool in searchResults"
          :key="tool.id"
          :to="tool.to"
          class="stack gap-1 p-3 rounded-md panel transition-colors duration-120 hover:border-line-strong hover:bg-surface-2"
          @contextmenu="openMenu($event, { kind: 'tool', tool })"
        >
          <span class="row gap-2 min-w-0">
            <AppIcon :name="tool.icon" :size="15" class="shrink-0 text-fg-3" />
            <b class="text-[13px] font-medium truncate">{{ tool.title }}</b>
            <i class="ml-auto shrink-0 text-[11px] not-italic text-fg-3">{{ tool.group }}</i>
          </span>
          <span class="text-[12px] text-fg-3 leading-snug line-clamp-2">{{ tool.description }}</span>
        </RouterLink>
      </div>
      <p v-else class="py-16 text-center text-[13px] text-fg-3">没有匹配“{{ searchTerm }}”的工具。</p>
    </section>

    <template v-else>
      <!-- ── Pinned ──────────────────────────────────────────────────────── -->
      <section v-if="showPersonalRows && favoriteTools.length" class="mb-6">
        <div class="row-between gap-3 mb-2.5">
          <h2 class="eyebrow">常用</h2>
          <span class="text-[11px] text-fg-3">拖拽或 Alt + ←/→ 调整顺序，决定 Ctrl+Alt 快捷键</span>
        </div>
        <div class="flex flex-wrap gap-2">
          <RouterLink
            v-for="item in favoriteTools"
            :key="item.tool.id"
            :to="item.tool.to"
            draggable="true"
            aria-haspopup="menu"
            class="row gap-2 h-9 pl-3 pr-2.5 rounded-sm bg-surface-2 border text-[13px] cursor-grab active:cursor-grabbing
                   transition-colors duration-120 hover:bg-surface-3"
            :class="[
              dragId === item.tool.id ? 'opacity-40' : '',
              dropId === item.tool.id && dragId !== item.tool.id ? 'border-accent' : 'border-line hover:border-line-strong',
            ]"
            :title="`${item.tool.title}；拖拽或 Alt + ←/→ 调整顺序，右键或 Shift+F10 查看更多操作`"
            @keydown="favoriteKeydown($event, item.tool)"
            @contextmenu="openMenu($event, { kind: 'favorite', tool: item.tool })"
            @dragstart="startDrag($event, item.tool.id)"
            @dragenter.prevent="dropId = item.tool.id"
            @dragover.prevent
            @drop.prevent="dropOnFavorite(item.tool.id)"
            @dragend="endDrag"
          >
            <AppIcon :name="item.tool.icon" :size="15" class="shrink-0 text-fg-3" />
            <span class="truncate">{{ item.tool.title }}</span>
            <kbd v-if="item.shortcut" class="kbd shrink-0">{{ item.shortcut }}</kbd>
          </RouterLink>
        </div>
      </section>

      <section v-if="showPersonalRows && recentTools.length" class="mb-6">
        <h2 class="eyebrow mb-2.5">最近使用</h2>
        <div class="flex flex-wrap gap-2">
          <RouterLink
            v-for="tool in recentTools"
            :key="tool.id"
            :to="tool.to"
            class="row gap-2 h-9 px-3 rounded-sm bg-surface-2 border border-line text-[13px]
                   transition-colors duration-120 hover:border-line-strong hover:bg-surface-3"
            @contextmenu="openMenu($event, { kind: 'tool', tool })"
          >
            <AppIcon :name="tool.icon" :size="15" class="text-fg-3" />
            {{ tool.title }}
          </RouterLink>
        </div>
      </section>

      <!-- ── The board ───────────────────────────────────────────────────── -->
      <!-- Two columns of workbenches. An expanded block spans both, because a
           twelve-row operation list in a half-width column pushes everything
           beside it a screen down. -->
      <div class="grid gap-3 items-start grid-cols-1 lg:grid-cols-2 mb-8">
        <section
          v-for="block in visibleBlocks"
          :key="block.key"
          :class="[`cat-${block.accent}`, 'panel stack overflow-hidden transition-colors duration-120', block.expanded && !block.single ? 'lg:col-span-2' : '', dropId === block.key && dragId !== block.key ? 'border-accent' : '', dragId === block.key ? 'opacity-40' : '']"
          @dragenter.prevent="dropId = block.key"
          @dragover.prevent
          @drop.prevent="dropOnBlock(block.key)"
        >
          <!-- The header is the drag handle, the expander and the menu target.
               It is a button rather than a link even for single-tool blocks:
               a draggable anchor starts a link drag in Chrome, which drops a
               URL into whatever is under the pointer. -->
          <header
            class="row gap-2.5 px-3 h-12 shrink-0 select-none cursor-grab active:cursor-grabbing"
            :class="block.expanded && !block.single ? 'border-b border-line' : ''"
            :draggable="!activeCategory"
            @dragstart="startDrag($event, block.key)"
            @dragend="endDrag"
          >
            <!-- Inline rather than an `AppIcon` name: the icon map lives in the
                 startup bundle, which is within a few hundred bytes of its
                 budget, and this handle is only ever drawn on this route. -->
            <svg
              v-if="!activeCategory"
              class="shrink-0 text-fg-3"
              width="14"
              height="14"
              viewBox="0 0 14 14"
              fill="currentColor"
              aria-hidden="true"
            >
              <circle cx="5" cy="3" r="1.1" /><circle cx="9" cy="3" r="1.1" />
              <circle cx="5" cy="7" r="1.1" /><circle cx="9" cy="7" r="1.1" />
              <circle cx="5" cy="11" r="1.1" /><circle cx="9" cy="11" r="1.1" />
            </svg>
            <span class="center w-7 h-7 rounded-sm shrink-0 text-cat" style="background: color-mix(in srgb, var(--cat) 14%, transparent)">
              <AppIcon :name="block.icon" :size="15" />
            </span>
            <button
              type="button"
              class="stack items-start gap-0 min-w-0 flex-1 text-left"
              aria-haspopup="menu"
              :aria-expanded="block.single ? undefined : block.expanded"
              :title="block.single ? `打开${block.label}` : `${block.expanded ? '收起' : '展开'} ${block.label} 的 ${block.tools.length} 个操作；右键或 Shift+F10 查看更多操作`"
              @click="toggleExpanded(block)"
              @keydown="blockKeydown($event, block)"
              @contextmenu="openMenu($event, { kind: 'block', block })"
            >
              <b class="text-[14px] font-semibold text-fg truncate max-w-full">{{ block.label }}</b>
              <small class="text-[11px] text-fg-3 truncate max-w-full">{{ block.summary }}</small>
            </button>
            <span v-if="!block.single" class="chip shrink-0 tabular-nums">{{ block.tools.length }}</span>
            <button
              type="button"
              class="btn-tool w-7 justify-center px-0 shrink-0"
              aria-haspopup="menu"
              :aria-label="`${block.label} 操作`"
              @click.stop="openMenu($event, { kind: 'block', block })"
            >
              <AppIcon name="more" :size="15" />
            </button>
            <AppIcon
              v-if="!block.single"
              name="chevron"
              :size="14"
              class="shrink-0 text-fg-3 transition-transform duration-120"
              :class="block.expanded ? 'rotate-90' : ''"
              aria-hidden="true"
            />
          </header>

          <!-- Collapsed: the operation names as a single wrapped line. It is the
               one thing the old grid did well — you could see what a category
               held — kept at a tenth of the height. -->
          <div v-if="!block.expanded && !block.single" class="row flex-wrap gap-1.5 px-3 pb-3">
            <RouterLink
              v-for="tool in block.tools.slice(0, 6)"
              :key="tool.id"
              :to="tool.to"
              class="chip hover:bg-surface-3 hover:text-fg transition-colors duration-120"
              :title="tool.description"
              @contextmenu="openMenu($event, { kind: 'tool', tool, block })"
            >{{ tool.title }}</RouterLink>
            <button
              v-if="block.tools.length > 6"
              type="button"
              class="chip text-fg-3 hover:text-fg transition-colors duration-120"
              @click.stop="toggleExpanded(block)"
            >还有 {{ block.tools.length - 6 }} 项</button>
          </div>

          <!-- Expanded: a compact row per operation, draggable within the block. -->
          <!-- An expanded block already spans both columns, so a single column
               of twelve short rows leaves half the width empty and costs twice
               the height. Two columns of rows, row-major, which is the order the
               drag and Alt + ←/→ already move things in. -->
          <div v-else-if="block.expanded && !block.single" class="grid grid-cols-1 xl:grid-cols-2 p-1.5">
            <RouterLink
              v-for="tool in block.tools"
              :key="tool.id"
              :to="tool.to"
              draggable="true"
              aria-haspopup="menu"
              class="row gap-2.5 min-h-9 px-2.5 py-1.5 rounded-sm border border-transparent cursor-grab active:cursor-grabbing
                     transition-colors duration-120 hover:bg-surface-2"
              :class="[dragId === tool.id ? 'opacity-40' : '', dropId === tool.id && dragId !== tool.id ? 'border-accent bg-surface-2' : '']"
              :title="`${tool.title}；拖拽或 Alt + ←/→ 调整顺序，右键或 Shift+F10 查看更多操作`"
              @keydown="toolKeydown($event, block, tool)"
              @contextmenu="openMenu($event, { kind: 'tool', tool, block })"
              @dragstart.stop="startDrag($event, tool.id)"
              @dragenter.prevent.stop="dropId = tool.id"
              @dragover.prevent.stop
              @drop.prevent.stop="dropOnTool(block, tool.id)"
              @dragend.stop="endDrag"
            >
              <AppIcon :name="tool.icon" :size="15" class="shrink-0 text-cat" />
              <span class="text-[13px] font-medium shrink-0">{{ tool.title }}</span>
              <span class="text-[12px] text-fg-3 truncate">{{ tool.description }}</span>
              <AppIcon
                v-if="favoriteIds.has(tool.id)"
                name="star"
                :size="13"
                class="ml-auto shrink-0 text-warn"
                aria-label="已加入常用"
              />
            </RouterLink>
          </div>
        </section>
      </div>

      <!-- ── Hidden blocks ───────────────────────────────────────────────── -->
      <section v-if="hiddenBlocks.length" class="stack gap-2.5 mb-8">
        <h2 class="eyebrow">已隐藏 {{ hiddenBlocks.length }} 个</h2>
        <div class="flex flex-wrap gap-2">
          <button
            v-for="block in hiddenBlocks"
            :key="block.key"
            type="button"
            class="row gap-2 h-8 px-2.5 rounded-sm bg-surface-2 border border-line text-[12px] text-fg-3
                   transition-colors duration-120 hover:border-line-strong hover:text-fg"
            @click="setBlockHidden(block, false)"
          >
            <AppIcon :name="block.icon" :size="14" />
            {{ block.label }}
            <span class="text-fg-3">恢复</span>
          </button>
        </div>
      </section>

      <footer v-if="showPersonalRows" class="row gap-2 pt-2 text-[12px] text-fg-3">
        <AppIcon name="flask" :size="14" class="shrink-0" />
        <RouterLink to="/lab" class="tap hover:text-fg">本机能力与实验</RouterLink>
        <span>检查 Vault、FFmpeg、输出目录与本机转写引擎的真实边界。</span>
      </footer>
    </template>

    <Teleport to="body">
      <section
        v-if="menu"
        ref="menuElement"
        class="menu-panel w-64"
        role="menu"
        :aria-label="menu.target.kind === 'block' ? `${menu.target.block.label} 操作` : `${menu.target.tool.title} 操作`"
        :style="{ left: `${menu.x}px`, top: `${menu.y}px` }"
        @click.stop
        @contextmenu.prevent
        @keydown.stop="handleMenuKeydown"
      >
        <p class="menu-title stack items-start gap-0.5">
          <span>{{ menu.target.kind === 'block' ? '工作台' : menu.target.tool.group }}</span>
          <b class="text-[12px] font-medium text-fg">{{ menu.target.kind === 'block' ? menu.target.block.label : menu.target.tool.title }}</b>
        </p>

        <!-- A block: arrangement first, since opening it is one click away. -->
        <template v-if="menu.target.kind === 'block'">
          <button v-if="menu.target.block.single" class="menu-item" role="menuitem" @click="runMenuAction('open')">
            <span class="row gap-2"><AppIcon :name="menu.target.block.icon" :size="16" />打开工具</span>
          </button>
          <button v-else class="menu-item" role="menuitem" @click="runMenuAction('expand')">
            <span class="row gap-2"><AppIcon name="chevron" :size="16" />{{ menu.target.block.expanded ? '收起操作' : `展开 ${menu.target.block.tools.length} 个操作` }}</span>
          </button>
          <template v-if="!activeCategory">
            <div class="menu-sep" role="separator" />
            <button class="menu-item" role="menuitem" @click="runMenuAction('block-top')">
              <span class="row gap-2"><AppIcon name="sort" :size="16" />移到最前</span>
            </button>
            <button class="menu-item" role="menuitem" @click="runMenuAction('block-up')">
              <span class="row gap-2"><AppIcon name="chevron-left" :size="16" />上移一位</span><kbd class="kbd">Alt ←</kbd>
            </button>
            <button class="menu-item" role="menuitem" @click="runMenuAction('block-down')">
              <span class="row gap-2"><AppIcon name="chevron" :size="16" />下移一位</span><kbd class="kbd">Alt →</kbd>
            </button>
            <div class="menu-sep" role="separator" />
            <button class="menu-item" role="menuitem" @click="runMenuAction('category')">
              <span class="row gap-2"><AppIcon name="toolbox" :size="16" />只看这一类</span>
            </button>
            <button class="menu-item menu-item-danger" role="menuitem" @click="runMenuAction('hide')">
              <span class="row gap-2"><AppIcon name="close" :size="16" />从工具箱隐藏</span>
            </button>
          </template>
        </template>

        <!-- A tool. -->
        <template v-else>
          <button class="menu-item" role="menuitem" @click="runMenuAction('open')">
            <span class="row gap-2"><AppIcon :name="menu.target.tool.icon" :size="16" />打开工具</span>
          </button>
          <button class="menu-item" role="menuitem" @click="runMenuAction('favorite')">
            <span class="row gap-2"><AppIcon name="star" :size="16" />{{ favoriteIds.has(menu.target.tool.id) ? '取消收藏' : '加入常用' }}</span>
          </button>
          <template v-if="menu.target.kind === 'tool' && menu.target.block && !activeCategory">
            <div class="menu-sep" role="separator" />
            <button class="menu-item" role="menuitem" @click="runMenuAction('tool-top')">
              <span class="row gap-2"><AppIcon name="sort" :size="16" />在此工作台置顶</span>
            </button>
            <button class="menu-item" role="menuitem" @click="runMenuAction('tool-up')">
              <span class="row gap-2"><AppIcon name="chevron-left" :size="16" />上移一位</span><kbd class="kbd">Alt ←</kbd>
            </button>
            <button class="menu-item" role="menuitem" @click="runMenuAction('tool-down')">
              <span class="row gap-2"><AppIcon name="chevron" :size="16" />下移一位</span><kbd class="kbd">Alt →</kbd>
            </button>
          </template>
          <div class="menu-sep" role="separator" />
          <button class="menu-item" role="menuitem" @click="runMenuAction('copy')">
            <span class="row gap-2"><AppIcon name="clipboard" :size="16" />复制工具说明</span>
          </button>
          <button class="menu-item" role="menuitem" @click="runMenuAction('owner')">
            <span class="row gap-2"><AppIcon name="toolbox" :size="16" />在所属空间中查看</span>
          </button>
        </template>
      </section>
    </Teleport>
  </div>
</template>
