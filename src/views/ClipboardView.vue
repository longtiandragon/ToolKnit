<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useWorkbenchStore } from '@/stores/workbench'
import { useUiStore } from '@/stores/ui'
import { cleanupClipboardAssets, copyClipboardItem, isDesktop, setClipboardMonitor } from '@/lib/native'
import { readClipboardPayload } from '@/lib/clipboard'
import { matchesClipboardQuery } from '@/lib/clipboard-search'
import { clipboardItemToMarkdownNote } from '@/lib/clipboard-note'
import { clipboardFilterFromQuery, clipboardFilterOptions, clipboardRouteAction, toggleClipboardSelection, type ClipboardFilter } from '@/lib/clipboard-workflows'
import { clampMenuPosition, isContextMenuShortcut, nextMenuItemIndex } from '@/lib/desktop-menu'
import { stageLocalFileHandoff } from '@/lib/local-file-handoff'
import AppBreadcrumbs from '@/components/AppBreadcrumbs.vue'
import ClipboardImagePreview from '@/components/ClipboardImagePreview.vue'
import EmptyState from '@/components/EmptyState.vue'
import AppIcon from '@/components/AppIcon.vue'
import PageHeader from '@/components/PageHeader.vue'
import { looksLikeCode } from '@/lib/workbench-utils'
import type { ClipboardItem } from '@/types'

const store = useWorkbenchStore()
const ui = useUiStore()
const route = useRoute()
const router = useRouter()
const desktop = isDesktop()
const CLIPBOARD_PAGE_SIZE = 24
const query = ref('')
const settledQuery = ref('')
const filter = ref<ClipboardFilter>(clipboardFilterFromQuery(route.query.view))
const capturing = ref(false)
const copyingId = ref('')
const archivingId = ref('')
const composerOpen = ref(false)
const snippetElement = ref<HTMLTextAreaElement>()
const snippetText = ref('')
const visibleLimit = ref(CLIPBOARD_PAGE_SIZE)
const selectionMode = ref(false)
const selectedIds = ref<Set<string>>(new Set())
const cardMenu = ref<{ item: ClipboardItem; x: number; y: number }>()
const cardMenuElement = ref<HTMLElement>()
let queryTimer: number | undefined
let cardMenuTrigger: HTMLElement | undefined

const targetItemId = computed(() => typeof route.query.item === 'string' ? route.query.item : '')
const items = computed(() => {
  const matches = store.clipboardItems.filter((item) => {
  const matchesFilter = filter.value === 'all' || filter.value === 'snippets' ? filter.value === 'all' || item.pinned : item.kind === filter.value
  return matchesFilter && matchesClipboardQuery(item, settledQuery.value)
  })
  const targetIndex = targetItemId.value ? matches.findIndex((item) => item.id === targetItemId.value) : -1
  if (targetIndex <= 0) return matches
  return [matches[targetIndex]!, ...matches.slice(0, targetIndex), ...matches.slice(targetIndex + 1)]
})
const visibleItems = computed(() => items.value.slice(0, visibleLimit.value))
const hasMoreItems = computed(() => visibleItems.value.length < items.value.length)
const searchPending = computed(() => query.value.trim() !== settledQuery.value.trim())
const hasActiveFilters = computed(() => Boolean(query.value.trim() || filter.value !== 'all'))
const selectedItems = computed(() => store.clipboardItems.filter(item => selectedIds.value.has(item.id)))
const allFilteredSelected = computed(() => Boolean(items.value.length) && items.value.every(item => selectedIds.value.has(item.id)))
const selectedAllPinned = computed(() => Boolean(selectedItems.value.length) && selectedItems.value.every(item => item.pinned))

watch(query, (value) => {
  if (queryTimer !== undefined) window.clearTimeout(queryTimer)
  queryTimer = window.setTimeout(() => { settledQuery.value = value }, 160)
})
watch([filter, settledQuery, () => store.clipboardItems.length], () => { visibleLimit.value = CLIPBOARD_PAGE_SIZE })
watch([filter, settledQuery], () => { if (selectionMode.value) selectedIds.value = new Set() })
watch(() => route.query.view, (value) => {
  if (targetItemId.value) return
  filter.value = clipboardFilterFromQuery(value)
}, { immediate: true })
watch(() => route.query.action, async (value) => {
  const action = clipboardRouteAction(value)
  if (!action) return
  const nextQuery = { ...route.query }
  delete nextQuery.action
  await router.replace({ path: '/clipboard', query: nextQuery })
  if (action === 'create-snippet') await openSnippetComposer()
  else await capture()
}, { immediate: true })
watch([targetItemId, () => store.clipboardItems.length], ([id]) => {
  if (!id || !store.clipboardItems.some((item) => item.id === id)) return
  filter.value = 'all'
  query.value = ''
  settledQuery.value = ''
  const nextQuery = { ...route.query }
  delete nextQuery.view
  void router.replace({ path: '/clipboard', query: nextQuery })
  void nextTick(() => {
    const target = document.getElementById(`clipboard-${id}`)
    target?.scrollIntoView({ block: 'center' })
    target?.focus({ preventScroll: true })
  })
}, { immediate: true })
onBeforeUnmount(() => { if (queryTimer !== undefined) window.clearTimeout(queryTimer) })

async function capture() {
  capturing.value = true
  try {
    const payload = await readClipboardPayload()
    if (!payload) throw new Error('剪贴板中没有支持的文本或图片。')
    const kind = payload.kind === 'image' ? 'image' : looksLikeCode(payload.content || '') ? 'code' : 'text'
    await store.addClipboardItem({ kind, content: payload.content, preview: payload.preview, assetPath: payload.assetPath, hash: payload.hash })
    ui.toast('已保存到剪贴板历史', '内容只保存在这台设备。', 'success')
  } catch (error) {
    ui.toast('读取失败', error instanceof Error ? error.message : '无法读取剪贴板。', 'error')
  } finally { capturing.value = false }
}

async function openSnippetComposer() {
  composerOpen.value = true
  await nextTick()
  snippetElement.value?.focus({ preventScroll: true })
  snippetElement.value?.scrollIntoView({ behavior: 'auto', block: 'center' })
}

function selectFilter(next: ClipboardFilter) {
  filter.value = next
  const nextQuery = { ...route.query }
  delete nextQuery.action
  if (next === 'all') delete nextQuery.view
  else nextQuery.view = next
  void router.replace({ path: '/clipboard', query: nextQuery })
}

function clearFilters() {
  query.value = ''
  settledQuery.value = ''
  selectFilter('all')
}

async function saveSnippet() {
  const content = snippetText.value.trim()
  if (!content) return
  await store.addClipboardItem({ kind: looksLikeCode(content) ? 'code' : 'text', content, pinned: true })
  snippetText.value = ''
  composerOpen.value = false
  selectFilter('snippets')
  ui.toast('常用片段已保存', '它会固定在剪贴板顶部，不受自动清理影响。', 'success')
}

async function copy(id: string) {
  const item = await store.resolveClipboardItem(id)
  if (!item || copyingId.value) return
  copyingId.value = id
  try {
    await copyClipboardItem(item)
    ui.toast('已重新复制', item.kind === 'image' ? '图片已写入系统剪贴板。' : item.content?.slice(0, 60), 'success')
  } catch (error) {
    ui.toast('复制失败', error instanceof Error ? error.message : '系统拒绝了剪贴板访问。', 'error')
  } finally { copyingId.value = '' }
}

async function toggleMonitor() {
  const enabled = !store.settings.clipboardEnabled
  try {
    await setClipboardMonitor(enabled, false)
    store.updateSettings({ clipboardEnabled: enabled, clipboardPaused: false })
    ui.toast(enabled ? '后台监听已开启' : '后台监听已关闭', '剪贴板内容不会上传。', 'info')
  } catch (error) {
    ui.toast('无法切换剪贴板监听', error instanceof Error ? error.message : '桌面服务暂时不可用。', 'error')
  }
}

async function togglePause() {
  const paused = !store.settings.clipboardPaused
  try {
    await setClipboardMonitor(true, paused)
    store.updateSettings({ clipboardPaused: paused })
  } catch (error) {
    ui.toast('无法切换监听状态', error instanceof Error ? error.message : '桌面服务暂时不可用。', 'error')
  }
}

async function syncAssets() {
  const active = [...store.clipboardItems.map((item) => item.assetPath), ...store.sources.map((source) => source.managedPath)].filter(Boolean) as string[]
  try { await cleanupClipboardAssets(active) } catch { /* cleanup must not undo the user's action */ }
}
async function removeDirect(id: string) {
  await store.removeClipboardItem(id)
  const next = new Set(selectedIds.value)
  next.delete(id)
  selectedIds.value = next
}
async function remove(id: string) {
  const item = store.clipboardItems.find(entry => entry.id === id)
  if (!item) return
  const approved = await ui.confirm({ title: '删除这条剪贴板记录？', message: item.kind === 'image' ? '记录和对应的临时图片缓存会被清理；已归档到资料库的独立副本不受影响。' : '只会删除 Knitspace 中的本地历史记录，不会修改原始内容。', danger: true, confirmLabel: '删除记录' })
  if (!approved) return
  await removeDirect(id)
  await syncAssets()
}
async function clear() {
  if (await ui.confirm({ title: '清空剪贴板历史？', message: '常用片段和固定项目会保留，其他本地记录将被删除。', danger: true, confirmLabel: '清空' })) {
    await store.clearClipboard(); selectedIds.value = new Set(); selectionMode.value = false; await syncAssets()
  }
}
function toggleSelectionMode() {
  selectionMode.value = !selectionMode.value
  selectedIds.value = new Set()
  closeCardMenu()
}
function toggleSelected(id: string) { selectedIds.value = toggleClipboardSelection(selectedIds.value, id) }
function toggleAllFiltered() { selectedIds.value = allFilteredSelected.value ? new Set() : new Set(items.value.map(item => item.id)) }
function exitSelectionMode() { selectionMode.value = false; selectedIds.value = new Set() }
function batchTogglePin() {
  if (!selectedItems.value.length) return
  const shouldPin = !selectedAllPinned.value
  let changed = 0
  for (const item of selectedItems.value) {
    if (Boolean(item.pinned) === shouldPin) continue
    store.toggleClipboardPin(item.id)
    changed += 1
  }
  ui.toast(shouldPin ? `已固定 ${changed} 条记录` : `已取消固定 ${changed} 条记录`, shouldPin ? '固定项目不会被自动清理。' : '这些记录将重新遵循保留期限。', 'success')
}
async function batchRemove() {
  const targets = selectedItems.value
  if (!targets.length) return
  const imageCount = targets.filter(item => item.kind === 'image').length
  const approved = await ui.confirm({ title: `删除选中的 ${targets.length} 条记录？`, message: `${imageCount ? `其中 ${imageCount} 张图片的临时缓存也会清理。` : ''} 已归档资料和原始系统剪贴板不受影响。`, danger: true, confirmLabel: `删除 ${targets.length} 条` })
  if (!approved) return
  for (const item of targets) await removeDirect(item.id)
  await syncAssets()
  exitSelectionMode()
  ui.toast('已删除选中的剪贴板记录', `${targets.length} 条本地历史已清理。`, 'success')
}
function closeCardMenu(restoreFocus = false) {
  cardMenu.value = undefined
  if (restoreFocus) cardMenuTrigger?.focus({ preventScroll: true })
}
function cardMenuHeight(item: ClipboardItem) { return (item.kind === 'text' ? 210 : item.kind === 'image' ? 281 : 246) + 36 }
function showCardMenu(item: ClipboardItem, x: number, y: number, trigger: HTMLElement) {
  cardMenuTrigger = trigger
  cardMenu.value = { item, ...clampMenuPosition(x, y, { menuWidth: 220, menuHeight: cardMenuHeight(item), margin: 12 }) }
  void nextTick(() => cardMenuElement.value?.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')?.focus())
}
function openCardMenu(event: MouseEvent, item: ClipboardItem) {
  if (!(event.currentTarget instanceof HTMLElement)) return
  showCardMenu(item, event.clientX, event.clientY, event.currentTarget)
}
function openCardMenuFromKeyboard(item: ClipboardItem, trigger: HTMLElement) {
  const bounds = trigger.getBoundingClientRect()
  showCardMenu(item, bounds.right - 18, bounds.top + 20, trigger)
}
function handleCardKeydown(event: KeyboardEvent, item: ClipboardItem) {
  if (!isContextMenuShortcut(event)) return
  if (!(event.currentTarget instanceof HTMLElement)) return
  event.preventDefault()
  event.stopPropagation()
  openCardMenuFromKeyboard(item, event.currentTarget)
}
function handleCardMenuKeydown(event: KeyboardEvent) {
  const menuItems = [...(cardMenuElement.value?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? [])]
  if (!menuItems.length) return
  if (event.key === 'Escape') { event.preventDefault(); closeCardMenu(true); return }
  const nextIndex = nextMenuItemIndex(event.key, menuItems.indexOf(document.activeElement as HTMLButtonElement), menuItems.length)
  if (nextIndex === undefined) return
  event.preventDefault()
  menuItems[nextIndex]?.focus()
}
async function prepareCodeImageFromClipboard(id: string) {
  const item = await store.resolveClipboardItem(id)
  if (!item?.content?.trim() || item.kind !== 'code') {
    ui.toast('无法制作代码分享图', '这条记录不是可用的代码。', 'warning')
    return
  }
  store.prepareCodeDraft(item.content, 'clipboard-code.txt')
  await router.push('/code-image')
}
async function archiveImageFromClipboard(id: string) {
  const item = await store.resolveClipboardItem(id)
  if (!item || item.kind !== 'image' || !item.assetPath || !desktop) {
    ui.toast('无法归档这张图片', '请在桌面端重新读取剪贴板图片后再试。', 'warning')
    return
  }
  if (archivingId.value) return
  archivingId.value = id
  try {
    // This invokes the same native import path as the Library. It copies the
    // image into Vault/sources first, so deleting the clipboard history later
    // cannot leave the archived source pointing at an ephemeral cache file.
    const { source, duplicate } = await store.importDesktopSource(item.assetPath)
    store.addActivity('source', duplicate ? '剪贴板图片已在资料库' : '从剪贴板归档图片', source.name, '/library', source.id)
    ui.toast(duplicate ? '资料库中已有这张图片' : '已归档到本地资料库', duplicate ? '已打开已有的独立副本。' : '现在可以标注、裁剪或关联到笔记。', 'success')
    await router.push({ path: '/library', query: { source: source.id } })
  } catch (error) {
    ui.toast('归档图片失败', error instanceof Error ? error.message : '无法复制到本地资料库。', 'error')
  } finally { archivingId.value = '' }
}
async function recognizeImageFromClipboard(id: string) {
  const item = await store.resolveClipboardItem(id)
  if (!item || item.kind !== 'image' || !item.assetPath || !desktop) {
    ui.toast('无法打开离线 OCR', '请在桌面端重新读取剪贴板图片后再试。', 'warning')
    return
  }
  stageLocalFileHandoff('ocr', [item.assetPath], '剪贴板历史')
  await router.push('/ocr')
}
async function createNoteFromClipboard(id: string) {
  const item = await store.resolveClipboardItem(id)
  const draft = item && clipboardItemToMarkdownNote(item)
  if (!draft) {
    ui.toast('无法整理为笔记', '这条记录不是可用的文字或代码。', 'warning')
    return
  }
  const note = store.createNote(draft.title, '收集箱', draft.content)
  store.addActivity('source', '从剪贴板整理为笔记', note.title, '/documents', note.id)
  ui.toast('已收进本地笔记', '已保留原始内容，可继续编辑和关联知识。', 'success')
  await router.push({ path: '/documents', query: { kind: 'note', document: note.id, mode: 'edit' } })
}
async function runCardMenuAction(action: 'select' | 'copy' | 'code-image' | 'ocr' | 'archive-image' | 'note' | 'pin' | 'remove') {
  const item = cardMenu.value?.item
  if (!item) return
  // Keep the image menu visible while the native Vault copy is running; it
  // provides an honest progress label instead of a silent, frozen-looking card.
  if (action === 'archive-image') { await archiveImageFromClipboard(item.id); return }
  closeCardMenu()
  if (action === 'select') { if (!selectionMode.value) selectionMode.value = true; toggleSelected(item.id); return }
  if (action === 'copy') { void copy(item.id); return }
  if (action === 'code-image') { await prepareCodeImageFromClipboard(item.id); return }
  if (action === 'ocr') { await recognizeImageFromClipboard(item.id); return }
  if (action === 'note') { await createNoteFromClipboard(item.id); return }
  if (action === 'pin') {
    const wasPinned = Boolean(item.pinned)
    store.toggleClipboardPin(item.id)
    ui.toast(wasPinned ? '已移出常用片段' : '已固定为常用片段', '固定项目不会被自动清理。', 'success')
    return
  }
  await remove(item.id)
}
const formatTime = (value: string) => new Date(value).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
</script>

<template>
  <div class="clipboard-view page-enter mx-auto w-full max-w-320 px-8 py-6" @click="closeCardMenu()">
    <AppBreadcrumbs :items="[{ label: '工作', to: '/' }, { label: '剪贴板' }]"/>
    <PageHeader title="剪贴板" subtitle="找回刚刚复制过的内容,把反复要用的存成常用片段">
      <template #actions>
        <button class="btn-default" @click="composerOpen ? (composerOpen = false) : openSnippetComposer()">
          <AppIcon name="plus" :size="15" />新建片段
        </button>
      </template>
    </PageHeader>

    <section v-if="composerOpen" class="snippet-composer panel">
      <div><p class="eyebrow">新建片段</p><h3>保存一段经常使用的内容</h3><p>片段只保存在本机，并固定显示在历史记录顶部。</p></div>
      <textarea ref="snippetElement" v-model="snippetText" aria-label="常用片段内容" placeholder="例如：邮件回复、收货地址、常用命令或代码模板…" @keydown.ctrl.enter="saveSnippet"></textarea>
      <div><button class="quiet-button" @click="composerOpen = false; snippetText = ''">取消</button><button class="primary-button" :disabled="!snippetText.trim()" @click="saveSnippet">保存片段</button></div>
    </section>

    <section class="clipboard-warning" :class="{ active: store.settings.clipboardEnabled }"><i></i><span><b>{{ store.settings.clipboardEnabled ? (store.settings.clipboardPaused ? '监听已暂停' : '正在本地监听') : '后台监听未开启' }}</b><small>{{ store.settings.clipboardEnabled ? '不做密码过滤；请避免复制不希望保留的敏感内容。' : '可随时手动读取当前剪贴板。' }}</small></span><button v-if="store.settings.clipboardEnabled" @click="togglePause">{{ store.settings.clipboardPaused ? '继续' : '暂停' }}</button></section>

    <section class="clipboard-toolbar panel" :aria-busy="searchPending"><input v-model="query" class="search-input" aria-label="搜索剪贴板历史" placeholder="搜索历史和常用片段…"/><div><button v-for="option in clipboardFilterOptions" :key="option.id" :class="{ active: filter === option.id }" @click="selectFilter(option.id)">{{ option.label }}</button></div><span class="clipboard-result-count" aria-live="polite">{{ items.length }} 条{{ searchPending ? ' · 筛选中' : '' }}</span><button class="quiet-button" :class="{ active: selectionMode }" :disabled="!store.clipboardItems.length" @click="toggleSelectionMode"><AppIcon name="task" :size="14" />{{ selectionMode ? '退出批量' : '批量管理' }}</button><button class="quiet-button" :disabled="!store.clipboardItems.length" @click="clear">清空</button></section>

    <section v-if="selectionMode" class="clipboard-batch-bar panel" aria-label="剪贴板批量操作">
      <span><AppIcon name="task" :size="16" /><b>已选择 {{ selectedIds.size }} 条</b><small>当前筛选共 {{ items.length }} 条；切换筛选会清空选择。</small></span>
      <button type="button" class="quiet-button" :disabled="!items.length" @click="toggleAllFiltered">{{ allFilteredSelected ? '取消全选' : `选择全部 ${items.length} 条` }}</button>
      <button type="button" class="quiet-button" :disabled="!selectedIds.size" @click="batchTogglePin"><AppIcon name="star" :size="14" />{{ selectedAllPinned ? '取消固定' : '固定所选' }}</button>
      <button type="button" class="quiet-button danger" :disabled="!selectedIds.size" @click="batchRemove"><AppIcon name="trash" :size="14" />删除所选</button>
      <button type="button" class="quiet-button" @click="exitSelectionMode">完成</button>
    </section>

    <template v-if="items.length">
      <section class="clipboard-grid"><article v-for="item in visibleItems" :id="`clipboard-${item.id}`" :key="item.id" v-memo="[item.id, item.kind, item.pinned, item.capturedAt, item.contentLoaded, copyingId === item.id, Boolean(archivingId), targetItemId === item.id, selectionMode, selectedIds.has(item.id)]" tabindex="0" class="clipboard-card panel" :class="{ snippet: item.pinned, targeted: targetItemId === item.id, selectable: selectionMode, selected: selectedIds.has(item.id) }" :aria-label="`${selectedIds.has(item.id) ? '已选择，' : ''}${item.pinned ? '常用片段' : item.kind === 'image' ? '图片' : item.kind === 'code' ? '代码' : '文本'}，${formatTime(item.capturedAt)}。右键或 Shift 加 F10 打开操作。`" aria-haspopup="menu" :aria-expanded="cardMenu?.item.id === item.id" @click="selectionMode && toggleSelected(item.id)" @contextmenu.prevent.stop="openCardMenu($event, item)" @keydown="handleCardKeydown($event, item)"><header><button v-if="selectionMode" type="button" class="clipboard-select-toggle" :class="{ checked: selectedIds.has(item.id) }" :aria-pressed="selectedIds.has(item.id)" :aria-label="selectedIds.has(item.id) ? '取消选择这条记录' : '选择这条记录'" @click.stop="toggleSelected(item.id)"><AppIcon name="check" :size="13"/></button><span :class="item.kind">{{ item.pinned ? '常用片段' : item.kind === 'image' ? '图片' : item.kind === 'code' ? '代码' : '文本' }}</span><time>{{ formatTime(item.capturedAt) }}</time><button type="button" :class="{ pinned: item.pinned }" :title="item.pinned ? '移出常用片段' : '固定为常用片段'" @click.stop="store.toggleClipboardPin(item.id)"><AppIcon name="clipboard" :size="14"/></button></header><ClipboardImagePreview v-if="item.kind === 'image'" :asset-path="item.assetPath" :preview="item.preview" alt="剪贴板图片预览"/><template v-else><pre>{{ item.content }}</pre><p v-if="item.contentLoaded === false" class="clipboard-preview-hint">为保持流畅，仅显示前 12,000 个字符；复制时会读取完整内容。</p></template><footer><button type="button" class="primary-button" :disabled="Boolean(copyingId || archivingId)" @click.stop="copy(item.id)">{{ copyingId === item.id ? '复制中…' : '复制' }}</button><button v-if="item.kind === 'image'" type="button" class="quiet-button" :disabled="!desktop || !item.assetPath || Boolean(archivingId)" @click.stop="recognizeImageFromClipboard(item.id)">识别文字</button><button type="button" class="quiet-button danger" :disabled="Boolean(copyingId || archivingId)" @click.stop="remove(item.id)">删除</button></footer></article></section>
      <button v-if="hasMoreItems" type="button" class="clipboard-load-more quiet-button" @click="visibleLimit += CLIPBOARD_PAGE_SIZE">再显示 {{ Math.min(CLIPBOARD_PAGE_SIZE, items.length - visibleItems.length) }} 条</button>
    </template>
    <EmptyState v-else-if="store.clipboardItems.length && hasActiveFilters" icon="search" title="当前筛选没有匹配内容" description="历史记录仍在本机；可以清除搜索或回到全部类型。" action="清除筛选" @action="clearFilters"/>
    <EmptyState v-else icon="file-text" :title="filter === 'snippets' ? '还没有常用片段' : '剪贴板历史还是空的'" :description="filter === 'snippets' ? '保存常用回复、地址或代码，以后点击一次就能复制。' : '复制一段文字、代码或图片，然后读取当前内容。'" :action="filter === 'snippets' ? '新建片段' : '读取当前剪贴板'" @action="filter === 'snippets' ? openSnippetComposer() : capture()"/>
    <Teleport to="body">
      <section v-if="cardMenu" ref="cardMenuElement" class="clipboard-context-menu" role="menu" :aria-label="`${cardMenu.item.kind === 'image' ? '图片' : cardMenu.item.kind === 'code' ? '代码' : '文本'}剪贴板操作`" :style="{ left: `${cardMenu.x}px`, top: `${cardMenu.y}px` }" @click.stop @contextmenu.prevent @keydown.stop="handleCardMenuKeydown">
        <p>{{ cardMenu.item.pinned ? '常用片段' : cardMenu.item.kind === 'image' ? '图片记录' : cardMenu.item.kind === 'code' ? '代码记录' : '文本记录' }}</p>
        <button type="button" role="menuitem" @click="runCardMenuAction('select')"><AppIcon name="task" :size="14" />{{ selectedIds.has(cardMenu.item.id) ? '取消选择这条记录' : '选择这条记录' }}</button>
        <button type="button" role="menuitem" :disabled="Boolean(copyingId || archivingId)" @click="runCardMenuAction('copy')"><AppIcon name="duplicate" :size="14" />{{ copyingId === cardMenu.item.id ? '正在复制…' : '重新复制到系统剪贴板' }}</button>
        <button v-if="cardMenu.item.kind === 'code'" type="button" role="menuitem" @click="runCardMenuAction('code-image')"><AppIcon name="terminal" :size="14" />制作代码分享图</button>
        <button v-if="cardMenu.item.kind === 'image'" type="button" role="menuitem" :disabled="!desktop || !cardMenu.item.assetPath" @click="runCardMenuAction('ocr')"><AppIcon name="file-text" :size="14" />离线识别图片文字</button>
        <button v-if="cardMenu.item.kind === 'image'" type="button" role="menuitem" :disabled="!desktop || !cardMenu.item.assetPath || Boolean(archivingId)" @click="runCardMenuAction('archive-image')"><AppIcon name="inbox" :size="14" />{{ archivingId === cardMenu.item.id ? '正在归档…' : '归档图片到资料库' }}</button>
        <button type="button" role="menuitem" :disabled="cardMenu.item.kind === 'image'" @click="runCardMenuAction('note')"><AppIcon name="book" :size="14" />整理为 Markdown 笔记</button>
        <button type="button" role="menuitem" @click="runCardMenuAction('pin')"><AppIcon name="clipboard" :size="14" />{{ cardMenu.item.pinned ? '移出常用片段' : '固定为常用片段' }}</button>
        <button type="button" role="menuitem" class="danger" :disabled="Boolean(copyingId || archivingId)" @click="runCardMenuAction('remove')"><AppIcon name="close" :size="14" />删除这条记录</button>
      </section>
    </Teleport>
  </div>
</template>

<style scoped>
.snippet-composer{display:grid;grid-template-columns:minmax(220px,.65fr) minmax(360px,1.35fr) auto;align-items:end;gap:18px;margin-bottom:14px;padding:20px}.snippet-composer h3{margin:4px 0;font-size:18px}.snippet-composer p:not(.eyebrow){margin:0;color:var(--muted);font-size:12px}.snippet-composer textarea{min-height:94px;resize:vertical;border:1px solid var(--line);border-radius:12px;padding:13px;background:var(--canvas);color:var(--ink);font:13px/1.55 ui-monospace,SFMono-Regular,Consolas,monospace;outline:none}.snippet-composer textarea:focus{border-color:var(--accent);box-shadow:0 0 0 3px color-mix(in srgb,var(--accent) 12%,transparent)}.snippet-composer>div:last-child{display:flex;gap:8px}.clipboard-card.snippet{border-color:color-mix(in srgb,var(--accent) 34%,var(--line));box-shadow:inset 0 3px 0 color-mix(in srgb,var(--accent) 76%,transparent)}.clipboard-card.targeted{border-color:color-mix(in srgb,var(--accent) 64%,var(--line));box-shadow:0 0 0 3px color-mix(in srgb,var(--accent) 12%,transparent)}.clipboard-preview-hint{margin:-3px 0 10px;color:var(--muted);font-size:11px;line-height:1.45}@media(max-width:900px){.snippet-composer{grid-template-columns:1fr}.snippet-composer>div:last-child{justify-content:flex-end}}
.clipboard-toolbar>.quiet-button{display:inline-flex;align-items:center;gap:5px;white-space:nowrap}.clipboard-toolbar>.quiet-button.active{border-color:var(--accent);color:var(--green-strong);background:var(--green-bg)}
.clipboard-batch-bar{display:flex;align-items:center;gap:7px;margin:-3px 0 12px;padding:10px 12px;border-color:var(--accent-soft);background:linear-gradient(100deg,var(--accent-soft),var(--surface))}.clipboard-batch-bar>span{display:grid;min-width:0;grid-template-columns:auto minmax(0,1fr);align-items:center;gap:2px 8px;margin-right:auto;color:var(--green-strong)}.clipboard-batch-bar>span>.app-icon{grid-row:1/3}.clipboard-batch-bar b{color:var(--text);font:700 11px var(--font-ui)}.clipboard-batch-bar small{overflow:hidden;color:var(--muted);font:9px var(--font-ui);text-overflow:ellipsis;white-space:nowrap}.clipboard-batch-bar button{display:inline-flex;align-items:center;gap:5px;min-height:32px;font-size:9px;white-space:nowrap}.clipboard-batch-bar button.danger{color:var(--danger)!important;border-color:var(--danger-soft)}
.clipboard-card.selectable{cursor:pointer}.clipboard-card.selected{border-color:var(--accent);background:linear-gradient(145deg,var(--surface-2),var(--surface));box-shadow:inset 0 0 0 2px var(--accent-soft),0 8px 22px var(--accent-soft)}.clipboard-card>header>.clipboard-select-toggle{border-color:var(--accent-soft);color:transparent;background:var(--surface-raised)}.clipboard-card>header>.clipboard-select-toggle.checked{border-color:var(--green);color:var(--fg);background:var(--green-strong)}.clipboard-card>header>.clipboard-select-toggle:focus-visible{outline:2px solid color-mix(in srgb,var(--green) 48%,transparent);outline-offset:2px}
@media(max-width:1050px){.clipboard-toolbar{flex-wrap:wrap}.clipboard-toolbar>.search-input{min-width:220px;flex:1 1 100%}.clipboard-batch-bar{align-items:stretch;flex-wrap:wrap}.clipboard-batch-bar>span{flex:1 1 100%}}@media(max-width:720px){.clipboard-batch-bar button{flex:1;justify-content:center}.clipboard-batch-bar small{white-space:normal}}
</style>
