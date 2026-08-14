<script setup lang="ts">
import { computed, ref } from 'vue'
import { RouterLink, useRoute } from 'vue-router'
import AppIcon from '@/components/AppIcon.vue'
import { toolCategories, findCategory } from '@/lib/toolbox-nav'
import type { ToolCatalogItem } from '@/lib/tool-catalog'
import { useWorkbenchStore } from '@/stores/workbench'

/**
 * The toolbox: the home route shows every category, `/c/:category` shows one.
 * Both are the same grid, which keeps the transition between "browsing
 * everything" and "browsing PDF" free of layout surprise.
 *
 * It is also the only tool browser. There used to be a second one at
 * /tool-space — same 45 tools, its own search, its own filters — reachable
 * only from the command palette, so the product answered "where are the
 * tools?" twice with two different pages. Favourites and the shortcuts to
 * 处理历史 / 万能处理入口 came from there; the rest of that page was this one
 * again.
 */
const route = useRoute()
const store = useWorkbenchStore()
const query = ref('')

const activeCategory = computed(() =>
  typeof route.params.category === 'string' ? findCategory(route.params.category) : undefined,
)

const sections = computed(() => (activeCategory.value ? [activeCategory.value] : toolCategories))

/** Filtering searches titles, descriptions and keywords, then drops empty sections. */
const filtered = computed(() => {
  const term = query.value.trim().toLowerCase()
  if (!term) return sections.value
  return sections.value
    .map((section) => ({
      ...section,
      tools: section.tools.filter((tool) =>
        [tool.title, tool.description, ...tool.keywords].some((field) => field.toLowerCase().includes(term)),
      ),
    }))
    .filter((section) => section.tools.length)
})

const matchCount = computed(() => filtered.value.reduce((sum, section) => sum + section.tools.length, 0))

const favoriteIds = computed(() => new Set(store.favorites.map((favorite) => favorite.toolId)))

/** Favourites, in the order the user pinned them. */
const favoriteTools = computed<ToolCatalogItem[]>(() => {
  const all = toolCategories.flatMap((category) => category.tools)
  return store.favorites.flatMap((favorite) => all.find((tool) => tool.id === favorite.toolId) ?? [])
})

/** Most recent first, de-duplicated, and only tools that still exist. */
const recentTools = computed<ToolCatalogItem[]>(() => {
  const seen = new Set<string>()
  const all = toolCategories.flatMap((category) => category.tools)
  const out: ToolCatalogItem[] = []
  for (const job of [...store.jobs].reverse()) {
    if (!job.toolId || seen.has(job.toolId)) continue
    const tool = all.find((item) => item.id === job.toolId)
    if (!tool) continue
    seen.add(job.toolId)
    out.push(tool)
    if (out.length === 6) break
  }
  return out
})

/** The extra rows only make sense on the unfiltered home view. */
const showPersonalRows = computed(() => !activeCategory.value && !query.value.trim())
</script>

<template>
  <div class="mx-auto w-full max-w-300 px-8 py-7">
    <header class="row-between gap-4 flex-wrap mb-6">
      <div class="stack gap-1 min-w-0">
        <h1 class="text-[26px] font-semibold tracking-tight font-display">
          {{ activeCategory ? activeCategory.label : '工具箱' }}
        </h1>
        <p class="text-[13px] text-fg-2">
          {{ activeCategory ? activeCategory.summary : '选一个工具开始。文件不离开这台机器。' }}
        </p>
      </div>
      <div class="row gap-2 shrink-0">
        <RouterLink class="btn-default" to="/history">处理历史</RouterLink>
        <RouterLink class="btn-primary" to="/quick"><AppIcon name="inbox" :size="15" />万能处理入口</RouterLink>
      </div>
    </header>

    <div class="relative mb-7">
      <AppIcon name="search" :size="16" class="absolute left-3 top-1/2 -translate-y-1/2 text-fg-3 pointer-events-none" />
      <input
        v-model="query"
        type="search"
        class="field w-full h-11 pl-10 pr-3 text-[14px]"
        :placeholder="activeCategory ? `在 ${activeCategory.label} 中搜索…` : '搜索工具名称、用途或格式…'"
        aria-label="搜索工具"
      >
    </div>

    <section v-if="showPersonalRows && favoriteTools.length" class="mb-8">
      <h2 class="eyebrow mb-2.5">收藏</h2>
      <div class="flex flex-wrap gap-2">
        <span v-for="tool in favoriteTools" :key="tool.id" class="relative">
          <RouterLink
            :to="tool.to"
            class="row gap-2 h-9 pl-3 pr-9 rounded-sm bg-surface-2 border border-line text-[13px]
                   transition-colors duration-120 hover:border-line-strong hover:bg-surface-3"
          >
            <AppIcon :name="tool.icon" :size="15" class="text-fg-3" />
            {{ tool.title }}
          </RouterLink>
          <button
            type="button"
            class="absolute right-0.5 top-1/2 -translate-y-1/2 center w-8 h-8 rounded-sm text-warn transition-colors hover:bg-surface-3"
            :aria-label="`取消收藏 ${tool.title}`"
            @click="store.toggleFavorite(tool.id)"
          >
            <AppIcon name="star" :size="13" />
          </button>
        </span>
      </div>
    </section>

    <section v-if="showPersonalRows && recentTools.length" class="mb-8">
      <h2 class="eyebrow mb-2.5">最近使用</h2>
      <div class="flex flex-wrap gap-2">
        <RouterLink
          v-for="tool in recentTools"
          :key="tool.id"
          :to="tool.to"
          class="row gap-2 h-9 px-3 rounded-sm bg-surface-2 border border-line text-[13px]
                 transition-colors duration-120 hover:border-line-strong hover:bg-surface-3"
        >
          <AppIcon :name="tool.icon" :size="15" class="text-fg-3" />
          {{ tool.title }}
        </RouterLink>
      </div>
    </section>

    <section v-for="section in filtered" :key="section.id" :class="`cat-${section.accent}`" class="mb-8">
      <div class="row gap-2.5 mb-3">
        <span class="center w-7 h-7 rounded-sm shrink-0 text-cat" style="background: color-mix(in srgb, var(--cat) 14%, transparent)">
          <AppIcon :name="section.icon" :size="15" />
        </span>
        <h2 class="text-[15px] font-semibold">{{ section.label }}</h2>
        <span class="text-[12px] text-fg-3 tabular-nums">{{ section.tools.length }}</span>
        <RouterLink
          v-if="!activeCategory"
          :to="`/c/${section.id}`"
          class="tap ml-auto text-[12px] text-fg-3 transition-colors duration-120 hover:text-fg"
        >只看这一类 →</RouterLink>
      </div>

      <div class="grid gap-2.5 grid-cols-[repeat(auto-fill,minmax(15rem,1fr))]">
        <!-- The star sits over the card rather than inside it: a button nested
             in a link is neither, and the whole card has to stay the target
             for opening the tool. -->
        <div v-for="tool in section.tools" :key="tool.id" class="group relative">
          <RouterLink
            :to="tool.to"
            class="stack gap-1 h-full p-3.5 rounded-md bg-surface border border-line overflow-hidden
                   transition-[border-color,background] duration-120 hover:border-line-strong hover:bg-surface-2"
          >
            <!-- The category colour reads as a spine on the card rather than a fill,
                 so nine hues can share a page without competing. -->
            <i class="absolute inset-y-0 left-0 w-0.5 bg-cat opacity-0 transition-opacity duration-120 group-hover:opacity-100" aria-hidden="true" />
            <span class="row gap-2 pr-7">
              <AppIcon :name="tool.icon" :size="16" class="text-cat shrink-0" />
              <b class="text-[13px] font-semibold truncate">{{ tool.title }}</b>
            </span>
            <span class="text-[12px] text-fg-2 leading-snug line-clamp-2">{{ tool.description }}</span>
          </RouterLink>
          <button
            type="button"
            class="absolute right-1.5 top-1.5 center w-7 h-7 rounded-sm transition-opacity duration-120
                   focus-visible:opacity-100 group-hover:opacity-100"
            :class="favoriteIds.has(tool.id) ? 'text-warn opacity-100' : 'text-fg-3 opacity-0 hover:text-fg'"
            :aria-label="`${favoriteIds.has(tool.id) ? '取消收藏' : '收藏'} ${tool.title}`"
            :aria-pressed="favoriteIds.has(tool.id)"
            @click="store.toggleFavorite(tool.id)"
          >
            <AppIcon name="star" :size="14" />
          </button>
        </div>
      </div>
    </section>

    <p v-if="query && !matchCount" class="py-16 text-center text-[13px] text-fg-3">
      没有匹配“{{ query }}”的工具。
    </p>

    <!-- The one entry point to the capability check. It is not a tool, so it is
         not in the catalogue, and this was the only place in the interface that
         linked to it. -->
    <footer v-if="showPersonalRows" class="row gap-2 pt-2 text-[12px] text-fg-3">
      <AppIcon name="flask" :size="14" class="shrink-0" />
      <RouterLink to="/lab" class="tap hover:text-fg">本机能力与实验</RouterLink>
      <span>检查 Vault、FFmpeg、输出目录与本机转写引擎的真实边界。</span>
    </footer>
  </div>
</template>
