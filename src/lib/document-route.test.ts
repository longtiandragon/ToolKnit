import { describe, expect, it } from 'vitest'
import { createdDocumentRoute, markdownInsertRequest } from './document-route'

describe('document route handoff', () => {
  it('accepts only supported one-shot insert panels', () => {
    expect(markdownInsertRequest('formula')).toBe('formula')
    expect(markdownInsertRequest('table')).toBe('table')
    expect(markdownInsertRequest('ocr')).toBeUndefined()
    expect(markdownInsertRequest(['formula'])).toBeUndefined()
  })

  it('preserves the requested mode and formula dialog after creation', () => {
    expect(createdDocumentRoute('note', 'note-1', 'split', 'formula')).toEqual({
      path: '/documents',
      query: { kind: 'note', document: 'note-1', mode: 'split', insert: 'formula' },
    })
  })

  it('preserves the explicit formula recognition handoff only for formulas', () => {
    expect(createdDocumentRoute('note', 'note-2', 'split', 'formula', 'formula')).toEqual({
      path: '/documents',
      query: { kind: 'note', document: 'note-2', mode: 'split', insert: 'formula', recognize: 'formula' },
    })
    expect(createdDocumentRoute('note', 'note-3', 'split', 'table', 'formula').query).not.toHaveProperty('recognize')
  })

  it('does not add an empty insertion request', () => {
    expect(createdDocumentRoute('question', 'question-1', 'edit')).toEqual({
      path: '/documents',
      query: { kind: 'question', document: 'question-1', mode: 'edit' },
    })
  })
})
