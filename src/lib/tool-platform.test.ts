import { describe, expect, it } from 'vitest'
import { createPipelineStep, getToolDefinition, runTextPipeline, suggestToolDefinitions, validatePipelineSteps } from './tool-platform'

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

  it('rejects unknown and oversized pipelines before writing output', () => {
    expect(() => validatePipelineSteps([{ id: 'a', toolId: 'unknown' }])).toThrow(/找不到工具/)
    expect(() => runTextPipeline('x'.repeat(8 * 1024 * 1024 + 1), [createPipelineStep('text.trim', 0)])).toThrow(/超过 8 MB/)
  })

  it('recommends deterministic operations from pasted content', () => {
    expect(suggestToolDefinitions('{"ok":true}').map((tool) => tool.id).slice(0, 2)).toEqual(['text.json', 'text.trim'])
    expect(suggestToolDefinitions('https://example.com\na@example.com').map((tool) => tool.id)).toContain('text.extract-contacts')
    expect(suggestToolDefinitions('b\na\nb').map((tool) => tool.id)).toContain('text.dedupe-lines')
  })
})
