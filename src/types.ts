export type SourceKind = 'image' | 'pdf' | 'code' | 'text'
export type QuestionType = 'algorithm' | 'math' | 'science' | 'general'
export type ReviewRating = 'Again' | 'Hard' | 'Good' | 'Easy'
export type JobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled'

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
  kind: 'ocr' | 'formula' | 'batch' | 'download'
  label: string
  status: JobStatus
  progress: number
  errorCode?: string
  createdAt: string
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
