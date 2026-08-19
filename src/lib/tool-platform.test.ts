import { describe, expect, it } from 'vitest'
import { ArtifactPipelineCancelledError, createPipelineStep, getToolDefinition, runArtifactPipeline, runTextPipeline, runTextPipelineAsync, suggestToolDefinitions, ToolPipelineCancelledError, validatePipelineSteps } from './tool-platform'
import type { ArtifactRef } from '@/types'

describe('tool platform text pipelines', () => {
  it('exposes definitions for the current text tools', () => {
    expect(getToolDefinition('text.json')?.runner).toBe('worker')
    expect(getToolDefinition('text.json')?.output).toBe('text')
    expect(getToolDefinition('missing-tool')).toBeUndefined()
  })

  it('runs ordered steps and reports each step', () => {
    const steps = [createPipelineStep('text.dedupe-lines', 0), createPipelineStep('text.sort-lines', 1)]
    const progress: number[] = []
    const result = runTextPipeline('项目10\n项目2\n项目10\n项目1', steps, ({ index }) => progress.push(index))
    expect(result.content).toBe('项目1\n项目2\n项目10\n')
    expect(result.extension).toBe('txt')
    expect(result.steps.map((step) => step.toolId)).toEqual(['text.dedupe-lines', 'text.sort-lines'])
    expect(progress).toEqual([0, 1])
  })

  it('yields between async steps so cancellation is cooperative', async () => {
    let cancelled = false
    await expect(runTextPipelineAsync('b\na\nb', [createPipelineStep('text.dedupe-lines', 0), createPipelineStep('text.sort-lines', 1)], {
      shouldCancel: () => cancelled,
      onProgress: ({ index }) => { if (index === 0) cancelled = true },
    })).rejects.toBeInstanceOf(ToolPipelineCancelledError)
  })

  it('rejects unknown and oversized pipelines before writing output', () => {
    expect(() => validatePipelineSteps([{ id: 'a', toolId: 'unknown' }])).toThrow(/找不到工具/)
    expect(() => runTextPipeline('x'.repeat(8 * 1024 * 1024 + 1), [createPipelineStep('text.trim', 0)])).toThrow(/超过 8 MB/)
  })

  it('can skip a failed step while preserving the previous output', () => {
    const result = runTextPipeline('{broken}', [
      { ...createPipelineStep('text.json', 0), onError: 'skip' },
      createPipelineStep('text.trim', 1),
    ])
    expect(result.content).toBe('{broken}\n')
    expect(result.steps[0]).toMatchObject({ skipped: true, attempts: 1 })
    expect(result.steps[1].content).toBe('{broken}\n')
  })

  it('reports each bounded retry attempt before surfacing a persistent error', () => {
    const attempts: number[] = []
    expect(() => runTextPipeline('{broken}', [{ ...createPipelineStep('text.json', 0), onError: 'retry' }], ({ attempt }) => attempts.push(attempt))).toThrow('JSON')
    expect(attempts).toEqual([1, 2, 3])
  })

  it('supports deterministic conditional branches without changing skipped content', () => {
    const result = runTextPipeline(' b \n a', [
      createPipelineStep('text.trim', 0),
      { ...createPipelineStep('text.sort-lines', 1), when: 'changed' },
      { ...createPipelineStep('text.json', 2), when: 'empty' },
      { ...createPipelineStep('text.statistics', 3), when: 'non-empty' },
    ])
    expect(result.steps.map((step) => step.attempts)).toEqual([1, 1, 0, 1])
    expect(result.steps[2]).toMatchObject({ skipped: true, skipReason: 'condition' })
    expect(result.steps[3].content).toContain('字符（含空格）')
  })

  it('rejects unknown conditional branch values', () => {
    expect(() => validatePipelineSteps([{ id: 'a', toolId: 'text.trim', when: 'sometimes' as never }])).toThrow(/执行条件/)
  })

  it('recommends deterministic operations from pasted content', () => {
    expect(suggestToolDefinitions('{"ok":true}').map((tool) => tool.id).slice(0, 2)).toEqual(['text.json', 'text.trim'])
    expect(suggestToolDefinitions('https://example.com\na@example.com').map((tool) => tool.id)).toContain('text.extract-contacts')
    expect(suggestToolDefinitions('b\na\nb').map((tool) => tool.id)).toContain('text.dedupe-lines')
  })
})

describe('tool platform ArtifactRef pipelines', () => {
  const inputs: ArtifactRef[] = Array.from({ length: 6 }, (_, index) => ({
    id: `image-${index}`,
    kind: 'image',
    name: `image-${index}.png`,
    mime: 'image/png',
    size: 100 + index,
    locator: { kind: 'runtime', value: `runtime-${index}` },
  }))

  it('publishes execution boundaries, permissions and non-destructive output contracts', () => {
    expect(getToolDefinition('image.compress')).toMatchObject({
      executionBoundary: 'renderer-worker',
      destructiveLevel: 'creates-output',
      createsNewOutput: true,
      maxConcurrency: 2,
    })
    expect(getToolDefinition('media.clean-metadata')?.permissions).toContain('run-local-engine')
  })

  it('runs multiple lightweight references with bounded concurrency and step logs', async () => {
    let active = 0
    let peak = 0
    const result = await runArtifactPipeline(inputs, [{ id: 'compress', toolId: 'image.compress' }], {
      concurrency: 4,
      adapters: {
        async 'image.compress'(input) {
          active += 1
          peak = Math.max(peak, active)
          await new Promise(resolve => setTimeout(resolve, 2))
          active -= 1
          return { ...input, id: `${input.id}-out`, name: `${input.name}-out` }
        },
      },
    })
    expect(peak).toBe(2)
    expect(result.artifacts).toHaveLength(6)
    expect(result.logs).toEqual([expect.objectContaining({ inputCount: 6, outputCount: 6, failedCount: 0, status: 'succeeded' })])
  })

  it('preserves an input when skip policy handles one failed artifact', async () => {
    const result = await runArtifactPipeline(inputs.slice(0, 2), [{ id: 'clean', toolId: 'image.clean-metadata', onError: 'skip' }], {
      adapters: {
        async 'image.clean-metadata'(input) {
          if (input.id === 'image-1') throw new Error('fixture failure')
          return { ...input, id: `${input.id}-clean`, name: `${input.name}-clean` }
        },
      },
    })
    expect(result.artifacts.map(item => item.id)).toEqual(['image-0-clean', 'image-1'])
    expect(result.logs[0]).toMatchObject({ failedCount: 1, status: 'partial' })
  })

  it('stops between bounded batches when cancellation is requested', async () => {
    let cancelled = false
    await expect(runArtifactPipeline(inputs, [{ id: 'clean', toolId: 'image.clean-metadata' }], {
      concurrency: 2,
      shouldCancel: () => cancelled,
      adapters: {
        async 'image.clean-metadata'(input) {
          cancelled = true
          return { ...input, id: `${input.id}-clean` }
        },
      },
    })).rejects.toBeInstanceOf(ArtifactPipelineCancelledError)
  })
})
