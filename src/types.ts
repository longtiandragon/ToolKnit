export type SourceKind = 'image' | 'pdf' | 'code' | 'text'
export type QuestionType = 'algorithm' | 'math' | 'science' | 'general'
export type ReviewRating = 'Again' | 'Hard' | 'Good' | 'Easy'
/** A question can test recall of the solution separately from recall of the
 * mistake that caused it. The legacy `review` field remains the answer card. */
export type QuestionReviewFacet = 'answer' | 'error'
/** A word sense can be recalled from more than one direction. Every
 * direction owns an independent FSRS state instead of sharing mastery. */
export type VocabularyReviewFacet = 'meaning' | 'spelling' | 'example' | 'comparison'
export type JobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled'
export type JobKind = 'pdf' | 'image' | 'text' | 'code' | 'ocr' | 'ai' | 'archive' | 'script' | 'media'

export interface SourceAnchor {
  sourceId: string
  pageIndex: number
  /** normalized top-left x/y/w/h, always in the range 0..1 */
  bbox: [number, number, number, number]
  cropAssetId?: string
}

export interface Source {
  id: string
  name: string
  kind: SourceKind
  mime: string
  size: number
  sha256?: string
  importedAt: string
  lastOpenedAt?: string
  originalPath?: string
  managedPath?: string
  preview?: string
  content?: string
  pageCount?: number
  tags: string[]
  /** Browser fallback keeps cropped source snippets here; desktop mode writes assets/crops instead. */
  crops?: Record<string, string>
}

export interface ReviewState {
  due: string
  intervalDays: number
  repetitions: number
  lapses: number
  lastReviewedAt?: string
  /** Full FSRS card fields. Older records omit this and are upgraded after
   * their next review; keeping it separate lets the UI show simple metadata
   * without leaking scheduler-specific names everywhere. */
  fsrs?: FsrsCardState
}

export interface FsrsCardState {
  state: number
  stability: number
  difficulty: number
  elapsedDays: number
  scheduledDays: number
  learningSteps: number
}

/** A user-owned Markdown file linked to a document in the local Vault. */
export interface ExternalMarkdownFile {
  path: string
  name: string
  /** Content fingerprint from the last successful read or save. */
  hash: string
  /** File timestamp and size allow lightweight change polling without reading it. */
  modifiedAt: string
  size: number
}

export interface VocabularySense {
  id: string
  partOfSpeech: string
  definition: string
  examples: string[]
  /** Common word partnerships such as “run a program” or “heavy rain”. */
  collocations: string[]
  synonyms: string[]
  reviewEnabled: boolean
  /** The original word → meaning card. Kept as the stable shape for existing
   * Vaults and browser backups. */
  review?: ReviewState
  /** Extra recall directions. `meaning` stays in `review` for backwards
   * compatibility, while spelling, cloze and comparison cards schedule independently. */
  reviewFacets?: Partial<Record<Exclude<VocabularyReviewFacet, 'meaning'>, ReviewState>>
}

/** Structured vocabulary lives in SQLite; senses become independent cards. */
export interface VocabularyEntry {
  id: string
  lemma: string
  language: string
  pronunciation?: string
  forms: Record<string, string>
  senses: VocabularySense[]
  createdAt: string
  updatedAt: string
  /** Desktop list rows omit heavy structured fields until the entry opens. */
  summaryOnly?: boolean
  senseCount?: number
  partOfSpeechPreview?: string
  definitionPreview?: string
}

/** Structured fields for a question. Markdown remains available for free-form notes. */
export interface QuestionDetails {
  /** Human-readable provenance such as a book chapter, course, URL, or problem id. */
  source: string
  stem: string
  answer: string
  explanation: string
  wrongAnswer: string
  errorReason: string
}

export type RelationType = 'related' | 'prerequisite' | 'variation'

/** A light edge between two Vault entities; the entities stay the source of titles and content. */
export interface EntityRelation {
  fromId: string
  toId: string
  relationType: RelationType
  createdAt: string
}

export interface StudyDocument {
  id: string
  title: string
  kind: 'question' | 'note'
  questionType?: QuestionType
  subject: string
  tags: string[]
  /** Virtual Vault folder, such as `算法/二分`. It never moves an external Markdown file. */
  folder?: string
  difficulty: number
  content: string
  questionDetails?: QuestionDetails
  sourceAnchor?: SourceAnchor
  createdAt: string
  updatedAt: string
  reviewEnabled: boolean
  /** `review` is the stable answer card; supplemental question directions
   * live here so older Vaults keep their original schedule unchanged. */
  reviewFacets?: Partial<Record<Exclude<QuestionReviewFacet, 'answer'>, ReviewState>>
  review?: ReviewState
  errorTypes: string[]
  aiGenerated?: boolean
  externalFile?: ExternalMarkdownFile
}

export interface Job {
  id: string
  kind: JobKind
  label: string
  status: JobStatus
  progress: number
  errorCode?: string
  inputNames?: string[]
  outputNames?: string[]
  toolId?: string
  route?: string
  parameters?: Record<string, string | number | boolean | string[]>
  inputs?: FileReference[]
  outputs?: FileReference[]
  startedAt?: string
  completedAt?: string
  retryable?: boolean
  detail?: string
  createdAt: string
  /** Native SQLite revision. Browser snapshots created before the native job
   * ledger omit it, so consumers must continue treating it as optional. */
  updatedAt?: string
}

export interface FileReference {
  name: string
  path?: string
  size?: number
  mime?: string
}

export interface FavoriteTool {
  toolId: string
  order: number
  shortcut?: number
}

export type ContentFavoriteKind = 'note' | 'question' | 'word' | 'source' | 'diagram'

/** A small cross-space pointer. Desktop mode persists these in SQLite while
 * the referenced Markdown, structured record, or source stays authoritative. */
export interface ContentFavorite {
  itemId: string
  itemKind: ContentFavoriteKind
  addedAt: string
}

/** A bounded access pointer used by global “recently opened”. It never owns
 * the referenced content or causes Markdown/source bodies to enter Pinia. */
export interface ContentRecent {
  itemId: string
  itemKind: ContentFavoriteKind
  openedAt: string
}

export interface ToolUsage {
  toolId: string
  route: string
  usedAt: string
}

export type ActivityKind = 'tool' | 'job' | 'source' | 'output' | 'clipboard' | 'backup' | 'system'

/** Compact, structured record for the Today space. Desktop persists these in
 * Vault SQLite; browser preview keeps only a small fallback list. */
export type TimelineEventType = 'pomodoro' | 'anniversary' | 'activity'

export interface TimelineEvent {
  id: string
  type: TimelineEventType
  startsAt: string
  payload: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

export interface ActivityRecord {
  id: string
  kind: ActivityKind
  title: string
  detail?: string
  route?: string
  relatedId?: string
  createdAt: string
}

export type ClipboardKind = 'text' | 'code' | 'image'

export interface ClipboardItem {
  id: string
  kind: ClipboardKind
  content?: string
  assetPath?: string
  preview?: string
  hash: string
  capturedAt: string
  pinned?: boolean
  /** Desktop list hydration may contain only a bounded text prefix. */
  contentLoaded?: boolean
}

export type CloseBehavior = 'ask' | 'tray' | 'quit'
export type ReadingScale = 'compact' | 'comfortable' | 'large'
export type ReadingDensity = 'compact' | 'comfortable' | 'airy'
export type ReadingWidth = 'focused' | 'balanced' | 'wide'
export type ReadingPaperTone = 'warm' | 'neutral' | 'mist' | 'night'
export type TranscriptionLanguage = 'auto' | 'zh' | 'en' | 'ja' | 'ko'

export interface WorkbenchSettings {
  outputDirectory: string
  /** Last user-selected Markdown workspace. Only the path is remembered. */
  markdownWorkspaceDirectory: string
  codeImageAuthor: string
  /** Absolute path to a user-owned JSON manifest. Core never ships one. */
  privateToolsManifestPath: string
  /** User-selected whisper.cpp-compatible CLI. Knitspace never bundles or auto-runs it. */
  transcriptionExecutablePath: string
  /** User-owned local model; only its absolute path is persisted. */
  transcriptionModelPath: string
  transcriptionLanguage: TranscriptionLanguage
  clipboardEnabled: boolean
  clipboardPaused: boolean
  clipboardLimit: number
  clipboardRetentionDays: number
  closeBehavior: CloseBehavior
  notificationsEnabled: boolean
  autoCheckUpdates: boolean
  /** Save an internal or unchanged linked Markdown draft after typing pauses. */
  documentAutoSave: boolean
  readingScale: ReadingScale
  readingDensity: ReadingDensity
  readingWidth: ReadingWidth
  readingPaperTone: ReadingPaperTone
  reduceMotion: boolean
  lastUpdateCheck?: string
  /** Legacy mixed backup timestamp retained for older JSON snapshots. */
  lastBackupAt?: string
  lastManualBackupAt?: string
  lastAutomaticBackupAt?: string
}

/** A reusable preset for one real file-processing operation. */
export interface ToolRecipe {
  id: string
  title: string
  group: 'pdf' | 'image' | 'text' | 'organize'
  operation: string
  parameters: Record<string, string | number>
  createdAt: string
  lastRunAt?: string
}

/** A reusable ordered set of tools. The step shape intentionally contains
 * only serializable parameters and never owns file paths or file contents. */
export type ToolPipelineErrorPolicy = 'stop' | 'skip' | 'retry'

export interface ToolPipelineStep {
  id: string
  toolId: string
  parameters?: Record<string, string | number | boolean>
  /** What to do when this pure transformation cannot process its input. */
  onError?: ToolPipelineErrorPolicy
}

export interface ToolPipelineRecipe {
  id: string
  title: string
  version: 1
  steps: ToolPipelineStep[]
  createdAt: string
  updatedAt: string
  lastRunAt?: string
}

export interface AiProfile {
  id: string
  label: string
  baseUrl: string
  model: string
  hasKey: boolean
}

export interface ToolAction {
  id: string
  title: string
  description: string
  accepts: SourceKind[]
}
