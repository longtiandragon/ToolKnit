import { describe, expect, it } from 'vitest'
import { acceptsDroppedFile, exceedsDroppedFileLimit, filesWithinDropBudget, formatDropFileSize, mergeFileSelection, type FileDropCandidate } from './file-drop-policy'

describe('file drop policy', () => {
  it('matches extensions, exact MIME types and MIME families', () => {
    expect(acceptsDroppedFile({ name: 'notes.MD', type: 'text/markdown' }, '.md,text/*')).toBe(true)
    expect(acceptsDroppedFile({ name: 'photo.png', type: 'image/png' }, 'image/*')).toBe(true)
    expect(acceptsDroppedFile({ name: 'archive.zip', type: 'application/zip' }, '.md,text/*')).toBe(false)
  })

  it('rejects oversized candidates before their bytes need to be loaded', () => {
    expect(exceedsDroppedFileLimit({ size: 4 * 1024 * 1024 + 1 }, 4 * 1024 * 1024)).toBe(true)
    expect(exceedsDroppedFileLimit({ size: 4 * 1024 * 1024 }, 4 * 1024 * 1024)).toBe(false)
    expect(formatDropFileSize(4 * 1024 * 1024)).toBe('4.0 MB')
  })

  it('keeps a stable prefix-compatible selection within the aggregate memory budget', () => {
    const candidates = [{ size: 4 }, { size: 7 }, { size: 5 }]
    expect(filesWithinDropBudget(candidates, 10)).toEqual({ files: [candidates[0], candidates[2]], rejected: 1, totalBytes: 9 })
    expect(filesWithinDropBudget(candidates)).toEqual({ files: candidates, rejected: 0, totalBytes: 16 })
  })
})

describe('mergeFileSelection', () => {
  const file = (name: string, size: number, lastModified = 1): FileDropCandidate & { lastModified: number } => ({ name, type: 'application/pdf', size, lastModified })

  it('appends a new pick after the files already staged', () => {
    const result = mergeFileSelection([file('a.pdf', 10)], [file('b.pdf', 20)])
    expect(result.files.map((item) => item.name)).toEqual(['a.pdf', 'b.pdf'])
    expect(result.totalBytes).toBe(30)
  })

  it('skips exact duplicates of already staged files', () => {
    const result = mergeFileSelection([file('a.pdf', 10)], [file('a.pdf', 10), file('c.pdf', 5)])
    expect(result.files.map((item) => item.name)).toEqual(['a.pdf', 'c.pdf'])
    expect(result.duplicates).toBe(1)
  })

  it('enforces the aggregate byte budget across old and new files', () => {
    const result = mergeFileSelection([file('a.pdf', 30)], [file('b.pdf', 40), file('c.pdf', 10)], { maxTotalBytes: 60 })
    expect(result.files.map((item) => item.name)).toEqual(['a.pdf', 'c.pdf'])
    expect(result.rejectedOverBudget).toBe(1)
  })

  it('caps the combined list at maxFiles and reports the excess', () => {
    const result = mergeFileSelection([file('a.pdf', 1)], [file('b.pdf', 1), file('c.pdf', 1)], { maxFiles: 2 })
    expect(result.files.map((item) => item.name)).toEqual(['a.pdf', 'b.pdf'])
    expect(result.rejectedOverCount).toBe(1)
  })
})
