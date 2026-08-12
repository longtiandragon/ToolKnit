import { describe, expect, it } from 'vitest'
import { appRoutes } from '@/routes'
import { documentKnowledgeAction, knowledgeAreaActions, knowledgeWorkflowActions, vocabularyKnowledgeAction, type KnowledgeAreaId } from './knowledge-workflows'

describe('knowledge workflow discovery', () => {
  it('exposes eight distinct high-frequency tasks backed by registered routes', () => {
    const registered = new Set(appRoutes.map(route => route.path))
    expect(knowledgeWorkflowActions).toHaveLength(8)
    expect(new Set(knowledgeWorkflowActions.map(action => action.id)).size).toBe(8)
    expect(knowledgeWorkflowActions.every(action => registered.has(action.to.split(/[?#]/, 1)[0]))).toBe(true)
  })

  it('gives every knowledge category a browse action and its real creation or import actions', () => {
    const areas: KnowledgeAreaId[] = ['note', 'question', 'word', 'source']
    for (const area of areas) {
      const actions = knowledgeAreaActions(area)
      expect(actions).toHaveLength(3)
      expect(actions.every(action => action.area === area)).toBe(true)
      expect(actions[0]?.id).toBe(`browse-${area === 'note' ? 'notes' : area === 'question' ? 'questions' : area === 'word' ? 'words' : 'sources'}`)
    }
    expect(knowledgeAreaActions('note').map(action => action.id)).toContain('open-markdown')
    expect(knowledgeAreaActions('question').map(action => action.id)).toContain('import-questions')
    expect(knowledgeAreaActions('word').map(action => action.id)).toContain('import-words')
  })

  it('accepts only the deep-link actions consumed by the target editors', () => {
    expect(documentKnowledgeAction('open-file', 'note')).toBe('open-file')
    expect(documentKnowledgeAction('open-file', 'question')).toBeUndefined()
    expect(documentKnowledgeAction('unknown', 'note')).toBeUndefined()
    expect(vocabularyKnowledgeAction('create')).toBe('create')
    expect(vocabularyKnowledgeAction('unknown')).toBeUndefined()
  })
})
