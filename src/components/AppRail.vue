<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { RouterLink, useRoute } from 'vue-router'
import AppIcon from '@/components/AppIcon.vue'
import { toolCategories } from '@/lib/toolbox-nav'
import { applyTheme, resolveTheme, themePreference, type ThemePreference } from '@/lib/theme'
import { activeWorkspaceChildTarget, activeWorkspaceSpace, workspaceNavGroups, type WorkspaceNavItem } from '@/lib/workspace-navigation'

const emit = defineEmits<{
  openCommand: [HTMLElement]
  openSpaceContext: [MouseEvent, WorkspaceNavItem]
  openSpaceContextKeyboard: [WorkspaceNavItem, HTMLElement]
}>()

const route = useRoute()
// Read from the shared preference so the rail and the settings picker
// never disagree about which theme is on.
const preference = themePreference

// What the window actually looks like right now — `preference` may be
// 'system', which is not something the label can render.
const resolved = computed(() => resolveTheme(preference.value))

const totalTools = computed(() => toolCategories.reduce((sum, category) => sum + category.tools.length, 0))
const spaces = workspaceNavGroups.flatMap((group) => group.items)
const expandedSpace = ref(activeSpace()?.to ?? '/today')
const railNav = ref<HTMLElement>()

/* The rail's own callers always want the open-space preference. It is a
   separate function because `expandedSpace` is initialised *from*
   `activeSpace`, and a default parameter would evaluate the ref before it
   exists — `f(undefined)` runs the default. */
function activeSpace(preferred?: string) {
  return activeWorkspaceSpace(spaces, { path: route.path, query: route.query, hash: route.hash }, preferred)
}

function currentSpace() {
  return activeSpace(expandedSpace.value)
}

function visibleChildren(space: WorkspaceNavItem) {
  return space.children.filter((child) => child.to !== space.to)
}

/* Clicking an entry that points at the location you are already on is not a
   navigation, so the router does nothing and the page has no way to know it was
   asked again. The page listens for this instead. */
function announceAnchor(to: string) {
  const hash = to.includes('#') ? `#${to.split('#')[1]}` : ''
  if (!hash) return
  window.dispatchEvent(new CustomEvent('knitspace:anchor-requested', { detail: { hash } }))
}

function activeChild(space: WorkspaceNavItem) {
  return activeWorkspaceChildTarget(space.children, { path: route.path, query: route.query, hash: route.hash })
}

function toggleSpace(space: WorkspaceNavItem) {
  expandedSpace.value = expandedSpace.value === space.to ? '' : space.to
}

function handleSpaceKeydown(event: KeyboardEvent, space: WorkspaceNavItem) {
  if (!(event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10'))) return
  event.preventDefault()
  emit('openSpaceContextKeyboard', space, event.currentTarget as HTMLElement)
}

watch(() => route.fullPath, () => {
  const active = currentSpace()
  if (active) expandedSpace.value = active.to
  // A space with a dozen children is taller than the rail, so the entry that
  // was just opened can easily be the one scrolled out of sight.
  void nextTick(() => {
    railNav.value
      ?.querySelector('.rail-child.active')
      ?.scrollIntoView({ block: 'nearest' })
  })
})

function isActive(path: string) {
  return route.path === path || route.path.startsWith(`${path}/`)
}

/** The rail is a quick flip between the two visible outcomes; the three-way
 *  choice, including 跟随系统, lives in settings. Flipping while on 系统 moves
 *  to the opposite of whatever the system currently resolves to. */
function cycleTheme() {
  const next: ThemePreference = resolveTheme(preference.value) === 'dark' ? 'light' : 'dark'
  applyTheme(next)
}
</script>

<template>
  <aside
    class="rail fixed bottom-0 left-0 top-[var(--titlebar-h)] z-10 w-60 flex flex-col bg-surface border-r border-line"
    aria-label="主导航"
  >
    <RouterLink
      to="/"
      class="row gap-2.5 h-14 px-4 shrink-0 border-b border-line"
      title="Knitspace 工具箱"
    >
      <!-- `bg-accent-solid`, not `bg-accent`: the ink ramp is tuned to be read
           *on* a dark plane, so white on top of it measures 2.49:1. -->
      <span class="center w-7 h-7 rounded-md bg-accent-solid text-accent-fg font-bold text-[12px] shrink-0">KS</span>
      <span class="stack min-w-0">
        <strong class="text-[13px] font-semibold leading-tight truncate">Knitspace</strong>
        <small class="text-[11px] text-fg-3 leading-tight">本地工具箱</small>
      </span>
    </RouterLink>

    <div class="p-2.5 shrink-0">
      <button
        type="button"
        class="row gap-2 w-full h-8.5 px-2.5 rounded-sm bg-well border border-line text-fg-3 text-[13px]
               transition-colors duration-120 hover:border-line-strong hover:text-fg-2"
        @click="emit('openCommand', $event.currentTarget as HTMLElement)"
      >
        <AppIcon name="search" :size="15" />
        <span>搜索 {{ totalTools }} 个工具</span>
        <kbd class="kbd ml-auto">Ctrl K</kbd>
      </button>
    </div>

    <!-- The five spaces are the product's stable mental model. Their children
         expose implemented workflows without growing another top-level list;
         only the active space expands, so an ordinary desktop window remains
         compact. Right click opens the same complete menu used elsewhere. -->
    <nav ref="railNav" class="flex-1 min-h-0 overflow-y-auto px-2.5 pb-2" aria-label="主导航目录">
      <p class="eyebrow px-2.5 pt-1 pb-1.5">五个空间</p>
      <section
        v-for="space in spaces"
        :key="space.to"
        class="rail-space stack gap-0.5"
        :class="expandedSpace === space.to && 'expanded'"
      >
        <div class="row gap-0.5">
          <RouterLink
            :to="space.to"
            :class="['nav-item min-w-0 flex-1', currentSpace()?.to === space.to && 'nav-item-active']"
            :title="`打开${space.label}；右键查看全部功能`"
            aria-haspopup="menu"
            @contextmenu.prevent.stop="emit('openSpaceContext', $event, space)"
            @keydown="handleSpaceKeydown($event, space)"
          >
            <AppIcon :name="space.icon" :size="15" class="shrink-0 text-fg-3" />
            <span class="truncate">{{ space.label }}</span>
          </RouterLink>
          <button
            type="button"
            class="rail-space__toggle center w-7 h-8 shrink-0 rounded-sm text-fg-3 transition-colors duration-120 hover:bg-surface-2 hover:text-fg"
            :aria-label="`${expandedSpace === space.to ? '收起' : '展开'}${space.label}功能`"
            :aria-expanded="expandedSpace === space.to"
            @click="toggleSpace(space)"
            @contextmenu.prevent.stop="emit('openSpaceContext', $event, space)"
            @keydown="handleSpaceKeydown($event, space)"
          >
            <span class="transition-transform duration-120"><AppIcon name="chevron-left" :size="12" class="rotate-180" /></span>
          </button>
        </div>
        <!-- No height cap and no scroller of its own. It had `max-h-64
             overflow-y-auto`, which nested a second scroll area inside the
             rail's own — so a space with thirteen children showed nine and cut
             the tenth in half against an inner edge no one could see. One
             scroll, on the rail, is the ordinary pattern and the one that lets
             `scrollIntoView` below actually reach an item. -->
        <nav v-if="expandedSpace === space.to" class="rail-space__children stack gap-0.5 pr-0.5 pb-1" :aria-label="`${space.label}功能`">
          <RouterLink
            v-for="child in visibleChildren(space)"
            :key="child.to"
            :to="child.to"
            class="rail-child row gap-2 min-h-7 pl-7 pr-2 py-1 rounded-sm text-[11px] leading-snug text-fg-2 scroll-my-2 transition-colors duration-120"
            :class="activeChild(space) === child.to && 'active'"
            :title="child.label"
            @click="announceAnchor(child.to)"
          >
            <AppIcon :name="child.icon" :size="12" />
            <span class="min-w-0 truncate">{{ child.label }}</span>
          </RouterLink>
        </nav>
      </section>
    </nav>

    <div class="shrink-0 p-2.5 border-t border-line stack gap-0.5">
      <button type="button" class="nav-item w-full" :title="resolved === 'dark' ? '切换到浅色' : '切换到深色'" @click="cycleTheme">
        <AppIcon :name="resolved === 'dark' ? 'sparkle' : 'palette'" :size="15" class="shrink-0 text-fg-3" />
        <span>{{ preference === 'system' ? '跟随系统' : resolved === 'dark' ? '深色' : '浅色' }}</span>
      </button>
      <RouterLink to="/settings" :class="['nav-item', isActive('/settings') && 'nav-item-active']">
        <AppIcon name="settings" :size="15" class="shrink-0 text-fg-3" />
        <span>设置</span>
      </RouterLink>
      <p class="row gap-1.5 px-2.5 pt-1.5 text-[11px] text-fg-3">
        <i class="w-1.5 h-1.5 rounded-full bg-success shrink-0" aria-hidden="true" />
        全部在本机运行
      </p>
    </div>
  </aside>
</template>
