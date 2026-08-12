<script setup lang="ts">
import { computed, ref } from 'vue'
import { RouterLink, useRoute } from 'vue-router'
import AppIcon from '@/components/AppIcon.vue'
import { toolCategories } from '@/lib/toolbox-nav'
import { applyTheme, readThemePreference, type ThemePreference } from '@/lib/theme'

const emit = defineEmits<{ openCommand: [HTMLElement] }>()

const route = useRoute()
const preference = ref<ThemePreference>(readThemePreference())

const totalTools = computed(() => toolCategories.reduce((sum, category) => sum + category.tools.length, 0))

/** Workspaces that are not tool categories but still need a permanent home. */
const workspaces = [
  { to: '/today', label: '今天', icon: 'dashboard' },
  { to: '/documents', label: '资料与笔记', icon: 'book' },
  { to: '/review', label: '复习', icon: 'review' },
  { to: '/history', label: '处理记录', icon: 'clock' },
]

function isActive(path: string) {
  return route.path === path || route.path.startsWith(`${path}/`)
}

function cycleTheme() {
  const next: ThemePreference = preference.value === 'dark' ? 'light' : 'dark'
  preference.value = next
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
      <span class="center w-7 h-7 rounded-md bg-accent text-accent-fg font-bold text-[12px] shrink-0">KS</span>
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

    <nav class="flex-1 min-h-0 overflow-y-auto px-2.5 pb-2" aria-label="工具类别">
      <p class="eyebrow px-2.5 pt-1 pb-1.5">工具</p>
      <RouterLink
        v-for="category in toolCategories"
        :key="category.id"
        :to="`/c/${category.id}`"
        :class="[`cat-${category.accent}`, 'nav-item', isActive(`/c/${category.id}`) && 'nav-item-active']"
      >
        <AppIcon :name="category.icon" :size="15" class="shrink-0 text-cat" />
        <span class="truncate">{{ category.label }}</span>
        <span class="ml-auto text-[11px] text-fg-3 tabular-nums">{{ category.tools.length }}</span>
      </RouterLink>

      <p class="eyebrow px-2.5 pt-4 pb-1.5">工作区</p>
      <RouterLink
        v-for="workspace in workspaces"
        :key="workspace.to"
        :to="workspace.to"
        :class="['nav-item', isActive(workspace.to) && 'nav-item-active']"
      >
        <AppIcon :name="workspace.icon" :size="15" class="shrink-0 text-fg-3" />
        <span class="truncate">{{ workspace.label }}</span>
      </RouterLink>
    </nav>

    <div class="shrink-0 p-2.5 border-t border-line stack gap-0.5">
      <button type="button" class="nav-item w-full" :title="preference === 'dark' ? '切换到浅色' : '切换到深色'" @click="cycleTheme">
        <AppIcon :name="preference === 'dark' ? 'sparkle' : 'palette'" :size="15" class="shrink-0 text-fg-3" />
        <span>{{ preference === 'dark' ? '深色' : '浅色' }}</span>
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
