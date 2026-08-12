import { describe, expect, it, vi } from 'vitest'
import { allowDocumentTransition } from './document-transition'

describe('allowDocumentTransition', () => {
  it('allows a clean document without prompting or saving', async () => {
    const ask = vi.fn()
    const save = vi.fn()
    await expect(allowDocumentTransition(false, ask, save)).resolves.toBe(true)
    expect(ask).not.toHaveBeenCalled()
    expect(save).not.toHaveBeenCalled()
  })

  it('keeps the editor open when requested', async () => {
    const save = vi.fn()
    await expect(allowDocumentTransition(true, async () => 'stay', save)).resolves.toBe(false)
    expect(save).not.toHaveBeenCalled()
  })

  it('allows discarding without saving', async () => {
    const save = vi.fn()
    await expect(allowDocumentTransition(true, async () => 'discard', save)).resolves.toBe(true)
    expect(save).not.toHaveBeenCalled()
  })

  it('only allows save-and-continue after a successful save', async () => {
    await expect(allowDocumentTransition(true, async () => 'save', async () => true)).resolves.toBe(true)
    await expect(allowDocumentTransition(true, async () => 'save', async () => false)).resolves.toBe(false)
  })
})
