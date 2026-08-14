<script setup lang="ts">
import { computed, defineAsyncComponent, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AppIcon from '@/components/AppIcon.vue'
import PageHeader from '@/components/PageHeader.vue'
import SegmentedControl from '@/components/SegmentedControl.vue'
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
import { reviewWorkflowGroups } from '@/lib/review-workflows'
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
// The filter was declared and never rendered — a queue you could only leave
// through the empty state. It belongs with the progress bar, where "which
// cards" and "how far in" are read together.
const reviewKindChoices = computed(() =>
  reviewKindOptions.map((option) => ({
    ...option,
    detail: `${queueKindCounts.value[option.id]} 张`,
  })),
)
// Four ratings pressed a few hundred times a day. Tinted, not filled: four
// saturated buttons in a row is a slot machine, and the colour still has to
// separate "again" from "easy" at a glance.
const ratingTone: Record<ReviewRating, string> = {
  Again: 'border-line text-danger hover:not-disabled:border-danger hover:not-disabled:bg-danger-soft',
  Hard: 'border-line text-warn hover:not-disabled:border-warn hover:not-disabled:bg-warn-soft',
  Good: 'border-line text-accent hover:not-disabled:border-accent hover:not-disabled:bg-accent-soft',
  Easy: 'border-line text-success hover:not-disabled:border-success hover:not-disabled:bg-success-soft',
}
// Each finished state answers a different question, so each gets its own
// sentence rather than a shared "没有卡片了".
const reviewFinishedState = computed(() => {
  if (deferredCount.value) {
    return {
      icon: 'review',
      title: `本轮先完成了 ${sessionReviewed.value} 张`,
      detail: `还有 ${deferredCount.value} 张暂缓卡留在本轮末尾；它们没有被评分，也没有改变 FSRS 计划。`,
    }
  }
  switch (reviewEmptyState.value) {
    case 'filtered':
      return {
        icon: 'rule',
        title: '这个分类当前没有到期卡片',
        detail: `其他类型还有 ${queueKindCounts.value.all} 张到期内容；切回全部队列即可继续。`,
      }
    case 'no-material':
      return {
        icon: 'plus',
        title: '先准备第一份复习材料',
        detail: '记录一道错题，或录入一个带词义的单词，再为需要记忆的方向启用卡片。',
      }
    case 'no-cards':
      return {
        icon: 'sort',
        title: '内容已经存在，但还没有启用复习方向',
        detail: '进入题目或单词，选择答案、错因、词义、拼写或例句卡；每张卡会独立安排 FSRS。',
      }
    case 'waiting':
      return {
        icon: 'clock',
        title: '当前没有到期卡片',
        detail: `${reviewScheduleSummary.value.count} 张卡正在按各自节奏安排；下一次复习：${nextReviewLabel.value}。`,
      }
    default:
      return {
        icon: 'check',
        title: '今天的线已经织完了',
        detail: '可以收一份新资料，或者放心地合上 Knitspace。',
      }
  }
})
// Materials used to be two panels — "准备复习材料" and "管理复习材料" — with
// separate headers pointing at the same two destinations. Split by source
// instead: each column owns its count and its own three tasks.
const materialGroups = computed(() => {
  const groups = reviewWorkflowGroups()
  return [
    {
      id: 'question',
      label: '题目与错题',
      icon: 'review',
      to: '/documents?kind=question',
      summary: `${questionMaterialCount.value} 道题 · ${store.dueQuestionCards.length} 张到期`,
      actions: groups.question,
    },
    {
      id: 'word',
      label: '结构化单词',
      icon: 'sort',
      to: '/words',
      summary: `${vocabularyMaterialCount.value} 个词 · ${store.dueVocabularyCards.length} 张到期`,
      actions: groups.word,
    },
  ]
})
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
  <!-- No `review` / `review-card` class: the legacy sheets cap those at
       1040px and 920px and centre them, which left the card floating in two
       wide gutters inside the rebuilt page column. -->
  <div class="page-enter mx-auto w-full max-w-320 px-8 py-6" @click="closeReviewMenu()">
    <PageHeader title="学习复习" subtitle="题面、错因和词义各自排期，熟的那一面不会替你把生的那面盖过去">
      <template #actions>
        <button v-if="canUndoLastRating" class="btn-default" :disabled="ratingInProgress" @click="undoLastRating">
          撤销上一评分<kbd class="kbd">Ctrl Z</kbd>
        </button>
      </template>
      <template #lead>
        <!-- Progress belongs above the card, not in a side panel: it is read
             between ratings, in the same glance as the next question. The
             queue filter sits with it, because "which cards am I doing" and
             "how far in am I" are one decision. -->
        <div class="stack gap-2.5">
          <div class="row-between gap-4 text-[12px]">
            <span class="row gap-2">
              <b class="text-[13px] text-fg">{{ remainingCount }} 张待复习</b>
              <span class="text-fg-3">{{ remainingKindsLabel }}</span>
            </span>
            <span class="text-fg-3 tabular-nums">{{ sessionReviewed }} / {{ Math.max(1, sessionTotal) }} · 共 {{ reviewScheduleSummary.count }} 张已安排</span>
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
          <SegmentedControl
            :options="reviewKindChoices"
            :model-value="reviewKind"
            label="复习队列筛选"
            size="compact"
            @update:model-value="selectReviewKind($event as ReviewKind)"
          />
        </div>
      </template>
    </PageHeader>

    <!-- The card is the page. It claims a fixed slice of the window so the
         rating buttons land in the same place on every card — you rate a few
         hundred of these, and a footer that moves with the content length
         means aiming at a moving target. -->
    <section
      v-if="current"
      ref="reviewCard"
      tabindex="0"
      class="panel flex flex-col overflow-hidden h-[clamp(420px,calc(100vh_-_var(--titlebar-h)_-_21rem),680px)] focus:outline-none focus-visible:border-accent"
      role="region"
      aria-haspopup="menu"
      :aria-expanded="Boolean(reviewMenu)"
      :aria-label="`${currentCardTitle}；右键或 Shift 加 F10 打开复习菜单`"
      @contextmenu.prevent.stop="openReviewMenu($event, $event.currentTarget)"
      @keydown="handleReviewCardKeydown"
    >
      <header class="row-between gap-4 shrink-0 px-5 py-3.5 border-b border-line">
        <div v-if="current.type === 'question'" class="stack gap-1 min-w-0">
          <p class="text-[11px] text-fg-3 truncate">{{ current.document.subject }} · {{ questionReviewFacetLabels[current.facet] }} · 难度 {{ current.document.difficulty }}</p>
          <h3 class="text-[15px] font-semibold text-fg truncate">{{ current.document.title }}</h3>
          <div v-if="current.document.tags.length" class="row gap-1 flex-wrap mt-0.5">
            <TagPill v-for="tag in current.document.tags" :key="tag" :label="tag" />
          </div>
        </div>
        <div v-else class="stack gap-1 min-w-0">
          <p class="text-[11px] text-fg-3 truncate">{{ current.entry.language }} · {{ vocabularyReviewFacetLabels[current.facet] }} · {{ current.sense.partOfSpeech || '词义卡' }}</p>
          <h3 class="text-[15px] font-semibold text-fg truncate">{{ currentCardTitle }}</h3>
          <small v-if="currentWordAnswerVisible && current.entry.pronunciation" class="text-[12px] text-fg-2 font-mono">{{ current.entry.pronunciation }}</small>
        </div>

        <div class="row gap-2 shrink-0">
          <button
            v-if="current.type === 'word' && currentWordAnswerVisible"
            type="button"
            class="btn-ghost btn-sm"
            :class="speakingEntryId === current.entry.id ? 'text-accent' : ''"
            :aria-pressed="speakingEntryId === current.entry.id"
            :aria-label="speakingEntryId === current.entry.id ? `停止朗读 ${current.entry.lemma}` : `朗读 ${current.entry.lemma}`"
            aria-keyshortcuts="P"
            @click.stop="speakCurrentWord"
          >
            <AppIcon :name="speakingEntryId === current.entry.id ? 'pause' : 'play'" :size="13" />
            {{ speakingEntryId === current.entry.id ? '停止' : '朗读' }}<kbd class="kbd">P</kbd>
          </button>
          <span class="row items-baseline gap-0.5 tabular-nums">
            <b class="text-[17px] font-semibold text-fg">{{ String(sessionReviewed + 1).padStart(2, '0') }}</b>
            <small class="text-[12px] text-fg-3">/ {{ String(Math.max(1, sessionTotal)).padStart(2, '0') }}</small>
          </span>
        </div>
      </header>

      <div ref="reviewBody" class="flex-1 min-h-0 overflow-auto px-5 py-4" tabindex="0" aria-label="复习卡正文；内容较长时可在此滚动">
        <div v-if="current.type === 'question' && questionLoading" class="center h-full text-[13px] text-fg-3" role="status" aria-live="polite">正在从本机资料库加载题目…</div>

        <div v-else-if="current.type === 'question' && !questionFrontAvailable" class="stack items-center justify-center gap-3 h-full text-center">
          <span class="center w-12 h-12 rounded-lg bg-surface-2 text-[20px] font-semibold text-fg-3" aria-hidden="true">?</span>
          <b class="text-[14px] font-semibold text-fg">这张卡还没有题干</b>
          <p class="max-w-96 text-[12px] leading-relaxed text-fg-3">复习计划仍然保留着；补全题目后，它会继续按原来的 FSRS 进度出现。</p>
          <button class="btn-default" @click="openCurrentItem">去题库补全</button>
        </div>

        <Suspense v-else-if="current.type === 'question'">
          <template #default>
            <MarkdownContent class="review-content" :source="front.replace(/^---[\s\S]*?---\s*/, '')" @link-open="openReviewMarkdownLink" />
          </template>
          <template #fallback>
            <div class="center h-full text-[13px] text-fg-3" role="status" aria-live="polite">正在准备题目阅读视图…</div>
          </template>
        </Suspense>

        <!-- Active recall: the draft box sits directly under the prompt, so
             writing an answer is the obvious next move rather than a feature
             you discover. -->
        <form
          v-if="currentCanDraftAnswer && !revealed"
          id="question-review-form"
          class="stack gap-2 mt-4 pt-4 border-t border-line"
          @submit.prevent="checkQuestionDraft"
          @contextmenu.stop
        >
          <div class="row-between gap-3">
            <label for="question-review-answer" class="text-[13px] font-medium text-fg">
              {{ current.facet === 'error' ? '写下你认为的错因' : '先写下你的答案或解题思路' }}
            </label>
            <small class="text-[11px] text-fg-3 tabular-nums">{{ questionDraftAnswer.length.toLocaleString() }} / 8,000</small>
          </div>
          <textarea
            id="question-review-answer"
            ref="questionAnswerInput"
            v-model="questionDraftAnswer"
            rows="3"
            maxlength="8000"
            spellcheck="true"
            aria-describedby="question-review-answer-hint"
            class="field-area w-full text-[13px]"
            :placeholder="current.facet === 'error' ? '当时忽略了什么？以后用什么原则避免？' : '不用写得完整，先留下关键步骤、结论或复杂度…'"
            @keydown.ctrl.enter="handleQuestionDraftShortcut"
            @keydown.meta.enter="handleQuestionDraftShortcut"
            @contextmenu.stop
          ></textarea>
          <small id="question-review-answer-hint" class="text-[11px] text-fg-3">仅本次内存 · 不写回题库 · 评分仍由你决定</small>
        </form>

        <div v-if="current.type === 'word'" class="stack items-center gap-2 py-6 text-center">
          <template v-if="current.facet === 'meaning'">
            <span class="text-[12px] text-fg-3">请回想这一条词义</span>
            <b class="text-[32px] font-semibold leading-tight text-fg">{{ current.entry.lemma }}</b>
            <small class="text-[12px] text-fg-3">{{ current.sense.partOfSpeech || '词性待补充' }}</small>
          </template>
          <template v-else-if="current.facet === 'spelling'">
            <span class="text-[12px] text-fg-3">根据释义，拼写单词</span>
            <b class="max-w-160 text-[20px] font-medium leading-snug text-fg">{{ current.sense.definition || '先补全这条释义' }}</b>
            <small class="text-[12px] text-fg-3">{{ current.sense.partOfSpeech || '拼写卡' }}</small>
          </template>
          <template v-else>
            <span class="text-[12px] text-fg-3">补全例句中的空白</span>
            <b class="max-w-160 text-[19px] font-medium leading-relaxed text-fg">{{ currentVocabularyCloze.prompt }}</b>
            <small class="text-[12px] text-fg-3">{{ current.sense.definition || current.sense.partOfSpeech || '例句填空卡' }}</small>
          </template>

          <form v-if="currentCanTypeAnswer && !revealed" class="stack gap-2 w-full max-w-100 mt-3 text-left" @submit.prevent="checkTypedAnswer" @contextmenu.stop>
            <label for="word-review-answer" class="text-[12px] font-medium text-fg-2">{{ current.facet === 'spelling' ? '输入单词' : '填入空白处' }}</label>
            <div class="row gap-2">
              <input
                id="word-review-answer"
                ref="answerInput"
                v-model="typedAnswer"
                type="text"
                autocomplete="off"
                autocapitalize="none"
                :spellcheck="false"
                aria-describedby="word-review-answer-hint"
                class="field flex-1 min-w-0"
                placeholder="在这里作答…"
                @keydown.enter="handleTypedAnswerEnter"
                @contextmenu.stop
              />
              <button type="submit" class="btn-primary shrink-0">检查答案<kbd class="kbd">Enter</kbd></button>
            </div>
            <small id="word-review-answer-hint" class="text-[11px] text-fg-3">只在当前卡片内存中保留；检查后仍由你决定熟练度。</small>
          </form>
        </div>

        <div v-if="revealed && !questionLoading" ref="answerReveal" class="stack gap-3 mt-4 pt-4 border-t border-line">
          <template v-if="current.type === 'question'">
            <section v-if="questionDraftAnswer.trim()" class="stack gap-1.5 p-3 rounded-md bg-well border border-line" aria-labelledby="question-review-attempt-title">
              <h4 id="question-review-attempt-title" class="text-[12px] font-medium text-fg-2">我的本次作答</h4>
              <pre class="m-0 whitespace-pre-wrap break-words font-mono text-[12px] leading-relaxed text-fg">{{ questionDraftAnswer }}</pre>
            </section>
            <p class="eyebrow">{{ current.facet === 'error' ? '错因与原则' : '答案与解法' }}</p>
            <Suspense>
              <template #default><MarkdownContent class="review-content" :source="back" @link-open="openReviewMarkdownLink" /></template>
              <template #fallback><div class="text-[13px] text-fg-3" role="status">正在准备复习内容…</div></template>
            </Suspense>
          </template>

          <template v-else>
            <div
              v-if="currentCanTypeAnswer"
              class="row gap-2.5 p-3 rounded-md border"
              :class="typedAnswerCorrect === true ? 'border-success bg-success-soft text-success'
                : typedAnswerCorrect === false ? 'border-danger bg-danger-soft text-danger'
                : 'border-line bg-surface-2 text-fg-2'"
              role="status"
              aria-live="polite"
            >
              <AppIcon :name="typedAnswerCorrect === true ? 'check' : typedAnswerCorrect === false ? 'close' : 'review'" :size="15" class="shrink-0 mt-0.5" />
              <div class="stack gap-0.5 min-w-0">
                <b class="text-[13px] font-medium">{{ typedAnswerCorrect === true ? '拼写正确' : typedAnswerCorrect === false ? '再看一眼正确形式' : '已直接揭晓' }}</b>
                <small v-if="typedAnswer.trim()" class="text-[12px] opacity-90">你的答案：{{ typedAnswer }}</small>
                <small v-else class="text-[12px] opacity-90">本次没有输入答案，不会自动替你评分。</small>
              </div>
            </div>

            <p class="eyebrow">{{ vocabularyReviewFacetLabels[current.facet] }} · 答案</p>
            <h4 class="text-[19px] font-semibold leading-snug text-fg">{{ currentCanTypeAnswer ? currentExpectedWordAnswer : current.sense.definition || '尚未填写释义' }}</h4>
            <p v-if="current.sense.examples.length" class="text-[13px] leading-relaxed text-fg-2">{{ current.sense.examples.join(' · ') }}</p>
            <dl class="stack gap-1 text-[12px]">
              <div v-if="current.facet !== 'meaning' && current.sense.definition" class="row gap-2">
                <dt class="shrink-0 w-20 text-fg-3">释义</dt><dd class="m-0 min-w-0 text-fg-2">{{ current.sense.definition }}</dd>
              </div>
              <div v-if="current.sense.collocations.length" class="row gap-2">
                <dt class="shrink-0 w-20 text-fg-3">常用搭配</dt><dd class="m-0 min-w-0 text-fg-2">{{ current.sense.collocations.join(' · ') }}</dd>
              </div>
              <div v-if="current.sense.synonyms.length" class="row gap-2">
                <dt class="shrink-0 w-20 text-fg-3">近义 / 易混</dt><dd class="m-0 min-w-0 text-fg-2">{{ current.sense.synonyms.join(' · ') }}</dd>
              </div>
            </dl>
          </template>
        </div>
      </div>

      <footer class="stack gap-2 shrink-0 px-5 py-3 border-t border-line">
        <button v-if="!revealed && current.type === 'question' && !questionLoading && !questionFrontAvailable" class="btn-primary w-full" @click="openCurrentItem">
          先补全题干，再开始复习
        </button>
        <button v-else-if="!revealed && currentCanTypeAnswer" class="btn-default w-full" @click="revealCurrent">暂不输入，直接揭晓</button>
        <div v-else-if="!revealed && currentCanDraftAnswer" class="row gap-2">
          <button class="btn-default flex-1" @click="revealCurrent">暂不记录，直接揭晓</button>
          <button type="submit" form="question-review-form" class="btn-primary flex-1">对照答案<kbd class="kbd">Ctrl / ⌘ Enter</kbd></button>
        </div>
        <button v-else-if="!revealed" class="btn-primary w-full" :disabled="questionLoading" @click="revealCurrent">
          {{ current.type === 'word' ? '查看答案' : questionLoading ? '正在读取题目…' : current.facet === 'error' ? '先回想错因，再看复盘' : '先想一想，再看解法' }}
        </button>

        <template v-else>
          <!-- Four ratings, four equal targets, always in this order. The
               colour is a tint rather than a fill: these are pressed all day,
               and four saturated buttons in a row is a slot machine. -->
          <div class="row-between gap-3">
            <p class="text-[12px] text-fg-2">{{ current.type === 'word' ? `这张${vocabularyReviewFacetLabels[current.facet]}卡现在有多熟？` : `这张${questionReviewFacetLabels[current.facet]}卡现在有多熟？` }}</p>
            <small v-if="ratingPreviewLoading" class="text-[11px] text-fg-3" role="status">正在估算下一次复习…</small>
          </div>
          <div class="grid grid-cols-4 gap-2">
            <button
              v-for="item in ratingOptions"
              :key="item.rating"
              class="stack items-center justify-center gap-0.5 h-13 rounded-sm border bg-surface transition-colors disabled:opacity-45 disabled:cursor-not-allowed"
              :class="ratingTone[item.rating]"
              :disabled="ratingInProgress || questionLoading"
              :aria-label="`${item.shortcut}，${item.label}；下次复习 ${ratingIntervals[item.rating] || '正在估算'}`"
              @click="rate(item.rating)"
            >
              <b class="row gap-1.5 text-[13px] font-medium"><kbd class="kbd">{{ item.shortcut }}</kbd>{{ item.label }}</b>
              <small class="text-[11px] text-fg-3 tabular-nums">{{ ratingIntervals[item.rating] || item.rating }}</small>
            </button>
          </div>
        </template>

        <p v-if="reviewError" class="text-[12px] text-danger" role="alert">{{ reviewError }}</p>
        <small class="text-[11px] text-fg-3">
          <span v-if="currentCanTypeAnswer && !revealed">Enter 检查 · </span><span v-if="currentCanDraftAnswer && !revealed">Ctrl/⌘ Enter 对照 · </span>Space 翻面 · 1–4 评分 · D 稍后再看<span v-if="currentWordAnswerVisible"> · P 朗读</span><span v-if="currentCanRetryAnswer && revealed"> · R 重答</span> · Ctrl/⌘ Z 撤销 · Shift+F10 打开菜单
        </small>
      </footer>
    </section>

    <section v-else class="panel stack items-center justify-center gap-3 min-h-80 px-6 py-12 text-center">
      <span class="center w-13 h-13 rounded-lg bg-accent-soft text-accent">
        <AppIcon :name="reviewFinishedState.icon" :size="24" />
      </span>
      <b class="text-[17px] font-semibold text-fg">{{ reviewFinishedState.title }}</b>
      <p class="max-w-120 text-[13px] leading-relaxed text-fg-2">{{ reviewFinishedState.detail }}</p>
      <div class="row gap-2 mt-1">
        <template v-if="deferredCount">
          <button class="btn-primary" @click="restoreDeferred">继续复习暂缓卡</button>
          <RouterLink class="btn-default" to="/library">先去收集资料</RouterLink>
        </template>
        <template v-else-if="reviewEmptyState === 'filtered'">
          <button class="btn-primary" @click="selectReviewKind('all')">查看全部到期内容</button>
        </template>
        <template v-else-if="reviewEmptyState === 'no-material'">
          <RouterLink class="btn-primary" to="/documents?kind=question&create=question">记录第一道错题</RouterLink>
          <RouterLink class="btn-default" to="/words?action=create">录入第一个单词</RouterLink>
        </template>
        <template v-else-if="reviewEmptyState === 'no-cards'">
          <RouterLink class="btn-primary" to="/documents?kind=question">设置题目卡</RouterLink>
          <RouterLink class="btn-default" to="/words">设置单词卡</RouterLink>
        </template>
        <template v-else-if="reviewEmptyState === 'waiting'">
          <RouterLink class="btn-primary" to="/knowledge">回到知识库</RouterLink>
          <RouterLink class="btn-default" to="/documents?kind=question&create=question">继续记录错题</RouterLink>
        </template>
        <template v-else>
          <RouterLink class="btn-primary" to="/library">去收集资料</RouterLink>
        </template>
      </div>
    </section>

    <!-- One materials section, not two. "准备复习材料" and "管理复习材料" were
         separate panels with separate headers that both linked to the same two
         places; split by source instead, each column carrying its own count. -->
    <section class="panel mt-4 p-4" aria-labelledby="review-materials-title">
      <header class="row-between gap-4 mb-3">
        <div class="stack gap-0.5 min-w-0">
          <h3 id="review-materials-title" class="text-[14px] font-semibold text-fg">复习材料</h3>
          <p class="text-[12px] text-fg-3">卡片从结构化题目和词义生成；一个题目或词义可生成多个卡面，各自保留 FSRS 强度与到期时间。</p>
        </div>
      </header>
      <div class="grid gap-3 grid-cols-1 lg:grid-cols-2">
        <div v-for="group in materialGroups" :key="group.id" class="stack gap-2 p-3 rounded-md bg-surface-2 border border-line">
          <RouterLink :to="group.to" class="row-between gap-3 group min-h-6">
            <span class="row gap-2.5 min-w-0">
              <AppIcon :name="group.icon" :size="17" class="shrink-0 text-accent" />
              <b class="text-[13px] font-medium text-fg truncate">{{ group.label }}</b>
            </span>
            <small class="shrink-0 text-[12px] text-fg-3 tabular-nums">{{ group.summary }}</small>
          </RouterLink>
          <div class="stack gap-1">
            <RouterLink
              v-for="action in group.actions"
              :key="action.id"
              v-memo="[action.id]"
              :to="action.to"
              class="row gap-2.5 h-9 px-2 rounded-sm text-fg-2 transition-colors hover:bg-surface-3 hover:text-fg"
            >
              <AppIcon :name="action.icon" :size="14" class="shrink-0 text-fg-3" />
              <b class="text-[12px] font-normal">{{ action.label }}</b>
              <small class="ml-auto text-[11px] text-fg-3 truncate">{{ action.detail }}</small>
            </RouterLink>
          </div>
        </div>
      </div>
    </section>

    <Teleport to="body">
      <section
        v-if="reviewMenu && current"
        ref="reviewMenuElement"
        class="fixed z-[120] w-64 p-1 rounded-md bg-surface border border-line-strong shadow-lg"
        role="menu"
        :aria-label="`${currentCardTitle} 操作`"
        :style="{ left: `${reviewMenu.x}px`, top: `${reviewMenu.y}px` }"
        @click.stop
        @contextmenu.prevent
        @keydown="handleReviewMenuKeydown"
      >
        <p class="px-2.5 py-1.5 text-[11px] text-fg-3 truncate">{{ currentCardTitle }}</p>
        <button v-if="currentSourceAnchor" class="nav-item w-full" role="menuitem" @click="openCurrentSource">回到来源资料 · 第 {{ currentSourceAnchor.pageIndex + 1 }} 页</button>
        <button v-if="currentQuestionSource.raw" class="nav-item w-full" role="menuitem" @click="copyCurrentQuestionSource">复制来源 / 出处</button>
        <button v-if="currentQuestionSource.kind !== 'text'" class="nav-item w-full" role="menuitem" @click="openCurrentQuestionSource">{{ questionSourceActionLabel(currentQuestionSource) }}</button>
        <button class="nav-item w-full" role="menuitem" @click="openCurrentItem">{{ currentLocationLabel }}</button>
        <button v-if="current.type === 'word' && currentWordAnswerVisible" class="nav-item w-full" role="menuitem" @click="speakCurrentWord">{{ speakingEntryId === current.entry.id ? '停止朗读' : '朗读单词' }}<kbd class="kbd ml-auto">P</kbd></button>
        <button v-if="!revealed && currentHasDraftAnswer" class="nav-item w-full" role="menuitem" @click="clearCurrentAnswer">清空本次作答</button>
        <button v-if="revealed && currentCanRetryAnswer" class="nav-item w-full" role="menuitem" @click="retryCurrentAnswer">重新作答<kbd class="kbd ml-auto">R</kbd></button>
        <button class="nav-item w-full" role="menuitem" :disabled="questionLoading || (current.type === 'question' && !questionFrontAvailable)" @click="copyCurrentReviewCard">{{ current.type === 'word' ? revealed ? '复制完整单词 Markdown' : '复制当前题面 Markdown' : revealed ? '复制当前卡片 Markdown' : '复制题目 Markdown' }}</button>
        <button v-if="canUndoLastRating" class="nav-item w-full" role="menuitem" :disabled="ratingInProgress" @click="undoLastRating">撤销上一评分<kbd class="kbd ml-auto">Ctrl / ⌘ Z</kbd></button>
        <button class="nav-item w-full" role="menuitem" @click="deferCurrent">本轮稍后再看<kbd class="kbd ml-auto">D</kbd></button>
        <button class="nav-item w-full" role="menuitem" @click="closeReviewMenu(true)">继续复习</button>
      </section>
    </Teleport>
  </div>
</template>
