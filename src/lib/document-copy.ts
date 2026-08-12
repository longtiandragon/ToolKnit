import type { StudyDocument } from '@/types'
import { cloneStudyDocument } from './study-document'

function copyTitle(title: string) {
  return `${title.trim() || '未命名笔记'} 副本`
}

function replaceDocumentHeading(content: string, sourceTitle: string, nextTitle: string) {
  const lineEnding = content.includes('\r\n') ? '\r\n' : '\n'
  const lines = content.split(/\r?\n/)
  const headingIndex = lines.findIndex((line) => line.trim() === `# ${sourceTitle}`)
  if (headingIndex >= 0) lines[headingIndex] = `# ${nextTitle}`
  return lines.join(lineEnding)
}

/**
 * Makes a self-contained starting point for a related note or question.
 * File links and review state deliberately stay behind: copying them would
 * either sync two documents to one disk file or duplicate an FSRS schedule.
 */
export function createIndependentDocumentCopy(source: StudyDocument, id: string, createdAt: string): StudyDocument {
  const copy = cloneStudyDocument(source)
  const title = copyTitle(source.title)
  copy.id = id
  copy.title = title
  copy.content = replaceDocumentHeading(copy.content, source.title, title)
  copy.createdAt = createdAt
  copy.updatedAt = createdAt
  copy.reviewEnabled = false
  delete copy.review
  delete copy.externalFile
  return copy
}
