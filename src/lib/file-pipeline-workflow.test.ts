import { describe, expect, it } from 'vitest'
import type { Job, ToolPipelineRecipe } from '@/types'
import { artifactPipelineSignature, artifactRecipeSteps, repeatedArtifactPipelineRuns, restoreArtifactPipelineParameters, serializeArtifactPipelineSteps } from './file-pipeline-workflow'

const steps = [
  { id: 'one', toolId: 'image.compress', parameters: { quality: 84, maxWidth: 1920 }, onError: 'retry' as const },
  { id: 'two', toolId: 'image.clean-metadata', onError: 'stop' as const },
]

describe('file pipeline workflow persistence', () => {
  it('serializes only structured step configuration and restores bounded values', () => {
    const stepConfigs = serializeArtifactPipelineSteps(steps)
    expect(stepConfigs.join('')).not.toContain('C:\\')
    const restored = restoreArtifactPipelineParameters({ concurrency: 9, stepConfigs })
    expect(restored?.concurrency).toBe(4)
    expect(restored?.steps.map(step => step.toolId)).toEqual(['image.compress', 'image.clean-metadata'])
    expect(artifactPipelineSignature(restored!.steps)).toBe(artifactPipelineSignature(steps))
    expect(restoreArtifactPipelineParameters({ stepConfigs: ['{"toolId":"unknown"}'] })).toBeUndefined()
    expect(() => serializeArtifactPipelineSteps([{ id: 'unsafe', toolId: 'image.compress', parameters: { output: 'C:\\private\\out' } }])).toThrow('本机路径')
  })

  it('discovers three confirmed runs in thirty days and separates artifact recipes', () => {
    const now = Date.parse('2026-08-19T10:00:00Z')
    const parameters = { concurrency: 2, stepConfigs: serializeArtifactPipelineSteps(steps) }
    const jobs: Job[] = Array.from({ length: 3 }, (_, index) => ({
      id: `job-${index}`, kind: 'image', label: '文件流水线', status: 'succeeded', progress: 100,
      toolId: 'pipeline:artifacts', parameters, createdAt: new Date(now - index * 86_400_000).toISOString(),
    }))
    expect(repeatedArtifactPipelineRuns(jobs, steps, now)).toBe(3)
    jobs[2].createdAt = new Date(now - 31 * 86_400_000).toISOString()
    expect(repeatedArtifactPipelineRuns(jobs, steps, now)).toBe(2)

    const recipe: ToolPipelineRecipe = {
      id: 'recipe', title: '图片交付前清理', version: 1, scope: 'artifact', steps,
      createdAt: '2026-08-19T00:00:00Z', updatedAt: '2026-08-19T00:00:00Z',
    }
    expect(artifactRecipeSteps(recipe)?.map(step => step.toolId)).toEqual(['image.compress', 'image.clean-metadata'])
    expect(artifactRecipeSteps({ ...recipe, scope: 'text' })).toBeUndefined()
  })
})
