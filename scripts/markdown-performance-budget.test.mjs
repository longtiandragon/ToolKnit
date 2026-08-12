import { describe, expect, it } from 'vitest'
import { evaluateMarkdownPerformanceBudgets } from './markdown-performance-budget.mjs'

const healthyReport = {
  profile: '1 MB',
  sourceKiB: 1_220,
  previewKiB: 1_340,
  incrementalBlocks: 243,
  coldMedianMs: 40,
  warmMedianMs: 8,
  editorProjectionMedianMs: 3,
}

describe('Markdown performance budget', () => {
  it('accepts a healthy renderer report', () => {
    expect(evaluateMarkdownPerformanceBudgets([healthyReport])).toMatchObject({ passed: true, failures: [] })
  })

  it('reports timing and lost cache benefit together', () => {
    const result = evaluateMarkdownPerformanceBudgets([{ ...healthyReport, coldMedianMs: 600, warmMedianMs: 550 }])
    expect(result.passed).toBe(false)
    expect(result.failures.join('\n')).toContain('冷解析中位数')
    expect(result.failures.join('\n')).toContain('热缓存中位数')
    expect(result.failures.join('\n')).toContain('热缓存/冷解析比')
  })

  it('detects eager output expansion and lost incremental sections', () => {
    const result = evaluateMarkdownPerformanceBudgets([{ ...healthyReport, previewKiB: 2_000, incrementalBlocks: 12 }])
    expect(result.failures.join('\n')).toContain('预览/原文体积比')
    expect(result.failures.join('\n')).toContain('安全分段')
  })

  it('rejects a CodeMirror full-text projection regression', () => {
    const result = evaluateMarkdownPerformanceBudgets([{ ...healthyReport, editorProjectionMedianMs: 120 }])
    expect(result.failures.join('\n')).toContain('编辑投影中位数')
  })

  it('rejects missing or non-finite measurements', () => {
    const result = evaluateMarkdownPerformanceBudgets([{ ...healthyReport, coldMedianMs: Number.NaN }])
    expect(result.passed).toBe(false)
    expect(result.failures.join('\n')).toContain('冷解析中位数')
  })

  it('requires an explicit budget for every measured profile', () => {
    const result = evaluateMarkdownPerformanceBudgets([{ ...healthyReport, profile: '10 MB' }])
    expect(result).toMatchObject({ passed: false, checkedProfiles: [] })
    expect(result.failures[0]).toContain('缺少性能预算配置')
  })
})
