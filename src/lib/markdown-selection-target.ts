import type { ContentAiAction } from '@/lib/ai'

export const markdownSelectionTargetPaths = {
  codeImage: '/code-image',
  ai: '/ai',
} as const

/** Selection handoffs are kept outside the editor component so menu labels can
 * evolve without silently reviving retired route names. */
export function markdownSelectionAiTarget(action: Extract<ContentAiAction, 'summarize' | 'rewrite'>) {
  return { path: markdownSelectionTargetPaths.ai, query: { action } }
}
