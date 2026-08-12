<script setup lang="ts">
import { computed, defineAsyncComponent, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { onBeforeRouteLeave, onBeforeRouteUpdate, useRoute, useRouter } from 'vue-router'
import type { VocabularyEntry, VocabularyReviewFacet, VocabularySense } from '@/types'
import { useWorkbenchStore } from '@/stores/workbench'
import { useUiStore } from '@/stores/ui'
import { cloneVocabularyEntry } from '@/lib/vocabulary'
import { vocabularyToMarkdown } from '@/lib/vocabulary-markdown'
import { matchesVocabularySearch } from '@/lib/vocabulary-search'
import { vocabularyKnowledgeAction } from '@/lib/knowledge-workflows'
import { newId } from '@/lib/id'
import { clampMenuPosition, isContextMenuShortcut, nextMenuItemIndex } from '@/lib/desktop-menu'
import { createVocabularyReviewState, vocabularyReviewCards, vocabularyReviewFacetLabels, vocabularyReviewForFacet, withVocabularyReviewFacet } from '@/lib/vocabulary-review'
import AppIcon from '@/components/AppIcon.vue'
import UnsavedChangesDialog from '@/components/UnsavedChangesDialog.vue'
import EditorRecoveryBanner from '@/components/EditorRecoveryBanner.vue'
import { allowDocumentTransition, type UnsavedDocumentDecision } from '@/lib/document-transition'
import { deleteEditorCrashDraft, editorCrashDraftDelay, getEditorCrashDraft, parseUsableEditorCrashDraft, saveEditorCrashDraft, type EditorCrashDraftSaveState } from '@/lib/editor-crash-draft'
import type { DesktopEditorCrashDraft } from '@/lib/native'
import { useVocabularySpeech } from '@/lib/use-vocabulary-speech'

const VocabularyImportDialog = defineAsyncComponent(() => import('@/components/VocabularyImportDialog.vue'))

const store = useWorkbenchStore()
const ui = useUiStore()
const route = useRoute()
const router = useRouter()
const query = ref('')
const appliedQuery = ref('')
const importDialogOpen = ref(route.query.import === '1')
const selectedId = ref(typeof route.query.word === 'string' ? route.query.word : store.vocabulary[0]?.id ?? '')
const draft = ref<VocabularyEntry | null>(null)
const draftDirty = ref(false)
let replacingDraft = false
const saved = ref(false)
const crashDraft = ref<DesktopEditorCrashDraft>()
const crashDraftState = ref<EditorCrashDraftSaveState>('idle')
const crashDraftBusy = ref(false)
let crashDraftTimer: number | undefined
let crashDraftRevision = 0
const unsavedPrompt = ref<{ targetLabel: string } | null>(null)
let unsavedResolver: ((decision: UnsavedDocumentDecision) => void) | undefined
const menu = ref<{ entry: VocabularyEntry; x: number; y: number } | null>(null)
const menuElement = ref<HTMLElement>()
const listViewport = ref<HTMLElement>()
const listScrollTop = ref(0)
const listViewportHeight = ref(0)
let menuTrigger: HTMLElement | undefined
let searchTimer: number | undefined
let listFrame: number | undefined
let listResizeObserver: ResizeObserver | undefined
const vocabularyRowHeight = 60
const vocabularyListOverscan = 8
const reviewFacetChoices: VocabularyReviewFacet[] = ['meaning', 'spelling', 'example']
const { speakingEntryId, speakVocabularyEntry: speakVocabulary, disposeVocabularySpeech } = useVocabularySpeech()

const words = computed(() => {
  const needle = appliedQuery.value.trim().toLocaleLowerCase('zh-CN')
  if (!needle) return store.vocabulary
  return store.vocabulary.filter((entry) => matchesVocabularySearch(entry, needle))
})
const hasVocabulary = computed(() => store.vocabulary.length > 0)
const searchPending = computed(() => query.value.trim() !== appliedQuery.value.trim())
const vocabularyWindowStart = computed(() => Math.max(0, Math.floor(listScrollTop.value / vocabularyRowHeight) - vocabularyListOverscan))
const vocabularyWindowEnd = computed(() => Math.min(words.value.length, Math.ceil((listScrollTop.value + listViewportHeight.value) / vocabularyRowHeight) + vocabularyListOverscan))
const visibleWords = computed(() => words.value.slice(vocabularyWindowStart.value, vocabularyWindowEnd.value))
const vocabularyWindowOffset = computed(() => vocabularyWindowStart.value * vocabularyRowHeight)
const selected = computed(() => store.vocabulary.find((entry) => entry.id === selectedId.value))
const dueCount = computed(() => draft.value?.senses.flatMap((sense) => vocabularyReviewCards(sense)).filter(({ review }) => new Date(review.due) <= new Date()).length ?? 0)

function replaceDraft(entry: VocabularyEntry | null, dirty = false) {
  replacingDraft = true
  draft.value = entry ? cloneVocabularyEntry(entry) : null
  draftDirty.value = Boolean(entry && dirty)
  replacingDraft = false
}

function markDraftDirty() {
  if (replacingDraft || !draft.value) return
  draftDirty.value = true
  scheduleCrashDraft()
}
watch([draftDirty, () => draft.value?.lemma ?? ''], ([dirty, title]) => {
  window.dispatchEvent(new CustomEvent('knitspace:editor-dirty', { detail: { dirty, id: draft.value?.id, title, kindLabel: '单词', discardRecovery: clearCurrentRecovery } }))
})
watch(selected, (entry) => {
  replaceDraft(entry ?? null)
  void loadCrashDraft(entry ?? null)
}, { immediate: true })
watch(selectedId, (id) => {
  if (store.vocabulary.some((entry) => entry.id === id)) store.touchContentRecent('word', id)
}, { immediate: true })
watch(() => route.query.word, (id) => { if (typeof id === 'string' && store.vocabulary.some((entry) => entry.id === id)) selectedId.value = id }, { immediate: true })
watch(() => route.query.import, (value) => { if (value === '1') void openBatchImport() })
watch(() => route.query.action, async (action) => {
  if (!vocabularyKnowledgeAction(action)) return
  const { action: _action, ...query } = route.query
  await router.replace({ path: '/words', query })
  await addWord()
}, { immediate: true })
watch(words, (visible) => { if (!draftDirty.value && !visible.some((entry) => entry.id === selectedId.value)) selectedId.value = visible[0]?.id ?? '' }, { immediate: true })
watch(query, (value) => {
  window.clearTimeout(searchTimer)
  searchTimer = window.setTimeout(() => { appliedQuery.value = value }, 140)
})
watch(selectedId, (id) => {
  const rowIndex = words.value.findIndex((entry) => entry.id === id)
  const viewport = listViewport.value
  if (rowIndex < 0 || !viewport) return
  const rowTop = rowIndex * vocabularyRowHeight
  const rowBottom = rowTop + vocabularyRowHeight
  if (rowTop >= viewport.scrollTop && rowBottom <= viewport.scrollTop + viewport.clientHeight) return
  const nextTop = Math.max(0, rowTop - Math.max(0, (viewport.clientHeight - vocabularyRowHeight) / 2))
  viewport.scrollTop = nextTop
  listScrollTop.value = nextTop
})

function askUnsavedDecision(targetLabel: string) {
  if (unsavedResolver) unsavedResolver('stay')
  unsavedPrompt.value = { targetLabel }
  return new Promise<UnsavedDocumentDecision>((resolve) => { unsavedResolver = resolve })
}
function resolveUnsavedDecision(decision: UnsavedDocumentDecision) {
  const resolve = unsavedResolver
  unsavedResolver = undefined
  unsavedPrompt.value = null
  resolve?.(decision)
}
async function confirmEntryTransition(targetLabel: string) {
  let discarded = false
  const allowed = await allowDocumentTransition(draftDirty.value, async () => {
    const decision = await askUnsavedDecision(targetLabel)
    discarded = decision === 'discard'
    return decision
  }, save)
  if (allowed && discarded) {
    await clearCurrentRecovery()
    draftDirty.value = false
  }
  return allowed
}

async function loadCrashDraft(entry: VocabularyEntry | null) {
  const revision = ++crashDraftRevision
  window.clearTimeout(crashDraftTimer)
  crashDraft.value = undefined
  crashDraftState.value = 'idle'
  if (!entry) return
  try {
    const record = await getEditorCrashDraft('vocabulary', entry.id)
    if (revision !== crashDraftRevision || selectedId.value !== entry.id) return
    if (parseUsableEditorCrashDraft(record, entry, 'vocabulary')) crashDraft.value = record ?? undefined
    else if (record) await deleteEditorCrashDraft('vocabulary', entry.id)
  } catch {
    if (revision === crashDraftRevision) crashDraftState.value = 'error'
  }
}
function scheduleCrashDraft() {
  window.clearTimeout(crashDraftTimer)
  const current = draft.value
  if (!current || !draftDirty.value) return
  const id = current.id
  crashDraft.value = undefined
  crashDraftState.value = 'pending'
  crashDraftTimer = window.setTimeout(async () => {
    if (!draft.value || draft.value.id !== id || !draftDirty.value) return
    try {
      await saveEditorCrashDraft('vocabulary', cloneVocabularyEntry(draft.value))
      if (draft.value?.id === id && draftDirty.value) {
        crashDraftState.value = 'saved'
      }
    } catch (error) {
      crashDraftState.value = error instanceof RangeError ? 'oversize' : 'error'
    }
  }, editorCrashDraftDelay(16 * 1024))
}
async function clearCurrentRecovery() {
  window.clearTimeout(crashDraftTimer)
  const id = draft.value?.id ?? selectedId.value
  crashDraft.value = undefined
  crashDraftState.value = 'idle'
  if (id) await deleteEditorCrashDraft('vocabulary', id).catch(() => undefined)
}
async function restoreCrashDraft() {
  const current = selected.value
  const record = crashDraft.value
  if (!current || !record) return
  crashDraftBusy.value = true
  const recovered = parseUsableEditorCrashDraft(record, current, 'vocabulary')
  if (recovered) {
    replaceDraft(recovered, true)
    crashDraft.value = undefined
    crashDraftState.value = 'saved'
    scheduleCrashDraft()
    ui.toast('已恢复未完成单词', '内容仍是未保存修改；确认后请按 Ctrl+S。', 'success')
  }
  crashDraftBusy.value = false
}
async function discardCrashDraft() {
  crashDraftBusy.value = true
  await clearCurrentRecovery()
  crashDraftBusy.value = false
}
async function pick(entry: VocabularyEntry) {
  if (selectedId.value === entry.id) return true
  if (!await confirmEntryTransition(`打开“${entry.lemma || '未命名单词'}”`)) return false
  selectedId.value = entry.id
  saved.value = false
  await router.replace({ path: '/words', query: { word: entry.id } })
  return true
}
function routeChangesEntry(to: { path: string; query: Record<string, unknown> }) {
  if (to.path !== route.path) return true
  if (to.query.import === '1' && route.query.import !== '1') return true
  if (to.query.action === 'create' && route.query.action !== 'create') return true
  const targetId = typeof to.query.word === 'string' ? to.query.word : ''
  return Boolean(targetId && targetId !== selectedId.value)
}
onBeforeRouteLeave(() => confirmEntryTransition('离开单词库'))
onBeforeRouteUpdate((to) => routeChangesEntry(to) ? confirmEntryTransition(to.query.import === '1' ? '批量导入单词' : '打开其他单词') : true)
function clearSearch() { window.clearTimeout(searchTimer); query.value = ''; appliedQuery.value = '' }
function syncListViewport() { if (listViewport.value) listViewportHeight.value = listViewport.value.clientHeight }
function handleListScroll() {
  if (listFrame) return
  listFrame = window.requestAnimationFrame(() => {
    listScrollTop.value = listViewport.value?.scrollTop ?? 0
    listFrame = undefined
  })
}
function flashSaved() { saved.value = true; window.setTimeout(() => saved.value = false, 1500) }
async function addWord() {
  if (!await confirmEntryTransition('新建单词')) return
  const entry = store.createVocabularyEntry()
  await pick(entry)
  ui.toast('已新建单词卡', '先补充词义，再决定是否加入复习。', 'success')
}
async function openBatchImport() {
  if (importDialogOpen.value) return
  if (!await confirmEntryTransition('批量导入单词')) return
  importDialogOpen.value = true
}
async function closeBatchImport() {
  importDialogOpen.value = false
  if (route.query.import === '1') await router.replace({ path: '/words', query: selectedId.value ? { word: selectedId.value } : {} })
}
async function completeBatchImport(summary: { imported: number; updated: number; skipped: number; reviewCards: number; firstId?: string }) {
  await closeBatchImport()
  if (summary.firstId) {
    const entry = store.vocabulary.find(item => item.id === summary.firstId)
    if (entry) await pick(entry)
  }
  ui.toast('词表已写入本地 Vault', `${summary.imported} 个新增 · ${summary.updated} 个合并${summary.reviewCards ? ` · ${summary.reviewCards} 张复习卡` : ''}${summary.skipped ? ` · ${summary.skipped} 行跳过` : ''}`, 'success')
}
function addSense() {
  if (!draft.value) return
  draft.value.senses.push({ id: newId(), partOfSpeech: '', definition: '', examples: [], collocations: [], synonyms: [], reviewEnabled: false })
  markDraftDirty()
}
function reviewFacetEnabled(sense: VocabularySense, facet: VocabularyReviewFacet) {
  return Boolean(vocabularyReviewForFacet(sense, facet))
}
function toggleReviewFacet(sense: VocabularySense, facet: VocabularyReviewFacet) {
  const existing = vocabularyReviewForFacet(sense, facet)
  if (existing) {
    Object.assign(sense, withVocabularyReviewFacet(sense, facet))
    return
  }
  if (!sense.definition.trim()) {
    ui.toast('先写下词义，再加入复习。', undefined, 'info')
    return
  }
  if (facet === 'example' && !sense.examples.some((example) => example.trim())) {
    ui.toast('例句填空卡需要至少一条例句。', undefined, 'info')
    return
  }
  Object.assign(sense, withVocabularyReviewFacet(sense, facet, createVocabularyReviewState()))
}
function removeSense(id: string) {
  if (!draft.value || draft.value.senses.length === 1) { ui.toast('至少保留一个词义。', undefined, 'info'); return }
  draft.value.senses = draft.value.senses.filter((sense) => sense.id !== id)
  markDraftDirty()
}
function setList(sense: VocabularySense, key: 'examples' | 'collocations' | 'synonyms', value: string) { sense[key] = value.split(/[；;\n]/).map((item) => item.trim()).filter(Boolean) }
async function save(): Promise<boolean> {
  if (!draft.value) return false
  if (!draft.value.lemma.trim()) { ui.toast('请先填写单词。', undefined, 'error'); return false }
  const next = cloneVocabularyEntry(draft.value)
  store.saveVocabularyEntry(next)
  replaceDraft(next)
  await clearCurrentRecovery()
  flashSaved()
  return true
}
async function removeEntry(entry: VocabularyEntry) {
  if (!await ui.confirm({ title: `删除“${entry.lemma}”？`, message: '会删除它的全部词义和复习记录，但不会影响其他笔记。', danger: true, confirmLabel: '删除单词' })) return
  if (selectedId.value === entry.id) { await clearCurrentRecovery(); draftDirty.value = false }
  store.deleteVocabularyEntry(entry.id)
  if (selectedId.value === entry.id) selectedId.value = store.vocabulary[0]?.id ?? ''
  ui.toast('已删除单词', undefined, 'success')
}
async function copyEntryAsMarkdown(entry: VocabularyEntry) {
  try {
    await navigator.clipboard.writeText(vocabularyToMarkdown(entry))
    ui.toast('已复制为 Markdown', '包含词形、词义、搭配、例句和易混词。', 'success')
  } catch (error) {
    ui.toast('无法写入剪贴板', error instanceof Error ? error.message : '请检查系统剪贴板权限。', 'error')
  } finally {
    closeMenu()
  }
}
function entryCollocations(entry: VocabularyEntry) {
  const source = entry.id === selectedId.value && draft.value ? draft.value : entry
  return [...new Set(source.senses.flatMap(sense => sense.collocations).map(item => item.trim()).filter(Boolean))]
}
function currentVocabularyEntry(entry: VocabularyEntry) {
  return entry.id === selectedId.value && draft.value ? draft.value : entry
}
function speakVocabularyEntry(entry: VocabularyEntry) {
  const source = currentVocabularyEntry(entry)
  closeMenu()
  speakVocabulary(source)
}
async function copyEntryCollocations(entry: VocabularyEntry) {
  const collocations = entryCollocations(entry)
  if (!collocations.length) return
  try {
    await navigator.clipboard.writeText(collocations.join('\n'))
    ui.toast('已复制常用搭配', `${collocations.length} 条搭配已写入剪贴板。`, 'success')
  } catch (error) {
    ui.toast('无法写入剪贴板', error instanceof Error ? error.message : '请检查系统剪贴板权限。', 'error')
  } finally {
    closeMenu()
  }
}
async function createEntryNote(entry: VocabularyEntry) {
  if (selectedId.value === entry.id && !await confirmEntryTransition('创建关联笔记')) return
  const source = store.vocabulary.find((item) => item.id === entry.id) ?? entry
  const lemma = source.lemma.trim() || '未命名词条'
  const note = store.createNote(`单词：${lemma}`, undefined, vocabularyToMarkdown(source))
  store.createRelation(source.id, note.id, 'related')
  closeMenu()
  router.push({ path: '/documents', query: { kind: 'note', document: note.id, mode: 'edit' } })
  ui.toast('已创建关联笔记', `“${lemma}”与新 Markdown 笔记已建立关联。`, 'success')
}
async function toggleEntryFavorite(entry: VocabularyEntry) {
  try {
    const favorite = await store.toggleContentFavorite('word', entry.id)
    ui.toast(favorite ? '已收藏单词' : '已取消收藏', favorite ? '可从知识库、今天或 Ctrl K 快速返回。' : '词条本身没有被删除。', 'success')
  } catch (error) {
    ui.toast('收藏状态没有保存', error instanceof Error ? error.message : '本地资料库暂时没有响应。', 'error')
  } finally {
    closeMenu()
  }
}
async function removeEntryFromRecents(entry: VocabularyEntry) {
  try {
    await store.removeFromContentRecents('word', entry.id)
    ui.toast('已从最近使用移除', '单词本身没有被删除。', 'success')
  } catch (error) {
    ui.toast('最近使用没有更新', error instanceof Error ? error.message : '本地资料库暂时没有响应。', 'error')
  } finally {
    closeMenu()
  }
}
function showMenu(entry: VocabularyEntry, x: number, y: number, trigger: HTMLElement) {
  menuTrigger = trigger
  const dirtyActionHeight = entry.id === selectedId.value && draftDirty.value ? 39 : 0
  const recoveryActionHeight = entry.id === selectedId.value && crashDraft.value ? 78 : 0
  const collocationActionHeight = entryCollocations(entry).length ? 39 : 0
  const speechActionHeight = 39
  menu.value = { entry, ...clampMenuPosition(x, y, { menuWidth: 230, menuHeight: (store.isContentRecent('word', entry.id) ? 324 : 288) + dirtyActionHeight + recoveryActionHeight + collocationActionHeight + speechActionHeight, margin: 12 }) }
  void nextTick(() => menuElement.value?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus())
}
function openMenu(event: MouseEvent, entry: VocabularyEntry) { showMenu(entry, event.clientX, event.clientY, event.currentTarget as HTMLElement) }
function openMenuFromKeyboard(entry: VocabularyEntry, trigger: HTMLElement) {
  const bounds = trigger.getBoundingClientRect()
  showMenu(entry, bounds.left + 24, bounds.top + 32, trigger)
}
function closeMenu() { menu.value = null }
async function openEntryFromMenu(entry: VocabularyEntry) { if (await pick(entry)) closeMenu() }
async function saveEntryFromMenu() { closeMenu(); await save() }
function handleEntryKeydown(event: KeyboardEvent, entry: VocabularyEntry) {
  if (!isContextMenuShortcut(event)) return
  event.preventDefault()
  openMenuFromKeyboard(entry, event.currentTarget as HTMLElement)
}
function handleMenuKeydown(event: KeyboardEvent) {
  const currentMenu = menuElement.value
  if (!currentMenu) return
  const items = [...currentMenu.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')]
  if (event.key === 'Escape') { event.preventDefault(); closeMenu(); menuTrigger?.focus(); return }
  const nextIndex = nextMenuItemIndex(event.key, items.indexOf(document.activeElement as HTMLButtonElement), items.length)
  if (nextIndex === undefined) return
  event.preventDefault()
  items[nextIndex]?.focus()
}
function shortcut(event: KeyboardEvent) { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); save() } }
function handleBeforeUnload(event: BeforeUnloadEvent) { if (draftDirty.value) { event.preventDefault(); event.returnValue = '' } }
onMounted(() => {
  window.addEventListener('keydown', shortcut)
  window.addEventListener('beforeunload', handleBeforeUnload)
  syncListViewport()
  if (listViewport.value) {
    listResizeObserver = new ResizeObserver(syncListViewport)
    listResizeObserver.observe(listViewport.value)
  }
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', shortcut)
  window.removeEventListener('beforeunload', handleBeforeUnload)
  window.dispatchEvent(new CustomEvent('knitspace:editor-dirty', { detail: { dirty: false } }))
  if (unsavedResolver) resolveUnsavedDecision('stay')
  window.clearTimeout(searchTimer)
  window.clearTimeout(crashDraftTimer)
  if (listFrame) window.cancelAnimationFrame(listFrame)
  listResizeObserver?.disconnect()
  disposeVocabularySpeech()
})
</script>

<template>
  <div class="vocabulary page-enter" @click="closeMenu">
    <aside class="vocabulary-list panel">
      <header><div><p class="eyebrow">词汇</p><h2>单词库</h2><span>{{ words.length }} 个词条{{ searchPending ? ' · 正在筛选' : '' }}</span></div><div class="vocabulary-list__actions"><button class="quiet-button" title="从 CSV、TSV 或文本批量导入" @click.stop="openBatchImport"><AppIcon name="inbox" :size="13" />批量</button><button class="icon-button" title="新建单词" @click.stop="addWord">＋</button></div></header>
      <label class="vocabulary-search"><span class="visually-hidden">搜索单词</span><input v-model="query" placeholder="词形、词义、例句…" /></label>
      <div ref="listViewport" class="vocabulary-list__rows" :aria-busy="searchPending" @scroll.passive="handleListScroll">
        <div v-if="words.length" class="vocabulary-list__spacer" :style="{ height: `${words.length * vocabularyRowHeight}px` }">
          <div class="vocabulary-list__window" :style="{ transform: `translateY(${vocabularyWindowOffset}px)` }">
            <button v-for="entry in visibleWords" :key="entry.id" v-memo="[entry.id, entry.lemma, entry.updatedAt, entry.id === selectedId, entry.id === selectedId && draftDirty, store.isContentFavorite('word', entry.id)]" class="vocabulary-row" :class="{ selected: entry.id === selectedId, dirty: entry.id === selectedId && draftDirty }" @click="pick(entry)" @contextmenu.prevent.stop="openMenu($event, entry)" @keydown="handleEntryKeydown($event, entry)">
              <span><b>{{ entry.lemma }}</b><small>{{ entry.pronunciation || entry.language }}</small></span><i><span v-if="entry.id === selectedId && draftDirty" class="vocabulary-row__dirty">未保存</span><template v-else><AppIcon v-if="store.isContentFavorite('word', entry.id)" name="star" :size="10" />{{ entry.senses.length }} 义</template></i>
            </button>
          </div>
        </div>
        <div v-if="!words.length" class="vocabulary-empty" :class="{ 'vocabulary-empty--quiet': !hasVocabulary && !query.trim() }">
          <template v-if="hasVocabulary || query.trim()"><b>没有匹配的单词</b><p>试试词形、词义或例句中的关键词。</p><button class="quiet-button" @click="clearSearch">清除搜索</button></template>
          <template v-else><AppIcon name="book" :size="20" /><b>词条会在这里出现</b><p>可以逐个录入，也可以批量粘贴现有词表。</p><button class="quiet-button" @click="openBatchImport">批量导入</button></template>
        </div>
      </div>
      <footer><span>右键或 Shift+F10 管理词条</span><div><button class="quiet-button" @click="openBatchImport">批量导入</button><button class="quiet-button" @click="addWord">＋ 新建</button></div></footer>
    </aside>

    <section v-if="draft" class="vocabulary-editor panel" @input="markDraftDirty" @change="markDraftDirty">
      <header class="vocabulary-editor__header">
        <div><p class="eyebrow">结构化词条</p><input v-model="draft.lemma" aria-label="单词" class="vocabulary-lemma" placeholder="run" /><div class="vocabulary-meta"><input v-model="draft.pronunciation" aria-label="音标或读音" placeholder="/rʌn/" /><select v-model="draft.language" aria-label="语言"><option>英语</option><option>日语</option><option>其他</option></select><button type="button" class="vocabulary-speak-button" :class="{ active: speakingEntryId === draft.id }" :aria-pressed="speakingEntryId === draft.id" :aria-label="speakingEntryId === draft.id ? `停止朗读 ${draft.lemma || '当前单词'}` : `朗读 ${draft.lemma || '当前单词'}`" @click.stop="speakVocabularyEntry(draft)"><AppIcon :name="speakingEntryId === draft.id ? 'pause' : 'play'" :size="13" />{{ speakingEntryId === draft.id ? '停止' : '朗读' }}</button></div></div>
        <div class="vocabulary-editor__actions"><span class="save-state" :class="{ 'is-dirty': draftDirty }" role="status" aria-live="polite"><i></i>{{ draftDirty ? crashDraftState === 'saved' ? '未保存 · 已留恢复点' : '未保存修改' : saved ? '已保存 · 本地' : '已同步 · 本地' }}</span><button class="primary-button" @click="save">保存 <kbd>Ctrl S</kbd></button><button class="more-button" aria-label="更多单词操作" @click.stop="openMenu($event, draft)">•••</button></div>
      </header>
      <EditorRecoveryBanner v-if="crashDraft" :saved-at="crashDraft.savedAt" item-kind="单词" :busy="crashDraftBusy" @restore="restoreCrashDraft" @discard="discardCrashDraft" />
      <section class="word-forms"><header><span>词形</span><small>用于查找和复习时提示</small></header><div><label><span>原形</span><input v-model="draft.forms.base" placeholder="run" /></label><label><span>过去式</span><input v-model="draft.forms.past" placeholder="ran" /></label><label><span>过去分词</span><input v-model="draft.forms.participle" placeholder="run" /></label><label><span>现在分词</span><input v-model="draft.forms.presentParticiple" placeholder="running" /></label></div></section>
      <section class="sense-section"><header><div><p class="eyebrow">义项</p><h3>词义与卡片</h3><small>每个复习方向独立安排 FSRS{{ dueCount ? ` · ${dueCount} 张已到期` : '' }}</small></div><button class="quiet-button" @click="addSense">＋ 添加词义</button></header>
        <article v-for="(sense, index) in draft.senses" :key="sense.id" class="sense-card"><header><span>0{{ index + 1 }}</span><div><select v-model="sense.partOfSpeech" :aria-label="`词义 ${index + 1} 词性`"><option value="">词性</option><option>noun</option><option>verb</option><option>adjective</option><option>adverb</option><option>phrase</option><option>other</option></select></div><button class="icon-button" :disabled="draft.senses.length === 1" :aria-label="`删除词义 ${index + 1}`" @click="removeSense(sense.id)">×</button></header><textarea v-model="sense.definition" :aria-label="`词义 ${index + 1} 释义`" placeholder="用自己的话写下这个词义…" /><div class="sense-fields"><label><span>例句</span><input :value="sense.examples.join('；')" placeholder="每条例句用；分隔" @input="setList(sense, 'examples', ($event.target as HTMLInputElement).value)" /></label><label><span>常用搭配</span><input :value="sense.collocations.join('；')" placeholder="run a program；run out of" @input="setList(sense, 'collocations', ($event.target as HTMLInputElement).value)" /></label><label><span>近义 / 易混</span><input :value="sense.synonyms.join('；')" placeholder="每项用；分隔" @input="setList(sense, 'synonyms', ($event.target as HTMLInputElement).value)" /></label></div><div class="sense-review-facets" :aria-label="`词义 ${index + 1} 的复习方向`"><div><span>复习方向</span><small>各自独立记忆强度</small></div><div class="sense-review-facets__choices"><label v-for="facet in reviewFacetChoices" :key="facet" :class="{ active: reviewFacetEnabled(sense, facet) }"><input type="checkbox" :checked="reviewFacetEnabled(sense, facet)" @change="toggleReviewFacet(sense, facet)" /><span>{{ vocabularyReviewFacetLabels[facet] }}</span></label></div></div></article>
      </section>
    </section>
    <section v-else class="vocabulary-detail-empty panel">
      <div class="vocabulary-detail-empty__content">
        <div class="vocabulary-detail-empty__mark"><AppIcon name="book" :size="23" /></div>
        <p class="eyebrow">本地词库</p>
        <h2>把一个单词，织成多张可复习的卡。</h2>
        <p class="vocabulary-detail-empty__description">词形、不同词性、常用搭配、例句与易混词都归在同一词条下；启用的每条词义会独立安排复习。</p>
        <ol class="vocabulary-onboarding" aria-label="单词卡录入流程">
          <li><span>01</span><div><b>补全词条</b><small>拼写、读音与常用词形</small></div></li>
          <li><span>02</span><div><b>按词性拆义</b><small>记录常用搭配、例句与易混词</small></div></li>
          <li><span>03</span><div><b>加入复习</b><small>只让需要巩固的词义进入队列</small></div></li>
        </ol>
        <div class="vocabulary-detail-empty__actions"><button class="primary-button" @click="addWord"><AppIcon name="plus" :size="15" />录入第一个单词</button><button class="quiet-button" @click="openBatchImport"><AppIcon name="inbox" :size="14" />批量导入词表</button></div>
        <small class="vocabulary-detail-empty__hint">所有内容仅保存到本地 Vault；词条支持右键或 Shift+F10 管理。</small>
      </div>
    </section>
    <section v-if="menu" ref="menuElement" class="vocabulary-context-menu" role="menu" :style="{ left: `${menu.x}px`, top: `${menu.y}px` }" @click.stop @keydown="handleMenuKeydown"><p>{{ menu.entry.lemma }}</p><button v-if="menu.entry.id === selectedId && draftDirty" role="menuitem" @click="saveEntryFromMenu">保存当前修改 <kbd>Ctrl+S</kbd></button><template v-if="menu.entry.id === selectedId && crashDraft"><button role="menuitem" @click="closeMenu(); restoreCrashDraft()">恢复异常退出草稿</button><button role="menuitem" @click="closeMenu(); discardCrashDraft()">放弃恢复点</button></template><button role="menuitem" @click="openEntryFromMenu(menu.entry)">打开词条</button><button role="menuitem" @click="speakVocabularyEntry(menu.entry)">{{ speakingEntryId === menu.entry.id ? '停止朗读' : '朗读单词' }} <kbd>本机</kbd></button><button role="menuitem" @click="toggleEntryFavorite(menu.entry)">{{ store.isContentFavorite('word', menu.entry.id) ? '取消收藏' : '加入收藏' }}</button><button v-if="store.isContentRecent('word', menu.entry.id)" role="menuitem" @click="removeEntryFromRecents(menu.entry)">从最近使用移除</button><button v-if="entryCollocations(menu.entry).length" role="menuitem" @click="copyEntryCollocations(menu.entry)">复制常用搭配</button><button role="menuitem" @click="copyEntryAsMarkdown(menu.entry)">复制为 Markdown</button><button role="menuitem" @click="createEntryNote(menu.entry)">创建关联笔记</button><button class="danger" role="menuitem" @click="removeEntry(menu.entry); closeMenu()">删除单词</button></section>
    <UnsavedChangesDialog v-if="unsavedPrompt" :item-label="draft?.lemma || '未命名单词'" :target-label="unsavedPrompt.targetLabel" item-kind="单词" @decision="resolveUnsavedDecision" />
    <VocabularyImportDialog v-if="importDialogOpen" @cancel="closeBatchImport" @complete="completeBatchImport" />
  </div>
</template>

<style scoped>
.vocabulary-speak-button{display:inline-flex;min-height:30px;flex:0 0 auto;align-items:center;gap:5px;padding:0 9px;border:1px solid var(--accent-soft);border-radius:7px;color:var(--green-strong);background:var(--accent-soft);font:650 11px var(--font-ui);white-space:nowrap;cursor:pointer;transition:color .16s ease,border-color .16s ease,background .16s ease}.vocabulary-speak-button:hover,.vocabulary-speak-button.active{border-color:var(--accent);background:var(--green-bg)}.vocabulary-speak-button:focus-visible{outline:2px solid color-mix(in srgb,var(--green) 48%,transparent);outline-offset:2px}@media (prefers-reduced-motion:reduce){.vocabulary-speak-button{transition:none}}
</style>
