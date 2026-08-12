import { describe, expect, it } from 'vitest'
import { imagePreviewDebounceMs } from './image-preview-policy'

describe('image preview scheduling', () => {
  it('settles large source images before starting a costly re-render', () => {
    expect(imagePreviewDebounceMs(0)).toBe(120)
    expect(imagePreviewDebounceMs(4 * 1024 * 1024)).toBe(220)
    expect(imagePreviewDebounceMs(16 * 1024 * 1024)).toBe(320)
  })
})
