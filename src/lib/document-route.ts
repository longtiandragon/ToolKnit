export type DocumentEditorMode = 'edit' | 'split' | 'preview' | 'mindmap'
export type MarkdownInsertRequest = 'table' | 'formula'

export function markdownInsertRequest(value: unknown): MarkdownInsertRequest | undefined {
  return value === 'table' || value === 'formula' ? value : undefined
}

/** Build a stable route after a create action without losing a requested
 * editor mode or one-shot insertion dialog. */
export function createdDocumentRoute(
  kind: 'note' | 'question',
  document: string,
  mode: DocumentEditorMode,
  insert?: MarkdownInsertRequest,
  recognize?: 'formula',
) {
  return {
    path: '/documents',
    query: { kind, document, mode, ...(insert ? { insert } : {}), ...(insert === 'formula' && recognize === 'formula' ? { recognize } : {}) },
  }
}
