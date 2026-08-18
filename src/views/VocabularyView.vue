<script setup lang="ts">
import { computed, defineAsyncComponent, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { onBeforeRouteLeave, onBeforeRouteUpdate, useRoute, useRouter } from 'vue-router'
import type { VocabularyEntry, VocabularyReviewFacet, VocabularySense } from '@/types'
import { useWorkbenchStore } from '@/stores/workbench'
import { useUiStore } from '@/stores/ui'
import { cloneVocabularyEntry, vocabularySenseCount } from '@/lib/vocabulary'
import { vocabularyToMarkdown } from '@/lib/vocabulary-markdown'
import { matchesVocabularySearch } from '@/lib/vocabulary-search'
import { vocabularyKnowledgeAction } from '@/lib/knowledge-workflows'
import { newId } from '@/lib/id'
import { lookupDictionaryWords, readDictionaryStatus, suggestDictionaryWords } from '@/lib/dictionary-native'
import { blankVocabularyRows, dictionaryRecordToRows } from '@/lib/dictionary-entry'
import { prepareVocabularyImport, vocabularyImportDuplicateIds } from '@/lib/vocabulary-import'
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
const indexedWords = ref<VocabularyEntry[]>([])
const indexedSearchLoading = ref(false)
const indexedSearchError = ref('')
const entryLoading = ref(false)
let indexedSearchRevision = 0
let entryLoadRevision = 0
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

/* Field metadata, so near-identical inputs are one loop instead of hand-written
   labels that drift apart. The set covers what a dictionary actually records:
   an adjective has no past participle, and a verb has no superlative.
   No example placeholders — grey `run` in an empty field reads as data. */
const wordFormFields = [
  { key: 'base', label: '原形' },
  { key: 'past', label: '过去式' },
  { key: 'participle', label: '过去分词' },
  { key: 'presentParticiple', label: '现在分词' },
  { key: 'thirdPerson', label: '三单' },
  { key: 'plural', label: '复数' },
  { key: 'comparative', label: '比较级' },
  { key: 'superlative', label: '最高级' },
] as const
const senseListFields = [
  { key: 'examples', label: '例句', placeholder: '每条例句用；分隔' },
  { key: 'collocations', label: '常用搭配', placeholder: '每项用；分隔' },
  { key: 'synonyms', label: '近义 / 易混', placeholder: '每项用；分隔' },
] as const
const dictionaryReady = ref(false)
const manualOnboardingSteps = [
  { index: '01', title: '补全词条', detail: '拼写、读音与常用词形' },
  { index: '02', title: '按词性拆义', detail: '记录常用搭配、例句与易混词' },
  { index: '03', title: '加入复习', detail: '只让需要巩固的词义进入队列' },
]
const dictionaryOnboardingSteps = [
  { index: '01', title: '输入单词', detail: '一行一个词，回车就行' },
  { index: '02', title: '自动补全', detail: '音标、词性、释义与词形变化' },
  { index: '03', title: '加入复习', detail: '每条词义独立安排 FSRS' },
]
const onboardingSteps = computed(() => dictionaryReady.value ? dictionaryOnboardingSteps : manualOnboardingSteps)
const vocabularyListOverscan = 8
const reviewFacetChoices: VocabularyReviewFacet[] = ['meaning', 'spelling', 'example', 'comparison']
const { speakingEntryId, speakVocabularyEntry: speakVocabulary, disposeVocabularySpeech } = useVocabularySpeech()

const words = computed(() => {
  const needle = appliedQuery.value.trim().toLocaleLowerCase('zh-CN')
  if (!needle) return store.vocabulary
  if (store.desktopVaultActive && !indexedSearchError.value) return indexedWords.value
  return store.vocabulary.filter((entry) => matchesVocabularySearch(entry, needle))
})
const hasVocabulary = computed(() => store.vocabulary.length > 0)
const searchPending = computed(() => query.value.trim() !== appliedQuery.value.trim() || indexedSearchLoading.value)
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
watch(selected, async (entry) => {
  const revision = ++entryLoadRevision
  replaceDraft(null)
  if (!entry) { entryLoading.value = false; return }
  entryLoading.value = Boolean(store.desktopVaultActive && entry.summaryOnly)
  try {
    const loaded = entry.summaryOnly ? await store.loadVocabulary(entry.id) : entry
    if (revision !== entryLoadRevision || selectedId.value !== entry.id) return
    replaceDraft(loaded ?? null)
    void loadCrashDraft(loaded ?? null)
  } catch (error) {
    if (revision === entryLoadRevision) ui.toast('词条没有打开', error instanceof Error ? error.message : '本地资料库暂时没有响应。', 'error')
  } finally {
    if (revision === entryLoadRevision) entryLoading.value = false
  }
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
watch(words, (visible) => {
  if (!searchPending.value && !draftDirty.value && !visible.some((entry) => entry.id === selectedId.value)) selectedId.value = visible[0]?.id ?? ''
}, { immediate: true })
watch(query, (value) => {
  window.clearTimeout(searchTimer)
  searchTimer = window.setTimeout(() => { appliedQuery.value = value }, 140)
})
watch(appliedQuery, async (value) => {
  const needle = value.trim()
  const revision = ++indexedSearchRevision
  indexedWords.value = []
  indexedSearchError.value = ''
  if (!needle || !store.desktopVaultActive) { indexedSearchLoading.value = false; return }
  indexedSearchLoading.value = true
  try {
    const results = await store.searchVocabularyEntries(needle, 160)
    if (revision === indexedSearchRevision) indexedWords.value = results
  } catch (error) {
    if (revision === indexedSearchRevision) indexedSearchError.value = error instanceof Error ? error.message : '本机词库索引暂时不可用。'
  } finally {
    if (revision === indexedSearchRevision) indexedSearchLoading.value = false
  }
}, { immediate: true })
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
const newWord = ref('')
const addingWord = ref(false)
/** A word the dictionary does not have, held back until the reader says what
 * they meant. Typing `abondon` should not quietly become an entry. */
const pendingMiss = ref<{ word: string; suggestions: string[] } | null>(null)

onMounted(async () => {
  try { dictionaryReady.value = (await readDictionaryStatus()).installed }
  catch { dictionaryReady.value = false }
})

/**
 * The whole point of the vocabulary tool: type a word, get an entry. The
 * dictionary fills in pronunciation, senses and inflections, and the existing
 * import pipeline does the storing — merging into an entry that already exists
 * without disturbing a single review date.
 */
/** Writes rows through the import pipeline, which merges into an entry that
 * already exists without disturbing a single review date. */
async function storeVocabularyRows(rows: ReturnType<typeof blankVocabularyRows>) {
  // Desktop list rows omit their senses; read the merge targets in full first.
  if (store.desktopVaultActive) {
    const duplicates = vocabularyImportDuplicateIds(rows, store.vocabulary)
    await Promise.all(duplicates.map((id) => store.loadVocabulary(id)))
  }
  const snapshot = prepareVocabularyImport(rows, store.vocabulary, 'merge', ['meaning'])
  await store.importVocabularyEntries(snapshot.entries)
  newWord.value = ''
  pendingMiss.value = null
  if (snapshot.entries[0]) await pick(snapshot.entries[0])
  return snapshot
}

async function completeWord(input = newWord.value) {
  const word = input.trim()
  if (!word || addingWord.value) return
  addingWord.value = true
  try {
    const records = dictionaryReady.value ? await lookupDictionaryWords([word]) : []
    if (!records.length && dictionaryReady.value) {
      // A missing word is usually a typo, and a vocabulary book full of
      // misspellings is worse than one that asks. Nothing is written yet.
      pendingMiss.value = { word, suggestions: await suggestDictionaryWords(word).catch(() => []) }
      return
    }
    const rows = records.length ? records.flatMap((record) => dictionaryRecordToRows(record)) : blankVocabularyRows(word)
    if (!rows.length) return
    const snapshot = await storeVocabularyRows(rows)
    if (!records.length) {
      // Saying what is missing without offering the fix is how someone ends up
      // typing a word, getting a blank entry, and concluding it is broken.
      ui.toast('已加入生词本，但还没有词库', `「${word}」暂时只有词形。装上离线词库后，输入单词即可补全音标、词性和释义。`, 'info', '去启用词库', () => router.push('/settings?section=dictionary'))
    } else if (snapshot.updatedCount) ui.toast(`已补全「${rows[0].lemma}」`, `合并了 ${snapshot.addedSenseCount} 个新义项，原有复习进度不变。`, 'success')
    else ui.toast(`已收录「${rows[0].lemma}」`, `${snapshot.addedSenseCount} 个义项 · ${snapshot.reviewCardCount} 张复习卡`, 'success')
  } catch (error) {
    ui.toast('没能加入生词本', error instanceof Error ? error.message : '本地资料库没有完成这次写入。', 'error')
  } finally {
    addingWord.value = false
  }
}

/** Keeps the spelling the reader insists on. Some words are simply newer than
 * the dictionary. */
async function addMissingWordAnyway() {
  const word = pendingMiss.value?.word
  if (!word || addingWord.value) return
  addingWord.value = true
  try {
    await storeVocabularyRows(blankVocabularyRows(word))
    ui.toast(`已按你写的收录「${word}」`, '词库里没有这个词，义项留空，随时可以自己补。', 'info')
  } catch (error) {
    ui.toast('没能加入生词本', error instanceof Error ? error.message : '本地资料库没有完成这次写入。', 'error')
  } finally {
    addingWord.value = false
  }
}

function useSuggestedWord(word: string) {
  newWord.value = word
  pendingMiss.value = null
  return completeWord(word)
}

const allWordFormsOpen = ref(false)
/** `big` is not a verb, so offering it a past participle is noise. Show what
 * the word actually has; the full set stays one click away for anything the
 * dictionary did not know. */
const visibleWordFormFields = computed(() => {
  if (allWordFormsOpen.value) return wordFormFields
  const filled = wordFormFields.filter((form) => String(draft.value?.forms?.[form.key] ?? '').trim())
  return filled.length ? filled : []
})

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
  if (facet === 'comparison' && !sense.synonyms.some((synonym) => synonym.trim())) {
    ui.toast('近义 / 易混卡需要至少填写一个相关词。', undefined, 'info')
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
    const complete = entry.summaryOnly ? await store.loadVocabulary(entry.id) : entry
    if (!complete) throw new Error('词条已不存在。')
    await navigator.clipboard.writeText(vocabularyToMarkdown(complete))
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
  const source = await store.loadVocabulary(entry.id) ?? entry
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
  <!-- No `vocabulary*` classes; the scoped block goes with them. This route
       had no PageHeader at all — it is a two-pane workspace, so it gets one
       header line and then gives the rest of the window to the list and the
       entry. -->
  <div class="page-enter h-full page-shell px-8 py-6" @click="closeMenu">
    <div class="flex-1 min-h-0 grid gap-4 grid-cols-[minmax(260px,300px)_minmax(0,1fr)]">
      <aside class="pane h-full min-h-0" aria-label="单词库">
        <header class="pane-head">
          <span class="row gap-2 min-w-0">
            <b class="text-[13px] font-semibold text-fg">单词库</b>
            <span class="chip h-5 px-1.5 text-[11px] tabular-nums">{{ words.length }}</span>
            <small v-if="searchPending" class="text-[11px] text-fg-3">筛选中…</small>
          </span>
          <span class="row gap-0.5 shrink-0">
            <button class="center w-7 h-7 rounded-sm text-fg-3 hover:bg-surface-2 hover:text-fg" title="从 CSV、TSV 或文本批量导入" aria-label="批量导入" @click.stop="openBatchImport">
              <AppIcon name="inbox" :size="15" />
            </button>
            <button class="center w-7 h-7 rounded-sm text-accent hover:bg-accent-soft" title="新建单词" aria-label="新建单词" @click.stop="addWord">
              <AppIcon name="plus" :size="15" />
            </button>
          </span>
        </header>

        <!-- The shortest path there is: a word goes in, an entry comes out.
             Everything else on this page is for the times that is not enough. -->
        <div class="shrink-0 p-2 border-b border-line stack gap-1.5">
          <span class="row gap-1.5">
            <input
              v-model="newWord"
              class="field h-8 min-w-0 flex-1 text-[12px]"
              @input="pendingMiss = null"
              :disabled="addingWord"
              aria-label="加入生词本"
              :placeholder="dictionaryReady ? '输入单词，回车自动补全' : '输入单词，回车加入生词本'"
              @keydown.enter.prevent="completeWord()"
            />
            <button class="btn-primary btn-sm shrink-0" :disabled="!newWord.trim() || addingWord" @click="completeWord()">
              {{ addingWord ? '处理中' : '加入' }}
            </button>
          </span>
          <!-- The dictionary has no such word. Offering the near misses is the
               whole point: a typo caught here never becomes an entry. -->
          <div v-if="pendingMiss" class="stack gap-1.5 p-2 rounded-sm border border-warn bg-warn-soft" role="status" aria-live="polite">
            <p class="text-[11px] leading-snug text-fg-2">词库里没有「<b class="font-medium">{{ pendingMiss.word }}</b>」，还没有录入。</p>
            <p v-if="pendingMiss.suggestions.length" class="text-[11px] text-fg-3">你是不是要找：</p>
            <span v-if="pendingMiss.suggestions.length" class="row flex-wrap gap-1">
              <button
                v-for="suggestion in pendingMiss.suggestions"
                :key="suggestion"
                class="btn-default btn-sm h-6 px-2 text-[11px]"
                :disabled="addingWord"
                @click="useSuggestedWord(suggestion)"
              >{{ suggestion }}</button>
            </span>
            <span class="row gap-2 pt-0.5">
              <button class="btn-tool h-6 px-1.5 text-[11px]" :disabled="addingWord" @click="addMissingWordAnyway">仍然收录这个拼写</button>
              <button class="btn-tool h-6 px-1.5 text-[11px]" :disabled="addingWord" @click="pendingMiss = null">取消</button>
            </span>
          </div>

          <!-- Until a dictionary is installed this box only records the word
               itself, which reads as "nothing happened" unless the missing
               step is stated where the typing happens. -->
          <RouterLink
            v-if="!dictionaryReady"
            class="row items-start gap-2 p-2 rounded-sm border border-accent-ring bg-accent-soft text-[11px] leading-snug text-fg-2 hover:border-accent"
            to="/settings?section=dictionary"
          >
            <AppIcon name="download" :size="14" class="shrink-0 mt-px text-accent" />
            <span class="min-w-0">还没有离线词库，现在只会记下单词本身。<b class="font-medium text-accent">点此启用</b>后，输入一个词就能补全音标、词性和释义。</span>
          </RouterLink>
        </div>

        <div class="shrink-0 p-2 border-b border-line">
          <input v-model="query" class="field h-8 w-full text-[12px]" aria-label="搜索单词" placeholder="词形、词义、例句…" />
        </div>

        <!-- Windowed with a translated inner block, so the row height here is
             `vocabularyRowHeight` and the two have to stay in step. -->
        <div ref="listViewport" class="flex-1 min-h-0 overflow-y-auto" :aria-busy="searchPending" @scroll.passive="handleListScroll">
          <div v-if="words.length" class="relative" :style="{ height: `${words.length * vocabularyRowHeight}px` }">
            <div class="absolute inset-x-0 top-0" :style="{ transform: `translateY(${vocabularyWindowOffset}px)` }">
              <button
                v-for="entry in visibleWords"
                :key="entry.id"
                v-memo="[entry.id, entry.lemma, entry.updatedAt, vocabularySenseCount(entry), entry.id === selectedId, entry.id === selectedId && draftDirty, store.isContentFavorite('word', entry.id)]"
                class="row-between gap-2 w-full h-15 px-3 text-left border-b border-line border-l-2 transition-colors duration-120"
                :class="entry.id === selectedId ? 'border-l-accent bg-accent-soft' : 'border-l-transparent hover:bg-surface-2'"
                @click="pick(entry)"
                @contextmenu.prevent.stop="openMenu($event, entry)"
                @keydown="handleEntryKeydown($event, entry)"
              >
                <span class="stack gap-0.5 min-w-0">
                  <b class="text-[13px] font-medium truncate" :class="entry.id === selectedId ? 'text-accent' : 'text-fg'">{{ entry.lemma }}</b>
                  <small class="text-[11px] truncate font-mono text-fg-3">{{ entry.pronunciation || entry.language }}</small>
                </span>
                <i class="row gap-1 shrink-0 text-[11px] not-italic" :class="entry.id === selectedId && draftDirty ? 'font-medium text-warn' : 'text-fg-3'">
                  <template v-if="entry.id === selectedId && draftDirty">未保存</template>
                  <template v-else>
                    <AppIcon v-if="store.isContentFavorite('word', entry.id)" name="star" :size="11" />{{ vocabularySenseCount(entry) }} 义
                  </template>
                </i>
              </button>
            </div>
          </div>
          <div v-else class="stack items-center gap-2 px-4 py-12 text-center">
            <template v-if="hasVocabulary || query.trim()">
              <b class="text-[12px] font-medium text-fg">没有匹配的单词</b>
              <p class="text-[11px] leading-relaxed text-fg-3">试试词形、词义或例句中的关键词。</p>
              <button class="btn-tool" @click="clearSearch">清除搜索</button>
            </template>
            <template v-else>
              <AppIcon name="book" :size="20" class="text-fg-3" />
              <b class="text-[12px] font-medium text-fg">词条会在这里出现</b>
              <p class="text-[11px] leading-relaxed text-fg-3">可以逐个录入，也可以批量粘贴现有词表。</p>
              <button class="btn-tool" @click="openBatchImport">批量导入</button>
            </template>
          </div>
        </div>

        <footer class="row gap-1.5 shrink-0 p-2 border-t border-line">
          <button class="btn-default btn-sm flex-1" @click="addWord"><AppIcon name="plus" :size="13" />新建</button>
          <button class="btn-default btn-sm shrink-0" @click="openBatchImport"><AppIcon name="inbox" :size="13" />批量导入</button>
        </footer>
      </aside>

      <section v-if="entryLoading" class="pane center h-full min-h-0" role="status" aria-live="polite">
        <span class="row gap-2 text-[12px] text-fg-3"><AppIcon name="refresh" :size="14" class="animate-spin" />正在从本机资料库读取完整词条…</span>
      </section>

      <section v-else-if="draft" class="pane h-full min-h-0" @input="markDraftDirty" @change="markDraftDirty">
        <header class="row-between gap-3 shrink-0 px-3 h-12 border-b border-line">
          <span class="row gap-2 min-w-0 flex-1">
            <input v-model="draft.lemma" class="min-w-0 max-w-56 h-8 bg-transparent border-0 shadow-none! text-[16px] font-semibold text-fg focus:outline-none" aria-label="单词" placeholder="单词" />
            <input v-model="draft.pronunciation" class="field h-7 w-28 px-2 font-mono text-[12px]" aria-label="音标或读音" placeholder="音标" />
            <select v-model="draft.language" class="field h-7 px-2 text-[12px]" aria-label="语言">
              <option>英语</option><option>日语</option><option>其他</option>
            </select>
            <button
              type="button"
              class="btn-tool"
              :class="speakingEntryId === draft.id ? 'btn-tool-active' : ''"
              :aria-pressed="speakingEntryId === draft.id"
              :aria-label="speakingEntryId === draft.id ? `停止朗读 ${draft.lemma || '当前单词'}` : `朗读 ${draft.lemma || '当前单词'}`"
              @click.stop="speakVocabularyEntry(draft)"
            >
              <AppIcon :name="speakingEntryId === draft.id ? 'pause' : 'play'" :size="13" />{{ speakingEntryId === draft.id ? '停止' : '朗读' }}
            </button>
          </span>
          <span class="row gap-2 shrink-0">
            <span class="row gap-1.5 text-[11px]" :class="draftDirty ? 'text-warn' : 'text-fg-3'" role="status" aria-live="polite">
              <i class="w-1.5 h-1.5 rounded-full" :class="draftDirty ? 'bg-warn' : 'bg-success'" aria-hidden="true" />
              {{ draftDirty ? (crashDraftState === 'saved' ? '未保存 · 已留恢复点' : '未保存修改') : saved ? '已保存 · 本地' : '已同步 · 本地' }}
            </span>
            <button class="btn-primary btn-sm" @click="save">保存<kbd class="kbd ml-1">Ctrl S</kbd></button>
            <button class="center w-7 h-7 rounded-sm text-fg-3 hover:bg-surface-2 hover:text-fg" aria-label="更多单词操作" @click.stop="openMenu($event, draft)">
              <AppIcon name="more" :size="15" />
            </button>
          </span>
        </header>

        <EditorRecoveryBanner v-if="crashDraft" :saved-at="crashDraft.savedAt" item-kind="单词" :busy="crashDraftBusy" @restore="restoreCrashDraft" @discard="discardCrashDraft" />

        <div class="flex-1 min-h-0 overflow-y-auto stack gap-3 p-3">
          <section class="stack gap-2">
            <div class="row-between gap-2">
              <h3 class="text-[11px] font-semibold text-fg-3">词形</h3>
              <span class="row gap-2">
                <small class="text-[11px] text-fg-3">用于查找和复习时提示</small>
                <button type="button" class="btn-tool h-6 px-1.5 text-[11px]" @click="allWordFormsOpen = !allWordFormsOpen">
                  {{ allWordFormsOpen ? '只看已有词形' : visibleWordFormFields.length ? '全部词形' : '添加词形' }}
                </button>
              </span>
            </div>
            <div v-if="visibleWordFormFields.length" class="grid grid-cols-2 lg:grid-cols-4 gap-2">
              <label v-for="form in visibleWordFormFields" :key="form.key" class="stack gap-1.5">
                <span class="text-[11px] text-fg-3">{{ form.label }}</span>
                <input v-model="draft.forms[form.key]" class="field h-8 text-[12px]" />
              </label>
            </div>
            <p v-else class="text-[11px] leading-snug text-fg-3">这个词没有记录到词形变化。</p>
          </section>

          <div class="divider" role="presentation" />

          <section class="stack gap-2">
            <div class="row-between gap-2">
              <span class="row gap-2">
                <h3 class="text-[11px] font-semibold text-fg-3">义项</h3>
                <small class="text-[11px] text-fg-3">每个复习方向独立安排 FSRS{{ dueCount ? ` · ${dueCount} 张已到期` : '' }}</small>
              </span>
              <button class="btn-tool" @click="addSense"><AppIcon name="plus" :size="13" />添加词义</button>
            </div>

            <article v-for="(sense, index) in draft.senses" :key="sense.id" class="stack gap-2.5 p-3 rounded-md border border-line bg-well">
              <header class="row gap-2">
                <span class="center w-6 h-6 shrink-0 rounded-sm bg-surface border border-line font-mono text-[11px] tabular-nums text-fg-2">{{ String(index + 1).padStart(2, '0') }}</span>
                <select v-model="sense.partOfSpeech" class="field h-7 px-2 text-[12px]" :aria-label="`词义 ${index + 1} 词性`">
                  <option value="">词性</option>
                  <option>noun</option><option>verb</option><option>adjective</option><option>adverb</option><option>phrase</option><option>other</option>
                  <!-- An imported word can carry a part of speech this list
                       never offered; dropping it from the options would show
                       the sense as having none at all. -->
                  <option v-if="sense.partOfSpeech && !['noun', 'verb', 'adjective', 'adverb', 'phrase', 'other'].includes(sense.partOfSpeech)">{{ sense.partOfSpeech }}</option>
                </select>
                <button
                  class="center w-7 h-7 ml-auto shrink-0 rounded-sm text-fg-3 hover:not-disabled:bg-surface-2 hover:not-disabled:text-danger disabled:opacity-35 disabled:cursor-not-allowed"
                  :disabled="draft.senses.length === 1"
                  :aria-label="`删除词义 ${index + 1}`"
                  @click="removeSense(sense.id)"
                >
                  <AppIcon name="close" :size="14" />
                </button>
              </header>
              <textarea v-model="sense.definition" class="field-area min-h-16 text-[12px]" :aria-label="`词义 ${index + 1} 释义`" placeholder="用自己的话写下这个词义…" />
              <div class="grid grid-cols-1 lg:grid-cols-3 gap-2">
                <label v-for="list in senseListFields" :key="list.key" class="stack gap-1.5">
                  <span class="text-[11px] text-fg-3">{{ list.label }}</span>
                  <input
                    :value="sense[list.key].join('；')"
                    class="field h-8 text-[12px]"
                    :placeholder="list.placeholder"
                    @input="setList(sense, list.key, ($event.target as HTMLInputElement).value)"
                  />
                </label>
              </div>
              <div class="row-between flex-wrap gap-2 pt-2 border-t border-line" :aria-label="`词义 ${index + 1} 的复习方向`">
                <span class="stack gap-0.5">
                  <b class="text-[11px] font-medium text-fg">复习方向</b>
                  <small class="text-[11px] text-fg-3">各自独立记忆强度</small>
                </span>
                <div class="row flex-wrap gap-1.5">
                  <label
                    v-for="facet in reviewFacetChoices"
                    :key="facet"
                    class="row gap-1.5 h-7 px-2.5 rounded-full border text-[11px] cursor-pointer transition-colors duration-120"
                    :class="reviewFacetEnabled(sense, facet) ? 'border-accent bg-accent-soft text-accent' : 'border-line text-fg-2 hover:border-line-strong hover:text-fg'"
                  >
                    <input type="checkbox" class="visually-hidden" :checked="reviewFacetEnabled(sense, facet)" @change="toggleReviewFacet(sense, facet)" />
                    <AppIcon :name="reviewFacetEnabled(sense, facet) ? 'check' : 'plus'" :size="11" />
                    {{ vocabularyReviewFacetLabels[facet] }}
                  </label>
                </div>
              </div>
            </article>
          </section>
        </div>
      </section>

      <section v-else class="pane h-full min-h-0 center">
        <div class="stack items-center gap-4 max-w-140 px-6 text-center">
          <span class="center w-12 h-12 rounded-lg bg-accent-soft text-accent"><AppIcon name="book" :size="24" /></span>
          <div class="stack gap-1.5">
            <strong class="text-[16px] font-semibold text-fg">{{ dictionaryReady ? '输入一个单词，其余交给词库' : '把一个单词，织成多张可复习的卡' }}</strong>
            <p class="text-[12px] leading-relaxed text-fg-3">词形、不同词性、常用搭配、例句与易混词都归在同一词条下；启用的每条词义会独立安排复习。</p>
          </div>

          <!-- Someone arriving here has no way to know a dictionary exists, let
               alone that it has to be downloaded. Saying it once, here, is the
               difference between "type a word" and "type a word and get a
               blank entry". -->
          <div v-if="!dictionaryReady" class="stack gap-2.5 w-full p-4 rounded-md border border-accent-ring bg-accent-soft text-left">
            <span class="row items-start gap-2.5">
              <AppIcon name="download" :size="18" class="shrink-0 mt-0.5 text-accent" />
              <span class="stack gap-1 min-w-0">
                <b class="text-[13px] font-semibold text-fg">先装上离线词库，之后只需要给单词</b>
                <small class="text-[12px] leading-relaxed text-fg-2">
                  装好后输入一个词，音标、词性、释义和过去式/分词等词形都会自动填好，拼错还会提示你要找的是哪个词。
                  词库是 ECDICT（MIT 许可，约 77 万词条），需要下载约 207MB，装完查词全程离线，文件不进资料库也不进备份。
                </small>
              </span>
            </span>
            <span class="row flex-wrap gap-2">
              <RouterLink class="btn-primary btn-sm" to="/settings?section=dictionary"><AppIcon name="download" :size="14" />去启用词库</RouterLink>
              <small class="row items-center text-[11px] text-fg-3">也可以先不装，手动录入或批量导入现有词表。</small>
            </span>
          </div>
          <ol class="grid grid-cols-3 gap-2 w-full" aria-label="单词卡录入流程">
            <li v-for="step in onboardingSteps" :key="step.index" class="stack gap-1 p-3 rounded-sm border border-line bg-well text-left">
              <span class="font-mono text-[11px] font-semibold text-accent">{{ step.index }}</span>
              <b class="text-[12px] font-medium text-fg">{{ step.title }}</b>
              <small class="text-[11px] leading-relaxed text-fg-3">{{ step.detail }}</small>
            </li>
          </ol>
          <div class="row flex-wrap justify-center gap-2">
            <button class="btn-primary" @click="addWord"><AppIcon name="plus" :size="15" />录入第一个单词</button>
            <button class="btn-default" @click="openBatchImport"><AppIcon name="inbox" :size="14" />批量导入词表</button>
          </div>
          <small class="text-[11px] leading-relaxed text-fg-3">所有内容仅保存到本地 Vault；词条支持右键或 Shift+F10 管理。</small>
        </div>
      </section>
    </div>

    <Teleport to="body">
      <section
        v-if="menu"
        ref="menuElement"
        class="menu-panel w-64"
        role="menu"
        :style="{ left: `${menu.x}px`, top: `${menu.y}px` }"
        @click.stop
        @keydown="handleMenuKeydown"
      >
        <p class="menu-title"><span class="min-w-0 truncate">{{ menu.entry.lemma }}</span></p>
        <button v-if="menu.entry.id === selectedId && draftDirty" class="menu-item" role="menuitem" @click="saveEntryFromMenu">保存当前修改<kbd class="kbd">Ctrl+S</kbd></button>
        <template v-if="menu.entry.id === selectedId && crashDraft">
          <button class="menu-item" role="menuitem" @click="closeMenu(); restoreCrashDraft()">恢复异常退出草稿</button>
          <button class="menu-item" role="menuitem" @click="closeMenu(); discardCrashDraft()">放弃恢复点</button>
        </template>
        <button class="menu-item" role="menuitem" @click="openEntryFromMenu(menu.entry)">打开词条</button>
        <button class="menu-item" role="menuitem" @click="speakVocabularyEntry(menu.entry)">{{ speakingEntryId === menu.entry.id ? '停止朗读' : '朗读单词' }}<kbd class="kbd">本机</kbd></button>
        <i class="menu-sep" aria-hidden="true" />
        <button class="menu-item" role="menuitem" @click="toggleEntryFavorite(menu.entry)">{{ store.isContentFavorite('word', menu.entry.id) ? '取消收藏' : '加入收藏' }}</button>
        <button v-if="store.isContentRecent('word', menu.entry.id)" class="menu-item" role="menuitem" @click="removeEntryFromRecents(menu.entry)">从最近使用移除</button>
        <button v-if="entryCollocations(menu.entry).length" class="menu-item" role="menuitem" @click="copyEntryCollocations(menu.entry)">复制常用搭配</button>
        <button class="menu-item" role="menuitem" @click="copyEntryAsMarkdown(menu.entry)">复制为 Markdown</button>
        <button class="menu-item" role="menuitem" @click="createEntryNote(menu.entry)">创建关联笔记</button>
        <i class="menu-sep" aria-hidden="true" />
        <button class="menu-item menu-item-danger" role="menuitem" @click="removeEntry(menu.entry); closeMenu()">删除单词</button>
      </section>
    </Teleport>

    <UnsavedChangesDialog v-if="unsavedPrompt" :item-label="draft?.lemma || '未命名单词'" :target-label="unsavedPrompt.targetLabel" item-kind="单词" @decision="resolveUnsavedDecision" />
    <VocabularyImportDialog v-if="importDialogOpen" @cancel="closeBatchImport" @complete="completeBatchImport" />
  </div>
</template>
