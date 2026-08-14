<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import AppIcon from '@/components/AppIcon.vue'
import PageHeader from '@/components/PageHeader.vue'
import { clampMenuPosition, isContextMenuShortcut, nextMenuItemIndex } from '@/lib/desktop-menu'
import { buildKnowledgeRelationGraph, knowledgeRelationEdgesFor, resolveBrowserWikiLinks, searchKnowledgeRelationNodes, type KnowledgeRelationEdge, type KnowledgeRelationNode, type KnowledgeWikiLinkProjection } from '@/lib/knowledge-relations'
import { isDesktop, listDesktopVisualProjects, listDesktopWikiLinks, type DesktopVisualProjectSummary } from '@/lib/native'
import { relationKindLabel } from '@/lib/relation-targets'
import { useUiStore } from '@/stores/ui'
import { useWorkbenchStore } from '@/stores/workbench'

const store = useWorkbenchStore()
const ui = useUiStore()
const route = useRoute()
const router = useRouter()
const query = ref('')
const connectedOnly = ref(true)
const focusId = ref(typeof route.query.focus === 'string' ? route.query.focus : '')
const visualProjects = shallowRef<DesktopVisualProjectSummary[]>([])
const desktop = isDesktop()
const desktopWikiProjection = shallowRef<KnowledgeWikiLinkProjection>({ links: [], unresolvedCount: 0, ambiguousCount: 0, truncated: false })
const menu = shallowRef<{ node: KnowledgeRelationNode; edge?: KnowledgeRelationEdge; x: number; y: number }>()
const menuElement = ref<HTMLElement>()
let menuTrigger: HTMLElement | undefined

const wikiProjection = computed<KnowledgeWikiLinkProjection>(() => desktop ? desktopWikiProjection.value : resolveBrowserWikiLinks(store.documents))
const graph = computed(() => buildKnowledgeRelationGraph(store.documents, store.vocabulary, visualProjects.value, store.relations, wikiProjection.value.links))
const connectedNodes = computed(() => graph.value.nodes.filter(node => !connectedOnly.value || node.degree > 0))
const visibleNodes = computed(() => searchKnowledgeRelationNodes(connectedNodes.value, query.value, 80))
const focusedNode = computed(() => graph.value.nodes.find(node => node.id === focusId.value))
const focusedEdges = computed(() => focusedNode.value ? knowledgeRelationEdgesFor(graph.value, focusedNode.value.id, 60) : [])
const neighborRows = computed(() => focusedEdges.value.map(edge => {
  const outbound = edge.from.id === focusedNode.value?.id
  return { edge, node: outbound ? edge.to : edge.from, outbound }
}))
const connectedCount = computed(() => graph.value.nodes.filter(node => node.degree > 0).length)
const orphanCount = computed(() => graph.value.nodes.length - connectedCount.value)
const relationTypeLabels = { related: '相关', prerequisite: '前置知识', variation: '变式 / 对比' } as const
const kindIcons = { note: 'book', question: 'review', word: 'sort', diagram: 'palette' } as const

function selectNode(node: KnowledgeRelationNode) {
  focusId.value = node.id
  void router.replace({ path: '/relations', query: { focus: node.id } })
}

function nodeRoute(node: KnowledgeRelationNode) {
  if (node.kind === 'word') return { path: '/words', query: { word: node.id } }
  if (node.kind === 'diagram') return { path: '/visual', query: { project: node.id } }
  return { path: '/documents', query: { kind: node.kind, document: node.id } }
}

function openNode(node: KnowledgeRelationNode) {
  closeMenu()
  void router.push(nodeRoute(node))
}

function edgeLabel(edge: KnowledgeRelationEdge) {
  if (!edge.explicit) return 'Markdown 双链'
  return `${relationTypeLabels[edge.relation.relationType]}${edge.wiki ? ' · 双链' : ''}`
}

function closeMenu(restoreFocus = false) {
  menu.value = undefined
  if (restoreFocus) void nextTick(() => menuTrigger?.isConnected && menuTrigger.focus({ preventScroll: true }))
}

function showMenu(event: MouseEvent | KeyboardEvent, node: KnowledgeRelationNode, edge?: KnowledgeRelationEdge) {
  event.preventDefault()
  event.stopPropagation()
  menuTrigger = event.currentTarget instanceof HTMLElement ? event.currentTarget : undefined
  const bounds = menuTrigger?.getBoundingClientRect()
  const x = 'clientX' in event && event.clientX ? event.clientX : (bounds?.left ?? 18) + 36
  const y = 'clientY' in event && event.clientY ? event.clientY : (bounds?.top ?? 18) + 36
  menu.value = { node, edge, ...clampMenuPosition(x, y, { menuWidth: 252, menuHeight: edge ? 274 : 188, margin: 12 }) }
  void nextTick(() => menuElement.value?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus({ preventScroll: true }))
}

function showMenuFromKeyboard(event: KeyboardEvent, node: KnowledgeRelationNode, edge?: KnowledgeRelationEdge) {
  if (isContextMenuShortcut(event)) showMenu(event, node, edge)
}

function handleMenuKeydown(event: KeyboardEvent) {
  const items = [...(menuElement.value?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? [])]
  if (event.key === 'Escape') { event.preventDefault(); closeMenu(true); return }
  const index = nextMenuItemIndex(event.key, items.indexOf(document.activeElement as HTMLButtonElement), items.length)
  if (index === undefined) return
  event.preventDefault()
  items[index]?.focus({ preventScroll: true })
}

async function copyNodeReference(node: KnowledgeRelationNode) {
  const value = node.kind === 'note' || node.kind === 'question' ? `[[${node.title}]]` : node.title
  try {
    await navigator.clipboard.writeText(value)
    ui.toast(node.kind === 'note' || node.kind === 'question' ? '双链已复制' : '名称已复制', value, 'success')
  } catch {
    ui.toast('暂时无法复制', '系统剪贴板当前不可用。', 'error')
  }
  closeMenu(true)
}

async function copyRelation(edge: KnowledgeRelationEdge) {
  const value = `${edge.from.title} —${edgeLabel(edge)}→ ${edge.to.title}`
  try {
    await navigator.clipboard.writeText(value)
    ui.toast('关系摘要已复制', value, 'success')
  } catch {
    ui.toast('暂时无法复制', '系统剪贴板当前不可用。', 'error')
  }
  closeMenu(true)
}

async function removeRelation(edge: KnowledgeRelationEdge) {
  if (!edge.explicit) return
  const confirmed = await ui.confirm({
    title: '移除这条知识关系？',
    message: `只移除“${edge.from.title}”与“${edge.to.title}”之间的${relationTypeLabels[edge.relation.relationType]}关系，内容本身不会删除。`,
    danger: true,
    confirmLabel: '移除关系',
  })
  if (!confirmed) return
  store.deleteRelation(edge.relation)
  closeMenu()
  ui.toast('已移除知识关系', '两端内容仍保留在本地资料库。', 'success')
}

function selectMenuNode() {
  if (!menu.value) return
  selectNode(menu.value.node)
  closeMenu()
}

watch(() => route.query.focus, value => {
  if (typeof value === 'string') focusId.value = value
})

watch(graph, next => {
  if (!next.nodes.length) { focusId.value = ''; return }
  if (!next.nodes.some(node => node.degree > 0)) connectedOnly.value = false
  if (!next.nodes.some(node => node.id === focusId.value)) focusId.value = next.nodes.find(node => node.degree > 0)?.id ?? next.nodes[0]?.id ?? ''
}, { immediate: true })

function closeFromWindow() { closeMenu() }

onMounted(async () => {
  window.addEventListener('knitspace:close-context-menus', closeFromWindow)
  const [visualResult, wikiResult] = await Promise.allSettled([listDesktopVisualProjects(100), listDesktopWikiLinks(1_000)])
  visualProjects.value = visualResult.status === 'fulfilled' ? visualResult.value : []
  if (desktop && wikiResult.status === 'fulfilled') desktopWikiProjection.value = wikiResult.value
})
onBeforeUnmount(() => window.removeEventListener('knitspace:close-context-menus', closeFromWindow))
</script>

<template>
  <!-- No `relation-graph__*` classes; the scoped block goes with them. -->
  <div class="page-enter h-full mx-auto w-full max-w-320 px-8 py-6" @click="closeMenu()">
    <PageHeader
      title="知识关系图谱"
      subtitle="以一条内容为中心，看它引用了谁、又被谁引用"
      :stats="[
        { label: '有关联', value: connectedCount },
        { label: '未关联', value: orphanCount, tone: orphanCount ? 'warn' : undefined },
        { label: '手动关系', value: store.relations.length },
      ]"
    >
      <template #actions>
        <RouterLink class="btn-default" to="/knowledge"><AppIcon name="chevron-left" :size="14" />返回知识库</RouterLink>
        <RouterLink class="btn-primary" to="/documents?kind=note&create=note"><AppIcon name="plus" :size="15" />新建笔记</RouterLink>
      </template>
    </PageHeader>

    <div class="flex-1 min-h-0 grid gap-4 grid-cols-[minmax(260px,320px)_minmax(0,1fr)]">
      <aside class="pane h-full min-h-0" aria-label="聚焦节点">
        <header class="pane-head">
          <span class="pane-title">选择中心内容</span>
          <small class="text-[11px] tabular-nums text-fg-3">{{ visibleNodes.length }} / {{ connectedNodes.length }}</small>
        </header>

        <div class="stack gap-2 shrink-0 p-2 border-b border-line">
          <label class="row gap-1.5 h-8 px-2.5 rounded-sm bg-well border border-line focus-within:border-accent">
            <AppIcon name="search" :size="14" class="shrink-0 text-fg-3" />
            <input v-model="query" type="search" class="min-w-0 flex-1 bg-transparent border-0 text-[12px] text-fg focus:outline-none" aria-label="搜索知识关系节点" placeholder="标题或分类…" />
            <button v-if="query" class="center w-5 h-5 shrink-0 rounded-sm text-fg-3 hover:text-fg" aria-label="清空搜索" @click="query = ''"><AppIcon name="close" :size="11" /></button>
          </label>
          <div class="row gap-0.5 p-0.5 rounded-sm bg-well border border-line" role="group" aria-label="节点范围">
            <button
              class="flex-1 center h-7 rounded-[4px] text-[12px] transition-colors duration-120 disabled:opacity-45 disabled:cursor-not-allowed"
              :class="connectedOnly ? 'bg-surface text-fg font-medium shadow-sm' : 'text-fg-3 hover:not-disabled:text-fg'"
              :disabled="!connectedCount"
              :title="connectedCount ? '只查看已有关系的内容' : '建立第一条关系后即可筛选'"
              @click="connectedOnly = true"
            >
              已连接 {{ connectedCount }}
            </button>
            <button
              class="flex-1 center h-7 rounded-[4px] text-[12px] transition-colors duration-120"
              :class="!connectedOnly ? 'bg-surface text-fg font-medium shadow-sm' : 'text-fg-3 hover:text-fg'"
              @click="connectedOnly = false"
            >
              全部 {{ graph.nodes.length }}
            </button>
          </div>
        </div>

        <nav v-if="visibleNodes.length" class="flex-1 min-h-0 overflow-y-auto stack gap-0.5 p-1.5" aria-label="知识节点">
          <button
            v-for="node in visibleNodes"
            :key="node.id"
            v-memo="[node.id, node.title, node.subtitle, node.degree, focusId]"
            class="row gap-2 px-2 py-1.5 rounded-sm text-left transition-colors duration-120"
            :class="focusId === node.id ? 'bg-accent-soft' : 'hover:bg-surface-2'"
            aria-haspopup="menu"
            :aria-expanded="menu?.node.id === node.id"
            :title="`${node.title}；右键或 Shift+F10 查看操作`"
            @click.stop="selectNode(node)"
            @contextmenu="showMenu($event, node)"
            @keydown="showMenuFromKeyboard($event, node)"
          >
            <span class="center w-7 h-7 shrink-0 rounded-sm bg-surface-2" :class="focusId === node.id ? 'text-accent' : 'text-fg-2'">
              <AppIcon :name="kindIcons[node.kind]" :size="14" />
            </span>
            <span class="stack gap-0.5 min-w-0 flex-1">
              <b class="text-[12px] font-medium truncate" :class="focusId === node.id ? 'text-accent' : 'text-fg'">{{ node.title }}</b>
              <small class="text-[11px] truncate text-fg-3">{{ relationKindLabel(node.kind) }} · {{ node.subtitle }}</small>
            </span>
            <i class="shrink-0 font-mono text-[11px] not-italic tabular-nums text-fg-3">{{ node.degree }}</i>
          </button>
        </nav>
        <div v-else class="flex-1 min-h-0 stack items-center justify-center gap-2 p-6 text-center">
          <AppIcon name="search" :size="19" class="text-fg-3" />
          <b class="text-[12px] font-medium text-fg">没有匹配的内容</b>
          <span class="text-[11px] leading-relaxed text-fg-3">换一个标题或查看全部节点。</span>
        </div>
        <footer class="shrink-0 px-3 py-2 border-t border-line text-[11px] text-fg-3">最多显示 80 个节点 · 按关联度排序</footer>
      </aside>

      <main class="pane h-full min-h-0">
        <template v-if="focusedNode">
          <header
            class="row gap-3 shrink-0 px-3 py-2.5 border-b border-line focus:outline-none focus-visible:bg-surface-2"
            tabindex="0"
            aria-haspopup="menu"
            :aria-expanded="menu?.node.id === focusedNode.id && !menu.edge"
            @contextmenu="showMenu($event, focusedNode)"
            @keydown="showMenuFromKeyboard($event, focusedNode)"
          >
            <span class="center w-10 h-10 shrink-0 rounded-md bg-accent-soft text-accent"><AppIcon :name="kindIcons[focusedNode.kind]" :size="20" /></span>
            <span class="stack gap-0.5 min-w-0 flex-1">
              <small class="text-[11px] font-semibold text-fg-3">当前聚焦 · {{ relationKindLabel(focusedNode.kind) }}</small>
              <h3 class="text-[15px] font-semibold truncate text-fg">{{ focusedNode.title }}</h3>
              <small class="text-[11px] truncate text-fg-3">{{ focusedNode.subtitle }}</small>
            </span>
            <dl class="row gap-4 shrink-0">
              <div class="stack items-center gap-0.5">
                <dt class="text-[16px] font-semibold tabular-nums text-fg">{{ focusedNode.inbound }}</dt>
                <dd class="text-[11px] text-fg-3">指向这里</dd>
              </div>
              <div class="stack items-center gap-0.5">
                <dt class="text-[16px] font-semibold tabular-nums text-fg">{{ focusedNode.outbound }}</dt>
                <dd class="text-[11px] text-fg-3">从此出发</dd>
              </div>
            </dl>
            <button class="btn-default btn-sm shrink-0" @click.stop="openNode(focusedNode)">打开内容<AppIcon name="arrow-right" :size="12" /></button>
          </header>

          <template v-if="neighborRows.length">
            <div class="row-between gap-2 shrink-0 px-3 h-9 border-b border-line">
              <span class="row gap-2 text-[11px]">
                <b class="font-semibold text-fg-3">可见关联</b>
                <span class="tabular-nums text-fg-2">{{ neighborRows.length }} 条直接关系</span>
              </span>
              <small class="text-[11px] text-fg-3">单击打开 · 右键管理</small>
            </div>
            <div class="flex-1 min-h-0 overflow-y-auto stack gap-0.5 p-1.5" aria-label="中心内容的知识关系">
              <button
                v-for="row in neighborRows"
                :key="row.edge.key"
                v-memo="[row.edge.key, row.node.title, row.node.subtitle, row.outbound]"
                class="row gap-2.5 px-2 py-2 rounded-sm text-left transition-colors duration-120 hover:bg-surface-2"
                aria-haspopup="menu"
                :aria-expanded="menu?.edge?.key === row.edge.key"
                :title="`${row.node.title}；右键或 Shift+F10 管理关系`"
                @click="openNode(row.node)"
                @contextmenu="showMenu($event, row.node, row.edge)"
                @keydown="showMenuFromKeyboard($event, row.node, row.edge)"
              >
                <span class="center w-8 h-8 shrink-0 rounded-sm bg-surface-2 text-fg-2"><AppIcon :name="kindIcons[row.node.kind]" :size="15" /></span>
                <span class="stack gap-0.5 min-w-0 flex-1">
                  <small class="text-[11px] truncate text-fg-3">{{ row.outbound ? '从当前内容出发' : '指向当前内容' }} · {{ row.edge.wiki ? `${row.edge.wiki.occurrences} 处双链` : '手动关系' }}</small>
                  <b class="text-[12px] font-medium truncate text-fg">{{ row.node.title }}</b>
                  <em class="text-[11px] not-italic truncate text-fg-3">{{ relationKindLabel(row.node.kind) }} · {{ row.node.subtitle }}</em>
                </span>
                <i
                  class="row gap-1 shrink-0 h-6 px-2 rounded-full text-[11px] not-italic whitespace-nowrap"
                  :class="row.edge.wiki && !row.edge.explicit ? 'bg-surface-2 text-fg-2' : 'bg-accent-soft text-accent'"
                  :title="row.edge.wiki?.headings.length ? `链接段落：${row.edge.wiki.headings.join('、')}` : edgeLabel(row.edge)"
                >
                  <AppIcon :name="row.outbound ? 'arrow-right' : 'chevron-left'" :size="11" />{{ edgeLabel(row.edge) }}
                </i>
              </button>
              <p v-if="focusedEdges.length >= 60" class="px-2 py-3 text-[11px] leading-relaxed text-fg-3">
                当前内容超过 60 条直接关系；这里只显示最近的 60 条，避免一次创建过多桌面节点。
              </p>
            </div>
          </template>
          <div v-else class="flex-1 min-h-0 center p-6">
            <div class="stack items-center gap-3 max-w-100 text-center">
              <span class="center w-12 h-12 rounded-lg bg-accent-soft text-accent"><AppIcon name="link" :size="22" /></span>
              <strong class="text-[14px] font-semibold text-fg">这条内容还没有连接</strong>
              <p class="text-[12px] leading-relaxed text-fg-3">
                在笔记检查器的「关联知识」中添加关系，或在正文里输入 <code class="font-mono text-fg-2">[[笔记标题]]</code> 建立双链。
              </p>
              <button class="btn-primary" @click="openNode(focusedNode)">打开内容并建立关系</button>
            </div>
          </div>
        </template>

        <div v-else class="flex-1 min-h-0 center p-6">
          <div class="stack items-center gap-3 max-w-100 text-center">
            <span class="center w-12 h-12 rounded-lg bg-accent-soft text-accent"><AppIcon name="link" :size="22" /></span>
            <strong class="text-[15px] font-semibold text-fg">从第一条知识关系开始</strong>
            <p class="text-[12px] leading-relaxed text-fg-3">先新建笔记、题目或单词，再在内容检查器里把它们连接起来。</p>
            <RouterLink class="btn-primary" to="/documents?kind=note&create=note">新建笔记</RouterLink>
          </div>
        </div>
      </main>
    </div>

    <p
      v-if="graph.unresolvedEdges || wikiProjection.unresolvedCount || wikiProjection.ambiguousCount || wikiProjection.truncated"
      class="row gap-2 shrink-0 mt-3 px-3 py-2 rounded-md bg-warn-soft text-[11px] leading-relaxed text-warn"
      role="status"
    >
      <AppIcon name="warning" :size="13" class="shrink-0 mt-0.5" />
      <span>
        <template v-if="graph.unresolvedEdges">{{ graph.unresolvedEdges }} 条手动关系的一端缺失；</template>
        <template v-if="wikiProjection.unresolvedCount">{{ wikiProjection.unresolvedCount }} 处双链尚无同名内容；</template>
        <template v-if="wikiProjection.ambiguousCount">{{ wikiProjection.ambiguousCount }} 处双链对应多个同名内容；</template>
        <template v-if="wikiProjection.truncated">双链投影已达到安全上限；</template>
        这些记录没有被自动修改。
      </span>
    </p>

    <Teleport to="body">
      <section
        v-if="menu"
        ref="menuElement"
        class="menu-panel w-64"
        role="menu"
        :style="{ left: `${menu.x}px`, top: `${menu.y}px` }"
        @click.stop
        @contextmenu.prevent
        @keydown.stop="handleMenuKeydown"
      >
        <p class="menu-title">
          {{ menu.edge ? edgeLabel(menu.edge) : relationKindLabel(menu.node.kind) }}
          <small class="min-w-0 truncate font-normal">{{ menu.node.title }}</small>
        </p>
        <button class="menu-item" role="menuitem" @click="openNode(menu.node)"><span class="row gap-2"><AppIcon name="arrow-right" :size="14" />打开内容</span></button>
        <button class="menu-item" role="menuitem" @click="selectMenuNode"><span class="row gap-2"><AppIcon name="link" :size="14" />设为图谱中心</span></button>
        <button class="menu-item" role="menuitem" @click="copyNodeReference(menu.node)">
          <span class="row gap-2"><AppIcon name="duplicate" :size="14" />{{ menu.node.kind === 'note' || menu.node.kind === 'question' ? '复制双链' : '复制名称' }}</span>
        </button>
        <button v-if="menu.edge" class="menu-item" role="menuitem" @click="copyRelation(menu.edge)"><span class="row gap-2"><AppIcon name="duplicate" :size="14" />复制关系摘要</span></button>
        <button v-if="menu.edge?.wiki" class="menu-item" role="menuitem" @click="openNode(menu.edge.from)"><span class="row gap-2"><AppIcon name="code" :size="14" />打开双链来源</span></button>
        <template v-if="menu.edge?.explicit">
          <i class="menu-sep" aria-hidden="true" />
          <button class="menu-item menu-item-danger" role="menuitem" @click="removeRelation(menu.edge)"><span class="row gap-2"><AppIcon name="trash" :size="14" />移除手动关系</span></button>
        </template>
      </section>
    </Teleport>
  </div>
</template>
