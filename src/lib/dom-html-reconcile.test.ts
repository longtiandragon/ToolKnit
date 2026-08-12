import { describe, expect, it } from 'vitest'
import { planHtmlChildReconciliation } from './dom-html-reconcile'

describe('planHtmlChildReconciliation', () => {
  it('keeps the unchanged nodes around one edited section', () => {
    expect(planHtmlChildReconciliation(['a', 'b', 'c', 'd'], ['a', 'b2', 'c', 'd'], 4)).toEqual({
      prefix: 1,
      suffix: 2,
      fullReplace: false,
    })
  })

  it('handles repeated identical sections by position', () => {
    expect(planHtmlChildReconciliation(['same', 'same', 'tail'], ['same', 'edited', 'tail'], 3)).toEqual({
      prefix: 1,
      suffix: 1,
      fullReplace: false,
    })
  })

  it('falls back safely when an enhancer changed the top-level shape', () => {
    expect(planHtmlChildReconciliation(['a', 'b'], ['a', 'c'], 3)).toEqual({
      prefix: 0,
      suffix: 0,
      fullReplace: true,
    })
  })

  it('supports append-only updates without replacing existing nodes', () => {
    expect(planHtmlChildReconciliation(['a', 'b'], ['a', 'b', 'c'], 2)).toEqual({
      prefix: 2,
      suffix: 0,
      fullReplace: false,
    })
  })
})
