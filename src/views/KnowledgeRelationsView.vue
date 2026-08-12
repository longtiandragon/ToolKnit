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
  <div class="relation-graph page-enter mx-auto w-full max-w-320 px-8 py-6" @click="closeMenu()">
    <PageHeader
      title="知识关系图谱"
      subtitle="以一条内容为中心,看它引用了谁、又被谁引用"
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

    <section class="relation-graph__workspace">
      <aside class="relation-graph__catalog">
        <header><div><p class="eyebrow">聚焦节点</p><h3>选择中心内容</h3></div><small>{{ visibleNodes.length }} / {{ connectedNodes.length }}</small></header>
        <label><AppIcon name="search" :size="14" /><input v-model="query" type="search" aria-label="搜索知识关系节点" placeholder="标题或分类…" /><button v-if="query" aria-label="清空搜索" @click="query = ''"><AppIcon name="close" :size="11" /></button></label>
        <div class="relation-graph__scope"><button :class="{ active: connectedOnly }" :disabled="!connectedCount" :title="connectedCount ? '只查看已有关系的内容' : '建立第一条关系后即可筛选'" @click="connectedOnly = true">已连接 {{ connectedCount }}</button><button :class="{ active: !connectedOnly }" @click="connectedOnly = false">全部 {{ graph.nodes.length }}</button></div>
        <nav v-if="visibleNodes.length" aria-label="知识节点">
          <button v-for="node in visibleNodes" :key="node.id" v-memo="[node.id,node.title,node.subtitle,node.degree,focusId]" :class="{ active: focusId === node.id }" aria-haspopup="menu" :aria-expanded="menu?.node.id === node.id" :title="`${node.title}；右键或 Shift+F10 查看操作`" @click.stop="selectNode(node)" @contextmenu="showMenu($event,node)" @keydown="showMenuFromKeyboard($event,node)">
            <span><AppIcon :name="kindIcons[node.kind]" :size="14" /></span><div><b>{{ node.title }}</b><small>{{ relationKindLabel(node.kind) }} · {{ node.subtitle }}</small></div><i>{{ node.degree }}</i>
          </button>
        </nav>
        <div v-else class="relation-graph__catalog-empty"><AppIcon name="search" :size="19" /><b>没有匹配的内容</b><span>换一个标题或查看全部节点。</span></div>
        <footer>最多显示 80 个节点 · 按关联度排序</footer>
      </aside>

      <main class="relation-graph__focus">
        <template v-if="focusedNode">
          <header class="relation-graph__focus-head" tabindex="0" aria-haspopup="menu" :aria-expanded="menu?.node.id === focusedNode.id && !menu.edge" @contextmenu="showMenu($event,focusedNode)" @keydown="showMenuFromKeyboard($event,focusedNode)">
            <span><AppIcon :name="kindIcons[focusedNode.kind]" :size="22" /></span>
            <div><p class="eyebrow">当前聚焦 · {{ relationKindLabel(focusedNode.kind) }}</p><h3>{{ focusedNode.title }}</h3><small>{{ focusedNode.subtitle }}</small></div>
            <dl><div><dt>{{ focusedNode.inbound }}</dt><dd>指向这里</dd></div><div><dt>{{ focusedNode.outbound }}</dt><dd>从此出发</dd></div></dl>
            <button class="quiet-button" @click.stop="openNode(focusedNode)">打开内容 <AppIcon name="arrow-right" :size="12" /></button>
          </header>

          <section v-if="neighborRows.length" class="relation-graph__threads" aria-label="中心内容的知识关系">
            <header><div><p class="eyebrow">可见关联</p><h3>{{ neighborRows.length }} 条直接关系</h3></div><small>单击打开 · 右键管理</small></header>
            <div>
              <button v-for="row in neighborRows" :key="row.edge.key" v-memo="[row.edge.key,row.node.title,row.node.subtitle,row.outbound]" aria-haspopup="menu" :aria-expanded="menu?.edge?.key === row.edge.key" :title="`${row.node.title}；右键或 Shift+F10 管理关系`" @click="openNode(row.node)" @contextmenu="showMenu($event,row.node,row.edge)" @keydown="showMenuFromKeyboard($event,row.node,row.edge)">
                <span><AppIcon :name="kindIcons[row.node.kind]" :size="16" /></span>
                <div><small>{{ row.outbound ? '从当前内容出发' : '指向当前内容' }} · {{ row.edge.wiki ? `${row.edge.wiki.occurrences} 处双链` : '手动关系' }}</small><b>{{ row.node.title }}</b><em>{{ relationKindLabel(row.node.kind) }} · {{ row.node.subtitle }}</em></div>
                <i :class="[row.edge.relation.relationType,{wiki:row.edge.wiki&&!row.edge.explicit,combined:row.edge.wiki&&row.edge.explicit}]" :title="row.edge.wiki?.headings.length ? `链接段落：${row.edge.wiki.headings.join('、')}` : edgeLabel(row.edge)"><AppIcon :name="row.outbound ? 'arrow-right' : 'chevron-left'" :size="11" />{{ edgeLabel(row.edge) }}</i>
              </button>
            </div>
          </section>
          <section v-else class="relation-graph__empty">
            <span><AppIcon name="link" :size="23" /></span><h3>这条内容还没有连接</h3><p>在笔记检查器的“关联知识”中添加关系，或在正文里输入 <code>[[笔记标题]]</code> 建立双链。</p><button class="primary-button" @click="openNode(focusedNode)">打开内容并建立关系</button>
          </section>
          <p v-if="focusedEdges.length >= 60" class="relation-graph__notice">当前内容超过 60 条直接关系；这里只显示最近的 60 条，避免一次创建过多桌面节点。</p>
        </template>
        <section v-else class="relation-graph__empty relation-graph__empty--root">
          <span><AppIcon name="link" :size="24" /></span><h3>从第一条知识关系开始</h3><p>先新建笔记、题目或单词，再在内容检查器里把它们连接起来。</p><RouterLink class="primary-button" to="/documents?kind=note&create=note">新建笔记</RouterLink>
        </section>
      </main>
    </section>

    <p v-if="graph.unresolvedEdges || wikiProjection.unresolvedCount || wikiProjection.ambiguousCount || wikiProjection.truncated" class="relation-graph__warning" role="status"><AppIcon name="warning" :size="13" /><span><template v-if="graph.unresolvedEdges">{{ graph.unresolvedEdges }} 条手动关系的一端缺失；</template><template v-if="wikiProjection.unresolvedCount">{{ wikiProjection.unresolvedCount }} 处双链尚无同名内容；</template><template v-if="wikiProjection.ambiguousCount">{{ wikiProjection.ambiguousCount }} 处双链对应多个同名内容；</template><template v-if="wikiProjection.truncated">双链投影已达到安全上限；</template>这些记录没有被自动修改。</span></p>

    <section v-if="menu" ref="menuElement" class="relation-graph__menu" role="menu" :style="{left:`${menu.x}px`,top:`${menu.y}px`}" @click.stop @contextmenu.prevent @keydown.stop="handleMenuKeydown">
      <header><span>{{ menu.edge ? edgeLabel(menu.edge) : relationKindLabel(menu.node.kind) }}</span><b>{{ menu.node.title }}</b></header>
      <button role="menuitem" @click="openNode(menu.node)"><AppIcon name="arrow-right" :size="14" />打开内容</button>
      <button role="menuitem" @click="selectMenuNode"><AppIcon name="link" :size="14" />设为图谱中心</button>
      <button role="menuitem" @click="copyNodeReference(menu.node)"><AppIcon name="duplicate" :size="14" />{{ menu.node.kind === 'note' || menu.node.kind === 'question' ? '复制双链' : '复制名称' }}</button>
      <button v-if="menu.edge" role="menuitem" @click="copyRelation(menu.edge)"><AppIcon name="duplicate" :size="14" />复制关系摘要</button>
      <button v-if="menu.edge?.wiki" role="menuitem" @click="openNode(menu.edge.from)"><AppIcon name="code" :size="14" />打开双链来源</button>
      <button v-if="menu.edge?.explicit" class="danger" role="menuitem" @click="removeRelation(menu.edge)"><AppIcon name="trash" :size="14" />移除手动关系</button>
    </section>
  </div>
</template>

<style scoped>
.relation-graph{max-width:1460px;margin:0 auto;padding:26px 30px 54px;color:var(--text)}
.relation-graph__hero{grid-template-columns:minmax(0,1fr) 330px;overflow:hidden;box-shadow:0 20px 48px var(--accent-soft)}
.relation-graph__hero>div{display:flex;align-items:flex-start;flex-direction:column;justify-content:center;padding:30px 38px}.relation-graph__hero .eyebrow{}.relation-graph__hero h2{max-width:870px;margin:9px 0 10px;font:720 clamp(27px,3vw,42px)/1.12 var(--font-display);letter-spacing:-.043em}.relation-graph__hero h2 em{font-style:normal}.relation-graph__hero>div>p:not(.eyebrow){max-width:790px;font-size:12px;line-height:1.72}.relation-graph__hero nav{display:flex;gap:8px;margin-top:17px}.relation-graph__hero nav a{display:inline-flex;align-items:center;gap:6px;min-height:36px;padding:0 12px}.relation-graph__hero .primary-button{}.relation-graph__hero .quiet-button{color:var(--fg);}
.relation-graph__hero>aside{display:grid;grid-template-columns:repeat(3,1fr);align-items:stretch;border-left:1px solid var(--surface-2);}.relation-graph__hero>aside>div{display:grid;place-content:center;justify-items:center;gap:6px;border-left:1px solid var(--surface-2)}.relation-graph__hero>aside>div:first-child{border-left:0}.relation-graph__hero>aside b{font:760 31px/1 var(--font-mono)}.relation-graph__hero>aside span{font-size:10px}
.relation-graph__workspace{display:grid;grid-template-columns:292px minmax(0,1fr);gap:14px;margin-top:16px;align-items:start}.relation-graph__catalog,.relation-graph__focus{overflow:hidden;border:1px solid var(--line);border-radius:16px;background:var(--surface-2);box-shadow:0 12px 30px var(--accent-soft)}.relation-graph__catalog{position:sticky;top:18px;display:grid;grid-template-rows:auto auto auto minmax(180px,1fr) auto;max-height:calc(100vh - 116px)}.relation-graph__catalog>header{display:flex;align-items:flex-end;justify-content:space-between;padding:14px;border-bottom:1px solid var(--line-weak)}.relation-graph__catalog h3{margin-top:4px;font:700 15px var(--font-display)}.relation-graph__catalog>header>small{color:var(--muted);font:9px var(--font-mono)}.relation-graph__catalog>label{display:flex;align-items:center;gap:7px;height:38px;margin:11px 12px 7px;padding:0 10px;border:1px solid var(--line);border-radius:9px;color:var(--muted);background:var(--canvas)}.relation-graph__catalog>label:focus-within{border-color:var(--green);box-shadow:0 0 0 3px color-mix(in srgb,var(--green) 12%,transparent)}.relation-graph__catalog input{min-width:0;flex:1;border:0;outline:0;color:var(--text);background:transparent;font-size:11px}.relation-graph__catalog label button{display:grid;width:22px;height:22px;padding:0;place-items:center;border:0;color:var(--muted);background:transparent}.relation-graph__scope{display:flex;gap:4px;padding:0 12px 9px}.relation-graph__scope button{min-height:27px;padding:0 8px;border:1px solid transparent;border-radius:7px;color:var(--muted);background:transparent;font-size:9px}.relation-graph__scope button.active{border-color:var(--accent-soft);color:var(--green-strong);background:var(--green-bg)}.relation-graph__catalog>nav{overflow:auto;padding:0 7px 8px;scrollbar-width:thin}.relation-graph__catalog>nav>button{display:grid;width:100%;grid-template-columns:29px minmax(0,1fr) auto;align-items:center;gap:8px;min-height:52px;padding:7px 8px;border:1px solid transparent;border-radius:9px;color:var(--text-secondary);background:transparent;text-align:left}.relation-graph__catalog>nav>button:hover,.relation-graph__catalog>nav>button:focus-visible{color:var(--green-strong);background:var(--green-bg)}.relation-graph__catalog>nav>button.active{border-color:var(--accent-soft);color:var(--green-strong);background:linear-gradient(90deg,var(--green-bg),var(--surface-2))}.relation-graph__catalog>nav>button:focus-visible{outline:2px solid color-mix(in srgb,var(--green) 46%,transparent);outline-offset:-2px}.relation-graph__catalog>nav span{display:grid;width:29px;height:29px;place-items:center;border-radius:8px;color:var(--green-strong);background:var(--accent-soft)}.relation-graph__catalog>nav div{display:grid;min-width:0;gap:3px}.relation-graph__catalog>nav b,.relation-graph__catalog>nav small{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.relation-graph__catalog>nav b{font-size:11px}.relation-graph__catalog>nav small{color:var(--muted);font-size:9px}.relation-graph__catalog>nav i{display:grid;width:21px;height:21px;place-items:center;border-radius:50%;color:var(--green-strong);background:var(--green-bg);font:700 9px var(--font-mono);font-style:normal}.relation-graph__catalog>footer{padding:9px 12px;border-top:1px solid var(--line-weak);color:var(--muted);font-size:8px;text-align:center}.relation-graph__catalog-empty{display:grid;place-content:center;justify-items:center;gap:6px;padding:28px;color:var(--muted);text-align:center}.relation-graph__catalog-empty b{color:var(--text);font-size:11px}.relation-graph__catalog-empty span{font-size:9px}
.relation-graph__focus{min-height:520px}.relation-graph__focus-head{display:grid;grid-template-columns:48px minmax(0,1fr) auto auto;align-items:center;gap:13px;padding:18px 20px;border-bottom:1px solid var(--line);background:linear-gradient(118deg,var(--green-bg),var(--surface) 64%)}.relation-graph__focus-head:focus-visible{outline:2px solid color-mix(in srgb,var(--green) 48%,transparent);outline-offset:-2px}.relation-graph__focus-head>span{display:grid;width:48px;height:48px;place-items:center;border:1px solid var(--accent-soft);border-radius:14px;color:var(--green-strong);background:var(--surface)}.relation-graph__focus-head>div{display:grid;min-width:0;gap:3px}.relation-graph__focus-head h3{overflow:hidden;font:720 20px var(--font-display);text-overflow:ellipsis;white-space:nowrap}.relation-graph__focus-head small{color:var(--muted);font-size:10px}.relation-graph__focus-head dl{display:flex;margin:0}.relation-graph__focus-head dl>div{min-width:63px;padding:2px 12px;border-left:1px solid var(--line)}.relation-graph__focus-head dt{font:720 17px var(--font-mono)}.relation-graph__focus-head dd{margin:2px 0 0;color:var(--muted);font-size:8px}.relation-graph__focus-head>button{display:inline-flex;align-items:center;gap:5px;white-space:nowrap}
.relation-graph__threads>header{display:flex;align-items:flex-end;justify-content:space-between;padding:16px 19px 11px}.relation-graph__threads h3{margin-top:4px;font:700 14px var(--font-display)}.relation-graph__threads>header>small{color:var(--muted);font-size:9px}.relation-graph__threads>div{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;padding:0 14px 16px}.relation-graph__threads>div>button{display:grid;grid-template-columns:36px minmax(0,1fr) auto;align-items:center;gap:10px;min-height:72px;padding:10px 11px;border:1px solid var(--line);border-radius:11px;color:var(--text-secondary);background:var(--surface-2);text-align:left}.relation-graph__threads>div>button:hover,.relation-graph__threads>div>button:focus-visible{border-color:var(--accent-soft);color:var(--green-strong);background:var(--surface)}.relation-graph__threads>div>button:focus-visible{outline:2px solid color-mix(in srgb,var(--green) 46%,transparent);outline-offset:2px}.relation-graph__threads button>span{display:grid;width:36px;height:36px;place-items:center;border-radius:10px;color:var(--green-strong);background:var(--green-bg)}.relation-graph__threads button>div{display:grid;min-width:0;gap:3px}.relation-graph__threads button small{color:var(--muted);font-size:8px}.relation-graph__threads button b,.relation-graph__threads button em{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.relation-graph__threads button b{font-size:11px}.relation-graph__threads button em{color:var(--muted);font-size:9px;font-style:normal}.relation-graph__threads button>i{display:inline-flex;align-items:center;gap:4px;padding:5px 7px;border-radius:7px;color:var(--green-strong);background:var(--green-bg);font:700 8px var(--font-ui);font-style:normal;white-space:nowrap}.relation-graph__threads button>i.variation{color:var(--warn);background:var(--warn-soft)}.relation-graph__threads button>i.prerequisite{color:var(--danger);background:var(--danger-soft)}
.relation-graph__empty{display:grid;min-height:350px;place-content:center;justify-items:center;padding:36px;text-align:center}.relation-graph__empty>span{display:grid;width:50px;height:50px;margin-bottom:11px;place-items:center;border-radius:15px;color:var(--green-strong);background:var(--green-bg)}.relation-graph__empty h3{font:720 17px var(--font-display)}.relation-graph__empty p{max-width:470px;margin:8px 0 16px;color:var(--muted);font-size:10px;line-height:1.65}.relation-graph__empty code{padding:2px 5px;border-radius:4px;color:var(--green-strong);background:var(--green-bg);font-family:var(--font-mono)}.relation-graph__empty--root{min-height:520px}.relation-graph__notice,.relation-graph__warning{display:flex;align-items:center;gap:7px;margin:0;padding:9px 13px;color:var(--warn);background:var(--warn-soft);font-size:9px}.relation-graph__notice{border-top:1px solid var(--warn-soft)}.relation-graph__warning{margin-top:11px;border:1px solid var(--warn-soft);border-radius:10px}
.relation-graph__menu{position:fixed;z-index:var(--z-context-menu);width:252px;overflow:hidden;border:1px solid var(--accent-soft);border-radius:12px;background:var(--surface);box-shadow:var(--shadow-lg);animation:relation-menu-in .14s ease-out both}.relation-graph__menu>header{display:grid;gap:3px;padding:11px 13px 9px;border-bottom:1px solid var(--line-weak);background:linear-gradient(125deg,var(--green-bg),var(--surface-2))}.relation-graph__menu>header span{color:var(--green-strong);font:700 9px var(--font-mono);letter-spacing:.08em}.relation-graph__menu>header b{overflow:hidden;font:700 12px var(--font-ui);text-overflow:ellipsis;white-space:nowrap}.relation-graph__menu>button{display:flex;width:100%;min-height:39px;align-items:center;gap:9px;padding:0 13px;border:0;border-bottom:1px solid var(--line-weak);color:var(--text-secondary);background:transparent;font:650 10px var(--font-ui);text-align:left}.relation-graph__menu>button:last-child{border-bottom:0}.relation-graph__menu>button:hover,.relation-graph__menu>button:focus-visible{color:var(--green-strong);background:var(--green-bg)}.relation-graph__menu>button:focus-visible{outline:2px solid color-mix(in srgb,var(--green) 48%,transparent);outline-offset:-2px}.relation-graph__menu>button.danger{color:var(--danger)}@keyframes relation-menu-in{from{opacity:0;transform:translateY(-4px) scale(.985)}to{opacity:1;transform:none}}
.relation-graph__threads button>i.wiki{color:var(--accent);background:var(--accent-soft)}.relation-graph__threads button>i.combined{color:var(--warn);background:var(--warn-soft)}
.relation-graph__scope button:disabled{cursor:not-allowed;opacity:.48}
@media(max-width:1100px){.relation-graph__hero{}.relation-graph__hero>aside{min-height:92px;border-top:1px solid var(--surface-2);border-left:0}.relation-graph__workspace{grid-template-columns:258px minmax(0,1fr)}.relation-graph__threads>div{grid-template-columns:1fr}.relation-graph__focus-head{grid-template-columns:44px minmax(0,1fr) auto}.relation-graph__focus-head dl{display:none}}
@media(max-width:780px){.relation-graph{padding:20px 16px 42px}.relation-graph__hero>div{padding:25px 24px}.relation-graph__workspace{grid-template-columns:1fr}.relation-graph__catalog{position:static;max-height:430px}.relation-graph__focus-head{grid-template-columns:44px minmax(0,1fr)}.relation-graph__focus-head>button{grid-column:2;justify-self:start}}
@media(prefers-reduced-motion:reduce){.relation-graph__menu{animation:none}}
</style>
