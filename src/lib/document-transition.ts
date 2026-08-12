export type UnsavedDocumentDecision = 'save' | 'discard' | 'stay'

export async function allowDocumentTransition(
  dirty: boolean,
  ask: () => Promise<UnsavedDocumentDecision>,
  save: () => Promise<boolean>,
) {
  if (!dirty) return true
  const decision = await ask()
  if (decision === 'stay') return false
  if (decision === 'discard') return true
  return save()
}
