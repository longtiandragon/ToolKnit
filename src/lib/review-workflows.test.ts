import { describe, expect, it } from 'vitest'
import { appRoutes } from '@/routes'
import { reviewWorkflowActions, reviewWorkflowGroups } from './review-workflows'

describe('review workflow discovery', () => {
  it('exposes six distinct material tasks backed by registered routes', () => {
    const registered = new Set(appRoutes.map(route => route.path))
    expect(reviewWorkflowActions).toHaveLength(6)
    expect(new Set(reviewWorkflowActions.map(action => action.id)).size).toBe(6)
    expect(reviewWorkflowActions.every(action => registered.has(action.to.split(/[?#]/, 1)[0]))).toBe(true)
  })

  it('balances question and vocabulary maintenance without duplicating session filters', () => {
    const groups = reviewWorkflowGroups()
    expect(groups.question.map(action => action.id)).toEqual(['new-question', 'import-questions', 'browse-questions'])
    expect(groups.word.map(action => action.id)).toEqual(['new-word', 'import-words', 'browse-words'])
    expect(new Set<string>(reviewWorkflowActions.map(action => action.to)).has('/review')).toBe(false)
  })
})
