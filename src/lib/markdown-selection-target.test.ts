import { describe, expect, it } from 'vitest'
import { appRoutes } from '@/routes'
import { markdownSelectionAiTarget, markdownSelectionTargetPaths } from './markdown-selection-target'

describe('Markdown selection menu targets', () => {
  it('keeps every handoff on a registered application route', () => {
    const registered = new Set(appRoutes.map((route) => route.path))
    expect(registered.has(markdownSelectionTargetPaths.codeImage)).toBe(true)
    expect(registered.has(markdownSelectionTargetPaths.ai)).toBe(true)
    expect(markdownSelectionAiTarget('rewrite')).toEqual({ path: '/ai', query: { action: 'rewrite' } })
    expect(markdownSelectionAiTarget('summarize')).toEqual({ path: '/ai', query: { action: 'summarize' } })
  })
})
