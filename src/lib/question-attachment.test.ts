import { describe, expect, it } from 'vitest'
import type { DesktopQuestionAttachment } from '@/lib/native'
import { formatQuestionAttachmentSize, questionAttachmentIcon, upsertQuestionAttachment } from './question-attachment'

function attachment(id: string, name: string, mime: string): DesktopQuestionAttachment {
  return { id, name, mime, size: 1024, createdAt: '2026-08-10T00:00:00Z', available: true }
}

describe('question attachment summaries', () => {
  it('selects a consistent icon without inspecting file bytes', () => {
    expect(questionAttachmentIcon(attachment('1', 'proof.pdf', 'application/octet-stream'))).toBe('file-pdf')
    expect(questionAttachmentIcon(attachment('2', 'graph.png', 'image/png'))).toBe('file-image')
    expect(questionAttachmentIcon(attachment('3', 'answer.cpp', 'application/octet-stream'))).toBe('file-code')
    expect(questionAttachmentIcon(attachment('4', 'recording.m4a', 'audio/mp4'))).toBe('attachment')
  })

  it('formats bounded metadata and handles invalid values', () => {
    expect(formatQuestionAttachmentSize(0)).toBe('0 B')
    expect(formatQuestionAttachmentSize(1536)).toBe('1.5 KB')
    expect(formatQuestionAttachmentSize(5 * 1024 ** 2)).toBe('5.0 MB')
    expect(formatQuestionAttachmentSize(Number.NaN)).toBe('0 B')
  })

  it('deduplicates repeated imports and keeps the visible list bounded', () => {
    const current = Array.from({ length: 64 }, (_, index) => attachment(String(index), `${index}.txt`, 'text/plain'))
    const next = upsertQuestionAttachment(current, attachment('12', 'updated.txt', 'text/plain'))
    expect(next).toHaveLength(64)
    expect(next[0]?.name).toBe('updated.txt')
    expect(next.filter((item) => item.id === '12')).toHaveLength(1)
  })
})
