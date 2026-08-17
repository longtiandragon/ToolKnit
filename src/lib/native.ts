import { invoke } from '@tauri-apps/api/core'
import { convertFileSrc } from '@tauri-apps/api/core'
import type { ClipboardItem as WorkbenchClipboardItem, ContentFavorite, ContentFavoriteKind, ContentRecent, EntityRelation, Job, ReviewRating, ReviewState, Source, StudyDocument, TimelineEvent, VocabularyEntry } from '@/types'

export function isDesktop() {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

export interface DesktopVaultHydration {
  root: string
  documents: StudyDocument[]
  vocabulary: DesktopVocabularySummary[]
  relations: EntityRelation[]
  migrated: boolean
}

export interface DesktopVocabularySummary {
  id: string
  lemma: string
  language: string
  pronunciation?: string
  senseCount: number
  partOfSpeechPreview: string
  definitionPreview: string
  createdAt: string
  updatedAt: string
}

export interface DesktopProcessingJobHydration {
  jobs: Job[]
  migrated: boolean
  importedCount: number
  skippedCount: number
  hasMore: boolean
}

/** Imports the former bounded renderer history exactly once. Active jobs in
 * that snapshot are normalized as interrupted by Rust because they belonged
 * to an earlier renderer lifetime. */
export async function hydrateDesktopProcessingJobs(browserJobs: Job[]) {
  if (!isDesktop()) return undefined
  return invoke<DesktopProcessingJobHydration>('hydrate_default_processing_jobs', { browserJobs })
}

export async function listDesktopProcessingJobs(limit = 500, before?: Pick<Job, 'createdAt' | 'id'>) {
  if (!isDesktop()) return [] as Job[]
  return invoke<Job[]>('list_default_processing_jobs', {
    limit,
    beforeCreatedAt: before?.createdAt,
    beforeId: before?.id,
  })
}

export async function saveDesktopProcessingJob(job: Job) {
  if (!isDesktop()) return undefined
  return invoke<Job>('save_default_processing_job', { job })
}

export async function deleteDesktopProcessingJob(id: string) {
  if (!isDesktop()) return
  await invoke('delete_default_processing_job', { id })
}

export async function deleteDesktopProcessingJobs(ids: string[]) {
  if (!isDesktop() || !ids.length) return 0
  return invoke<number>('delete_default_processing_jobs', { ids })
}

export interface DesktopVaultHealth {
  root: string
  schemaVersion: number
  latestSchemaVersion: number
  integrity: string
  databaseSize: number
  documentCount: number
  noteCount: number
  questionCount: number
  vocabularyCount: number
  sourceCount: number
  relationCount: number
  reviewCardCount: number
  ftsEntryCount: number
  missingMarkdownCount: number
  lastAutomaticBackup?: string
  lastAutomaticBackupAt?: string
}

export type EditorCrashDraftKind = 'document' | 'vocabulary'

export interface DesktopEditorCrashDraft {
  kind: EditorCrashDraftKind
  entityId: string
  baseUpdatedAt: string
  savedAt: string
  byteSize: number
  payloadJson: string
}

export async function saveDesktopEditorCrashDraft(input: {
  kind: EditorCrashDraftKind
  entityId: string
  baseUpdatedAt: string
  payloadJson: string
}) {
  if (!isDesktop()) return undefined
  return invoke<DesktopEditorCrashDraft>('save_default_editor_crash_draft', input)
}

export async function getDesktopEditorCrashDraft(kind: EditorCrashDraftKind, entityId: string) {
  if (!isDesktop()) return undefined
  return invoke<DesktopEditorCrashDraft | null>('get_default_editor_crash_draft', { kind, entityId })
}

export async function deleteDesktopEditorCrashDraft(kind: EditorCrashDraftKind, entityId: string) {
  if (!isDesktop()) return
  await invoke('delete_default_editor_crash_draft', { kind, entityId })
}

export async function getDesktopVaultHealth() {
  if (!isDesktop()) return undefined
  return invoke<DesktopVaultHealth>('get_default_vault_health')
}

export interface DesktopStorageSpace {
  path: string
  availableBytes: number
  totalBytes: number
}

export async function getDesktopVaultStorageSpace() {
  if (!isDesktop()) return undefined
  return invoke<DesktopStorageSpace>('get_default_vault_storage_space')
}

export interface DesktopVaultSearchResult {
  id: string
  title: string
  kind: StudyDocument['kind'] | 'word' | 'source'
  subject: string
  tags: string[]
  updatedAt: string
  snippet: string
}

export interface DesktopWikiLink {
  fromId: string
  toId: string
  targetTitle: string
  headings: string[]
  occurrences: number
  sourceUpdatedAt: string
}

export interface DesktopWikiLinkProjection {
  links: DesktopWikiLink[]
  unresolvedCount: number
  ambiguousCount: number
  truncated: boolean
}

export interface ExternalMarkdownState {
  hash: string
  modifiedAt: string
  size: number
}

export interface ExternalMarkdownPayload extends ExternalMarkdownState {
  path: string
  name: string
  content: string
}

export interface ExternalMarkdownDirectoryEntry {
  name: string
  path: string
  relativePath: string
  kind: 'directory' | 'markdown'
  size?: number
  modifiedAt?: string
}

export interface ExternalMarkdownDirectory {
  root: string
  relativePath: string
  entries: ExternalMarkdownDirectoryEntry[]
  truncated: boolean
}

export interface ExternalMarkdownWorkspaceSearch {
  root: string
  query: string
  entries: ExternalMarkdownDirectoryEntry[]
  scanned: number
  truncated: boolean
}

export interface ExternalMarkdownContentMatch extends ExternalMarkdownDirectoryEntry {
  line: number
  preview: string
}

export interface ExternalMarkdownContentSearch {
  root: string
  query: string
  matches: ExternalMarkdownContentMatch[]
  scanned: number
  scannedBytes: number
  skippedLarge: number
  truncated: boolean
}

export interface ExternalMarkdownWorkspaceChange {
  root: string
  relativePaths: string[]
  overflow: boolean
}

export interface MarkdownImageAttachment {
  source: string
  filename: string
  size: number
}

/**
 * Desktop-only document boundary. Browser mode intentionally keeps its small
 * localStorage fallback so the public demo remains usable without Tauri.
 */
export async function hydrateDesktopVault(browserDocuments: StudyDocument[], browserVocabulary: VocabularyEntry[], browserRelations: EntityRelation[]) {
  if (!isDesktop()) return undefined
  return invoke<DesktopVaultHydration>('hydrate_default_vault', { browserDocuments, browserVocabulary, browserRelations })
}

/** Desktop source list is deliberately metadata-only. Use getDesktopSource
 * after selection so a large PDF/image preview never becomes startup data. */
export async function hydrateDesktopSources(browserSources: Source[]) {
  if (!isDesktop()) return [] as Source[]
  return invoke<Source[]>('hydrate_default_sources', { browserSources })
}

/** Content favorites are bounded metadata pointers. Hydrate them after sources
 * so a browser favorite can be validated against every supported content kind. */
export async function hydrateDesktopContentFavorites(browserFavorites: ContentFavorite[]) {
  if (!isDesktop()) return browserFavorites
  return invoke<ContentFavorite[]>('hydrate_default_content_favorites', { browserFavorites })
}

export async function setDesktopContentFavorite(itemId: string, itemKind: ContentFavoriteKind, favorite: boolean) {
  if (!isDesktop()) return favorite ? { itemId, itemKind, addedAt: new Date().toISOString() } satisfies ContentFavorite : null
  return invoke<ContentFavorite | null>('set_default_content_favorite', { itemId, itemKind, favorite })
}

export async function replaceDesktopContentFavorites(favorites: ContentFavorite[]) {
  if (!isDesktop()) return favorites
  return invoke<ContentFavorite[]>('replace_default_content_favorites', { favorites })
}

export async function hydrateDesktopContentRecents(browserRecents: ContentRecent[]) {
  if (!isDesktop()) return browserRecents
  return invoke<ContentRecent[]>('hydrate_default_content_recents', { browserRecents })
}

export async function touchDesktopContentRecent(itemId: string, itemKind: ContentFavoriteKind) {
  if (!isDesktop()) return { itemId, itemKind, openedAt: new Date().toISOString() } satisfies ContentRecent
  return invoke<ContentRecent>('touch_default_content_recent', { itemId, itemKind })
}

export async function removeDesktopContentRecent(itemId: string, itemKind: ContentFavoriteKind) {
  if (!isDesktop()) return
  await invoke('remove_default_content_recent', { itemId, itemKind })
}

export async function clearDesktopContentRecents() {
  if (!isDesktop()) return
  await invoke('clear_default_content_recents')
}

export async function replaceDesktopContentRecents(recents: ContentRecent[]) {
  if (!isDesktop()) return recents
  return invoke<ContentRecent[]>('replace_default_content_recents', { recents })
}

/**
 * Native imports copy the selected file directly into the Vault. Unlike a
 * browser File/Data URL import, this never materializes a PDF or image in the
 * renderer process before it is actually opened.
 */
export async function importDesktopSource(sourcePath: string) {
  if (!isDesktop()) throw new Error('从磁盘导入仅支持桌面模式。')
  return invoke<{ source: Source; duplicate: boolean }>('import_default_source', { sourcePath })
}

/** Creates at most one streaming, full-Vault archive per day. */
export async function createDesktopAutoBackup() {
  if (!isDesktop()) return undefined
  return invoke<string | null>('automatic_default_vault_backup')
}

/**
 * Write a complete Vault archive to a destination the user explicitly chose.
 * The native command derives the Vault root itself so the renderer cannot
 * accidentally archive an unrelated directory.
 */
export async function createDesktopVaultBackup(outputPath: string) {
  if (!isDesktop()) throw new Error('完整 Vault 归档仅支持桌面模式。')
  await invoke('create_default_vault_backup', { outputPath })
  return outputPath
}

export interface DesktopVaultBackupInspection {
  archiveName: string
  archiveSize: number
  modifiedAt?: string
  schemaVersion: number
  latestSchemaVersion: number
  integrity: string
  documentCount: number
  noteCount: number
  questionCount: number
  vocabularyCount: number
  sourceCount: number
  relationCount: number
  reviewCardCount: number
  fileCount: number
  managedFileCount: number
  uncompressedSize: number
  missingMarkdownCount: number
}

/** Validates a selected full archive without loading its Markdown/assets into
 * the renderer or changing the live Vault. */
export async function inspectDesktopVaultBackup(archivePath: string) {
  if (!isDesktop()) throw new Error('完整 Vault 归档检查仅支持桌面模式。')
  return invoke<DesktopVaultBackupInspection>('inspect_default_vault_backup', { archivePath })
}

/** Restores a selected full archive and returns its pre-restore safety copy. */
export async function restoreDesktopVaultBackup(archivePath: string) {
  if (!isDesktop()) throw new Error('完整 Vault 恢复仅支持桌面模式。')
  return invoke<string>('restore_default_vault_backup', { archivePath })
}

export async function saveDesktopSource(source: Source) {
  if (!isDesktop()) return
  await invoke('save_default_source', { source })
}

export async function getDesktopSource(id: string) {
  if (!isDesktop()) return undefined
  return invoke<Source>('get_default_source', { id })
}

export async function touchDesktopSource(id: string) {
  if (!isDesktop()) return
  await invoke('touch_default_source', { id })
}

/** Updates indexed metadata without serializing the source body or binary asset. */
export async function saveDesktopSourceTags(id: string, tags: string[]) {
  if (!isDesktop()) return tags
  return invoke<string[]>('save_default_source_tags', { id, tags })
}

export async function saveDesktopSourceCrops(id: string, crops: Record<string, string>) {
  if (!isDesktop()) return
  await invoke('save_default_source_crops', { id, crops })
}

export async function getDesktopSourceCrop(id: string, cropId: string) {
  if (!isDesktop()) return undefined
  return invoke<string | null>('get_default_source_crop', { id, cropId })
}

export async function saveDesktopVaultDocument(document: StudyDocument) {
  if (!isDesktop()) return
  await invoke('save_default_vault_document', { document })
}

export async function saveDesktopQuestionBatch(documents: StudyDocument[]) {
  if (!isDesktop()) return
  await invoke('save_default_question_batch', { documents })
}

/** The startup payload intentionally contains document metadata only. Load the
 * Markdown body after a document becomes active instead of hydrating every
 * note into the renderer process. */
export async function getDesktopVaultDocument(id: string) {
  if (!isDesktop()) return undefined
  return invoke<StudyDocument>('get_default_vault_document', { id })
}

export type DesktopVaultMarkdownReconcileStatus = 'updated' | 'unchanged' | 'missing' | 'untracked'

export interface DesktopVaultMarkdownReconcile {
  documentId: string
  status: DesktopVaultMarkdownReconcileStatus
  document?: StudyDocument
}

/** Reindexes one managed Markdown file after a native watcher event. It never
 * writes the file and therefore cannot overwrite work from another editor. */
export async function reconcileDesktopVaultMarkdown(id: string) {
  if (!isDesktop()) return { documentId: id, status: 'unchanged' as const }
  return invoke<DesktopVaultMarkdownReconcile>('reconcile_default_vault_markdown', { id })
}

/** Starts the bounded notes/questions watcher. Calling it again intentionally
 * rebuilds native handles after a Vault restore or renderer reload. */
export async function watchDesktopVaultMarkdown() {
  if (!isDesktop()) return
  await invoke('watch_default_vault_markdown')
}

export interface DesktopDocumentVersionSummary {
  id: string
  documentId: string
  title: string
  savedAt: string
  byteSize: number
  preview: string
  isCurrent: boolean
}

/** Lists only bounded version metadata. Multi-megabyte Markdown snapshots stay
 * behind an explicit get call so opening the inspector cannot stall the UI. */
export async function listDesktopDocumentVersions(documentId: string) {
  if (!isDesktop()) return [] as DesktopDocumentVersionSummary[]
  return invoke<DesktopDocumentVersionSummary[]>('list_default_document_versions', { documentId })
}

export async function getDesktopDocumentVersion(documentId: string, versionId: string) {
  if (!isDesktop()) return undefined
  return invoke<StudyDocument>('get_default_document_version', { documentId, versionId })
}

export async function preserveDesktopDocumentVersion(documentId: string) {
  if (!isDesktop()) return
  await invoke('preserve_default_document_version', { documentId })
}

/** Explicit export path: unlike hydration, this includes every Markdown body
 * so a user-created JSON backup is complete. */
export async function exportDesktopVaultDocuments() {
  if (!isDesktop()) return [] as StudyDocument[]
  return invoke<StudyDocument[]>('export_default_vault_documents')
}

export async function exportDesktopVocabulary() {
  if (!isDesktop()) return [] as VocabularyEntry[]
  return invoke<VocabularyEntry[]>('export_default_vocabulary')
}

export async function deleteDesktopVaultDocument(id: string) {
  if (!isDesktop()) return
  await invoke('delete_default_vault_document', { id })
}

export interface DesktopQuestionAttachment {
  id: string
  name: string
  mime: string
  size: number
  createdAt: string
  available: boolean
}

/** Lists bounded attachment metadata only; file bytes never enter Vue. */
export async function listDesktopQuestionAttachments(documentId: string) {
  if (!isDesktop()) return [] as DesktopQuestionAttachment[]
  return invoke<DesktopQuestionAttachment[]>('list_default_question_attachments', { documentId })
}

export async function importDesktopQuestionAttachment(documentId: string, sourcePath: string) {
  if (!isDesktop()) throw new Error('题目附件仅支持 Knitspace 桌面版。')
  return invoke<DesktopQuestionAttachment>('import_default_question_attachment', { documentId, sourcePath })
}

/** Resolves a registered attachment only after an explicit reveal action. */
export async function resolveDesktopQuestionAttachment(documentId: string, attachmentId: string) {
  if (!isDesktop()) throw new Error('题目附件仅支持 Knitspace 桌面版。')
  return invoke<string>('resolve_default_question_attachment', { documentId, attachmentId })
}

export async function deleteDesktopQuestionAttachment(documentId: string, attachmentId: string) {
  if (!isDesktop()) return
  await invoke('delete_default_question_attachment', { documentId, attachmentId })
}

export interface DesktopVisualProjectImage {
  name: string
  mime: string
  path: string
  size: number
}

interface DesktopVisualProjectStagedImage {
  name: string
  mime: string
  assetPath: string
  size: number
  sha256: string
}

export interface DesktopVisualProject {
  id: string
  title: string
  canvasTitle: string
  layout: 'single' | 'pair' | 'grid'
  background: string
  watermark: string
  annotations: unknown[]
  images: DesktopVisualProjectImage[]
  createdAt: string
  updatedAt: string
}

export interface DesktopVisualProjectSummary {
  id: string
  title: string
  imageCount: number
  annotationCount: number
  updatedAt: string
}

/** Persist the editable canvas, not just its flattened PNG. Each source image
 * uses Tauri's raw binary body sequentially; the final JSON command contains
 * only bounded metadata and never expands image bytes into number arrays. */
export async function saveDesktopVisualProject(project: {
  id: string
  title: string
  canvasTitle: string
  layout: DesktopVisualProject['layout']
  background: string
  watermark: string
  annotations: unknown[]
  images: File[]
  createdAt?: string
}) {
  if (!isDesktop()) throw new Error('画布项目仅支持桌面开发版。')
  if (!project.images.length || project.images.length > 4) throw new Error('一个画布项目需要包含 1–4 张源图。')
  if (project.images.reduce((total, file) => total + file.size, 0) > 96 * 1024 * 1024) throw new Error('一个画布项目的源图总量不能超过 96 MB。')
  const images: DesktopVisualProjectStagedImage[] = []
  for (const file of project.images.slice(0, 4)) {
    if (!file.size || file.size > 32 * 1024 * 1024) throw new Error(`“${file.name}”为空或超过 32 MB。`)
    images.push(await invoke<DesktopVisualProjectStagedImage>(
      'stage_default_visual_project_image',
      new Uint8Array(await file.arrayBuffer()),
      { headers: {
        'x-knitspace-project-id': project.id,
        'x-knitspace-file-name': encodeURIComponent(file.name.slice(0, 180) || 'canvas-image'),
        'x-knitspace-file-mime': file.type || 'application/octet-stream',
      } },
    ))
  }
  return invoke<DesktopVisualProject>('save_default_visual_project', {
    project: { ...project, images, createdAt: project.createdAt || null },
  })
}

export async function listDesktopVisualProjects(limit = 40) {
  if (!isDesktop()) return [] as DesktopVisualProjectSummary[]
  return invoke<DesktopVisualProjectSummary[]>('list_default_visual_projects', { limit })
}

export async function getDesktopVisualProject(id: string) {
  if (!isDesktop()) throw new Error('画布项目仅支持桌面开发版。')
  return invoke<DesktopVisualProject>('get_default_visual_project', { id })
}

export async function deleteDesktopVisualProject(id: string) {
  if (!isDesktop()) return
  await invoke('delete_default_visual_project', { id })
}

export async function replaceDesktopVaultDocuments(documents: StudyDocument[]) {
  if (!isDesktop()) return
  await invoke('replace_default_vault_documents', { documents })
}

export async function searchDesktopVaultDocuments(query: string) {
  if (!isDesktop()) return [] as DesktopVaultSearchResult[]
  return invoke<DesktopVaultSearchResult[]>('search_default_vault_documents', { query })
}

/** Resolves backlinks in SQLite so selecting one document never scans every
 * loaded Markdown body on the renderer thread. */
export async function findDesktopWikiBacklinks(targetTitle: string, excludeId: string) {
  if (!isDesktop()) return [] as DesktopVaultSearchResult[]
  return invoke<DesktopVaultSearchResult[]>('find_default_wiki_backlinks', { targetTitle, excludeId })
}

export async function listDesktopWikiLinks(limit = 1_000) {
  if (!isDesktop()) return { links: [], unresolvedCount: 0, ambiguousCount: 0, truncated: false } satisfies DesktopWikiLinkProjection
  return invoke<DesktopWikiLinkProjection>('list_default_wiki_links', { limit })
}

export async function saveDesktopVocabulary(entry: VocabularyEntry) {
  if (!isDesktop()) return
  await invoke('save_default_vocabulary', { entry })
}

export async function saveDesktopVocabularyBatch(entries: VocabularyEntry[]) {
  if (!isDesktop()) return
  await invoke('save_default_vocabulary_batch', { entries })
}

export async function getDesktopVocabulary(id: string) {
  if (!isDesktop()) return undefined
  return invoke<VocabularyEntry>('get_default_vocabulary', { id })
}

export async function searchDesktopVocabulary(query: string, limit = 120) {
  if (!isDesktop()) return [] as DesktopVocabularySummary[]
  return invoke<DesktopVocabularySummary[]>('search_default_vocabulary', { query, limit })
}

export type DesktopReviewKind = 'all' | 'question' | 'error' | 'word'

export interface DesktopReviewCursor {
  dueEpoch: number
  id: string
}

export interface DesktopReviewCardSummary {
  id: string
  entityId: string
  entityKind: 'question' | 'word'
  title: string
  facet: 'answer' | 'error' | 'meaning' | 'spelling' | 'example' | 'comparison'
  due: string
  dueEpoch: number
  review: ReviewState
  senseId?: string
  context: string
  detail: string
  createdAt: string
  updatedAt: string
}

export interface DesktopReviewQueuePage {
  cards: DesktopReviewCardSummary[]
  hasMore: boolean
  nextCursor?: DesktopReviewCursor
}

export interface DesktopReviewQueueSummary {
  scheduledCount: number
  reviewedCount: number
  dueCount: number
  dueQuestionCount: number
  dueErrorCount: number
  dueWordCount: number
  questionMaterialCount: number
  vocabularyMaterialCount: number
  earliestDue?: string
  nextFutureDue?: string
}

export interface DesktopReviewDailyCount {
  date: string
  count: number
}

export interface DesktopReviewAnalytics {
  totalReviews: number
  reviewedToday: number
  reviewed7Days: number
  reviewed30Days: number
  studyDays30: number
  currentStreakDays: number
  longestStreak365Days: number
  again30Days: number
  hard30Days: number
  good30Days: number
  easy30Days: number
  daily14Days: DesktopReviewDailyCount[]
}

export interface DesktopReviewGradeResult {
  eventId: string
  cardId: string
  review: ReviewState
  reviewedAt: string
  updatedAt: string
}

export interface DesktopReviewHistoryEntry {
  id: string
  cardId: string
  entityId: string
  facet: string
  rating: ReviewRating
  previousReview: ReviewState
  nextReview: ReviewState
  reviewedAt: string
  undoneAt?: string
}

/** Keyset pagination keeps the session stable while graded cards leave the
 * due queue. No document body or unrelated word sense crosses this boundary. */
export async function listDesktopDueReviewCards(input: {
  asOf?: string
  limit?: number
  cursor?: DesktopReviewCursor
  reviewKind?: DesktopReviewKind
}) {
  if (!isDesktop()) return { cards: [], hasMore: false } satisfies DesktopReviewQueuePage
  return invoke<DesktopReviewQueuePage>('list_default_due_review_cards', input)
}

export async function getDesktopReviewQueueSummary(asOf?: string) {
  if (!isDesktop()) return undefined
  return invoke<DesktopReviewQueueSummary>('get_default_review_queue_summary', { asOf })
}

export async function getDesktopReviewAnalytics(asOf = new Date().toISOString()) {
  if (!isDesktop()) return undefined
  return invoke<DesktopReviewAnalytics>('get_default_review_analytics', {
    asOf,
    utcOffsetMinutes: -new Date(asOf).getTimezoneOffset(),
  })
}

export async function gradeDesktopReviewCard(input: {
  cardId: string
  rating: ReviewRating
  nextReview: ReviewState
  reviewedAt?: string
  expectedUpdatedAt: string
}) {
  if (!isDesktop()) throw new Error('原生复习评分仅支持桌面模式。')
  return invoke<DesktopReviewGradeResult>('grade_default_review_card', { input })
}

export async function undoDesktopReviewGrade(input: {
  eventId: string
  expectedCardUpdatedAt: string
}) {
  if (!isDesktop()) throw new Error('原生复习撤销仅支持桌面模式。')
  return invoke<DesktopReviewGradeResult>('undo_default_review_grade', { input })
}

export async function listDesktopReviewHistory(cardId: string, limit = 50) {
  if (!isDesktop()) return [] as DesktopReviewHistoryEntry[]
  return invoke<DesktopReviewHistoryEntry[]>('list_default_review_history', { cardId, limit })
}

export async function deleteDesktopVocabulary(id: string) {
  if (!isDesktop()) return
  await invoke('delete_default_vocabulary', { id })
}

export async function replaceDesktopVocabulary(entries: VocabularyEntry[]) {
  if (!isDesktop()) return
  await invoke('replace_default_vocabulary', { entries })
}

export async function saveDesktopRelation(relation: EntityRelation) {
  if (!isDesktop()) return
  await invoke('save_default_relation', { relation })
}

export async function deleteDesktopRelation(relation: EntityRelation) {
  if (!isDesktop()) return
  await invoke('delete_default_relation', { relation })
}

export async function listDesktopEvents(limit = 80) {
  if (!isDesktop()) return [] as TimelineEvent[]
  return invoke<TimelineEvent[]>('list_default_events', { limit })
}

/** Focus sessions and recurring dates have their own bounded feed. Ordinary
 * edit/tool activity cannot push these records out of the Today workspace. */
export async function listDesktopPersonalEvents(limitPerType = 120) {
  if (!isDesktop()) return [] as TimelineEvent[]
  return invoke<TimelineEvent[]>('list_default_personal_events', { limitPerType })
}

export type DesktopFocusCursor = Pick<TimelineEvent, 'startsAt' | 'updatedAt' | 'id'>

/** Pages only focus sessions. Anniversaries stay in the small personal feed,
 * while a long-running time ledger can be traversed without hydrating it all. */
export async function listDesktopFocusEvents(limit = 120, before?: DesktopFocusCursor) {
  if (!isDesktop()) return [] as TimelineEvent[]
  return invoke<TimelineEvent[]>('list_default_focus_events', {
    limit,
    beforeStartsAt: before?.startsAt,
    beforeUpdatedAt: before?.updatedAt,
    beforeId: before?.id,
  })
}

export interface DesktopFocusDailyCount {
  date: string
  sessions: number
  minutes: number
}

export interface DesktopFocusAnalytics {
  sessionsToday: number
  minutesToday: number
  sessions7Days: number
  minutes7Days: number
  daily7Days: DesktopFocusDailyCount[]
}

export async function getDesktopFocusAnalytics(asOf = new Date().toISOString()) {
  if (!isDesktop()) return undefined
  return invoke<DesktopFocusAnalytics>('get_default_focus_analytics', {
    asOf,
    utcOffsetMinutes: -new Date().getTimezoneOffset(),
  })
}

export type DesktopActivityCursor = Pick<TimelineEvent, 'startsAt' | 'updatedAt' | 'id'>

export async function listDesktopActivityEvents(limit = 300, before?: DesktopActivityCursor) {
  if (!isDesktop()) return [] as TimelineEvent[]
  return invoke<TimelineEvent[]>('list_default_activity_events', {
    limit,
    beforeStartsAt: before?.startsAt,
    beforeUpdatedAt: before?.updatedAt,
    beforeId: before?.id,
  })
}

export async function saveDesktopEvent(event: TimelineEvent) {
  if (!isDesktop()) return
  await invoke('save_default_event', { event })
}

/** One-time import for the browser-era Today timeline. The native transaction
 * keeps existing rows on ID conflicts, so retrying after a renderer crash is
 * safe and cannot overwrite a newer desktop edit. */
export async function importDesktopLegacyEvents(events: TimelineEvent[]) {
  if (!isDesktop() || !events.length) return
  await invoke('import_default_legacy_events', { events })
}

export async function deleteDesktopEvent(id: string) {
  if (!isDesktop()) return
  await invoke('delete_default_event', { id })
}

/** Replace only activity-log events. Focus sessions and anniversaries remain
 * untouched, which keeps browser-backup restore scoped and predictable. */
export async function replaceDesktopActivityEvents(events: TimelineEvent[]) {
  if (!isDesktop()) return
  await invoke('replace_default_activity_events', { events })
}

export async function replaceDesktopRelations(relations: EntityRelation[]) {
  if (!isDesktop()) return
  await invoke('replace_default_relations', { relations })
}

/** Clipboard data belongs to the desktop Vault instead of localStorage. List
 * hydration returns at most a bounded text prefix; callers fetch full content
 * only for an explicit copy action. */
export async function hydrateDesktopClipboard(browserItems: WorkbenchClipboardItem[], limit: number, retentionDays: number) {
  if (!isDesktop()) return [] as WorkbenchClipboardItem[]
  return invoke<WorkbenchClipboardItem[]>('hydrate_default_clipboard', { browserItems, limit, retentionDays })
}

export async function getDesktopClipboardItem(id: string) {
  if (!isDesktop()) return undefined
  return invoke<WorkbenchClipboardItem>('get_default_clipboard_item', { id })
}

export async function saveDesktopClipboardItem(item: WorkbenchClipboardItem) {
  if (!isDesktop()) return item
  return invoke<WorkbenchClipboardItem>('save_default_clipboard_item', { item })
}

export async function setDesktopClipboardItemPinned(id: string, pinned: boolean) {
  if (!isDesktop()) return
  await invoke('set_default_clipboard_item_pinned', { id, pinned })
}

export async function deleteDesktopClipboardItem(id: string) {
  if (!isDesktop()) return
  await invoke('delete_default_clipboard_item', { id })
}

export async function clearDesktopClipboardItems() {
  if (!isDesktop()) return
  await invoke('clear_default_clipboard_items')
}

export async function readExternalMarkdown(path: string) {
  if (!isDesktop()) throw new Error('外部 Markdown 仅支持桌面模式。')
  return invoke<ExternalMarkdownPayload>('read_external_markdown', { path })
}

/** Drains paths supplied by an OS file association or a second desktop
 * instance. Paths never enter a route query or a persistent browser store. */
export async function takeDesktopOpenedMarkdownFiles() {
  if (!isDesktop()) return [] as string[]
  return invoke<string[]>('take_pending_open_files')
}

/** Lists one directory level only. Expansion stays renderer-driven so opening
 * a large notes folder never recursively walks or hydrates every Markdown. */
export async function listExternalMarkdownDirectory(root: string, relativePath = '') {
  if (!isDesktop()) throw new Error('外部 Markdown 工作区仅支持桌面模式。')
  return invoke<ExternalMarkdownDirectory>('list_external_markdown_directory', { root, relativePath: relativePath || null })
}

/** Searches names and relative paths on a blocking native worker. The native
 * boundary caps both visited entries and returned matches, so quick-open never
 * hydrates the workspace tree or reads Markdown bodies into Vue state. */
export async function searchExternalMarkdownWorkspace(root: string, query: string, limit = 40) {
  if (!isDesktop()) throw new Error('外部 Markdown 工作区搜索仅支持桌面模式。')
  return invoke<ExternalMarkdownWorkspaceSearch>('search_external_markdown_workspace', { root, query, limit })
}

/** Searches bounded Markdown bodies on a native worker. The Rust boundary
 * limits file count, bytes per file, aggregate bytes and returned excerpts. */
export async function searchExternalMarkdownContent(root: string, query: string, limit = 40) {
  if (!isDesktop()) throw new Error('外部 Markdown 正文搜索仅支持桌面模式。')
  return invoke<ExternalMarkdownContentSearch>('search_external_markdown_content', { root, query, limit })
}

export async function createExternalMarkdownEntry(root: string, parentRelativePath: string, name: string, kind: 'markdown' | 'directory') {
  if (!isDesktop()) throw new Error('外部 Markdown 工作区仅支持桌面模式。')
  return invoke<ExternalMarkdownDirectoryEntry>('create_external_markdown_entry', { root, parentRelativePath: parentRelativePath || null, name, kind })
}

export async function renameExternalMarkdownEntry(root: string, relativePath: string, name: string) {
  if (!isDesktop()) throw new Error('外部 Markdown 工作区仅支持桌面模式。')
  return invoke<ExternalMarkdownDirectoryEntry>('rename_external_markdown_entry', { root, relativePath, name })
}

export async function moveExternalMarkdownEntry(root: string, relativePath: string, targetParentRelativePath: string) {
  if (!isDesktop()) throw new Error('外部 Markdown 工作区仅支持桌面模式。')
  return invoke<ExternalMarkdownDirectoryEntry>('move_external_markdown_entry', {
    root,
    relativePath,
    targetParentRelativePath: targetParentRelativePath || null,
  })
}

export async function duplicateExternalMarkdownEntry(root: string, relativePath: string) {
  if (!isDesktop()) throw new Error('外部 Markdown 工作区仅支持桌面模式。')
  return invoke<ExternalMarkdownDirectoryEntry>('duplicate_external_markdown_entry', { root, relativePath })
}

export async function trashExternalMarkdownEntry(root: string, relativePath: string) {
  if (!isDesktop()) throw new Error('外部 Markdown 工作区仅支持桌面模式。')
  await invoke('trash_external_markdown_entry', { root, relativePath })
}

export async function inspectExternalMarkdown(path: string) {
  if (!isDesktop()) throw new Error('外部 Markdown 仅支持桌面模式。')
  return invoke<ExternalMarkdownState>('inspect_external_markdown', { path })
}

/** Native file notifications replace the old periodic inspection while a
 * linked Markdown note is open. The view keeps a slow polling fallback only
 * when the operating-system watcher cannot be created. */
export async function watchDesktopExternalMarkdown(path: string) {
  if (!isDesktop()) return
  return invoke<void>('watch_external_markdown', { path })
}

export async function unwatchDesktopExternalMarkdown(path: string) {
  if (!isDesktop()) return
  return invoke<void>('unwatch_external_markdown', { path })
}

/** A single recursive OS watcher keeps the lazy file tree in sync without
 * polling every directory or reading Markdown bodies. Renderer refreshes are
 * still limited to directory levels that the user has already expanded. */
export async function watchDesktopExternalMarkdownWorkspace(root: string) {
  if (!isDesktop()) return
  return invoke<void>('watch_external_markdown_workspace', { root })
}

export async function unwatchDesktopExternalMarkdownWorkspace(root: string) {
  if (!isDesktop()) return
  return invoke<void>('unwatch_external_markdown_workspace', { root })
}

export async function writeExternalMarkdown(path: string, markdown: string, expectedHash?: string, force = false) {
  if (!isDesktop()) throw new Error('外部 Markdown 仅支持桌面模式。')
  return invoke<ExternalMarkdownState>('write_external_markdown', { path, markdown, expectedHash, force })
}

/** Reads one visible, relative raster image from the directory tree referenced
 * by an open Markdown file. The native side rejects URL/absolute references
 * and caps the data so a long note never hydrates every image at once. */
export async function readExternalMarkdownImage(path: string, source: string) {
  if (!isDesktop()) throw new Error('外部 Markdown 图片仅支持桌面模式。')
  return invoke<string>('read_external_markdown_image', { path, source })
}

/** Persists the current clipboard image without moving RGBA/Data URLs through
 * Vue state. Internal notes use the Vault; linked Markdown stays portable by
 * placing the PNG in an adjacent assets folder. */
export async function pasteDesktopMarkdownClipboardImage(documentId: string, externalMarkdownPath?: string) {
  if (!isDesktop()) throw new Error('剪贴板图片仅支持桌面模式。')
  return invoke<MarkdownImageAttachment>('paste_markdown_clipboard_image', { documentId, externalMarkdownPath })
}

/** Copies one explicitly selected raster image into the current document's
 * managed asset location without sending its bytes through Vue state. */
export async function importDesktopMarkdownImage(documentId: string, sourcePath: string, externalMarkdownPath?: string) {
  if (!isDesktop()) throw new Error('本地图片导入仅支持桌面模式。')
  return invoke<MarkdownImageAttachment>('import_markdown_image', { documentId, sourcePath, externalMarkdownPath })
}

/** Resolves only an image registered to this document and returns it lazily
 * when the preview is about to reveal the image. */
export async function readDesktopVaultMarkdownImage(documentId: string, source: string) {
  if (!isDesktop()) throw new Error('Vault 图片预览仅支持桌面模式。')
  return invoke<string>('read_default_vault_markdown_image', { documentId, source })
}

export async function storeApiKey(id: string, apiKey: string) {
  if (!isDesktop()) return false
  await invoke('write_api_key', { profile: { id, api_key: apiKey } })
  return true
}

export async function hasStoredApiKey(id: string) {
  if (!isDesktop()) return false
  return invoke<boolean>('has_api_key', { profileId: id })
}

export async function removeApiKey(id: string) {
  if (!isDesktop()) return false
  await invoke('delete_api_key', { profileId: id })
  return true
}

export async function runDesktopAi(request: { profile_id: string; base_url: string; model: string; temperature: number; messages: unknown }, signal?: AbortSignal) {
  const requestId = crypto.randomUUID()
  const cancel = () => { void invoke('cancel_ai_action', { requestId }) }
  if (signal?.aborted) throw new Error('AI 请求已取消。')
  signal?.addEventListener('abort', cancel, { once: true })
  try { return await invoke<string>('run_ai_action', { requestId, request }) }
  finally { signal?.removeEventListener('abort', cancel) }
}

export async function saveDesktopOutput(outputDirectory: string, filename: string, data: Blob | ArrayBuffer | Uint8Array | string) {
  if (!isDesktop()) return undefined
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data instanceof Blob ? new Uint8Array(await data.arrayBuffer()) : data instanceof ArrayBuffer ? new Uint8Array(data) : data
  return invoke<string>('save_output', { outputDir: outputDirectory, filename, data: Array.from(bytes) })
}

export interface MediaEngineStatus { available: boolean; version?: string }
export interface MediaTrackInfo {
  index: number
  kind: string
  codec: string
  language?: string
  title?: string
  channels?: number
  sampleRate?: number
  width?: number
  height?: number
}
export interface MediaChapterInfo {
  id: number
  startSeconds: number
  endSeconds: number
  title?: string
}
export interface MediaFileInfo {
  path: string
  name: string
  size: number
  durationSeconds?: number
  formatName?: string
  audioCodec?: string
  videoCodec?: string
  width?: number
  height?: number
  bitRate?: number
  tracks?: MediaTrackInfo[]
  chapters?: MediaChapterInfo[]
}
export interface MediaOutput { path: string; name: string; size: number; elapsedMs: number }
export interface MediaTranscodeProgress { runId: string; progress: number; detail: string }

/** Optional desktop capability: Knitspace never bundles FFmpeg or sends media
 * away. When the user has installed it, commands receive only their selected
 * local paths and always write a new output file. */
export async function getMediaEngineStatus() {
  if (!isDesktop()) return { available: false } satisfies MediaEngineStatus
  return invoke<MediaEngineStatus>('media_engine_status')
}
export type DesktopEngineId = 'ffmpeg' | 'ffprobe' | 'seven-zip' | 'qpdf' | 'libreoffice' | 'tesseract' | 'imagemagick' | 'exiftool' | 'czkawka' | 'yt-dlp'
export interface DesktopEngineStatus {
  id: DesktopEngineId
  title: string
  category: string
  available: boolean
  executable?: string
  version?: string
  detail: string
}
/** Returns fixed, read-only version probes for optional local engines. The
 * native side owns the allowlist and never accepts an executable or argument
 * from the renderer. */
export async function getDesktopEngineRegistry() {
  if (!isDesktop()) return [] as DesktopEngineStatus[]
  return invoke<DesktopEngineStatus[]>('engine_registry_status')
}
export async function inspectDesktopMedia(path: string) {
  if (!isDesktop()) throw new Error('媒体探测仅支持桌面模式。')
  return invoke<MediaFileInfo>('inspect_media_file', { path })
}
export async function transcodeDesktopMedia(request: { inputPath: string; outputDir: string; operation: 'extract-mp3' | 'transcode-m4a' | 'transcode-wav' | 'normalize-audio' | 'transcode-mp4' | 'mute-video' | 'remove-audio' | 'remove-subtitles' | 'add-subtitle' | 'burn-subtitle' | 'trim-clip' | 'lossless-clip' | 'remux-mp4' | 'extract-subtitle' | 'extract-cover' | 'clean-metadata' | 'edit-chapters'; runId: string; startSeconds?: number; durationSeconds?: number; subtitlePath?: string; chaptersJson?: string }) {
  if (!isDesktop()) throw new Error('媒体转换仅支持桌面模式。')
  return invoke<MediaOutput>('transcode_media_file', { request })
}
export async function cancelDesktopMediaTranscode(runId: string) {
  if (!isDesktop()) return
  return invoke<void>('cancel_media_transcode', { runId })
}

export interface TranscriptionCapability { available: boolean; executableName: string; modelName: string; detail: string }
export interface TranscriptionProgress { runId: string; progress: number; detail: string }
export interface TranscriptionOutput { path: string; name: string; size: number; elapsedMs: number }
export interface TranscriptionRequest {
  executablePath: string
  modelPath: string
  inputPath: string
  outputDir: string
  runId: string
  language: string
}

/** Runs only after explicit user action. Paths are passed as process arguments,
 * never interpolated into a shell command, and the media remains local. */
export async function probeDesktopTranscriptionEngine(executablePath: string, modelPath: string) {
  if (!isDesktop()) throw new Error('本机转写引擎仅支持 Knitspace 桌面版。')
  return invoke<TranscriptionCapability>('probe_transcription_engine', { request: { executablePath, modelPath } })
}
export async function transcribeDesktopMedia(request: TranscriptionRequest) {
  if (!isDesktop()) throw new Error('本机转写仅支持 Knitspace 桌面版。')
  return invoke<TranscriptionOutput>('transcribe_media_file', { request })
}
export async function cancelDesktopTranscription(runId: string) {
  if (!isDesktop()) return
  return invoke<void>('cancel_transcription', { runId })
}

export async function desktopFileExists(path: string) { return isDesktop() ? invoke<boolean>('file_exists', { path }) : false }
interface InputFilePayload { name:string; path:string; mime:string; size:number; data:number[] }
export interface DesktopInputFileMetadata { name:string; path:string; mime:string; size:number }
export async function inspectDesktopInputFile(path:string) {
  if (!isDesktop()) throw new Error('文件探测仅支持桌面模式。')
  return invoke<DesktopInputFileMetadata>('inspect_input_file',{path})
}
export async function readDesktopInputFile(path:string) {
  const payload = await invoke<InputFilePayload>('read_input_file',{path})
  const file = new File([new Uint8Array(payload.data)],payload.name,{type:payload.mime})
  Object.defineProperty(file,'path',{value:payload.path,enumerable:true})
  return file
}
export interface DesktopWindowCapture {
  path: string
  name: string
  width: number
  height: number
  capturedAt: string
  windowTitle: string
}
export async function captureDesktopForegroundWindow() {
  if (!isDesktop()) throw new Error('前台窗口采集仅支持 Knitspace 桌面版。')
  return invoke<DesktopWindowCapture>('capture_foreground_window')
}
export interface DesktopOcrLanguage {
  tag: string
  displayName: string
}
export interface DesktopOcrCapability {
  available: boolean
  languages: DesktopOcrLanguage[]
  defaultLanguage?: string
  maxImageDimension: number
  detail: string
}
export interface DesktopOcrRecognition {
  text: string
  language: DesktopOcrLanguage
  sourceWidth: number
  sourceHeight: number
  processedWidth: number
  processedHeight: number
  lineCount: number
  downscaled: boolean
}
export async function probeDesktopOcr() {
  if (!isDesktop()) return {
    available: false,
    languages: [],
    maxImageDimension: 0,
    detail: '离线 OCR 需要 Knitspace Windows 桌面开发版。',
  } satisfies DesktopOcrCapability
  return invoke<DesktopOcrCapability>('probe_windows_ocr')
}
export async function recognizeDesktopImageText(path: string, languageTag?: string) {
  if (!isDesktop()) throw new Error('离线 OCR 需要 Knitspace Windows 桌面开发版。')
  return invoke<DesktopOcrRecognition>('recognize_image_text', { path, languageTag })
}
export async function listenWindowFileDrops(handler:(paths:string[])=>void) {
  if(!isDesktop()) return () => undefined
  const { getCurrentWindow } = await import('@tauri-apps/api/window')
  return getCurrentWindow().onDragDropEvent(event=>{ if(event.payload.type==='drop') handler(event.payload.paths) })
}
export type DesktopFileDragEvent =
  | { type: 'enter' | 'over' | 'drop'; paths: string[]; position: { x: number; y: number } }
  | { type: 'leave'; paths: string[] }
export async function listenWindowFileDragEvents(handler: (event: DesktopFileDragEvent) => void) {
  if (!isDesktop()) return () => undefined
  const { getCurrentWindow } = await import('@tauri-apps/api/window')
  const currentWindow = getCurrentWindow()
  const scaleFactor = await currentWindow.scaleFactor()
  let activePaths: string[] = []
  return currentWindow.onDragDropEvent((event) => {
    const payload = event.payload
    if (payload.type === 'leave') {
      activePaths = []
      handler({ type: 'leave', paths: [] })
      return
    }
    if (payload.type === 'enter' || payload.type === 'drop') activePaths = payload.paths
    handler({
      type: payload.type,
      paths: payload.type === 'over' ? activePaths : payload.paths,
      position: { x: payload.position.x / scaleFactor, y: payload.position.y / scaleFactor },
    })
    if (payload.type === 'drop') activePaths = []
  })
}
export async function revealDesktopFile(path: string) { if (isDesktop()) await invoke('reveal_in_folder', { path }) }
export async function saveOutputAs(source:string,name:string) { if(!isDesktop())return;const {save}=await import('@tauri-apps/plugin-dialog');const destination=await save({title:'另存 Knitspace 输出',defaultPath:name});if(!destination)return;return invoke<string>('copy_output_file',{source,destination}) }
export async function setClipboardMonitor(enabled: boolean, paused: boolean) { if (isDesktop()) await invoke('set_clipboard_monitor', { enabled, paused }) }
export interface NativeClipboardPayload { kind: 'text' | 'image'; content?: string; assetPath?: string; hash: string }
export async function readDesktopClipboard() { return isDesktop() ? invoke<NativeClipboardPayload>('read_clipboard_current') : undefined }
export async function copyClipboardItem(item: WorkbenchClipboardItem) {
  if (isDesktop()) return invoke('copy_clipboard', { kind: item.kind, content: item.content, assetPath: item.assetPath })
  if (item.content) return navigator.clipboard.writeText(item.content)
  throw new Error('浏览器模式无法重新复制本地图片资源。')
}
export async function copyPngToClipboard(blob: Blob) {
  if (isDesktop()) {
    await invoke('copy_png_bytes', new Uint8Array(await blob.arrayBuffer()))
    return
  }
  if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') throw new Error('当前浏览器不支持复制图片。')
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
}
export async function stagePngClipboardFile(name: string, blob: Blob) {
  if (!isDesktop()) throw new Error('多张独立图片复制仅支持桌面开发模式。')
  const headerName = name.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 120) || 'code-snapshot.png'
  return invoke<string>('stage_clipboard_png', new Uint8Array(await blob.arrayBuffer()), {
    headers: { 'x-toolknit-file-name': headerName }
  })
}
export async function stageClipboardFile(name: string, blob: Blob) {
  if (!isDesktop()) throw new Error('源文件复制仅支持桌面开发模式。')
  const headerName = name.replace(/[^a-zA-Z0-9._\-\u4e00-\u9fff]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 120) || 'image-file'
  return invoke<string>('stage_clipboard_file', new Uint8Array(await blob.arrayBuffer()), {
    headers: { 'x-toolknit-file-name': encodeURIComponent(headerName) }
  })
}
export interface GifProcessOptions {
  quality: number
  mode: 'convert' | 'resize' | 'crop' | 'rotate'
  maxWidth: number
  rotation: number
  cropLeft: number
  cropTop: number
  cropWidth: number
  cropHeight: number
}
export async function processAnimatedGif(blob: Blob, options: GifProcessOptions) {
  if (!isDesktop()) throw new Error('GIF 动画压缩目前需要桌面模式。')
  const result = await invoke<ArrayBuffer>('process_gif_bytes', new Uint8Array(await blob.arrayBuffer()), {
    headers: {
      'x-toolknit-quality': String(Math.round(options.quality)),
      'x-toolknit-mode': options.mode,
      'x-toolknit-max-width': String(Math.round(options.maxWidth)),
      'x-toolknit-rotation': String(Math.round(options.rotation)),
      'x-toolknit-crop-left': String(options.cropLeft),
      'x-toolknit-crop-top': String(options.cropTop),
      'x-toolknit-crop-width': String(options.cropWidth),
      'x-toolknit-crop-height': String(options.cropHeight),
    }
  })
  return new Blob([result], { type: 'image/gif' })
}
export async function copyStagedPngFiles(paths: string[]) {
  if (!isDesktop()) throw new Error('多张独立图片复制仅支持桌面开发模式。')
  return invoke<void>('copy_staged_png_files', { paths })
}
export async function cleanupClipboardAssets(activePaths:string[]) { if(isDesktop()) await invoke('cleanup_clipboard_assets',{activePaths}) }
export function localAssetUrl(path?: string) { return path && isDesktop() ? convertFileSrc(path) : path ?? '' }

export async function listenDesktopEvent<T>(event: string, handler: (payload: T) => void) {
  if (!isDesktop()) return () => undefined
  const { listen } = await import('@tauri-apps/api/event')
  return listen<T>(event, ({ payload }) => handler(payload))
}

export async function hideMainWindow() { if (isDesktop()) { const { getCurrentWindow } = await import('@tauri-apps/api/window'); await getCurrentWindow().hide() } }
export async function quitDesktopApp() { if (isDesktop()) await invoke('quit_app') }

export interface GitHubRelease { tag_name: string; html_url: string; published_at?: string; name?: string; body?: string }
export async function checkDesktopUpdate() { return isDesktop() ? invoke<GitHubRelease>('check_github_update') : undefined }
export async function openExternalUrl(url:string) { if(isDesktop()){const {open}=await import('@tauri-apps/plugin-shell');await open(url)}else window.open(url,'_blank','noopener,noreferrer') }

export async function sendSystemNotification(title: string, body: string) {
  if (!isDesktop()) return false
  const { isPermissionGranted, requestPermission, sendNotification } = await import('@tauri-apps/plugin-notification')
  let granted = await isPermissionGranted()
  if (!granted) granted = await requestPermission() === 'granted'
  if (granted) sendNotification({ title, body })
  return granted
}
