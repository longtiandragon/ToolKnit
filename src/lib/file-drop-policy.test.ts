import { describe, expect, it } from 'vitest'
import { acceptsDroppedFile, exceedsDroppedFileLimit, filesWithinDropBudget, formatDropFileSize } from './file-drop-policy'

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
