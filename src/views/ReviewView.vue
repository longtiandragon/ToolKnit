<script setup lang="ts">
import { computed, defineAsyncComponent, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AppIcon from '@/components/AppIcon.vue'
import PageHeader from '@/components/PageHeader.vue'
import TagPill from '@/components/TagPill.vue'
import type { QuestionReviewFacet, ReviewRating, ReviewState, VocabularyEntry, VocabularyReviewFacet, VocabularySense } from '@/types'
import { useWorkbenchStore } from '@/stores/workbench'
import { useUiStore } from '@/stores/ui'
import { clampMenuPosition, isContextMenuShortcut, nextMenuItemIndex } from '@/lib/desktop-menu'
import { gradeFsrsReview } from '@/lib/fsrs-review'
import { cloneReviewState } from '@/lib/review-state'
import { vocabularyReviewCards, vocabularyReviewFacetLabels } from '@/lib/vocabulary-review'
import { hasQuestionReviewFront, questionReviewBack, questionReviewCards, questionReviewFacetLabels, questionReviewFront } from '@/lib/question-review'
import { buildVocabularyCloze, countReviewKinds, filterReviewItems, isVocabularyAnswerVisible, reviewKindFromQuery, vocabularyReviewAnswerMatches, vocabularyReviewHeading, type ReviewKind } from '@/lib/review-session'
import { reviewWorkflowActions } from '@/lib/review-workflows'
import { formatNextReviewDue, resolveReviewEmptyState } from '@/lib/review-empty-state'
import { useVocabularySpeech } from '@/lib/use-vocabulary-speech'
import { classifyMarkdownLink } from '@/lib/markdown-link'
import { questionSourceActionLabel, questionSourceReference } from '@/lib/question-source'
import { stageLocalFileHandoff } from '@/lib/local-file-handoff'
import { isDesktop, openExternalUrl } from '@/lib/native'

const store = useWorkbenchStore()
const ui = useUiStore()
const route = useRoute()
const router = useRouter()
// A word-only review session has no Markdown surface. Deferring this renderer
// keeps that fast path from loading the full technical-note preview stack.
const MarkdownContent = defineAsyncComponent(() => import('@/components/MarkdownContent.vue'))
const index = ref(0)
const revealed = ref(false)
const ratingInProgress = ref(false)
const questionLoading = ref(false)
const loadedQuestion = ref<typeof store.documents[number]>()
const sessionReviewed = ref(0)
const deferredItemKeys = ref<string[]>([])
const ratingIntervals = ref<Partial<Record<ReviewRating, string>>>({})
const ratingPreviewLoading = ref(false)
const reviewError = ref('')
const lastRating = ref<ReviewUndo>()
const reviewCard = ref<HTMLElement>()
const reviewBody = ref<HTMLElement>()
const answerReveal = ref<HTMLElement>()
const answerInput = ref<HTMLInputElement>()
const questionAnswerInput = ref<HTMLTextAreaElement>()
const typedAnswer = ref('')
const questionDraftAnswer = ref('')
const reviewMenu = ref<{ x: number; y: number } | null>(null)
const reviewMenuElement = ref<HTMLElement>()
let reviewMenuTrigger: HTMLElement | undefined
const { speakingEntryId, speakVocabularyEntry, stopVocabularySpeech, disposeVocabularySpeech } = useVocabularySpeech()
type ReviewItem = { type: 'question'; document: typeof store.documents[number]; facet: QuestionReviewFacet; review: ReviewState } | { type: 'word'; entry: VocabularyEntry; sense: VocabularySense; facet: VocabularyReviewFacet; review: ReviewState }
type ReviewUndo =
  | { type: 'question'; documentId: string; facet: QuestionReviewFacet; previousReview: ReviewState }
  | { type: 'word'; entryId: string; senseId: string; facet: VocabularyReviewFacet; previousReview: ReviewState }
const ratingOptions = [
  { rating: 'Again', label: '重来', shortcut: '1' },
  { rating: 'Hard', label: '费劲', shortcut: '2' },
  { rating: 'Good', label: '刚好', shortcut: '3' },
  { rating: 'Easy', label: '轻松', shortcut: '4' }
] as const
const reviewKind = ref<ReviewKind>(reviewKindFromQuery(route.query.kind))
const reviewKindOptions: { id: ReviewKind; label: string }[] = [
  { id: 'all', label: '全部到期' },
  { id: 'question', label: '全部题目' },
  { id: 'error', label: '错因卡' },
  { id: 'word', label: '单词卡' },
]
const allQueue = computed<ReviewItem[]>(() => [
  ...store.dueQuestionCards.map(({ document, facet, review }) => ({ type: 'question' as const, document, facet, review })),
  ...store.dueVocabularyCards.map(({ entry, sense, facet, review }) => ({ type: 'word' as const, entry, sense, facet, review }))
].sort((left, right) => {
  return new Date(left.review.due).getTime() - new Date(right.review.due).getTime()
}))
const queue = computed(() => filterReviewItems(allQueue.value, reviewKind.value))
const queueKindCounts = computed(() => countReviewKinds(allQueue.value))
function reviewItemKey(item: ReviewItem) {
  return item.type === 'question' ? `question:${item.document.id}:facet:${item.facet}` : `word:${item.entry.id}:sense:${item.sense.id}:facet:${item.facet}`
}
const activeQueue = computed(() => {
  const deferred = new Set(deferredItemKeys.value)
  return queue.value.filter((item) => !deferred.has(reviewItemKey(item)))
})
const current = computed(() => activeQueue.value[index.value])
const remainingCount = computed(() => activeQueue.value.length)
const deferredCount = computed(() => deferredItemKeys.value.length)
const sessionTotal = computed(() => sessionReviewed.value + remainingCount.value + deferredCount.value)
const sessionProgress = computed(() => sessionTotal.value ? Math.min(100, Math.round((sessionReviewed.value / sessionTotal.value) * 100)) : 100)
const remainingKindsLabel = computed(() => {
  const counts = countReviewKinds(activeQueue.value)
  return [counts.question ? `${counts.question} 题` : '', counts.word ? `${counts.word} 词` : ''].filter(Boolean).join(' · ') || '本轮已完成'
})
const reviewInventorySummary = computed(() => {
  let questionMaterialCount = 0
  let count = 0
  let nextDue = Number.POSITIVE_INFINITY
  for (const document of store.documents) {
    if (document.kind !== 'question') continue
    questionMaterialCount += 1
    for (const { review } of questionReviewCards(document)) {
      count += 1
      const due = new Date(review.due).getTime()
      if (Number.isFinite(due) && due < nextDue) nextDue = due
    }
  }
  for (const entry of store.vocabulary) {
    for (const sense of entry.senses) {
      for (const { review } of vocabularyReviewCards(sense)) {
        count += 1
        const due = new Date(review.due).getTime()
        if (Number.isFinite(due) && due < nextDue) nextDue = due
      }
    }
  }
  return {
    questionMaterialCount,
    vocabularyMaterialCount: store.vocabulary.length,
    count,
    nextDue: Number.isFinite(nextDue) ? new Date(nextDue).toISOString() : '',
  }
})
const questionMaterialCount = computed(() => reviewInventorySummary.value.questionMaterialCount)
const vocabularyMaterialCount = computed(() => reviewInventorySummary.value.vocabularyMaterialCount)
const reviewScheduleSummary = computed(() => reviewInventorySummary.value)
const reviewEmptyState = computed(() => {
  return resolveReviewEmptyState({
    sessionReviewed: sessionReviewed.value,
    filtered: reviewKind.value !== 'all',
    totalDue: queueKindCounts.value.all,
    filteredDue: queue.value.length,
    materialCount: questionMaterialCount.value + vocabularyMaterialCount.value,
    scheduledCardCount: reviewScheduleSummary.value.count,
  })
})
const nextReviewLabel = computed(() => formatNextReviewDue(reviewScheduleSummary.value.nextDue))
const canUndoLastRating = computed(() => Boolean(lastRating.value))
const currentLocationLabel = computed(() => current.value?.type === 'word' ? '在单词库中打开' : '在题库中打开')
const currentQuestion = computed(() => current.value?.type === 'question'
  ? (loadedQuestion.value?.id === current.value.document.id ? loadedQuestion.value : current.value.document.content ? current.value.document : undefined)
  : undefined)
const currentSourceAnchor = computed(() => current.value?.type === 'question'
  ? (currentQuestion.value?.sourceAnchor ?? current.value.document.sourceAnchor)
  : undefined)
const currentQuestionSource = computed(() => questionSourceReference(currentQuestion.value?.questionDetails?.source))
const currentWordAnswerVisible = computed(() => current.value?.type === 'word'
  && isVocabularyAnswerVisible(current.value.facet, revealed.value))
const currentCardTitle = computed(() => {
  const item = current.value
  if (!item) return ''
  return item.type === 'question'
    ? item.document.title
    : vocabularyReviewHeading(item.entry.lemma, item.facet, revealed.value)
})
const currentVocabularyCloze = computed(() => {
  const item = current.value
  if (!item || item.type !== 'word') return { prompt: '', expected: '', ready: false }
  return buildVocabularyCloze(item.entry.lemma, item.sense.examples[0] ?? '', item.sense.definition || '先为这个词义补一条例句。')
})
const currentCanTypeAnswer = computed(() => current.value?.type === 'word'
  && (current.value.facet === 'spelling' || (current.value.facet === 'example' && currentVocabularyCloze.value.ready)))
const currentExpectedWordAnswer = computed(() => {
  const item = current.value
  if (!item || item.type !== 'word') return ''
  return item.facet === 'example' ? currentVocabularyCloze.value.expected : item.entry.lemma
})
const typedAnswerCorrect = computed<boolean | undefined>(() => {
  if (!revealed.value || !currentCanTypeAnswer.value || !typedAnswer.value.trim()) return undefined
  return vocabularyReviewAnswerMatches(typedAnswer.value, currentExpectedWordAnswer.value)
})
let questionLoadRevision = 0
function resetReviewSession() {
  if (speakingEntryId.value) stopVocabularySpeech(false)
  index.value = 0
  revealed.value = false
  typedAnswer.value = ''
  questionDraftAnswer.value = ''
  sessionReviewed.value = 0
  deferredItemKeys.value = []
  lastRating.value = undefined
  reviewError.value = ''
  closeReviewMenu()
  void nextTick(() => reviewCard.value?.focus({ preventScroll: true }))
}
async function selectReviewKind(kind: ReviewKind) {
  if (kind === reviewKind.value) return
  reviewKind.value = kind
  resetReviewSession()
  const query = { ...route.query }
  if (kind === 'all') delete query.kind
  else query.kind = kind
  await router.replace({ query })
}
watch(() => route.query.kind, (value) => {
  const nextKind = reviewKindFromQuery(value)
  if (nextKind === reviewKind.value) return
  reviewKind.value = nextKind
  resetReviewSession()
})
watch(current, async (item) => {
  if (speakingEntryId.value) stopVocabularySpeech(false)
  typedAnswer.value = ''
  questionDraftAnswer.value = ''
  const revision = ++questionLoadRevision
  loadedQuestion.value = undefined
  reviewError.value = ''
  if (!item || item.type !== 'question') {
    questionLoading.value = false
    if (item?.type === 'word' && item.facet !== 'meaning') void nextTick(() => answerInput.value?.focus({ preventScroll: true }))
    return
  }
  if (item.document.content) { loadedQuestion.value = item.document; questionLoading.value = false; return }
  questionLoading.value = true
  try {
    const document = await store.loadDocument(item.document.id)
    if (revision === questionLoadRevision) loadedQuestion.value = document
  } finally {
    if (revision === questionLoadRevision) questionLoading.value = false
  }
}, { immediate: true })
watch(revealed, (isRevealed) => {
  if (!isRevealed && speakingEntryId.value) stopVocabularySpeech(false)
})
watch(queue, (items) => {
  const availableKeys = new Set(items.map(reviewItemKey))
  const nextDeferred = deferredItemKeys.value.filter((key) => availableKeys.has(key))
  if (nextDeferred.length !== deferredItemKeys.value.length) deferredItemKeys.value = nextDeferred
  if (index.value >= activeQueue.value.length) index.value = 0
}, { immediate: true })
const currentQuestionFacet = computed(() => current.value?.type === 'question' ? current.value.facet : 'answer')
const front = computed(() => currentQuestion.value ? questionReviewFront(currentQuestion.value, currentQuestionFacet.value) : '')
const back = computed(() => currentQuestion.value ? questionReviewBack(currentQuestion.value, currentQuestionFacet.value) : '')
const questionFrontAvailable = computed(() => Boolean(currentQuestion.value && hasQuestionReviewFront(currentQuestion.value, currentQuestionFacet.value)))
const currentCanDraftAnswer = computed(() => current.value?.type === 'question' && questionFrontAvailable.value)
const currentCanRetryAnswer = computed(() => currentCanTypeAnswer.value || currentCanDraftAnswer.value)
const currentHasDraftAnswer = computed(() => currentCanTypeAnswer.value
  ? Boolean(typedAnswer.value.trim())
  : currentCanDraftAnswer.value && Boolean(questionDraftAnswer.value.trim()))
function itemReviewState(item?: ReviewItem) {
  return item?.review
}
function itemCreatedAt(item: ReviewItem) {
  return item.type === 'question' ? item.document.createdAt : item.entry.createdAt
}
function formatReviewInterval(review: ReviewState) {
  const milliseconds = new Date(review.due).getTime() - Date.now()
  if (!Number.isFinite(milliseconds) || milliseconds <= 60 * 60 * 1000) return '≤ 1 小时'
  if (milliseconds < 24 * 60 * 60 * 1000) return `${Math.max(1, Math.ceil(milliseconds / (60 * 60 * 1000)))} 小时`
  return `${Math.max(1, review.intervalDays || Math.ceil(milliseconds / (24 * 60 * 60 * 1000)))} 天`
}
let ratingPreviewRevision = 0
watch([current, revealed], async ([item, isRevealed]) => {
  const revision = ++ratingPreviewRevision
  ratingIntervals.value = {}
  ratingPreviewLoading.value = false
  const review = itemReviewState(item)
  if (!item || !isRevealed || !review) return
  ratingPreviewLoading.value = true
  try {
    const previews = await Promise.all(ratingOptions.map(async ({ rating }) => ({ rating, label: formatReviewInterval(await gradeFsrsReview(review, itemCreatedAt(item), rating)) })))
    if (revision !== ratingPreviewRevision) return
    ratingIntervals.value = previews.reduce<Partial<Record<ReviewRating, string>>>((result, preview) => {
      result[preview.rating] = preview.label
      return result
    }, {})
  } catch {
    // The grade action remains available if the optional scheduler chunk cannot load.
  } finally {
    if (revision === ratingPreviewRevision) ratingPreviewLoading.value = false
  }
}, { flush: 'post' })
async function rate(rating: ReviewRating) {
  const item = current.value
  if (!item || ratingInProgress.value || questionLoading.value) return
  const review = itemReviewState(item)
  if (!review) return
  const undo: ReviewUndo = item.type === 'question'
    ? { type: 'question', documentId: item.document.id, facet: item.facet, previousReview: cloneReviewState(review) }
    : { type: 'word', entryId: item.entry.id, senseId: item.sense.id, facet: item.facet, previousReview: cloneReviewState(review) }
  ratingInProgress.value = true
  reviewError.value = ''
  try {
    if (item.type === 'question') await store.gradeDocument(item.document.id, rating, item.facet)
    else await store.gradeVocabularySense(item.entry.id, item.sense.id, rating, item.facet)
    lastRating.value = undo
    sessionReviewed.value += 1
    revealed.value = false
    typedAnswer.value = ''
    questionDraftAnswer.value = ''
    reviewMenu.value = null
    if (index.value >= activeQueue.value.length) index.value = 0
    await nextTick()
    reviewCard.value?.focus()
  } catch (error) {
    reviewError.value = error instanceof Error ? error.message : '暂时无法保存本次评分，请重试。'
  } finally {
    ratingInProgress.value = false
  }
}

function undoItemKey(undo: ReviewUndo) {
  return undo.type === 'question' ? `question:${undo.documentId}:facet:${undo.facet}` : `word:${undo.entryId}:sense:${undo.senseId}:facet:${undo.facet}`
}

async function undoLastRating() {
  const undo = lastRating.value
  if (!undo || ratingInProgress.value) return
  ratingInProgress.value = true
  reviewError.value = ''
  try {
    if (undo.type === 'question') {
      const document = await store.loadDocument(undo.documentId)
      if (!document) throw new Error('原题已不存在，无法撤销评分。')
      store.restoreQuestionReview(undo.documentId, undo.facet, cloneReviewState(undo.previousReview))
    } else {
      store.restoreVocabularySenseReview(undo.entryId, undo.senseId, undo.facet, cloneReviewState(undo.previousReview))
    }
    sessionReviewed.value = Math.max(0, sessionReviewed.value - 1)
    lastRating.value = undefined
    reviewMenu.value = null
    const restoredIndex = activeQueue.value.findIndex((item) => reviewItemKey(item) === undoItemKey(undo))
    if (restoredIndex >= 0) index.value = restoredIndex
    revealed.value = true
    await nextTick()
    reviewCard.value?.focus({ preventScroll: true })
    ui.toast('已撤销上一评分', 'FSRS 间隔与完整调度状态已恢复，可重新选择。', 'success')
  } catch (error) {
    reviewError.value = error instanceof Error ? error.message : '暂时无法撤销上一评分。'
  } finally {
    ratingInProgress.value = false
  }
}

function deferCurrent() {
  const item = current.value
  if (!item || ratingInProgress.value) return
  const key = reviewItemKey(item)
  if (!deferredItemKeys.value.includes(key)) deferredItemKeys.value = [...deferredItemKeys.value, key]
  revealed.value = false
  typedAnswer.value = ''
  questionDraftAnswer.value = ''
  reviewMenu.value = null
  if (index.value >= activeQueue.value.length) index.value = 0
  void nextTick(() => reviewCard.value?.focus())
}

function restoreDeferred() {
  if (!deferredCount.value) return
  deferredItemKeys.value = []
  index.value = 0
  revealed.value = false
  typedAnswer.value = ''
  questionDraftAnswer.value = ''
  void nextTick(() => reviewCard.value?.focus())
}

function closeReviewMenu(restoreFocus = false) {
  reviewMenu.value = null
  if (restoreFocus) void nextTick(() => reviewMenuTrigger?.focus({ preventScroll: true }))
}
function openReviewMenu(event: MouseEvent, target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return
  const trigger = target
  const width = 216
  const provenanceRows = Number(Boolean(currentQuestionSource.value.raw)) + Number(currentQuestionSource.value.kind !== 'text')
  const height = 190 + (currentSourceAnchor.value ? 36 : 0) + provenanceRows * 36 + (canUndoLastRating.value ? 36 : 0) + (currentWordAnswerVisible.value ? 36 : 0) + (currentCanRetryAnswer.value && (revealed.value || currentHasDraftAnswer.value) ? 36 : 0)
  reviewMenuTrigger = trigger
  reviewMenu.value = clampMenuPosition(event.clientX, event.clientY, { menuWidth: width, menuHeight: height, margin: 12 })
  void nextTick(() => reviewMenuElement.value?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus())
}
function openReviewMenuFromKeyboard(trigger: HTMLElement) {
  const bounds = trigger.getBoundingClientRect()
  openReviewMenu(new MouseEvent('contextmenu', { clientX: bounds.left + 24, clientY: bounds.top + 32 }), trigger)
}
function handleReviewCardKeydown(event: KeyboardEvent) {
  if (!isContextMenuShortcut(event)) return
  event.preventDefault()
  event.stopPropagation()
  if (reviewMenu.value) closeReviewMenu()
  else if (reviewCard.value) openReviewMenuFromKeyboard(reviewCard.value)
}
function openCurrentItem() {
  if (!current.value) return
  if (current.value.type === 'word') router.push({ path: '/words', query: { word: current.value.entry.id } })
  else router.push({ path: '/documents', query: { kind: current.value.document.kind, document: current.value.document.id } })
  closeReviewMenu()
}
function openCurrentSource() {
  const anchor = currentSourceAnchor.value
  if (!anchor) return
  router.push({ path: '/library', query: { source: anchor.sourceId, page: String(anchor.pageIndex) } })
  closeReviewMenu()
}
async function openReviewMarkdownLink(href: string, label: string) {
  const target = classifyMarkdownLink(href)
  try {
    if (target.kind === 'external') {
      await openExternalUrl(target.href)
      ui.toast('已交给系统打开来源', label, 'success')
      closeReviewMenu()
      return
    }
    if (target.kind === 'markdown') {
      stageLocalFileHandoff('markdown', [target.path], '题目来源')
      await router.push({ path: '/documents', query: { kind: 'note', handoff: 'desktop-markdown', request: String(Date.now()) } })
      closeReviewMenu()
      return
    }
    if (target.kind === 'file') {
      if (!isDesktop()) { ui.toast('打开本地来源需要桌面模式', target.path, 'info'); return }
      await openExternalUrl(target.path)
      ui.toast('已交给系统打开本地来源', label, 'success')
      closeReviewMenu()
      return
    }
    ui.toast('没有打开这个来源', '只允许网页和明确的本地绝对路径；危险或相对地址会保持为普通文字。', 'info')
  } catch (error) {
    ui.toast('来源没有打开', error instanceof Error ? error.message : '系统没有完成打开操作。', 'error')
  }
}
async function openCurrentQuestionSource() {
  const source = currentQuestionSource.value
  if (source.kind === 'text') return
  await openReviewMarkdownLink(source.href, source.label)
}
async function copyCurrentQuestionSource() {
  const source = currentQuestionSource.value.raw
  if (!source) return
  try {
    await navigator.clipboard.writeText(source)
    ui.toast('已复制题目来源', source.slice(0, 100), 'success')
    closeReviewMenu(true)
  } catch (error) {
    ui.toast('无法复制题目来源', error instanceof Error ? error.message : '系统剪贴板不可用。', 'error')
  }
}
function speakCurrentWord() {
  const item = current.value
  if (!item || item.type !== 'word' || !currentWordAnswerVisible.value) return
  closeReviewMenu()
  speakVocabularyEntry(item.entry)
}
function revealCurrent() {
  revealed.value = true
  void nextTick(() => {
    reviewCard.value?.focus({ preventScroll: true })
    const body = reviewBody.value
    const answer = answerReveal.value
    if (!body || !answer) return
    const bodyBounds = body.getBoundingClientRect()
    const answerBounds = answer.getBoundingClientRect()
    body.scrollTop += answerBounds.top - bodyBounds.top - 8
  })
}
function checkTypedAnswer() {
  if (!currentCanTypeAnswer.value) { revealCurrent(); return }
  if (!typedAnswer.value.trim()) {
    ui.toast('先输入你的答案', '按 Enter 检查；也可以使用下方按钮直接揭晓。', 'info')
    answerInput.value?.focus()
    return
  }
  revealCurrent()
}
function handleTypedAnswerEnter(event: KeyboardEvent) {
  if (event.isComposing) return
  event.preventDefault()
  checkTypedAnswer()
}
function checkQuestionDraft() {
  if (!currentCanDraftAnswer.value) { revealCurrent(); return }
  if (!questionDraftAnswer.value.trim()) {
    ui.toast('先写下你的思路', '按 Ctrl / ⌘ + Enter 对照答案；也可以使用下方按钮直接揭晓。', 'info')
    questionAnswerInput.value?.focus()
    return
  }
  revealCurrent()
}
function handleQuestionDraftShortcut(event: KeyboardEvent) {
  if (event.isComposing) return
  event.preventDefault()
  checkQuestionDraft()
}
function clearCurrentAnswer() {
  if (currentCanTypeAnswer.value) typedAnswer.value = ''
  if (currentCanDraftAnswer.value) questionDraftAnswer.value = ''
  closeReviewMenu()
  void nextTick(() => (currentCanTypeAnswer.value ? answerInput.value : questionAnswerInput.value)?.focus({ preventScroll: true }))
}
function retryCurrentAnswer() {
  if (!currentCanRetryAnswer.value) return
  revealed.value = false
  clearCurrentAnswer()
}
function currentReviewMarkdown() {
  const item = current.value
  if (!item) return ''
  if (item.type === 'question') {
    const question = currentQuestion.value
    if (!question) return ''
    const sections = [`# ${question.title}`, `> 复习方向：${questionReviewFacetLabels[item.facet]}`, questionReviewFront(question, item.facet)]
    if (revealed.value && questionDraftAnswer.value.trim()) sections.push(`## 我的本次作答\n\n${questionDraftAnswer.value.trim()}`)
    if (revealed.value && questionReviewBack(question, item.facet).trim()) sections.push(questionReviewBack(question, item.facet))
    return sections.filter(Boolean).join('\n\n')
  }
  const sense = item.sense
  if (!revealed.value) {
    if (item.facet === 'meaning') {
      return [`# ${item.entry.lemma}`, '> 复习方向：词义', '请回想这一条词义。'].join('\n\n')
    }
    if (item.facet === 'spelling') {
      return ['# 根据释义拼写', `> ${sense.partOfSpeech || '拼写卡'}`, sense.definition || '先补全这条释义'].join('\n\n')
    }
    return ['# 补全例句', `> ${sense.definition || sense.partOfSpeech || '例句填空卡'}`, currentVocabularyCloze.value.prompt].join('\n\n')
  }
  return [
    `# ${item.entry.lemma}`,
    item.entry.pronunciation && `> ${item.entry.pronunciation}`,
    `> 复习方向：${vocabularyReviewFacetLabels[item.facet]}`,
    `## ${sense.partOfSpeech || '词义'}`,
    sense.definition || '尚未填写释义',
    sense.examples.length && `## 例句\n\n${sense.examples.map((example) => `- ${example}`).join('\n')}`,
    sense.collocations.length && `## 常用搭配\n\n${sense.collocations.map((collocation) => `- ${collocation}`).join('\n')}`,
    sense.synonyms.length && `## 近义 / 易混\n\n${sense.synonyms.map((synonym) => `- ${synonym}`).join('\n')}`,
  ].filter(Boolean).join('\n\n')
}

async function copyCurrentReviewCard() {
  if (questionLoading.value) return
  const item = current.value
  const content = currentReviewMarkdown()
  if (!content) return
  try {
    await navigator.clipboard.writeText(content)
    ui.toast(
      item?.type === 'word' && revealed.value ? '已复制完整单词 Markdown' : '已复制当前复习内容',
      item?.type === 'word'
        ? revealed.value ? '包含词义、常用搭配、例句与易混词。' : '仅复制当前题面，不包含未翻开的答案。'
        : revealed.value ? '包含当前已展示的答案与解析。' : '仅复制题目，不包含未翻开的答案。',
      'success'
    )
    closeReviewMenu(true)
  } catch (error) {
    ui.toast('无法写入剪贴板', error instanceof Error ? error.message : '请检查系统剪贴板权限。', 'error')
  }
}
function isTextInput(target: EventTarget | null) {
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement || (target instanceof HTMLElement && target.isContentEditable)
}
function handleReviewKeydown(event: KeyboardEvent) {
  if (isTextInput(event.target)) return
  if (reviewMenu.value) {
    if (event.key === 'Escape') { event.preventDefault(); closeReviewMenu(true) }
    return
  }
  if (event.key === 'Escape' && reviewMenu.value) { event.preventDefault(); closeReviewMenu(true); return }
  if ((event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === 'z') {
    event.preventDefault()
    void undoLastRating()
    return
  }
  if (!current.value || ratingInProgress.value || questionLoading.value) return
  if (!event.ctrlKey && !event.metaKey && !event.altKey && event.key.toLowerCase() === 'r' && revealed.value && currentCanRetryAnswer.value) {
    event.preventDefault()
    retryCurrentAnswer()
    return
  }
  if (!event.ctrlKey && !event.metaKey && !event.altKey && event.key.toLowerCase() === 'p' && currentWordAnswerVisible.value) {
    event.preventDefault()
    speakCurrentWord()
    return
  }
  if (event.key.toLowerCase() === 'd') { event.preventDefault(); deferCurrent(); return }
  if (!revealed.value && (event.key === ' ' || event.key === 'Enter')) {
    event.preventDefault()
    if (current.value.type === 'question' && !questionFrontAvailable.value) openCurrentItem()
    else revealCurrent()
    return
  }
  if (!revealed.value) return
  const ratingMap: Record<string, ReviewRating> = { '1': 'Again', '2': 'Hard', '3': 'Good', '4': 'Easy' }
  if (ratingMap[event.key]) { event.preventDefault(); void rate(ratingMap[event.key]) }
}
function handleReviewMenuKeydown(event: KeyboardEvent) {
  event.stopPropagation()
  const menu = reviewMenuElement.value
  if (!menu) return
  const items = [...menu.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')]
  const currentIndex = items.indexOf(document.activeElement as HTMLButtonElement)
  if (event.key === 'Escape') { event.preventDefault(); closeReviewMenu(true); return }
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Home' || event.key === 'End') {
    event.preventDefault()
    const nextIndex = nextMenuItemIndex(event.key, currentIndex, items.length)
    if (nextIndex !== undefined) items[nextIndex]?.focus()
  }
}
function closeReviewContextMenus() { closeReviewMenu() }
onMounted(() => {
  window.addEventListener('keydown', handleReviewKeydown)
  window.addEventListener('knitspace:close-context-menus', closeReviewContextMenus)
  void nextTick(() => reviewCard.value?.focus({ preventScroll: true }))
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', handleReviewKeydown)
  window.removeEventListener('knitspace:close-context-menus', closeReviewContextMenus)
  disposeVocabularySpeech()
})
</script>

<template>
  <div class="review page-enter mx-auto w-full max-w-320 px-8 py-6" @click="closeReviewMenu()">
    <PageHeader title="学习复习" subtitle="题面、错因和词义各自排期,熟的那一面不会替你把生的那面盖过去">
      <template #actions>
        <button v-if="canUndoLastRating" class="btn-default" :disabled="ratingInProgress" @click="undoLastRating">
          撤销上一评分<kbd class="kbd">Ctrl Z</kbd>
        </button>
      </template>
      <template #lead>
        <!-- Progress belongs above the card, not in a side panel: it is read
             between ratings, in the same glance as the next question. -->
        <div class="stack gap-2">
          <div class="row-between gap-4 text-[12px]">
            <span class="row gap-2">
              <b class="text-[13px] text-fg">{{ remainingCount }} 张待复习</b>
              <span class="text-fg-3">{{ remainingKindsLabel }}</span>
            </span>
            <span class="text-fg-3">{{ sessionReviewed }} / {{ Math.max(1, sessionTotal) }} · 共 {{ reviewScheduleSummary.count }} 张已安排</span>
          </div>
          <div
            class="h-1 rounded-full bg-surface-3 overflow-hidden"
            role="progressbar"
            aria-label="本轮复习完成进度"
            :aria-valuenow="sessionProgress"
            aria-valuemin="0"
            aria-valuemax="100"
          >
            <i class="block h-full bg-accent transition-[width] duration-300" :style="{ width: `${sessionProgress}%` }" />
          </div>
        </div>
      </template>
    </PageHeader>
    <section v-if="current" ref="reviewCard" tabindex="0" class="review-card panel" :class="{ 'review-card--word': current.type === 'word', 'review-card--question-error': current.type === 'question' && current.facet === 'error', 'review-card--question-active': currentCanDraftAnswer && !revealed }" role="region" aria-haspopup="menu" :aria-expanded="Boolean(reviewMenu)" :aria-label="`${currentCardTitle}；右键或 Shift 加 F10 打开复习菜单`" @contextmenu.prevent.stop="openReviewMenu($event, $event.currentTarget)" @keydown="handleReviewCardKeydown">
      <header v-if="current.type === 'question'">
        <div><p>{{ current.document.subject }} · {{ questionReviewFacetLabels[current.facet] }} · 难度 {{ current.document.difficulty }}</p><h3>{{ current.document.title }}</h3><div><TagPill v-for="tag in current.document.tags" :key="tag" :label="tag" /></div></div>
        <span class="card-number"><b>{{ String(sessionReviewed + 1).padStart(2, '0') }}</b><small>/ {{ String(Math.max(1, sessionTotal)).padStart(2, '0') }}</small></span>
      </header>
      <header v-else>
        <div><p>{{ current.entry.language }} · {{ vocabularyReviewFacetLabels[current.facet] }} · {{ current.sense.partOfSpeech || '词义卡' }}</p><h3>{{ currentCardTitle }}</h3><small v-if="currentWordAnswerVisible && current.entry.pronunciation">{{ current.entry.pronunciation }}</small></div>
        <div class="review-card__word-tools">
          <button v-if="currentWordAnswerVisible" type="button" class="review-word-speak" :class="{ active: speakingEntryId === current.entry.id }" :aria-pressed="speakingEntryId === current.entry.id" :aria-label="speakingEntryId === current.entry.id ? `停止朗读 ${current.entry.lemma}` : `朗读 ${current.entry.lemma}`" aria-keyshortcuts="P" @click.stop="speakCurrentWord"><AppIcon :name="speakingEntryId === current.entry.id ? 'pause' : 'play'" :size="12" /><span>{{ speakingEntryId === current.entry.id ? '停止' : '朗读' }}</span><kbd>P</kbd></button>
          <span class="card-number"><b>{{ String(sessionReviewed + 1).padStart(2, '0') }}</b><small>/ {{ String(Math.max(1, sessionTotal)).padStart(2, '0') }}</small></span>
        </div>
      </header>
      <div ref="reviewBody" class="review-card__body" tabindex="0" aria-label="复习卡正文；内容较长时可在此滚动">
        <div v-if="current.type === 'question' && questionLoading" class="review-front-surface review-loading" role="status" aria-live="polite">正在从本机资料库加载题目…</div>
        <div v-else-if="current.type === 'question' && !questionFrontAvailable" class="review-front-surface review-front-empty">
          <span aria-hidden="true">?</span>
          <div><h4>这张卡还没有题干</h4><p>复习计划仍然保留着；补全题目后，它会继续按原来的 FSRS 进度出现。</p></div>
          <button class="quiet-button" @click="openCurrentItem">去题库补全</button>
        </div>
        <Suspense v-else-if="current.type === 'question'">
          <template #default><div class="review-front-surface"><MarkdownContent class="review-content" :source="front.replace(/^---[\s\S]*?---\s*/, '')" @link-open="openReviewMarkdownLink" /></div></template>
          <template #fallback><div class="review-front-surface review-loading" role="status" aria-live="polite">正在准备题目阅读视图…</div></template>
        </Suspense>
        <form v-if="currentCanDraftAnswer && !revealed" id="question-review-form" class="question-review-response" @submit.prevent="checkQuestionDraft" @contextmenu.stop>
          <div class="question-review-response__heading">
            <div><p class="eyebrow">主动回忆</p><label for="question-review-answer">{{ current.facet === 'error' ? '写下你认为的错因' : '先写下你的答案或解题思路' }}</label><small id="question-review-answer-hint">仅本次内存 · 不写回题库 · 评分仍由你决定</small></div>
            <small>{{ questionDraftAnswer.length.toLocaleString() }} / 8,000</small>
          </div>
          <textarea id="question-review-answer" ref="questionAnswerInput" v-model="questionDraftAnswer" rows="3" maxlength="8000" spellcheck="true" aria-describedby="question-review-answer-hint" :placeholder="current.facet === 'error' ? '当时忽略了什么？以后用什么原则避免？' : '不用写得完整，先留下关键步骤、结论或复杂度…'" @keydown.ctrl.enter="handleQuestionDraftShortcut" @keydown.meta.enter="handleQuestionDraftShortcut" @contextmenu.stop></textarea>
        </form>
        <div v-if="current.type === 'word'" class="word-review-front" :class="`word-review-front--${current.facet}`">
          <template v-if="current.facet === 'meaning'"><span>请回想这一条词义</span><b>{{ current.entry.lemma }}</b><small>{{ current.sense.partOfSpeech || '词性待补充' }}</small></template>
          <template v-else-if="current.facet === 'spelling'"><span>根据释义，拼写单词</span><b class="word-review-front__prompt">{{ current.sense.definition || '先补全这条释义' }}</b><small>{{ current.sense.partOfSpeech || '拼写卡' }}</small></template>
          <template v-else><span>补全例句中的空白</span><b class="word-review-front__example">{{ currentVocabularyCloze.prompt }}</b><small>{{ current.sense.definition || current.sense.partOfSpeech || '例句填空卡' }}</small></template>
          <form v-if="currentCanTypeAnswer && !revealed" class="word-review-response" @submit.prevent="checkTypedAnswer" @contextmenu.stop>
            <label for="word-review-answer">{{ current.facet === 'spelling' ? '输入单词' : '填入空白处' }}</label>
            <div>
              <input id="word-review-answer" ref="answerInput" v-model="typedAnswer" type="text" autocomplete="off" autocapitalize="none" :spellcheck="false" aria-describedby="word-review-answer-hint" placeholder="在这里作答…" @keydown.enter="handleTypedAnswerEnter" @contextmenu.stop />
              <button type="submit" class="primary-button">检查答案 <kbd>Enter</kbd></button>
            </div>
            <small id="word-review-answer-hint">只在当前卡片内存中保留；检查后仍由你决定熟练度。</small>
          </form>
        </div>
        <div v-if="revealed && !questionLoading" ref="answerReveal" class="answer-reveal">
          <template v-if="current.type === 'question'">
            <section v-if="questionDraftAnswer.trim()" class="question-review-attempt" aria-labelledby="question-review-attempt-title"><div><p class="eyebrow">我的作答</p><h4 id="question-review-attempt-title">我的本次作答</h4></div><pre>{{ questionDraftAnswer }}</pre></section>
            <p class="eyebrow">{{ current.facet === 'error' ? '错因与原则' : '答案与解法' }}</p><Suspense><template #default><MarkdownContent :source="back" @link-open="openReviewMarkdownLink" /></template><template #fallback><div class="review-loading" role="status">正在准备复习内容…</div></template></Suspense>
          </template>
          <template v-else>
            <div v-if="currentCanTypeAnswer" class="word-review-feedback" :class="{ correct: typedAnswerCorrect === true, incorrect: typedAnswerCorrect === false, skipped: typedAnswerCorrect === undefined }" role="status" aria-live="polite"><AppIcon :name="typedAnswerCorrect === true ? 'check' : typedAnswerCorrect === false ? 'close' : 'review'" :size="15" /><div><b>{{ typedAnswerCorrect === true ? '拼写正确' : typedAnswerCorrect === false ? '再看一眼正确形式' : '已直接揭晓' }}</b><small v-if="typedAnswer.trim()">你的答案：{{ typedAnswer }}</small><small v-else>本次没有输入答案，不会自动替你评分。</small></div></div>
            <p class="eyebrow">{{ vocabularyReviewFacetLabels[current.facet] }} · 答案</p><h4>{{ currentCanTypeAnswer ? currentExpectedWordAnswer : current.sense.definition || '尚未填写释义' }}</h4><p v-if="current.sense.examples.length">{{ current.sense.examples.join(' · ') }}</p><small v-if="current.facet !== 'meaning' && current.sense.definition">释义：{{ current.sense.definition }}</small><small v-if="current.sense.collocations.length">常用搭配：{{ current.sense.collocations.join(' · ') }}</small><small v-if="current.sense.synonyms.length">近义 / 易混：{{ current.sense.synonyms.join(' · ') }}</small>
          </template>
        </div>
      </div>
      <footer>
        <button v-if="!revealed && current.type === 'question' && !questionLoading && !questionFrontAvailable" class="primary-button wide" @click="openCurrentItem">先补全题干，再开始复习 <span>→</span></button>
        <button v-else-if="!revealed && currentCanTypeAnswer" class="quiet-button wide" @click="revealCurrent">暂不输入，直接揭晓 <span>↓</span></button>
        <div v-else-if="!revealed && currentCanDraftAnswer" class="question-review-footer-actions"><button class="quiet-button" @click="revealCurrent">暂不记录，直接揭晓</button><button type="submit" form="question-review-form" class="primary-button">对照答案 <kbd>Ctrl / ⌘ Enter</kbd></button></div>
        <button v-else-if="!revealed" class="primary-button wide" :disabled="questionLoading" @click="revealCurrent">{{ current.type === 'word' ? '查看答案' : questionLoading ? '正在读取题目…' : current.facet === 'error' ? '先回想错因，再看复盘' : '先想一想，再看解法' }} <span>↓</span></button>
        <template v-else>
          <p>{{ current.type === 'word' ? `这张${vocabularyReviewFacetLabels[current.facet]}卡现在有多熟？` : `这张${questionReviewFacetLabels[current.facet]}卡现在有多熟？` }}<small v-if="ratingPreviewLoading" class="review-interval-loading" role="status">正在估算下一次复习…</small></p>
          <div class="rating-row">
            <button v-for="item in ratingOptions" :key="item.rating" :class="`rating-${item.rating.toLowerCase()}`" :disabled="ratingInProgress || questionLoading" :aria-label="`${item.shortcut}，${item.label}；下次复习 ${ratingIntervals[item.rating] || '正在估算'}`" @click="rate(item.rating)"><b><kbd>{{ item.shortcut }}</kbd>{{ item.label }}</b><small>{{ ratingIntervals[item.rating] || item.rating }}</small></button>
          </div>
        </template>
        <p v-if="reviewError" class="review-error" role="alert">{{ reviewError }}</p>
        <small class="review-shortcuts"><span v-if="currentCanTypeAnswer && !revealed">Enter 检查 · </span><span v-if="currentCanDraftAnswer && !revealed">Ctrl/⌘ Enter 对照 · </span>Space 翻面 · 1–4 评分 · D 稍后再看<span v-if="currentWordAnswerVisible"> · P 朗读</span><span v-if="currentCanRetryAnswer && revealed"> · R 重答</span> · Ctrl/⌘ Z 撤销 · Shift+F10 打开菜单</small>
      </footer>
    </section>
    <section v-else class="review-finished panel">
      <template v-if="deferredCount">
        <span>暂缓</span><h3>本轮先完成了 {{ sessionReviewed }} 张。</h3><p>还有 {{ deferredCount }} 张暂缓卡留在本轮末尾；它们没有被评分，也没有改变 FSRS 计划。</p>
        <div><button class="primary-button" @click="restoreDeferred">继续复习暂缓卡</button><RouterLink class="quiet-button" to="/library">先去收集资料</RouterLink></div>
      </template>
      <template v-else-if="reviewEmptyState === 'filtered'">
        <span>筛选</span><h3>这个分类当前没有到期卡片。</h3><p>其他类型还有 {{ queueKindCounts.all }} 张到期内容；切回全部队列即可继续。</p><button class="primary-button" @click="selectReviewKind('all')">查看全部到期内容</button>
      </template>
      <template v-else-if="reviewEmptyState === 'no-material'">
        <span>开始</span><h3>先准备第一份复习材料。</h3><p>记录一道错题，或录入一个带词义的单词，再为需要记忆的方向启用卡片。</p><div><RouterLink class="primary-button" to="/documents?kind=question&create=question">记录第一道错题</RouterLink><RouterLink class="quiet-button" to="/words?action=create">录入第一个单词</RouterLink></div>
      </template>
      <template v-else-if="reviewEmptyState === 'no-cards'">
        <span>卡片</span><h3>内容已经存在，但还没有启用复习方向。</h3><p>进入题目或单词，选择答案、错因、词义、拼写或例句卡；每张卡会独立安排 FSRS。</p><div><RouterLink class="primary-button" to="/documents?kind=question">设置题目卡</RouterLink><RouterLink class="quiet-button" to="/words">设置单词卡</RouterLink></div>
      </template>
      <template v-else-if="reviewEmptyState === 'waiting'">
        <span>等待</span><h3>当前没有到期卡片。</h3><p>{{ reviewScheduleSummary.count }} 张卡正在按各自节奏安排；下一次复习：{{ nextReviewLabel }}。</p><div><RouterLink class="primary-button" to="/knowledge">回到知识库</RouterLink><RouterLink class="quiet-button" to="/documents?kind=question&create=question">继续记录错题</RouterLink></div>
      </template>
      <template v-else>
        <span>✓</span><h3>今天的线已经织完了。</h3><p>可以收一份新资料，或者放心地合上 Knitspace。</p><RouterLink class="primary-button" to="/library">去收集资料</RouterLink>
      </template>
    </section>
    <section class="review-launchpad" aria-labelledby="review-launchpad-heading">
      <header><div><p class="eyebrow">维护复习队列</p><h3 id="review-launchpad-heading">准备复习材料</h3></div><p>题目和词义仍是结构化内容；这里直接创建、导入或调整卡面。</p></header>
      <nav aria-label="复习材料常用任务">
        <RouterLink v-for="action in reviewWorkflowActions" :key="action.id" v-memo="[action.id]" :to="action.to"><span><AppIcon :name="action.icon" :size="14" /></span><div><b>{{ action.label }}</b><small>{{ action.detail }}</small></div><AppIcon name="arrow-right" :size="12" /></RouterLink>
      </nav>
    </section>
    <section class="review-materials" aria-labelledby="review-materials-title">
      <header>
        <div><p class="eyebrow">复习来源</p><h3 id="review-materials-title">管理复习材料</h3><p>卡片从结构化题目和词义生成；修改材料不会把它拆成零散文件。</p></div>
        <RouterLink class="quiet-button" to="/documents?kind=question&create=question"><AppIcon name="plus" :size="14" />记录新错题</RouterLink>
      </header>
      <div>
        <RouterLink to="/documents?kind=question"><span><AppIcon name="review" :size="17" /></span><div><b>题目与错题</b><small>{{ questionMaterialCount }} 道题 · {{ store.dueQuestionCards.length }} 张当前到期卡</small></div><AppIcon name="arrow-right" :size="13" /></RouterLink>
        <RouterLink to="/words"><span><AppIcon name="sort" :size="17" /></span><div><b>结构化单词</b><small>{{ vocabularyMaterialCount }} 个词 · {{ store.dueVocabularyCards.length }} 张当前到期卡</small></div><AppIcon name="arrow-right" :size="13" /></RouterLink>
      </div>
      <footer><AppIcon name="link" :size="13" /><span>一个题目或词义可生成多个独立卡面，每个卡面保留自己的 FSRS 强度与到期时间。</span></footer>
    </section>
    <section v-if="reviewMenu && current" ref="reviewMenuElement" class="review-context-menu" role="menu" :aria-label="`${currentCardTitle} 操作`" :style="{ left: `${reviewMenu.x}px`, top: `${reviewMenu.y}px` }" @click.stop @contextmenu.prevent @keydown="handleReviewMenuKeydown"><p>{{ currentCardTitle }}</p><button v-if="currentSourceAnchor" role="menuitem" @click="openCurrentSource">回到来源资料 · 第 {{ currentSourceAnchor.pageIndex + 1 }} 页</button><button v-if="currentQuestionSource.raw" role="menuitem" @click="copyCurrentQuestionSource">复制来源 / 出处</button><button v-if="currentQuestionSource.kind !== 'text'" role="menuitem" @click="openCurrentQuestionSource">{{ questionSourceActionLabel(currentQuestionSource) }}</button><button role="menuitem" @click="openCurrentItem">{{ currentLocationLabel }}</button><button v-if="current.type === 'word' && currentWordAnswerVisible" role="menuitem" @click="speakCurrentWord">{{ speakingEntryId === current.entry.id ? '停止朗读' : '朗读单词' }} <kbd>P</kbd></button><button v-if="!revealed && currentHasDraftAnswer" role="menuitem" @click="clearCurrentAnswer">清空本次作答</button><button v-if="revealed && currentCanRetryAnswer" role="menuitem" @click="retryCurrentAnswer">重新作答 <kbd>R</kbd></button><button role="menuitem" :disabled="questionLoading || (current.type === 'question' && !questionFrontAvailable)" @click="copyCurrentReviewCard">{{ current.type === 'word' ? revealed ? '复制完整单词 Markdown' : '复制当前题面 Markdown' : revealed ? '复制当前卡片 Markdown' : '复制题目 Markdown' }}</button><button v-if="canUndoLastRating" role="menuitem" :disabled="ratingInProgress" @click="undoLastRating">撤销上一评分 <kbd>Ctrl / ⌘ Z</kbd></button><button role="menuitem" @click="deferCurrent">本轮稍后再看 <kbd>D</kbd></button><button role="menuitem" @click="closeReviewMenu(true)">继续复习</button></section>
  </div>
</template>

<style scoped>
.review-kind-switch{display:flex;flex-wrap:wrap;gap:6px;margin-top:14px}.review-kind-switch button{display:flex;min-height:34px;align-items:center;gap:7px;padding:0 10px;border:1px solid var(--accent-soft);border-radius:8px;color:var(--text-secondary);background:var(--surface-2);font:650 11px var(--font-ui);transition:border-color .16s ease,color .16s ease,background .16s ease}.review-kind-switch button:hover,.review-kind-switch button:focus-visible{border-color:var(--accent);color:var(--green-strong);background:var(--surface)}.review-kind-switch button:focus-visible{outline:2px solid color-mix(in srgb,var(--green) 45%,transparent);outline-offset:2px}.review-kind-switch button.active{border-color:var(--accent-soft);color:var(--green-strong);background:var(--green-bg);box-shadow:inset 3px 0 var(--green)}.review-kind-switch button b{display:grid;min-width:20px;height:20px;place-items:center;padding:0 4px;border-radius:6px;color:var(--muted);background:var(--accent-soft);font:700 11px var(--font-mono)}.review-kind-switch button.active b{color:var(--accent-fg);background:var(--accent-solid-hover)}
.review-card{height:clamp(410px,calc(100vh - 270px),650px)}.review-card__body{min-height:0;flex:1;overflow:auto}
.review-card__word-tools{display:flex;flex:0 0 auto;align-items:center;gap:9px}.review-word-speak{display:inline-flex;min-height:30px;align-items:center;gap:6px;padding:0 9px;border:1px solid var(--accent-soft);border-radius:8px;color:var(--green-strong);background:var(--surface-2);font:680 11px var(--font-ui);cursor:pointer;transition:border-color .16s ease,color .16s ease,background .16s ease}.review-word-speak:hover,.review-word-speak:focus-visible,.review-word-speak.active{border-color:var(--accent);color:var(--accent-fg);background:var(--accent-solid-hover)}.review-word-speak:focus-visible{outline:2px solid color-mix(in srgb,var(--green) 45%,transparent);outline-offset:2px}.review-word-speak kbd{padding:1px 4px;border:1px solid currentColor;border-radius:4px;font:750 11px var(--font-mono);opacity:.78}
.review-card--question-active .review-front-surface{min-height:104px;padding-block:16px}.question-review-response{display:grid;gap:8px;padding:11px 24px 13px;border-top:1px solid var(--accent-soft);background:linear-gradient(180deg,var(--surface-2),var(--surface-2))}.question-review-response__heading{display:flex;align-items:flex-end;justify-content:space-between;gap:14px}.question-review-response__heading>div{display:grid;gap:3px}.question-review-response__heading .eyebrow{font-size:11px}.question-review-response label{color:var(--text);font:700 12px var(--font-ui)}.question-review-response__heading small{color:var(--muted);font:11px/1.45 var(--font-mono)}.question-review-response textarea{display:block;width:100%;min-height:66px;max-height:156px;resize:vertical;padding:9px 12px;border:1px solid var(--accent-soft);border-radius:9px;color:var(--text);background:var(--surface);font:500 12px/1.65 var(--font-ui);caret-color:var(--green-strong);transition:border-color .16s ease,box-shadow .16s ease}.question-review-response textarea::placeholder{color:var(--fg-3)}.question-review-response textarea:focus{border-color:var(--accent);outline:0;box-shadow:0 0 0 3px var(--accent-soft)}.question-review-footer-actions{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px}.question-review-footer-actions>button{min-height:42px;padding-inline:14px;font-size:11px}.question-review-footer-actions>.quiet-button{text-align:left}.question-review-footer-actions kbd{margin-left:7px;padding:2px 4px;border:1px solid var(--surface-2);border-radius:4px;font:750 11px var(--font-mono)}.question-review-attempt{display:grid;gap:9px;margin:-4px 0 18px;padding:12px 14px;border:1px solid var(--accent-soft);border-left:3px solid var(--green);border-radius:9px;background:var(--surface)}.question-review-attempt>div{display:flex;align-items:baseline;gap:9px}.question-review-attempt h4{margin:0;color:var(--text);font:700 12px var(--font-ui)}.question-review-attempt pre{overflow-wrap:anywhere;margin:0;color:var(--text-secondary);font:500 11px/1.7 var(--font-ui);white-space:pre-wrap}
.word-review-response{display:grid;width:min(100%,620px);gap:7px;margin-top:10px;text-align:left}.word-review-response>label{color:var(--text-secondary);font:680 11px var(--font-ui)}.word-review-response>div{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:7px}.word-review-response input{min-width:0;height:42px;padding:0 13px;border:1px solid var(--accent-soft);border-radius:9px;color:var(--text);background:var(--surface);font:650 15px var(--font-ui);caret-color:var(--green-strong);transition:border-color .16s ease,box-shadow .16s ease}.word-review-response input::placeholder{color:var(--fg-3)}.word-review-response input:focus{border-color:var(--accent);outline:0;box-shadow:0 0 0 3px var(--accent-soft)}.word-review-response .primary-button{min-height:42px;padding-inline:14px;font-size:11px}.word-review-response kbd{margin-left:7px;padding:2px 4px;border:1px solid var(--surface-2);border-radius:4px;font:750 11px var(--font-mono)}.word-review-response>small{color:var(--muted);font:11px/1.45 var(--font-mono);letter-spacing:0}.word-review-feedback{display:flex;align-items:flex-start;gap:9px;margin:0 0 14px;padding:10px 11px;border:1px solid var(--accent-soft);border-radius:10px;color:var(--green-strong);background:var(--accent-soft)}.word-review-feedback.incorrect{border-color:var(--danger-soft);color:var(--danger);background:var(--danger-soft)}.word-review-feedback.skipped{border-color:var(--line-strong);color:var(--text-secondary);background:var(--line)}.word-review-feedback>div{display:grid;gap:3px}.word-review-feedback b{font:700 11px var(--font-ui)}.review-card--word .answer-reveal .word-review-feedback small{margin:0;color:currentColor;font:11px/1.45 var(--font-mono);opacity:.82}.review-card>footer>.quiet-button.wide{display:flex;width:100%;min-height:42px;align-items:center;justify-content:space-between;padding:0 15px;font-size:11px;text-align:left}.review-card>footer>.quiet-button.wide span{font:700 16px var(--font-mono)}
.review-loading{display:grid;min-height:220px;place-items:center;color:var(--muted);letter-spacing:.02em}.answer-reveal{padding:20px 24px 26px;border-top:1px solid var(--line);background:var(--surface-2)}
.rating-row button{border-color:currentColor;color:var(--text-secondary);background:var(--surface)}.rating-row button kbd{margin-right:7px;padding:2px 4px;border:1px solid;border-radius:4px;font:750 11px var(--font-mono)}.rating-again{color:var(--danger)!important}.rating-hard{color:var(--warn)!important}.rating-good{color:var(--accent)!important}.rating-easy{color:var(--accent-fg)!important;background:var(--accent-solid)!important}
.review-launchpad{display:grid;grid-template-columns:218px minmax(0,1fr);gap:9px;margin:14px 0 0}.review-launchpad>header{display:flex;align-items:flex-start;flex-direction:column;justify-content:center;padding:12px 14px;border:1px solid var(--accent-soft);border-radius:13px;background:linear-gradient(135deg,var(--green-bg),var(--surface))}.review-launchpad h3{margin-top:4px;font:700 15px/1.25 var(--font-display);letter-spacing:-.02em}.review-launchpad>header>p:last-child{margin:6px 0 0;color:var(--muted);font-size:11px;line-height:1.5}.review-launchpad>nav{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:1px;overflow:hidden;border:1px solid var(--line);border-radius:13px;background:var(--line);box-shadow:0 7px 20px var(--accent-soft)}.review-launchpad a{display:grid;grid-template-columns:30px minmax(0,1fr) auto;align-items:center;gap:8px;min-height:56px;padding:8px 10px;color:var(--text-secondary);background:var(--surface);outline:0}.review-launchpad a:hover,.review-launchpad a:focus-visible{color:var(--green-strong);background:var(--green-bg)}.review-launchpad a:focus-visible{box-shadow:inset 0 0 0 2px color-mix(in srgb,var(--green) 46%,transparent)}.review-launchpad a>span{display:grid;width:30px;height:30px;place-items:center;border:1px solid var(--accent-soft);border-radius:8px;color:var(--green-strong);background:var(--surface)}.review-launchpad a>div{display:grid;min-width:0;gap:3px}.review-launchpad b,.review-launchpad small{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.review-launchpad b{font:670 11px var(--font-ui)}.review-launchpad small{color:var(--muted);font-size:11px}.review-launchpad a>.app-icon{color:var(--muted)}
@media(max-width:960px){.review-launchpad{grid-template-columns:1fr}.review-launchpad>header{display:grid;grid-template-columns:auto minmax(0,1fr);column-gap:12px}.review-launchpad>header>p:last-child{grid-column:2;margin:0}}
@media(max-width:720px){.review-kind-switch{display:grid;grid-template-columns:repeat(2,minmax(0,1fr))}.review-kind-switch button{justify-content:space-between;padding-inline:9px}}
@media(max-width:620px){.word-review-response>div{grid-template-columns:1fr}.word-review-response .primary-button{width:100%}.question-review-response{padding-inline:14px}.question-review-footer-actions{grid-template-columns:1fr}.question-review-footer-actions>button{width:100%}}
@media(prefers-reduced-motion:reduce){.review-word-speak,.question-review-response textarea{transition:none}}
</style>
