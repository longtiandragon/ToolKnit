import { describe, expect, it } from 'vitest'
import type { ToolPipelineRecipe, ToolRecipe } from '@/types'
import {
  automationRecipePreviewLocation,
  automationRecordsFromRecipes,
  recipesFromAutomationRecords,
} from './automation-recipes'

const toolRecipe: ToolRecipe = {
  id: '0198c123-4567-7890-abcd-ef0123456789',
  title: '图片压缩',
  group: 'image',
  operation: 'compress',
  parameters: { quality: 82 },
  createdAt: '2026-08-19T00:00:00Z',
}

const pipelineRecipe: ToolPipelineRecipe = {
  id: '0198c123-4567-7890-abcd-ef0123456790',
  title: '交付前处理',
  version: 1,
  scope: 'artifact',
  steps: [{ id: 'step-1', toolId: 'image.clean-metadata', parameters: { quality: 82 }, onError: 'stop' }],
  createdAt: '2026-08-19T00:00:00Z',
  updatedAt: '2026-08-19T01:00:00Z',
  lastRunAt: '2026-08-19T02:00:00Z',
}

describe('automation recipe transport', () => {
  it('round-trips portable tool and pipeline semantics without file state', () => {
    const records = automationRecordsFromRecipes([toolRecipe], [pipelineRecipe])
    expect(records.map(record => record.kind)).toEqual(['tool', 'artifact-pipeline'])
    expect(JSON.stringify(records)).not.toMatch(/input|outputDirectory|fileBody/)
    expect(recipesFromAutomationRecords(records)).toEqual({
      recipes: [toolRecipe],
      pipelineRecipes: [pipelineRecipe],
    })
  })

  it('drops malformed native records at the renderer boundary', () => {
    const [record] = automationRecordsFromRecipes([toolRecipe], [])
    const malformed = { ...record, definition: { group: 'image', operation: 'compress', parameters: { nested: { path: 'x' } } } }
    expect(recipesFromAutomationRecords([malformed as unknown as typeof record])).toEqual({ recipes: [], pipelineRecipes: [] })
  })

  it('routes each kind to a manual preview instead of an automatic run', () => {
    expect(automationRecipePreviewLocation('tool', 'one')).toEqual({ path: '/tools', query: { recipe: 'one' } })
    expect(automationRecipePreviewLocation('text-pipeline', 'two')).toEqual({ path: '/tools', query: { mode: 'pipeline', recipe: 'two' } })
    expect(automationRecipePreviewLocation('artifact-pipeline', 'three')).toEqual({ path: '/tools', query: { mode: 'file-pipeline', recipe: 'three' } })
  })
})
