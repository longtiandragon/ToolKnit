import type { SourceKind } from '@/types'

export type SourceHandoffDestination = 'visual' | 'batch' | 'ocr'

/**
 * Select a real destination for a source before transferring its explicit
 * file payload. BatchView delegates general image edits to the image studio,
 * so an image sent to the file tools must use its supported image → PDF flow.
 */
export function sourceHandoffRoute(kind: SourceKind, destination: SourceHandoffDestination) {
  if (destination === 'ocr') return kind === 'image' ? { path: '/ocr' } : undefined
  if (destination === 'visual') return kind === 'image' ? { path: '/visual' } : undefined
  if (kind === 'image') return { path: '/tools', query: { group: 'pdf', operation: 'images-to-pdf' } }
  if (kind === 'pdf') return { path: '/tools', query: { group: 'pdf', operation: 'split' } }
  return undefined
}
