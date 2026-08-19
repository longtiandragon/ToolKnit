import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import type { ActivityRecord, AiProfile, ClipboardItem, ContentFavorite, ContentFavoriteKind, ContentRecent, EntityRelation, FavoriteTool, FileReference, Job, QuestionReviewFacet, QuestionType, ReviewRating, ReviewState, Source, SourceAnchor, StudyDocument, ToolPipelineRecipe, ToolRecipe, ToolUsage, VocabularyEntry, VocabularyReviewFacet, WorkbenchSettings } from '@/types'
import { portableJobDetail, portableProcessingJob } from '@/lib/job-privacy'
import { newId } from '@/lib/id'
import { questionTemplate } from '@/lib/question-template'
import { defaultWorkbenchSettings, parsePersistedWorkspace, type WorkspaceSnapshot } from '@/lib/workspace-backup'
import { normalizeClipboardHistory, normalizeFavoriteOrder, pruneClipboardHistory } from '@/lib/workbench-utils'
import { cloneStudyDocument, insertStudyDocument, normalizeDocumentFolder } from '@/lib/study-document'
import { cloneVocabularyEntry } from '@/lib/vocabulary'
import { vocabularySearchText } from '@/lib/vocabulary-search'
import { vocabularyReviewCards, vocabularyReviewForFacet, withVocabularyReviewFacet } from '@/lib/vocabulary-review'
import { questionReviewCards, questionReviewForFacet, withQuestionReviewFacet } from '@/lib/question-review'
import { gradeFsrsReview } from '@/lib/fsrs-review'
import { normalizeWikiTitle, parseWikiLinks } from '@/lib/wiki-links'
import { appendDocumentRecoveryChange, parseDesktopDocumentRecovery, replayDesktopDocumentRecovery, serializeDesktopDocumentRecoveryBounded, type DesktopDocumentRecoveryChange } from '@/lib/desktop-document-recovery'
import { appendVocabularyRecoveryChange, parseDesktopVocabularyRecovery, replayDesktopVocabularyRecovery, serializeDesktopVocabularyRecoveryBounded, type DesktopVocabularyRecoveryChange } from '@/lib/desktop-vocabulary-recovery'
import { appendRelationRecoveryChange, parseDesktopRelationRecovery, replayDesktopRelationRecovery, serializeDesktopRelationRecoveryBounded, type DesktopRelationRecoveryChange } from '@/lib/desktop-relation-recovery'
import { activityToTimelineEvent, isRecentToolActivityDuplicate, MAX_TIMELINE_ACTIVITIES, timelineActivities } from '@/lib/timeline-activity'
import { normalizeSourceTags } from '@/lib/source-list'
import { boundedJobHistory, createCoalescedTask, createPrimaryWorkspaceSnapshot } from '@/lib/workspace-persistence'
import { cleanupClipboardAssets, clearDesktopClipboardItems, clearDesktopContentRecents, deleteDesktopClipboardItem, deleteDesktopProcessingJob, deleteDesktopProcessingJobs, deleteDesktopRelation, deleteDesktopVaultDocument, deleteDesktopVocabulary, exportDesktopVaultDocuments, exportDesktopVocabulary, findDesktopWikiBacklinks, getDesktopClipboardItem, getDesktopReviewQueueSummary, getDesktopSource, getDesktopSourceCrop, getDesktopVaultDocument, getDesktopVocabulary, gradeDesktopReviewCard, hydrateDesktopClipboard, hydrateDesktopContentFavorites, hydrateDesktopContentRecents, hydrateDesktopProcessingJobs, hydrateDesktopSources, hydrateDesktopVault, importDesktopSource as importNativeDesktopSource, isDesktop, listDesktopActivityEvents, listDesktopProcessingJobs, localAssetUrl, reconcileDesktopVaultMarkdown, removeDesktopContentRecent, replaceDesktopActivityEvents, replaceDesktopContentFavorites, replaceDesktopContentRecents, replaceDesktopRelations, replaceDesktopVaultDocuments, replaceDesktopVocabulary, saveDesktopClipboardItem, saveDesktopEvent, saveDesktopProcessingJob, saveDesktopQuestionBatch, saveDesktopRelation, saveDesktopSource, saveDesktopSourceCrops, saveDesktopSourceTags, saveDesktopVaultDocument, saveDesktopVocabulary, saveDesktopVocabularyBatch, searchDesktopVaultDocuments, searchDesktopVocabulary, setDesktopClipboardItemPinned, setDesktopContentFavorite, touchDesktopContentRecent, undoDesktopReviewGrade, type DesktopReviewCardSummary, type DesktopReviewGradeResult, type DesktopReviewQueueSummary, type DesktopVaultMarkdownReconcile, type DesktopVaultSearchResult, type DesktopVocabularySummary } from '@/lib/native'
import { contentFavoriteKey, removeContentFavorite, upsertContentFavorite } from '@/lib/content-favorites'
import { contentRecentKey, removeContentRecent, upsertContentRecent } from '@/lib/content-recents'
import { removeEntityRelations } from '@/lib/relation-targets'

const STORE_KEY = 'toolknit:workspace:v1'
const CLIPBOARD_KEY = 'toolknit:clipboard:v1'
const CODE_DRAFT_KEY = 'toolknit:code-draft:v1'
const DESKTOP_DOCUMENT_RECOVERY_KEY = 'toolknit:desktop-document-recovery:v1'
const DESKTOP_VOCABULARY_RECOVERY_KEY = 'toolknit:desktop-vocabulary-recovery:v1'
const DESKTOP_RELATION_RECOVERY_KEY = 'toolknit:desktop-relation-recovery:v1'
type PersistedWorkspace = WorkspaceSnapshot
export type VaultBootstrapStage = 'idle' | 'opening' | 'sources' | 'pointers' | 'activity' | 'processing' | 'clipboard' | 'ready' | 'fallback'

function now() { return new Date().toISOString() }

function vocabularySummaryEntry(summary: DesktopVocabularySummary): VocabularyEntry {
  return {
    id: summary.id,
    lemma: summary.lemma,
    language: summary.language,
    ...(summary.pronunciation ? { pronunciation: summary.pronunciation } : {}),
    forms: {},
    senses: [],
    createdAt: summary.createdAt,
    updatedAt: summary.updatedAt,
    summaryOnly: true,
    senseCount: summary.senseCount,
    partOfSpeechPreview: summary.partOfSpeechPreview,
    definitionPreview: summary.definitionPreview,
  }
}

function seedQuestion(): StudyDocument {
  const created = now()
  return {
    id: newId(), title: '二分答案：最小可行值', kind: 'question', questionType: 'algorithm', subject: '算法',
    tags: ['二分', '边界'], difficulty: 3,
    questionDetails: { source: '算法训练 · 二分答案', stem: '给定答案范围，求满足条件的最小值。', answer: '使用二分答案，并保持可行区间收缩。', explanation: '令 left、right 表示候选答案范围；当 mid 可行时收缩 right，否则抬高 left。', wrongAnswer: '循环使用 left < right，但更新分支没有保证收缩。', errorReason: '没有先写清循环不变量，边界更新不够严谨。' },
    content: `## 题目\n给定答案范围，求满足条件的最小值。\n\n## 我的尝试\n二分循环使用了 \`left < right\`，但更新分支没有保证收缩。\n\n## 错误原因\n- [ ] 概念不清\n- [x] 边界条件\n- [ ] 实现细节\n\n## 正确解法\n保持 \`left\` 为可行区间左边界，\`right\` 为可行区间右边界；当 \`mid\` 可行时令 \`right = mid\`。\n\n## 知识点\n[[二分]] [[循环不变量]]\n\n## 复盘\n写完先用单元素、全不可行和临界可行三组数据走一遍。`,
    createdAt: created, updatedAt: created, reviewEnabled: true,
    review: { due: created, intervalDays: 0, repetitions: 0, lapses: 0 }, errorTypes: ['边界条件']
  }
}

function load(): PersistedWorkspace {
  try {
    const raw = localStorage.getItem(STORE_KEY)
    if (raw) {
      const restored = parsePersistedWorkspace(raw)
      if (restored) return restored
    }
  } catch { /* reset corrupt browser fallback data */ }
  return { sources: [], documents: [seedQuestion()], jobs: [], aiProfiles: [], activeVaultName: '我的 KnitspaceVault', recipes: [], pipelineRecipes: [], favorites: [], contentFavorites: [], contentRecents: [], toolUsages: [], activities: [], settings: { ...defaultWorkbenchSettings } }
}

function loadClipboard() {
  try { return normalizeClipboardHistory(JSON.parse(localStorage.getItem(CLIPBOARD_KEY) ?? '[]')) } catch { return [] }
}

function loadCodeDraft(fallback?: { content: string; name: string }) {
  try {
    const parsed = JSON.parse(localStorage.getItem(CODE_DRAFT_KEY) ?? 'null')
    if (parsed && typeof parsed.content === 'string' && typeof parsed.name === 'string') return parsed as { content: string; name: string }
  } catch { /* ignore a corrupt standalone draft and use the workspace copy */ }
  return fallback
}

function loadDesktopDocumentRecovery() {
  return parseDesktopDocumentRecovery(localStorage.getItem(DESKTOP_DOCUMENT_RECOVERY_KEY))
}

function loadDesktopVocabularyRecovery() {
  return parseDesktopVocabularyRecovery(localStorage.getItem(DESKTOP_VOCABULARY_RECOVERY_KEY))
}

function loadDesktopRelationRecovery() {
  return parseDesktopRelationRecovery(localStorage.getItem(DESKTOP_RELATION_RECOVERY_KEY))
}

export const useWorkbenchStore = defineStore('workbench', () => {
  const initial = load()
  const sources = ref<Source[]>(initial.sources)
  const documents = ref<StudyDocument[]>(initial.documents)
  const vocabulary = ref<VocabularyEntry[]>((initial.vocabulary ?? []).map(cloneVocabularyEntry))
  const relations = ref<EntityRelation[]>((initial.relations ?? []).map((relation) => ({ ...relation })))
  const jobs = ref<Job[]>(boundedJobHistory(initial.jobs))
  const jobsHasMore = ref(false)
  const jobsLoadingMore = ref(false)
  const aiProfiles = ref<AiProfile[]>(initial.aiProfiles)
  const activeVaultName = ref(initial.activeVaultName)
  const codeDraft = ref(loadCodeDraft(initial.codeDraft))
  const recipes = ref<ToolRecipe[]>(initial.recipes)
  const pipelineRecipes = ref<ToolPipelineRecipe[]>(initial.pipelineRecipes ?? [])
  const favorites = ref<FavoriteTool[]>(initial.favorites ?? [])
  const contentFavorites = ref<ContentFavorite[]>(initial.contentFavorites ?? [])
  const contentFavoriteKeys = computed(() => new Set(contentFavorites.value.map(contentFavoriteKey)))
  const contentRecents = ref<ContentRecent[]>(initial.contentRecents ?? [])
  const contentRecentKeys = computed(() => new Set(contentRecents.value.map(contentRecentKey)))
  const toolUsages = ref<ToolUsage[]>(initial.toolUsages ?? [])
  const activities = ref<ActivityRecord[]>(initial.activities ?? [])
  const activitiesHasMore = ref(false)
  const activitiesLoadingMore = ref(false)
  const settings = ref<WorkbenchSettings>({ ...defaultWorkbenchSettings, ...initial.settings })
  const clipboardItems = ref<ClipboardItem[]>(loadClipboard())
  // Temporary hand-off between the universal intake and a destination tool.
  // File objects deliberately stay in memory and never enter localStorage/backups.
  const intakeFiles = ref<File[]>([])
  const intakeText = ref('')
  const vaultReady = ref(!isDesktop())
  const vaultHydrating = ref(false)
  const vaultError = ref('')
  const vaultBootstrapStage = ref<VaultBootstrapStage>(isDesktop() ? 'idle' : 'ready')
  const vaultRoot = ref('')
  const vaultMarkdownIssues = ref<Record<string, 'missing'>>({})
  const desktopVaultActive = ref(false)
  const desktopReviewSummary = ref<DesktopReviewQueueSummary>()
  // Clipboard history is a separate high-churn SQLite collection. Keep the
  // browser cache only until its one-time desktop migration succeeds.
  const desktopClipboardActive = ref(false)
  // Processing history is a bounded SQLite ledger on desktop. Until its
  // one-time migration succeeds, retain the renderer snapshot as recovery.
  const desktopJobsActive = ref(false)
  let documentMutation = Promise.resolve()
  let clipboardMutation = Promise.resolve()
  let recentMutation = Promise.resolve()
  // Desktop hydration carries only metadata. This map prevents one active
  // Markdown file from being requested twice while the user changes routes.
  const loadedDesktopDocumentIds = new Set<string>()
  const loadedDesktopVocabularyIds = new Set<string>()
  const pendingDesktopVocabularyLoads = new Map<string, Promise<VocabularyEntry | undefined>>()
  const pendingDesktopDocumentLoads = new Map<string, Promise<StudyDocument | undefined>>()
  let documentRevision = 0
  let documentRecoveryChanges: DesktopDocumentRecoveryChange[] = []
  let vocabularyRevision = 0
  let vocabularyRecoveryChanges: DesktopVocabularyRecoveryChange[] = []
  let relationRevision = 0
  let relationRecoveryChanges: DesktopRelationRecoveryChange[] = []
  let activityMutation = Promise.resolve()
  let jobMutation = Promise.resolve()
  let jobSaveTimer: ReturnType<typeof setTimeout> | undefined
  const pendingJobSaves = new Map<string, Job>()
  let jobHistoryCursor: Pick<Job, 'createdAt' | 'id'> | undefined
  let activityHistoryCursor: Pick<import('@/types').TimelineEvent, 'startsAt' | 'updatedAt' | 'id'> | undefined

  function writePrimaryWorkspace() {
    localStorage.setItem(STORE_KEY, JSON.stringify(createPrimaryWorkspaceSnapshot({
      // In desktop mode documents live in the Vault. Pinia intentionally keeps
      // them only as a page cache, so regular UI activity cannot rewrite a 5 MB
      // Markdown collection into localStorage.
      // Source previews can be multi-megabyte data URLs. The desktop Vault
      // owns them; Pinia holds only the in-memory list and selected detail.
      sources: sources.value, documents: documents.value, vocabulary: vocabulary.value, relations: relations.value, jobs: jobs.value,
      aiProfiles: aiProfiles.value, activeVaultName: activeVaultName.value, recipes: recipes.value, pipelineRecipes: pipelineRecipes.value,
      favorites: favorites.value, contentFavorites: contentFavorites.value, contentRecents: contentRecents.value, toolUsages: toolUsages.value,
      // Activities are an in-memory page cache on desktop. Their durable copy
      // belongs to the events table, alongside focus sessions and anniversaries.
      activities: activities.value, settings: settings.value
    } satisfies PersistedWorkspace, desktopVaultActive.value, desktopJobsActive.value)))
    if (desktopClipboardActive.value) localStorage.removeItem(CLIPBOARD_KEY)
    else localStorage.setItem(CLIPBOARD_KEY, JSON.stringify(clipboardItems.value))
  }

  const primaryWorkspacePersistence = createCoalescedTask(writePrimaryWorkspace)
  function persist() { primaryWorkspacePersistence.flush(); flushPendingJobSaves() }
  function schedulePersist() { primaryWorkspacePersistence.schedule() }

  function persistCodeDraft() {
    if (codeDraft.value) localStorage.setItem(CODE_DRAFT_KEY, JSON.stringify(codeDraft.value))
    else localStorage.removeItem(CODE_DRAFT_KEY)
  }

  // One-time migration for releases that embedded the draft in STORE_KEY.
  try {
    if (codeDraft.value && localStorage.getItem(CODE_DRAFT_KEY) === null) persistCodeDraft()
  } catch { /* keep the in-memory legacy draft if WebView storage is unavailable */ }

  function writeDocumentRecovery(change: DesktopDocumentRecoveryChange) {
    if (!isDesktop()) return 0
    const revision = ++documentRevision
    // The old recovery path serialized every document on each save. In a
    // multi-megabyte Markdown vault that makes Ctrl+S visibly pause the UI.
    // A bounded write-ahead journal protects small pending changes while
    // touching only the changed document (full replacement remains explicit).
    // Multi-megabyte Markdown goes straight to the Vault queue instead of
    // competing with synchronous WebView storage.
    const nextChanges = appendDocumentRecoveryChange(documentRecoveryChanges, change)
    const serialized = serializeDesktopDocumentRecoveryBounded(nextChanges, now())
    if (!serialized) {
      // Do not retain an older journal when the newest changed document is too
      // large for WebView storage: replaying it later could overwrite the
      // newer SQLite write. The Vault mutation still receives the full
      // snapshot below, without a synchronous storage quota check on its path.
      documentRecoveryChanges = []
      try { localStorage.removeItem(DESKTOP_DOCUMENT_RECOVERY_KEY) } catch { /* storage may be unavailable */ }
      return revision
    }
    documentRecoveryChanges = nextChanges
    try {
      localStorage.setItem(DESKTOP_DOCUMENT_RECOVERY_KEY, serialized)
    } catch {
      // A platform quota error must not turn Ctrl+S into a renderer exception.
      // Clearing the in-memory and persisted journal prevents stale replay.
      documentRecoveryChanges = []
      try { localStorage.removeItem(DESKTOP_DOCUMENT_RECOVERY_KEY) } catch { /* storage may be unavailable */ }
    }
    return revision
  }

  function clearDocumentRecovery(revision: number) {
    if (revision !== documentRevision) return
    documentRecoveryChanges = []
    localStorage.removeItem(DESKTOP_DOCUMENT_RECOVERY_KEY)
  }

  function writeVocabularyRecovery(change: DesktopVocabularyRecoveryChange) {
    if (!isDesktop()) return 0
    const revision = ++vocabularyRevision
    const nextChanges = appendVocabularyRecoveryChange(vocabularyRecoveryChanges, change)
    const serialized = serializeDesktopVocabularyRecoveryBounded(nextChanges, now())
    if (!serialized) {
      // Do not leave an older recovery journal around when its newer mutation
      // is too large to persist. SQLite still receives the full snapshot.
      vocabularyRecoveryChanges = []
      try { localStorage.removeItem(DESKTOP_VOCABULARY_RECOVERY_KEY) } catch { /* storage may be unavailable */ }
      return revision
    }
    vocabularyRecoveryChanges = nextChanges
    try { localStorage.setItem(DESKTOP_VOCABULARY_RECOVERY_KEY, serialized) }
    catch {
      vocabularyRecoveryChanges = []
      try { localStorage.removeItem(DESKTOP_VOCABULARY_RECOVERY_KEY) } catch { /* storage may be unavailable */ }
    }
    return revision
  }

  function clearVocabularyRecovery(revision: number) {
    if (revision !== vocabularyRevision) return
    vocabularyRecoveryChanges = []
    localStorage.removeItem(DESKTOP_VOCABULARY_RECOVERY_KEY)
  }

  function writeRelationRecovery(change: DesktopRelationRecoveryChange) {
    if (!isDesktop()) return 0
    const revision = ++relationRevision
    const nextChanges = appendRelationRecoveryChange(relationRecoveryChanges, change)
    const serialized = serializeDesktopRelationRecoveryBounded(nextChanges, now())
    if (!serialized) {
      relationRecoveryChanges = []
      try { localStorage.removeItem(DESKTOP_RELATION_RECOVERY_KEY) } catch { /* storage may be unavailable */ }
      return revision
    }
    relationRecoveryChanges = nextChanges
    try { localStorage.setItem(DESKTOP_RELATION_RECOVERY_KEY, serialized) }
    catch {
      relationRecoveryChanges = []
      try { localStorage.removeItem(DESKTOP_RELATION_RECOVERY_KEY) } catch { /* storage may be unavailable */ }
    }
    return revision
  }

  function clearRelationRecovery(revision: number) {
    if (revision !== relationRevision) return
    relationRecoveryChanges = []
    localStorage.removeItem(DESKTOP_RELATION_RECOVERY_KEY)
  }

  function queueVaultMutation(action: () => Promise<void>) {
    if (!desktopVaultActive.value) return Promise.resolve()
    documentMutation = documentMutation
      .catch(() => undefined)
      .then(action)
    return documentMutation
  }

  function queueClipboardMutation<T>(action: () => Promise<T>) {
    const task = clipboardMutation.catch(() => undefined).then(action)
    // Keep this lane usable after an individual operation fails, while the
    // caller still receives the original rejection for UI recovery.
    clipboardMutation = task.then(() => undefined, () => undefined)
    return task
  }

  function compactDesktopClipboardItem(item: ClipboardItem) {
    const content = item.content
    if (!content || content.length <= 12_000) return { ...item, contentLoaded: item.contentLoaded !== false }
    const boundary = [...content].slice(0, 12_000).join('')
    return { ...item, content: boundary, contentLoaded: false }
  }

  function pruneClipboard() {
    const current = clipboardItems.value
    const next = pruneClipboardHistory(current, settings.value.clipboardLimit, settings.value.clipboardRetentionDays)
    clipboardItems.value = next
    return current.filter((item) => !next.some((kept) => kept.id === item.id)).map((item) => item.id)
  }

  function queueDesktopClipboardRemovals(ids: string[]) {
    if (!desktopClipboardActive.value || !ids.length) return
    void queueClipboardMutation(async () => {
      for (const id of ids) await deleteDesktopClipboardItem(id)
      const activePaths = [...clipboardItems.value.map((item) => item.assetPath), ...sources.value.map((source) => source.managedPath)].filter(Boolean) as string[]
      await cleanupClipboardAssets(activePaths)
    }).catch((error) => {
      vaultError.value = error instanceof Error ? error.message : '剪贴板清理尚未写入本地资料库。'
    })
  }

  function queueVaultSave(document: StudyDocument) {
    const snapshot = cloneStudyDocument(document)
    const revision = writeDocumentRecovery({ kind: 'save', document: snapshot })
    return queueVaultMutation(async () => {
      await saveDesktopVaultDocument(snapshot)
      if (snapshot.id in vaultMarkdownIssues.value) {
        const next = { ...vaultMarkdownIssues.value }
        delete next[snapshot.id]
        vaultMarkdownIssues.value = next
      }
      clearDocumentRecovery(revision)
    }).catch((error) => {
      vaultError.value = error instanceof Error ? error.message : '文档尚未写入本地资料库。'
    })
  }

  function queueVaultDelete(id: string) {
    if (id in vaultMarkdownIssues.value) {
      const next = { ...vaultMarkdownIssues.value }
      delete next[id]
      vaultMarkdownIssues.value = next
    }
    const revision = writeDocumentRecovery({ kind: 'delete', id })
    return queueVaultMutation(async () => {
      await deleteDesktopVaultDocument(id)
      clearDocumentRecovery(revision)
    }).catch((error) => {
      vaultError.value = error instanceof Error ? error.message : '删除操作尚未写入本地资料库。'
    })
  }

  function queueVaultReplacement(nextDocuments: StudyDocument[]) {
    const snapshot = nextDocuments.map(cloneStudyDocument)
    const revision = writeDocumentRecovery({ kind: 'replace', documents: snapshot })
    return queueVaultMutation(async () => {
      await replaceDesktopVaultDocuments(snapshot)
      clearDocumentRecovery(revision)
    }).catch((error) => {
      vaultError.value = error instanceof Error ? error.message : '恢复内容尚未写入本地资料库。'
    })
  }

  function queueVocabularySave(entry: VocabularyEntry) {
    const snapshot = cloneVocabularyEntry(entry)
    const revision = writeVocabularyRecovery({ kind: 'save', entry: snapshot })
    return queueVaultMutation(async () => {
      await saveDesktopVocabulary(snapshot)
      clearVocabularyRecovery(revision)
      await refreshDesktopReviewSummary()
    }).catch((error) => { vaultError.value = error instanceof Error ? error.message : '单词尚未写入本地资料库。' })
  }

  function queueVocabularyDelete(id: string) {
    const revision = writeVocabularyRecovery({ kind: 'delete', id })
    return queueVaultMutation(async () => {
      await deleteDesktopVocabulary(id)
      clearVocabularyRecovery(revision)
      await refreshDesktopReviewSummary()
    }).catch((error) => { vaultError.value = error instanceof Error ? error.message : '删除单词尚未写入本地资料库。' })
  }

  function queueVocabularyReplacement(entries: VocabularyEntry[]) {
    const snapshot = entries.map(cloneVocabularyEntry)
    const revision = writeVocabularyRecovery({ kind: 'replace', entries: snapshot })
    return queueVaultMutation(async () => {
      await replaceDesktopVocabulary(snapshot)
      clearVocabularyRecovery(revision)
    }).catch((error) => { vaultError.value = error instanceof Error ? error.message : '单词恢复尚未写入本地资料库。' })
  }

  function queueRelationSave(relation: EntityRelation) {
    const snapshot = { ...relation }
    const revision = writeRelationRecovery({ kind: 'save', relation: snapshot })
    return queueVaultMutation(async () => {
      await saveDesktopRelation(snapshot)
      clearRelationRecovery(revision)
    }).catch((error) => { vaultError.value = error instanceof Error ? error.message : '关联尚未写入本地资料库。' })
  }

  function queueRelationDelete(relation: EntityRelation) {
    const snapshot = { ...relation }
    const revision = writeRelationRecovery({ kind: 'delete', relation: snapshot })
    return queueVaultMutation(async () => {
      await deleteDesktopRelation(snapshot)
      clearRelationRecovery(revision)
    }).catch((error) => { vaultError.value = error instanceof Error ? error.message : '删除关联尚未写入本地资料库。' })
  }

  function queueRelationReplacement(entries: EntityRelation[]) {
    const snapshot = entries.map((relation) => ({ ...relation }))
    const revision = writeRelationRecovery({ kind: 'replace', relations: snapshot })
    return queueVaultMutation(async () => {
      await replaceDesktopRelations(snapshot)
      clearRelationRecovery(revision)
    }).catch((error) => { vaultError.value = error instanceof Error ? error.message : '关联恢复尚未写入本地资料库。' })
  }

  function queueActivitySave(activity: ActivityRecord) {
    if (!desktopVaultActive.value) return
    const event = activityToTimelineEvent(activity)
    // Logs never delay document saving or first paint. A separate serial lane
    // preserves their order while keeping renderer interaction synchronous.
    activityMutation = activityMutation
      .catch(() => undefined)
      .then(() => saveDesktopEvent(event))
      .catch((error) => { vaultError.value = error instanceof Error ? error.message : '活动记录尚未写入本地资料库。' })
  }

  function cloneJob(job: Job): Job {
    return portableProcessingJob(job)
  }

  function flushPendingJobSaves() {
    if (jobSaveTimer !== undefined) { clearTimeout(jobSaveTimer); jobSaveTimer = undefined }
    if (!desktopJobsActive.value || !pendingJobSaves.size) return
    const snapshots = [...pendingJobSaves.values()].map(cloneJob)
    pendingJobSaves.clear()
    jobMutation = jobMutation
      .catch(() => undefined)
      .then(async () => { for (const job of snapshots) await saveDesktopProcessingJob(job) })
      .catch((error) => {
        desktopJobsActive.value = false
        vaultError.value = error instanceof Error ? error.message : '处理任务尚未写入本地资料库。'
        writePrimaryWorkspace()
      })
  }

  function queueJobSave(job: Job, immediate = false) {
    if (!desktopJobsActive.value) return
    pendingJobSaves.set(job.id, cloneJob(job))
    if (immediate) { flushPendingJobSaves(); return }
    if (jobSaveTimer === undefined) jobSaveTimer = setTimeout(flushPendingJobSaves, 900)
  }

  function queueJobDelete(ids: string[]) {
    if (!desktopJobsActive.value || !ids.length) return
    ids.forEach((id) => pendingJobSaves.delete(id))
    jobMutation = jobMutation
      .catch(() => undefined)
      .then(async () => {
        if (ids.length === 1) await deleteDesktopProcessingJob(ids[0])
        else await deleteDesktopProcessingJobs(ids)
      })
      .catch((error) => {
        desktopJobsActive.value = false
        vaultError.value = error instanceof Error ? error.message : '处理任务记录尚未从本地资料库删除。'
        writePrimaryWorkspace()
      })
  }

  async function hydrateVault() {
    if (vaultHydrating.value) return
    if (!isDesktop()) { vaultReady.value = true; vaultBootstrapStage.value = 'ready'; return }
    vaultReady.value = false
    vaultHydrating.value = true
    vaultError.value = ''
    vaultBootstrapStage.value = 'opening'
    desktopClipboardActive.value = false
    const previouslyNativeJobs = desktopJobsActive.value
    const activeJobsBeforeHydration = previouslyNativeJobs
      ? jobs.value.filter((job) => job.status === 'queued' || job.status === 'running').map(cloneJob)
      : []
    desktopJobsActive.value = false
    const recovery = loadDesktopDocumentRecovery()
    const vocabularyRecovery = loadDesktopVocabularyRecovery()
    const relationRecovery = loadDesktopRelationRecovery()
    const browserActivities = activities.value.slice(0, MAX_TIMELINE_ACTIVITIES)
    const browserDocuments = recovery.snapshot ?? documents.value.map(cloneStudyDocument)
    // Sources can include image/PDF data URLs, so migrate them before marking
    // the desktop Vault active. Until that succeeds the browser snapshot stays
    // intact and remains a recovery path.
    const browserSources = sources.value.map((source) => ({ ...source, tags: [...source.tags], crops: source.crops ? { ...source.crops } : undefined }))
    try {
      // Compact native list rows are never valid migration input. Only the
      // former browser workspace or an explicit recovery snapshot is sent.
      const browserVocabulary = vocabularyRecovery.snapshot
        ?? vocabulary.value.filter((entry) => !entry.summaryOnly).map(cloneVocabularyEntry)
      const browserRelations = relationRecovery.snapshot ?? relations.value.map((relation) => ({ ...relation }))
      // The original STORE_KEY remains untouched until native hydration and
      // persist() both succeed. Avoid duplicating the full legacy workspace in
      // localStorage here: large Markdown collections can exceed quota or
      // block the renderer before SQLite migration even begins. Native
      // migration archives plus resumable markers are the durable boundary.
      const hydration = await hydrateDesktopVault(browserDocuments, browserVocabulary, browserRelations)
      if (!hydration) throw new Error('桌面资料库没有返回初始化结果。')
      vaultBootstrapStage.value = 'sources'
      const hydratedSources = await hydrateDesktopSources(browserSources)
      vaultBootstrapStage.value = 'pointers'
      try {
        contentFavorites.value = await hydrateDesktopContentFavorites(contentFavorites.value)
      } catch (error) {
        // Favorites are small optional pointers. A damaged table must not
        // prevent the underlying notes, words, questions, and sources opening.
        vaultError.value = error instanceof Error ? error.message : '内容收藏暂未迁移到本地资料库。'
      }
      try {
        contentRecents.value = await hydrateDesktopContentRecents(contentRecents.value)
      } catch (error) {
        // Recent items are optional navigation pointers. Their migration must
        // never prevent the underlying local content from opening.
        vaultError.value = error instanceof Error ? error.message : '最近使用暂未迁移到本地资料库。'
      }
      // `events` was already the native home for focus and anniversary data.
      // Move the small legacy activity feed once, only when this Vault has no
      // activity records yet. This avoids a 300-call startup migration.
      vaultBootstrapStage.value = 'activity'
      let nativeActivityEvents = await listDesktopActivityEvents(81)
      if (!nativeActivityEvents.length && browserActivities.length) {
        await replaceDesktopActivityEvents(browserActivities.map(activityToTimelineEvent))
        nativeActivityEvents = browserActivities.map(activityToTimelineEvent).slice(0, 81)
      }
      activitiesHasMore.value = nativeActivityEvents.length > 80
      const initialActivityEvents = nativeActivityEvents.slice(0, 80)
      activityHistoryCursor = initialActivityEvents.at(-1)
      activities.value = timelineActivities(initialActivityEvents, 80)
      vaultBootstrapStage.value = 'processing'
      const processingHydration = await hydrateDesktopProcessingJobs(jobs.value.map(cloneJob))
      if (!processingHydration) throw new Error('桌面资料库没有返回处理任务初始化结果。')
      jobs.value = boundedJobHistory([...processingHydration.jobs, ...activeJobsBeforeHydration]
        .filter((job, index, all) => all.findIndex((candidate) => candidate.id === job.id) === index)
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id)))
      jobHistoryCursor = processingHydration.jobs.at(-1)
      jobsHasMore.value = processingHydration.hasMore
      desktopJobsActive.value = true
      const { hydrateAutomationRecipes } = await import('@/lib/automation-recipes')
      const automationHydration = await hydrateAutomationRecipes(recipes.value, pipelineRecipes.value)
      if (!automationHydration) throw new Error('自动化配方初始化失败。')
      recipes.value = automationHydration.recipes
      pipelineRecipes.value = automationHydration.pipelineRecipes
      // `persist()` deliberately clears documents from the primary browser
      // cache in desktop mode. If an app exit happened between changing the UI
      // state and a successful Vault write, recover the legacy full snapshot
      // or replay the compact write-ahead journal before showing the Vault.
      const recoveredDocuments = recovery.snapshot
        ? recovery.snapshot
        : recovery.changes.length
          ? replayDesktopDocumentRecovery(hydration.documents, recovery.changes)
          : hydration.documents.map(cloneStudyDocument)
      if (recovery.snapshot || recovery.changes.length) await replaceDesktopVaultDocuments(recoveredDocuments)
      documents.value = recoveredDocuments
      loadedDesktopDocumentIds.clear()
      if (recovery.snapshot || recovery.changes.length) recoveredDocuments.forEach((document) => loadedDesktopDocumentIds.add(document.id))
      const vocabularyCatalog = hydration.vocabulary.map(vocabularySummaryEntry)
      // Recovery is rare but must replay against complete native records;
      // otherwise a pending edit could erase senses omitted from the catalog.
      const recoveryVocabularyBase = vocabularyRecovery.changes.length
        ? await exportDesktopVocabulary()
        : vocabularyCatalog
      const recoveredVocabulary = vocabularyRecovery.snapshot
        ? vocabularyRecovery.snapshot
        : vocabularyRecovery.changes.length
          ? replayDesktopVocabularyRecovery(recoveryVocabularyBase, vocabularyRecovery.changes)
          : vocabularyCatalog
      if (vocabularyRecovery.snapshot || vocabularyRecovery.changes.length) await replaceDesktopVocabulary(recoveredVocabulary)
      vocabulary.value = recoveredVocabulary
      loadedDesktopVocabularyIds.clear()
      if (vocabularyRecovery.snapshot || vocabularyRecovery.changes.length) {
        recoveredVocabulary.forEach((entry) => loadedDesktopVocabularyIds.add(entry.id))
      }
      const recoveredRelations = relationRecovery.snapshot
        ? relationRecovery.snapshot
        : relationRecovery.changes.length
          ? replayDesktopRelationRecovery(hydration.relations, relationRecovery.changes)
          : hydration.relations.map((relation) => ({ ...relation }))
      if (relationRecovery.snapshot || relationRecovery.changes.length) await replaceDesktopRelations(recoveredRelations)
      relations.value = recoveredRelations
      sources.value = hydratedSources
      vaultRoot.value = hydration.root
      desktopVaultActive.value = true
      desktopReviewSummary.value = await getDesktopReviewQueueSummary().catch(() => undefined)
      vaultBootstrapStage.value = 'clipboard'
      try {
        clipboardItems.value = await hydrateDesktopClipboard(
          clipboardItems.value,
          settings.value.clipboardLimit,
          settings.value.clipboardRetentionDays
        )
        desktopClipboardActive.value = true
        localStorage.removeItem(CLIPBOARD_KEY)
      } catch (error) {
        // A damaged optional clipboard table must never hide the user's Vault.
        // Keep the browser snapshot until the next launch can retry safely.
        vaultError.value = error instanceof Error ? error.message : '剪贴板历史暂未迁移到本地资料库。'
      }
      vaultReady.value = true
      documentRecoveryChanges = []
      vocabularyRecoveryChanges = []
      relationRecoveryChanges = []
      persist()
      localStorage.removeItem(DESKTOP_DOCUMENT_RECOVERY_KEY)
      localStorage.removeItem(DESKTOP_VOCABULARY_RECOVERY_KEY)
      localStorage.removeItem(DESKTOP_RELATION_RECOVERY_KEY)
      if (hydration.migrated) addActivity('system', '已迁移浏览器资料到本地资料库', `已安全导入 ${browserDocuments.length} 条文档与 ${browserVocabulary.length} 个单词`)
      if (recovery.exists) addActivity('system', '已恢复未完成的本地修改', `已恢复 ${recoveredDocuments.length} 条文档到资料库`)
      if (vocabularyRecovery.exists) addActivity('system', '已恢复未完成的单词修改', `已恢复 ${recoveredVocabulary.length} 个单词到资料库`)
      if (relationRecovery.exists) addActivity('system', '已恢复未完成的知识关联', `已恢复 ${recoveredRelations.length} 条关联到资料库`)
      vaultBootstrapStage.value = 'ready'
    } catch (error) {
      // The browser snapshot remains untouched and usable if the desktop
      // service cannot start (permissions, disk error, older binary, etc.).
      desktopVaultActive.value = false
      desktopReviewSummary.value = undefined
      desktopJobsActive.value = false
      jobsHasMore.value = false
      jobHistoryCursor = undefined
      activitiesHasMore.value = false
      activityHistoryCursor = undefined
      vaultError.value = error instanceof Error ? error.message : '本地资料库暂不可用，正在使用恢复副本。'
      vaultBootstrapStage.value = 'fallback'
      persist()
    } finally {
      vaultHydrating.value = false
      vaultReady.value = true
    }
  }

  async function searchDocuments(query: string): Promise<DesktopVaultSearchResult[]> {
    const needle = query.trim().toLocaleLowerCase('zh-CN')
    if (!needle) return []
    if (desktopVaultActive.value) return searchDesktopVaultDocuments(needle)
    // Browser fallback is intentionally small. Desktop search always goes
    // through FTS5 and never filters every Markdown body on the main thread.
    const matchingDocuments = documents.value
      .filter((document) => `${document.title} ${document.subject} ${document.tags.join(' ')} ${document.content}`.toLocaleLowerCase('zh-CN').includes(needle))
      .slice(0, 12)
      .map((document) => ({ id: document.id, title: document.title, kind: document.kind, subject: document.subject, tags: document.tags, updatedAt: document.updatedAt, snippet: document.content.slice(0, 160) }))
    const matchingWords = vocabulary.value
      .filter((entry) => vocabularySearchText(entry).includes(needle))
      .slice(0, 12)
      .map((entry) => ({ id: entry.id, title: entry.lemma, kind: 'word' as const, subject: entry.language, tags: entry.senses.map((sense) => sense.partOfSpeech).filter(Boolean), updatedAt: entry.updatedAt, snippet: entry.senses.map((sense) => `${sense.partOfSpeech} ${sense.definition}`).join(' · ').slice(0, 160) }))
    return [...matchingDocuments, ...matchingWords].slice(0, 12)
  }

  async function loadMoreJobs() {
    if (!desktopJobsActive.value || jobsLoadingMore.value || !jobsHasMore.value) return 0
    const cursor = jobHistoryCursor
    if (!cursor) { jobsHasMore.value = false; return 0 }
    jobsLoadingMore.value = true
    try {
      const page = await listDesktopProcessingJobs(121, cursor)
      jobsHasMore.value = page.length > 120
      const additions = page.slice(0, 120)
      jobHistoryCursor = additions.at(-1)
      const known = new Set(jobs.value.map((job) => job.id))
      jobs.value = boundedJobHistory([...jobs.value, ...additions.filter((job) => !known.has(job.id))])
      return additions.length
    } catch (error) {
      vaultError.value = error instanceof Error ? error.message : '较早的处理任务暂未载入。'
      return 0
    } finally {
      jobsLoadingMore.value = false
    }
  }

  async function loadMoreActivities() {
    if (!desktopVaultActive.value || activitiesLoadingMore.value || !activitiesHasMore.value) return 0
    const cursor = activityHistoryCursor
    if (!cursor) { activitiesHasMore.value = false; return 0 }
    activitiesLoadingMore.value = true
    try {
      const page = await listDesktopActivityEvents(81, cursor)
      activitiesHasMore.value = page.length > 80
      const events = page.slice(0, 80)
      activityHistoryCursor = events.at(-1)
      const additions = timelineActivities(events, 80)
      const known = new Set(activities.value.map((activity) => activity.id))
      activities.value = [...activities.value, ...additions.filter((activity) => !known.has(activity.id))]
        .slice(0, MAX_TIMELINE_ACTIVITIES)
      return additions.length
    } catch (error) {
      vaultError.value = error instanceof Error ? error.message : '较早的操作日志暂未载入。'
      return 0
    } finally {
      activitiesLoadingMore.value = false
    }
  }

  async function findDocumentBacklinks(title: string, excludeId: string): Promise<DesktopVaultSearchResult[]> {
    const normalized = normalizeWikiTitle(title)
    if (!normalized) return []
    if (desktopVaultActive.value) return findDesktopWikiBacklinks(title.trim(), excludeId)
    // The web demo only carries a deliberately small local workspace. Desktop
    // mode takes the indexed SQLite path above and never does this scan.
    return documents.value
      .filter((document) => document.id !== excludeId && parseWikiLinks(document.content).some((link) => normalizeWikiTitle(link.target) === normalized))
      .slice(0, 30)
      .map((document) => ({ id: document.id, title: document.title, kind: document.kind, subject: document.subject, tags: document.tags, updatedAt: document.updatedAt, snippet: `[[${title.trim()}]]` }))
  }

  async function exportBrowserBackup() {
    // The renderer normally retains desktop document metadata only. A manual
    // backup is an explicit operation, so fetch complete Markdown bodies from
    // SQLite instead of silently exporting empty summaries.
    const backupDocuments = desktopVaultActive.value ? await exportDesktopVaultDocuments() : documents.value
    const backupActivities = desktopVaultActive.value
      ? timelineActivities(await listDesktopActivityEvents(MAX_TIMELINE_ACTIVITIES))
      : activities.value
    const backupJobs = desktopJobsActive.value ? await listDesktopProcessingJobs(500) : jobs.value
    const backupVocabulary = desktopVaultActive.value ? await exportDesktopVocabulary() : vocabulary.value
    const { createWorkspaceBackup } = await import('@/lib/workspace-backup-transfer')
    return createWorkspaceBackup({ sources: sources.value, documents: backupDocuments, vocabulary: backupVocabulary, relations: relations.value, jobs: backupJobs, aiProfiles: aiProfiles.value, activeVaultName: activeVaultName.value, codeDraft: codeDraft.value, recipes: recipes.value, pipelineRecipes: pipelineRecipes.value, favorites: favorites.value, contentFavorites: contentFavorites.value, contentRecents: contentRecents.value, toolUsages: toolUsages.value, activities: backupActivities, settings: settings.value })
  }

  async function restoreBrowserBackup(serialized: string) {
    const { prepareWorkspaceRestore } = await import('@/lib/workspace-backup-transfer')
    const { backup, automation: restoredAutomation } = await prepareWorkspaceRestore(serialized, desktopVaultActive.value)
    sources.value = backup.sources; documents.value = backup.documents.map(cloneStudyDocument); loadedDesktopDocumentIds.clear(); documents.value.forEach((document) => loadedDesktopDocumentIds.add(document.id)); vocabulary.value = (backup.vocabulary ?? []).map(cloneVocabularyEntry); loadedDesktopVocabularyIds.clear(); vocabulary.value.forEach((entry) => loadedDesktopVocabularyIds.add(entry.id)); relations.value = (backup.relations ?? []).map((relation) => ({ ...relation })); jobs.value = boundedJobHistory(backup.jobs); aiProfiles.value = backup.aiProfiles; recipes.value = restoredAutomation.recipes; pipelineRecipes.value = restoredAutomation.pipelineRecipes; favorites.value = backup.favorites ?? []; contentFavorites.value = backup.contentFavorites ?? []; contentRecents.value = backup.contentRecents ?? []; toolUsages.value = backup.toolUsages ?? []; activities.value = backup.activities ?? []; settings.value = { ...defaultWorkbenchSettings, ...backup.settings }; activeVaultName.value = backup.activeVaultName; codeDraft.value = backup.codeDraft; persistCodeDraft(); persist()
    jobsHasMore.value = false
    jobHistoryCursor = jobs.value.at(-1)
    activitiesHasMore.value = false
    activityHistoryCursor = activities.value.at(-1) ? activityToTimelineEvent(activities.value.at(-1)!) : undefined
    if (desktopVaultActive.value) {
      for (const source of sources.value) await saveDesktopSource(source)
      sources.value = await hydrateDesktopSources([])
      await queueVaultReplacement(documents.value); await queueVocabularyReplacement(vocabulary.value); await queueRelationReplacement(relations.value)
      contentFavorites.value = await replaceDesktopContentFavorites(contentFavorites.value)
      contentRecents.value = await replaceDesktopContentRecents(contentRecents.value)
      await replaceDesktopActivityEvents(activities.value.slice(0, MAX_TIMELINE_ACTIVITIES).map(activityToTimelineEvent))
      if (desktopJobsActive.value) {
        const existingIds = (await listDesktopProcessingJobs(500)).map((job) => job.id)
        if (existingIds.length) await deleteDesktopProcessingJobs(existingIds)
        for (const job of jobs.value) await saveDesktopProcessingJob(job)
      }
    }
    return { sources: backup.sources.length, documents: backup.documents.length, vocabulary: vocabulary.value.length, recipes: backup.recipes.length }
  }

  /** Questions can produce an answer card and an error-reflection card without
   * duplicating the Markdown entity or coupling their memory strength. */
  const dueQuestionCards = computed(() => documents.value.flatMap((document) => questionReviewCards(document)
    .filter(({ review }) => new Date(review.due) <= new Date())
    .map(({ facet, review }) => ({ document, facet, review }))))
  /** Keep the historical document-level view for dashboards and counts. */
  const dueDocuments = computed(() => [...new Map(dueQuestionCards.value.map(({ document }) => [document.id, document])).values()])
  /** Meaning, spelling, cloze and comparison cards can share a word sense while keeping
   * separate memory strength. The queue stays flat so review rendering never
   * has to scan the entire vocabulary again. */
  const dueVocabularyCards = computed(() => vocabulary.value.flatMap((entry) => entry.senses.flatMap((sense) => vocabularyReviewCards(sense)
    .filter(({ review }) => new Date(review.due) <= new Date())
    .map(({ facet, review }) => ({ entry, sense, facet, review })))))
  const questionCount = computed(() => documents.value.filter((document) => document.kind === 'question').length)
  const weakTags = computed(() => {
    const scores = new Map<string, number>()
    for (const doc of documents.value.filter((item) => item.kind === 'question')) {
      const penalty = (doc.review?.lapses ?? 0) * 2 + (doc.errorTypes.length || 1) + Math.max(0, 4 - doc.difficulty)
      for (const tag of doc.tags) scores.set(tag, (scores.get(tag) ?? 0) + penalty)
    }
    return [...scores.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([tag, score]) => ({ tag, score }))
  })

  async function hash(content: string) {
    const bytes = new TextEncoder().encode(content)
    const result = await crypto.subtle.digest('SHA-256', bytes)
    return [...new Uint8Array(result)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
  }

  async function addSource(input: Omit<Source, 'id' | 'importedAt' | 'sha256' | 'tags'> & { tags?: string[] }) {
    const fingerprint = await hash(`${input.name}:${input.size}:${input.content ?? input.preview ?? ''}`)
    const duplicate = sources.value.find((source) => source.sha256 === fingerprint)
    if (duplicate) return { source: duplicate, duplicate: true }
    const source: Source = { ...input, id: newId(), importedAt: now(), sha256: fingerprint, tags: input.tags ?? [] }
    // Write the complete payload first. After this point localStorage can be
    // cleared safely even when a PDF/image preview is several megabytes.
    if (desktopVaultActive.value) await saveDesktopSource(source)
    sources.value.unshift(source)
    persist()
    return { source, duplicate: false }
  }

  async function importDesktopSource(sourcePath: string) {
    if (!desktopVaultActive.value) throw new Error('本地资料库正在启动，请稍后再导入。')
    const imported = await importNativeDesktopSource(sourcePath)
    const existing = sources.value.find((source) => source.id === imported.source.id)
    const metadata: Source = { ...imported.source, content: undefined, preview: undefined, crops: undefined }
    if (!existing) sources.value.unshift(metadata)
    persist()
    return { source: existing ?? metadata, duplicate: imported.duplicate }
  }

  function touchSource(id: string) {
    const source = sources.value.find((item) => item.id === id)
    if (!source) return
    source.lastOpenedAt = now()
    touchContentRecent('source', id)
    addActivity('source', `打开资料：${source.name}`, undefined, '/library', id)
  }

  async function updateSourceTags(id: string, tags: string[]) {
    const source = sources.value.find((item) => item.id === id)
    if (!source) throw new Error('资料不存在。')
    const normalized = normalizeSourceTags(tags)
    const saved = desktopVaultActive.value
      ? await saveDesktopSourceTags(id, normalized)
      : normalized
    source.tags = [...saved]
    persist()
    return source.tags
  }

  async function loadSourceDetail(id: string) {
    const cached = sources.value.find((source) => source.id === id)
    if (!cached) return undefined
    if (!desktopVaultActive.value) return cached
    const detail = await getDesktopSource(id)
    if (!detail) return cached
    // Direct desktop imports retain the copied binary in Vault/sources. Use
    // Tauri's scoped asset protocol so selecting a PDF/image does not first
    // copy the entire file through a base64 string in JavaScript memory.
    if (!detail.preview && detail.managedPath && (detail.kind === 'pdf' || detail.kind === 'image')) detail.preview = localAssetUrl(detail.managedPath)
    const index = sources.value.findIndex((source) => source.id === id)
    if (index >= 0) sources.value[index] = detail
    return detail
  }

  /** Loads a single Markdown body when the user opens it. Document metadata
   * remains enough for lists, folders, due counts and FTS navigation. */
  async function loadDocument(id: string) {
    const cached = documents.value.find((document) => document.id === id)
    if (!cached || !desktopVaultActive.value || loadedDesktopDocumentIds.has(id)) return cached
    const pending = pendingDesktopDocumentLoads.get(id)
    if (pending) return pending
    const request = getDesktopVaultDocument(id)
      .then((document) => {
        if (!document) return undefined
        const index = documents.value.findIndex((item) => item.id === id)
        if (index >= 0) documents.value[index] = cloneStudyDocument(document)
        loadedDesktopDocumentIds.add(id)
        return documents.value[index] ?? document
      })
      .finally(() => { pendingDesktopDocumentLoads.delete(id) })
    pendingDesktopDocumentLoads.set(id, request)
    return request
  }

  /** Reads one structured word for review/open operations. Desktop queues carry
   * only a card pointer, so a large vocabulary never has to be rehydrated just
   * to reveal one answer. */
  async function loadVocabulary(id: string) {
    const cached = vocabulary.value.find((entry) => entry.id === id)
    if (!desktopVaultActive.value || loadedDesktopVocabularyIds.has(id) || (cached && !cached.summaryOnly)) return cached
    const pending = pendingDesktopVocabularyLoads.get(id)
    if (pending) return pending
    const request = getDesktopVocabulary(id)
      .then((entry) => {
        if (!entry) return cached
        const snapshot = cloneVocabularyEntry(entry)
        const index = vocabulary.value.findIndex((item) => item.id === id)
        if (index >= 0) vocabulary.value[index] = snapshot
        else vocabulary.value.unshift(snapshot)
        loadedDesktopVocabularyIds.add(id)
        return snapshot
      })
      .finally(() => { pendingDesktopVocabularyLoads.delete(id) })
    pendingDesktopVocabularyLoads.set(id, request)
    return request
  }

  async function searchVocabularyEntries(query: string, limit = 120) {
    const needle = query.trim()
    if (!needle) return vocabulary.value
    if (desktopVaultActive.value) return (await searchDesktopVocabulary(needle, limit)).map(vocabularySummaryEntry)
    return vocabulary.value.filter((entry) => vocabularySearchText(entry).includes(needle.toLocaleLowerCase('zh-CN'))).slice(0, limit)
  }

  async function refreshDesktopReviewSummary() {
    if (!desktopVaultActive.value) { desktopReviewSummary.value = undefined; return undefined }
    desktopReviewSummary.value = await getDesktopReviewQueueSummary()
    return desktopReviewSummary.value
  }

  /** Applies a disk-originated managed Markdown update without sending it back
   * through the normal save queue. Unopened documents keep metadata only so a
   * background edit cannot defeat lazy body hydration. */
  async function reconcileVaultMarkdown(id: string): Promise<DesktopVaultMarkdownReconcile> {
    const result = await reconcileDesktopVaultMarkdown(id)
    if (result.status === 'missing') vaultMarkdownIssues.value = { ...vaultMarkdownIssues.value, [id]: 'missing' }
    else if (id in vaultMarkdownIssues.value) {
      const next = { ...vaultMarkdownIssues.value }
      delete next[id]
      vaultMarkdownIssues.value = next
    }
    if (result.status !== 'updated' || !result.document) return result
    const index = documents.value.findIndex((document) => document.id === id)
    if (index < 0) return result
    const wasLoaded = loadedDesktopDocumentIds.has(id)
    const next = cloneStudyDocument(result.document)
    documents.value[index] = wasLoaded ? next : { ...next, content: '' }
    if (wasLoaded) loadedDesktopDocumentIds.add(id)
    return { ...result, document: next }
  }

  async function loadSourceCrop(sourceId: string, cropId: string) {
    const source = sources.value.find((item) => item.id === sourceId)
    const cached = source?.crops?.[cropId]
    if (cached || !desktopVaultActive.value) return cached
    const crop = await getDesktopSourceCrop(sourceId, cropId)
    if (crop && source) source.crops = { ...(source.crops ?? {}), [cropId]: crop }
    return crop ?? undefined
  }

  function createQuestion(source?: Source, anchor?: SourceAnchor) {
    const created = now()
    const document: StudyDocument = {
      id: newId(), title: source ? `来自 ${source.name} 的错题` : '未命名错题', kind: 'question', questionType: source?.kind === 'code' ? 'algorithm' : 'general',
      subject: source?.kind === 'code' ? '算法' : '未分类', tags: source?.tags ?? [], difficulty: 3,
      questionDetails: { source: '', stem: '', answer: '', explanation: '', wrongAnswer: '', errorReason: '' },
      content: questionTemplate(source ? `来自 ${source.name} 的错题` : '未命名错题'), sourceAnchor: anchor,
      createdAt: created, updatedAt: created, reviewEnabled: true,
      review: { due: created, intervalDays: 0, repetitions: 0, lapses: 0 }, errorTypes: []
    }
    documents.value.unshift(document)
    loadedDesktopDocumentIds.add(document.id)
    persist()
    void queueVaultSave(document)
    return document
  }

  function attachCrop(sourceId: string, dataUrl?: string) {
    if (!dataUrl) return undefined
    const source = sources.value.find((item) => item.id === sourceId)
    if (!source) return undefined
    const id = newId(); source.crops = { ...(source.crops ?? {}), [id]: dataUrl }
    if (desktopVaultActive.value) void saveDesktopSourceCrops(sourceId, source.crops).catch((error) => {
      vaultError.value = error instanceof Error ? error.message : '资料裁剪尚未写入本地资料库。'
    })
    persist(); return id
  }

  function createNote(title = '未命名笔记', folder?: string, initialContent?: string) {
    const created = now()
    const normalizedFolder = normalizeDocumentFolder(folder)
    const document: StudyDocument = { id: newId(), title, kind: 'note', subject: '未分类', tags: [], ...(normalizedFolder ? { folder: normalizedFolder } : {}), difficulty: 0, content: initialContent ?? `# ${title}\n`, createdAt: created, updatedAt: created, reviewEnabled: false, errorTypes: [] }
    documents.value.unshift(document)
    loadedDesktopDocumentIds.add(document.id)
    persist()
    void queueVaultSave(document)
    return document
  }

  function createVocabularyEntry(lemma = 'new word') {
    const created = now()
    const entry: VocabularyEntry = {
      id: newId(), lemma, language: '英语', pronunciation: '', forms: {}, createdAt: created, updatedAt: created,
      senses: [{ id: newId(), partOfSpeech: 'noun', definition: '', examples: [], collocations: [], synonyms: [], reviewEnabled: false }]
    }
    vocabulary.value.unshift(entry)
    loadedDesktopVocabularyIds.add(entry.id)
    persist()
    void queueVocabularySave(entry)
    return entry
  }

  function saveVocabularyEntry(next: VocabularyEntry) {
    const index = vocabulary.value.findIndex((entry) => entry.id === next.id)
    if (index < 0) return
    vocabulary.value[index] = { ...cloneVocabularyEntry(next), updatedAt: now() }
    loadedDesktopVocabularyIds.add(next.id)
    persist()
    void queueVocabularySave(vocabulary.value[index])
  }

  /** Commits a parsed study list before exposing it in the renderer. Desktop
   * uses one SQLite transaction, so a malformed row cannot leave half an
   * import behind; browser preview keeps the same in-memory merge semantics. */
  async function importVocabularyEntries(entries: VocabularyEntry[]) {
    const snapshots = entries.map(cloneVocabularyEntry)
    if (!snapshots.length) return
    if (desktopVaultActive.value) await queueVaultMutation(() => saveDesktopVocabularyBatch(snapshots))
    if (desktopVaultActive.value) await refreshDesktopReviewSummary()
    const incomingIds = new Set(snapshots.map((entry) => entry.id))
    vocabulary.value = [
      ...snapshots,
      ...vocabulary.value.filter((entry) => !incomingIds.has(entry.id)),
    ]
    snapshots.forEach((entry) => loadedDesktopVocabularyIds.add(entry.id))
    persist()
    addActivity('system', '批量导入单词', `${snapshots.length} 个结构化词条已写入本地资料库`, '/words')
  }

  /** Parsed questions are committed before entering the renderer list. The
   * desktop command validates every record and uses one SQLite transaction;
   * browser preview preserves the same new-only semantics in memory. */
  async function importQuestionDocuments(entries: StudyDocument[]) {
    const snapshots = entries.map(cloneStudyDocument)
    if (!snapshots.length) return
    if (snapshots.some(document => document.kind !== 'question')) throw new Error('批量导入只接受题目。')
    const incomingIds = new Set(snapshots.map(document => document.id))
    if (incomingIds.size !== snapshots.length || documents.value.some(document => incomingIds.has(document.id))) throw new Error('批量题目包含重复 ID。')
    if (desktopVaultActive.value) await queueVaultMutation(() => saveDesktopQuestionBatch(snapshots))
    for (const document of snapshots) loadedDesktopDocumentIds.add(document.id)
    documents.value = [...snapshots, ...documents.value]
    persist()
    addActivity('system', '批量导入题目', `${snapshots.length} 道结构化题目已写入本地资料库`, '/documents?kind=question')
  }

  function deleteVocabularyEntry(id: string) {
    vocabulary.value = vocabulary.value.filter((entry) => entry.id !== id)
    loadedDesktopVocabularyIds.delete(id)
    pendingDesktopVocabularyLoads.delete(id)
    contentFavorites.value = removeContentFavorite(contentFavorites.value, 'word', id)
    contentRecents.value = removeContentRecent(contentRecents.value, 'word', id)
    relations.value = relations.value.filter((relation) => relation.fromId !== id && relation.toId !== id)
    persist()
    void queueVocabularyDelete(id)
  }

  function createRelation(fromId: string, toId: string, relationType: EntityRelation['relationType']) {
    if (!fromId || !toId || fromId === toId) return undefined
    const existing = relations.value.find((relation) => relation.fromId === fromId && relation.toId === toId && relation.relationType === relationType)
    if (existing) return existing
    const relation: EntityRelation = { fromId, toId, relationType, createdAt: now() }
    relations.value.unshift(relation)
    persist()
    void queueRelationSave(relation)
    return relation
  }

  function deleteRelation(relation: EntityRelation) {
    relations.value = relations.value.filter((item) => !(item.fromId === relation.fromId && item.toId === relation.toId && item.relationType === relation.relationType))
    persist()
    void queueRelationDelete(relation)
  }

  function saveDocument(next: StudyDocument) {
    const index = documents.value.findIndex((document) => document.id === next.id)
    if (index === -1) return
    documents.value[index] = { ...cloneStudyDocument(next), updatedAt: now() }
    loadedDesktopDocumentIds.add(next.id)
    persist()
    void queueVaultSave(documents.value[index])
  }

  /** Explicit recovery/conflict path: wait for the native atomic file + SQLite
   * transaction before clearing a missing-file warning in the renderer. */
  async function writeManagedVaultMarkdown(next: StudyDocument) {
    const index = documents.value.findIndex((document) => document.id === next.id)
    if (index === -1) throw new Error('文档记录已经不存在。')
    const snapshot = { ...cloneStudyDocument(next), updatedAt: now() }
    await queueVaultMutation(() => saveDesktopVaultDocument(snapshot))
    documents.value[index] = snapshot
    loadedDesktopDocumentIds.add(snapshot.id)
    if (snapshot.id in vaultMarkdownIssues.value) {
      const issues = { ...vaultMarkdownIssues.value }
      delete issues[snapshot.id]
      vaultMarkdownIssues.value = issues
    }
    persist()
    return cloneStudyDocument(snapshot)
  }

  function insertDocument(next: StudyDocument) {
    const inserted = insertStudyDocument(documents.value, next)
    if (inserted === documents.value) return false
    documents.value = inserted
    loadedDesktopDocumentIds.add(next.id)
    persist()
    void queueVaultSave(documents.value[0])
    return true
  }

  function deleteDocument(id: string) {
    const kind = documents.value.find((document) => document.id === id)?.kind
    documents.value = documents.value.filter((document) => document.id !== id)
    if (kind) contentFavorites.value = removeContentFavorite(contentFavorites.value, kind, id)
    if (kind) contentRecents.value = removeContentRecent(contentRecents.value, kind, id)
    loadedDesktopDocumentIds.delete(id)
    pendingDesktopDocumentLoads.delete(id)
    relations.value = relations.value.filter((relation) => relation.fromId !== id && relation.toId !== id)
    persist()
    void queueVaultDelete(id)
  }

  async function gradeDocument(
    id: string,
    rating: ReviewRating,
    facet: QuestionReviewFacet = 'answer',
    nativeCard?: Pick<DesktopReviewCardSummary, 'id' | 'updatedAt' | 'review'>,
  ): Promise<DesktopReviewGradeResult | undefined> {
    const doc = await loadDocument(id)
    const review = doc && (nativeCard?.review ?? questionReviewForFacet(doc, facet))
    if (!doc || !review) return
    const gradedAt = new Date()
    const nextReview = await gradeFsrsReview(review, doc.createdAt, rating, gradedAt)
    if (desktopVaultActive.value && nativeCard) {
      const result = await gradeDesktopReviewCard({
        cardId: nativeCard.id,
        rating,
        nextReview,
        reviewedAt: gradedAt.toISOString(),
        expectedUpdatedAt: nativeCard.updatedAt,
      })
      Object.assign(doc, withQuestionReviewFacet(doc, facet, result.review))
      persist()
      return result
    }
    Object.assign(doc, withQuestionReviewFacet(doc, facet, nextReview))
    doc.updatedAt = now()
    persist()
    await queueVaultSave(doc)
  }

  async function restoreQuestionReview(
    id: string,
    facet: QuestionReviewFacet,
    review: ReviewState,
    nativeUndo?: { eventId: string; expectedCardUpdatedAt: string },
  ): Promise<DesktopReviewGradeResult | undefined> {
    const doc = documents.value.find((item) => item.id === id)
    if (!doc) throw new Error('原题已不存在，无法撤销评分。')
    const result = desktopVaultActive.value && nativeUndo
      ? await undoDesktopReviewGrade(nativeUndo)
      : undefined
    Object.assign(doc, withQuestionReviewFacet(doc, facet, result?.review ?? review))
    if (result) { persist(); return result }
    doc.updatedAt = now()
    loadedDesktopDocumentIds.add(id)
    persist()
    await queueVaultSave(doc)
  }

  async function gradeVocabularySense(
    entryId: string,
    senseId: string,
    rating: ReviewRating,
    facet: VocabularyReviewFacet = 'meaning',
    nativeCard?: Pick<DesktopReviewCardSummary, 'id' | 'updatedAt' | 'review'>,
  ): Promise<DesktopReviewGradeResult | undefined> {
    const entry = await loadVocabulary(entryId)
    const sense = entry?.senses.find((item) => item.id === senseId)
    const review = sense && (nativeCard?.review ?? vocabularyReviewForFacet(sense, facet))
    if (!entry || !sense || !review) return
    const gradedAt = new Date()
    const nextReview = await gradeFsrsReview(review, entry.createdAt, rating, gradedAt)
    const result = desktopVaultActive.value && nativeCard
      ? await gradeDesktopReviewCard({
          cardId: nativeCard.id,
          rating,
          nextReview,
          reviewedAt: gradedAt.toISOString(),
          expectedUpdatedAt: nativeCard.updatedAt,
        })
      : undefined
    const nextSense = withVocabularyReviewFacet(sense, facet, result?.review ?? nextReview)
    entry.senses = entry.senses.map((item) => item.id === senseId ? nextSense : item)
    if (result) { persist(); return result }
    entry.updatedAt = now()
    persist()
    await queueVocabularySave(entry)
  }

  async function restoreVocabularySenseReview(
    entryId: string,
    senseId: string,
    facet: VocabularyReviewFacet,
    review: import('@/types').ReviewState,
    nativeUndo?: { eventId: string; expectedCardUpdatedAt: string },
  ): Promise<DesktopReviewGradeResult | undefined> {
    const entry = await loadVocabulary(entryId)
    const sense = entry?.senses.find((item) => item.id === senseId)
    if (!entry || !sense) throw new Error('原单词词义已不存在，无法撤销评分。')
    const result = desktopVaultActive.value && nativeUndo
      ? await undoDesktopReviewGrade(nativeUndo)
      : undefined
    entry.senses = entry.senses.map((item) => item.id === senseId ? withVocabularyReviewFacet(item, facet, result?.review ?? review) : item)
    if (result) { persist(); return result }
    entry.updatedAt = now()
    persist()
    await queueVocabularySave(entry)
  }

  function addJob(kind: Job['kind'], label: string, inputNames: string[] = [], meta: Partial<Job> = {}) {
    const job: Job = { id: newId(), kind, label, inputNames, status: 'queued', progress: 0, createdAt: now(), retryable: false, ...meta }
    const portableJob = portableProcessingJob(job)
    jobs.value = boundedJobHistory([job, ...jobs.value]); queueJobSave(job, true); addActivity('job', `创建任务：${portableJob.label}`, portableJob.inputNames?.join('、'), meta.route, job.id); return job
  }

  function updateJob(id: string, patch: Partial<Job>) {
    const job = jobs.value.find((item) => item.id === id)
    if (!job) return
    Object.assign(job, patch)
    if (patch.status === 'running' && !job.startedAt) job.startedAt = now()
    if (patch.status === 'succeeded' || patch.status === 'failed' || patch.status === 'cancelled') {
      job.completedAt = now()
      const label = patch.status === 'succeeded' ? '完成' : patch.status === 'cancelled' ? '已取消' : '失败'
      const portableJob = portableProcessingJob(job)
      addActivity(patch.status === 'succeeded' ? 'output' : 'job', `${label}：${portableJob.label}`, portableJobDetail(patch.detail), job.route, job.id)
      queueJobSave(job, true)
    } else { queueJobSave(job, patch.status === 'running'); schedulePersist() }
  }

  function removeJob(id: string) { jobs.value = jobs.value.filter((item) => item.id !== id); queueJobDelete([id]); persist() }

  function removeJobs(ids: Iterable<string>) {
    const targets = new Set(ids)
    if (!targets.size) return
    jobs.value = jobs.value.filter((item) => !targets.has(item.id))
    queueJobDelete([...targets])
    persist()
  }

  function addActivity(kind: ActivityRecord['kind'], title: string, detail?: string, route?: string, relatedId?: string) {
    const activity = { id: newId(), kind, title, detail, route, relatedId, createdAt: now() }
    activities.value.unshift(activity)
    activities.value = activities.value.slice(0, MAX_TIMELINE_ACTIVITIES)
    queueActivitySave(activity)
    persist()
  }

  function recordToolUsage(toolId: string, route: string) {
    const usedAt = now()
    toolUsages.value = [{ toolId, route, usedAt }, ...toolUsages.value.filter((item) => item.toolId !== toolId)].slice(0, 40)
    if (isRecentToolActivityDuplicate(activities.value[0], toolId, usedAt)) { schedulePersist(); return }
    addActivity('tool', '打开工具', toolId, route, toolId)
  }

  function toggleFavorite(toolId: string) {
    const existing = favorites.value.find((item) => item.toolId === toolId)
    if (existing) favorites.value = favorites.value.filter((item) => item.toolId !== toolId)
    else favorites.value.push({ toolId, order: favorites.value.length, shortcut: favorites.value.length < 9 ? favorites.value.length + 1 : undefined })
    favorites.value = normalizeFavoriteOrder(favorites.value.map((item) => item.toolId))
    addActivity('system', existing ? '取消收藏工具' : '收藏工具', toolId)
  }

  function isContentFavorite(itemKind: ContentFavoriteKind, itemId: string) {
    return contentFavoriteKeys.value.has(`${itemKind}:${itemId}`)
  }

  async function toggleContentFavorite(itemKind: ContentFavoriteKind, itemId: string) {
    const previous = contentFavorites.value.find((item) => item.itemKind === itemKind && item.itemId === itemId)
    const existed = Boolean(previous)
    const favorite = !existed
    if (favorite && !existed && contentFavorites.value.length >= 256) throw new Error('内容收藏最多保留 256 项。')
    const optimistic: ContentFavorite = { itemId, itemKind, addedAt: now() }
    contentFavorites.value = favorite
      ? upsertContentFavorite(contentFavorites.value, optimistic)
      : removeContentFavorite(contentFavorites.value, itemKind, itemId)
    persist()
    try {
      if (desktopVaultActive.value) {
        const saved = await setDesktopContentFavorite(itemId, itemKind, favorite)
        if (favorite && saved) contentFavorites.value = upsertContentFavorite(contentFavorites.value, saved)
      }
      addActivity('system', favorite ? '收藏本地内容' : '取消收藏内容', `${itemKind}:${itemId}`, undefined, itemId)
      return favorite
    } catch (error) {
      // Roll back only this pointer. The content itself is never modified by
      // favorite failures and remains available from its original space.
      contentFavorites.value = previous
        ? upsertContentFavorite(contentFavorites.value, previous)
        : removeContentFavorite(contentFavorites.value, itemKind, itemId)
      persist()
      throw error
    }
  }

  function isContentRecent(itemKind: ContentFavoriteKind, itemId: string) {
    return contentRecentKeys.value.has(`${itemKind}:${itemId}`)
  }

  function touchContentRecent(itemKind: ContentFavoriteKind, itemId: string) {
    const optimistic: ContentRecent = { itemId, itemKind, openedAt: now() }
    contentRecents.value = upsertContentRecent(contentRecents.value, optimistic)
    schedulePersist()
    if (!desktopVaultActive.value) return
    const task = recentMutation.catch(() => undefined).then(async () => {
      const saved = await touchDesktopContentRecent(itemId, itemKind)
      // A later open may already be at the front. Upserting the native result
      // by timestamp keeps that newer pointer stable.
      contentRecents.value = upsertContentRecent(contentRecents.value, saved)
    })
    recentMutation = task.then(() => undefined, () => undefined)
    void task.catch((error) => {
      vaultError.value = error instanceof Error ? error.message : '最近打开状态尚未写入本地资料库。'
    })
  }

  async function removeFromContentRecents(itemKind: ContentFavoriteKind, itemId: string) {
    contentRecents.value = removeContentRecent(contentRecents.value, itemKind, itemId)
    persist()
    if (desktopVaultActive.value) await removeDesktopContentRecent(itemId, itemKind)
  }

  async function clearContentRecents() {
    contentRecents.value = []
    persist()
    if (desktopVaultActive.value) await clearDesktopContentRecents()
  }

  /** Reflect a native entity deletion in the renderer without issuing another
   * Vault mutation. The native delete command owns the transactional cleanup. */
  function forgetContentPointers(itemKind: ContentFavoriteKind, itemId: string) {
    contentFavorites.value = removeContentFavorite(contentFavorites.value, itemKind, itemId)
    contentRecents.value = removeContentRecent(contentRecents.value, itemKind, itemId)
    relations.value = removeEntityRelations(relations.value, itemId)
    persist()
  }

  function reorderFavorites(toolIds: string[]) {
    favorites.value = normalizeFavoriteOrder(toolIds)
    persist()
  }

  function updateSettings(patch: Partial<WorkbenchSettings>) {
    settings.value = { ...settings.value, ...patch }
    const retentionChanged = patch.clipboardLimit !== undefined || patch.clipboardRetentionDays !== undefined
    const removed = retentionChanged ? pruneClipboard() : []
    persist()
    queueDesktopClipboardRemovals(removed)
  }

  async function addClipboardItem(input: Omit<ClipboardItem, 'id' | 'capturedAt' | 'hash'> & { hash?: string }) {
    const fingerprint = input.hash ?? await hash(input.content ?? input.assetPath ?? input.preview ?? '')
    const candidate: ClipboardItem = { ...input, id: newId(), hash: fingerprint, capturedAt: now(), contentLoaded: true }
    let saved = candidate
    if (desktopClipboardActive.value) {
      saved = compactDesktopClipboardItem(await queueClipboardMutation(() => saveDesktopClipboardItem(candidate)))
    } else {
      const existing = clipboardItems.value.find((item) => item.hash === fingerprint)
      saved = existing
        ? { ...existing, capturedAt: candidate.capturedAt, contentLoaded: true }
        : candidate
    }
    clipboardItems.value = [saved, ...clipboardItems.value.filter((item) => item.id !== saved.id && item.hash !== saved.hash)]
    const removed = pruneClipboard()
    persist()
    queueDesktopClipboardRemovals(removed)
    addActivity('clipboard', '保存剪贴板内容', input.kind)
    return saved
  }

  async function resolveClipboardItem(id: string) {
    const current = clipboardItems.value.find((item) => item.id === id)
    if (!current || !desktopClipboardActive.value || current.contentLoaded !== false) return current
    const loaded = await queueClipboardMutation(() => getDesktopClipboardItem(id))
    // Do not keep a multi-megabyte text body in the reactive card list after
    // one copy. The bounded preview remains the UI's stable representation.
    return loaded ?? current
  }

  async function removeClipboardItem(id: string) {
    clipboardItems.value = clipboardItems.value.filter((item) => item.id !== id)
    persist()
    if (!desktopClipboardActive.value) return
    try { await queueClipboardMutation(() => deleteDesktopClipboardItem(id)) }
    catch (error) { vaultError.value = error instanceof Error ? error.message : '剪贴板删除尚未写入本地资料库。' }
  }

  async function clearClipboard() {
    clipboardItems.value = clipboardItems.value.filter((item) => item.pinned)
    persist()
    if (desktopClipboardActive.value) {
      try { await queueClipboardMutation(() => clearDesktopClipboardItems()) }
      catch (error) { vaultError.value = error instanceof Error ? error.message : '剪贴板清空尚未写入本地资料库。' }
    }
    addActivity('clipboard', '清空剪贴板历史', '已保留固定项目')
  }

  function toggleClipboardPin(id: string) {
    const item = clipboardItems.value.find((entry) => entry.id === id)
    if (!item) return
    const previous = Boolean(item.pinned)
    item.pinned = !previous
    const removed = pruneClipboard()
    persist()
    queueDesktopClipboardRemovals(removed)
    if (!desktopClipboardActive.value) return
    void queueClipboardMutation(() => setDesktopClipboardItemPinned(id, !previous)).catch((error) => {
      const current = clipboardItems.value.find((entry) => entry.id === id)
      if (current) current.pinned = previous
      persist()
      vaultError.value = error instanceof Error ? error.message : '固定状态尚未写入本地资料库。'
    })
  }

  function saveAiProfile(profile: AiProfile) {
    const index = aiProfiles.value.findIndex((item) => item.id === profile.id)
    if (index < 0) aiProfiles.value.push(profile); else aiProfiles.value[index] = profile
    persist()
  }

  function removeAiProfile(id: string) {
    aiProfiles.value = aiProfiles.value.filter((profile) => profile.id !== id)
    persist()
  }


  function prepareCodeImage(source: Source) {
    const content = source.content?.trim()
    if (!content) throw new Error('这份资料没有可导出的文本内容。')
    codeDraft.value = { content, name: source.name }
    persistCodeDraft()
  }

  function prepareCodeDraft(content: string, name = 'snippet.txt') {
    codeDraft.value = { content, name }
    // Code changes are frequent. Persist only the lightweight draft here instead
    // of serializing the entire workspace on every keystroke.
    persistCodeDraft()
  }

  function stageIntake(files: File[] = [], text = '') {
    intakeFiles.value = [...files]
    intakeText.value = text
  }

  function consumeIntakeFiles() {
    const files = intakeFiles.value
    intakeFiles.value = []
    return files
  }

  function consumeIntakeText() {
    const text = intakeText.value
    intakeText.value = ''
    return text
  }

  return {
    sources, documents, vocabulary, relations, jobs, jobsHasMore, jobsLoadingMore, aiProfiles, activeVaultName, codeDraft, recipes, pipelineRecipes, favorites, contentFavorites, contentRecents, toolUsages, activities, activitiesHasMore, activitiesLoadingMore, settings, clipboardItems, intakeFiles, intakeText, dueDocuments, dueQuestionCards, dueVocabularyCards, questionCount, weakTags, vaultReady, vaultHydrating, vaultError, vaultBootstrapStage, vaultRoot, vaultMarkdownIssues, desktopVaultActive, desktopReviewSummary,
    addSource, importDesktopSource, touchSource, updateSourceTags, loadSourceDetail, loadSourceCrop, loadDocument, loadVocabulary, searchVocabularyEntries, refreshDesktopReviewSummary, reconcileVaultMarkdown, createQuestion, createNote, insertDocument, createVocabularyEntry, saveVocabularyEntry, importVocabularyEntries, importQuestionDocuments, deleteVocabularyEntry, createRelation, deleteRelation, saveDocument, writeManagedVaultMarkdown, deleteDocument, gradeDocument, restoreQuestionReview, gradeVocabularySense, restoreVocabularySenseReview, attachCrop, addJob, updateJob, removeJob, removeJobs, loadMoreJobs, loadMoreActivities, addActivity, recordToolUsage, toggleFavorite, reorderFavorites, isContentFavorite, toggleContentFavorite, isContentRecent, touchContentRecent, removeFromContentRecents, clearContentRecents, forgetContentPointers, updateSettings, addClipboardItem, resolveClipboardItem, removeClipboardItem, clearClipboard, toggleClipboardPin, pruneClipboard, saveAiProfile, removeAiProfile, prepareCodeImage, prepareCodeDraft, stageIntake, consumeIntakeFiles, consumeIntakeText, persist, exportBrowserBackup, restoreBrowserBackup, hydrateVault, searchDocuments, findDocumentBacklinks
  }
})
