import type { StudyDocument } from '@/types'
import { cloneReviewState } from './review-state'

/**
 * A Vault folder is metadata, not a filesystem path. Keep only safe, readable
 * segments so it can later be mirrored to a real folder without permitting a
 * traversal sequence or platform-reserved filename characters.
 */
export function normalizeDocumentFolder(value: unknown) {
  if (typeof value !== 'string') return undefined
  const segments = value.replace(/\\/g, '/').split('/')
    .map((segment) => segment.trim().replace(/[<>:"|?*\u0000-\u001F]/g, '').slice(0, 72))
    .filter((segment) => Boolean(segment) && segment !== '.' && segment !== '..')
    .slice(0, 12)
  return segments.length ? segments.join('/') : undefined
}

/**
 * Produces a plain, serializable document from Vue proxies or restored data.
 * It also repairs array fields written by older/incomplete workspace versions.
 */
export function cloneStudyDocument(document: StudyDocument): StudyDocument {
  const plain = JSON.parse(JSON.stringify(document)) as StudyDocument
  plain.kind = plain.kind === 'note' ? 'note' : 'question'
  plain.tags = Array.isArray(plain.tags) ? plain.tags.filter((value): value is string => typeof value === 'string') : []
  const folder = normalizeDocumentFolder(plain.folder)
  if (folder) plain.folder = folder
  else delete plain.folder
  plain.errorTypes = Array.isArray(plain.errorTypes) ? plain.errorTypes.filter((value): value is string => typeof value === 'string') : []
  plain.difficulty = Number.isFinite(plain.difficulty) ? Math.min(5, Math.max(0, Math.round(plain.difficulty))) : plain.kind === 'question' ? 3 : 0
  plain.reviewEnabled = typeof plain.reviewEnabled === 'boolean' ? plain.reviewEnabled : plain.kind === 'question'
  if (plain.kind === 'question') {
    plain.questionType = ['algorithm', 'math', 'science', 'general'].includes(plain.questionType ?? '') ? plain.questionType : 'general'
    const details = plain.questionDetails && typeof plain.questionDetails === 'object' ? plain.questionDetails : {} as StudyDocument['questionDetails']
    plain.questionDetails = {
      source: typeof details?.source === 'string' ? details.source : '',
      stem: typeof details?.stem === 'string' ? details.stem : '',
      answer: typeof details?.answer === 'string' ? details.answer : '',
      explanation: typeof details?.explanation === 'string' ? details.explanation : '',
      wrongAnswer: typeof details?.wrongAnswer === 'string' ? details.wrongAnswer : '',
      errorReason: typeof details?.errorReason === 'string' ? details.errorReason : ''
    }
  } else {
    delete plain.questionDetails
    delete plain.questionType
  }
  if (plain.sourceAnchor) {
    const bbox = Array.isArray(plain.sourceAnchor.bbox) && plain.sourceAnchor.bbox.length === 4
      ? plain.sourceAnchor.bbox.map((value) => Number.isFinite(value) ? Math.min(1, Math.max(0, Number(value))) : 0) as [number, number, number, number]
      : [0, 0, 1, 1] as [number, number, number, number]
    if (typeof plain.sourceAnchor.sourceId === 'string') plain.sourceAnchor = { ...plain.sourceAnchor, pageIndex: Number.isFinite(plain.sourceAnchor.pageIndex) ? Math.max(0, Math.round(plain.sourceAnchor.pageIndex)) : 0, bbox }
    else delete plain.sourceAnchor
  }
  if (plain.review && typeof plain.review.due === 'string') {
    plain.review = cloneReviewState(plain.review)
  } else delete plain.review
  if (plain.kind === 'question' && plain.reviewFacets && typeof plain.reviewFacets === 'object') {
    const errorReview = plain.reviewFacets.error
    plain.reviewFacets = errorReview && typeof errorReview.due === 'string'
      ? { error: cloneReviewState(errorReview) }
      : undefined
  } else delete plain.reviewFacets
  plain.reviewEnabled = plain.kind === 'question'
    ? Boolean(plain.review || plain.reviewFacets?.error)
    : plain.reviewEnabled
  if (plain.externalFile && typeof plain.externalFile.path === 'string' && typeof plain.externalFile.name === 'string' && typeof plain.externalFile.hash === 'string') {
    plain.externalFile = {
      ...plain.externalFile,
      modifiedAt: typeof plain.externalFile.modifiedAt === 'string' ? plain.externalFile.modifiedAt : '',
      size: Number.isFinite(plain.externalFile.size) ? Math.max(0, plain.externalFile.size) : 0
    }
  } else delete plain.externalFile
  return plain
}

/** Inserts a new document without silently replacing an existing entity. */
export function insertStudyDocument(documents: StudyDocument[], document: StudyDocument) {
  if (documents.some((item) => item.id === document.id)) return documents
  return [cloneStudyDocument(document), ...documents]
}
