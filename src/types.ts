export type SourceKind = 'image' | 'pdf' | 'code' | 'text'
export type QuestionType = 'algorithm' | 'math' | 'science' | 'general'
export type ReviewRating = 'Again' | 'Hard' | 'Good' | 'Easy'
export type JobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled'
export type JobKind = 'pdf' | 'image' | 'text' | 'code' | 'ocr' | 'ai' | 'archive'

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
}

export interface StudyDocument {
  id: string
  title: string
  kind: 'question' | 'note'
  questionType?: QuestionType
  subject: string
  tags: string[]
  difficulty: number
  content: string
  sourceAnchor?: SourceAnchor
  createdAt: string
  updatedAt: string
  reviewEnabled: boolean
  review?: ReviewState
  errorTypes: string[]
  aiGenerated?: boolean
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

export interface ToolUsage {
  toolId: string
  route: string
  usedAt: string
}

export type ActivityKind = 'tool' | 'job' | 'source' | 'output' | 'clipboard' | 'backup' | 'system'

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
}

export type CloseBehavior = 'ask' | 'tray' | 'quit'

export interface WorkbenchSettings {
  outputDirectory: string
  clipboardEnabled: boolean
  clipboardPaused: boolean
  clipboardLimit: number
  clipboardRetentionDays: number
  closeBehavior: CloseBehavior
  notificationsEnabled: boolean
  autoCheckUpdates: boolean
  lastUpdateCheck?: string
  lastBackupAt?: string
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
  requiresEngine?: 'ocr' | 'formula'
}
