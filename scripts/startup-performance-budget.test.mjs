import { describe, expect, it } from 'vitest'
import { collectStartupAssetPaths, evaluateStartupBudget } from './check-startup-budget.mjs'

describe('startup performance budget', () => {
  it('reads only resources referenced by the production entry document', () => {
    expect(collectStartupAssetPaths(`
      <link rel="stylesheet" href="/assets/index.css">
      <link rel="preload" href="/assets/deferred.js">
      <script type="module" src="/assets/index.js"></script>
    `)).toEqual({ scripts: ['/assets/index.js'], styles: ['/assets/index.css'] })
  })

  it('accepts entry resources inside their individual and combined budgets', () => {
    const result = evaluateStartupBudget([
      { kind: 'script', path: '/entry.js', raw: 100, gzip: 40 },
      { kind: 'style', path: '/entry.css', raw: 120, gzip: 45 },
    ], { script: { raw: 110, gzip: 50 }, style: { raw: 130, gzip: 50 }, totalGzip: 100 })
    expect(result).toEqual({ totalGzip: 85, violations: [] })
  })

  it('reports raw, compressed and combined regressions independently', () => {
    const result = evaluateStartupBudget([
      { kind: 'script', path: '/entry.js', raw: 111, gzip: 51 },
      { kind: 'style', path: '/entry.css', raw: 120, gzip: 50 },
    ], { script: { raw: 110, gzip: 50 }, style: { raw: 130, gzip: 50 }, totalGzip: 100 })
    expect(result.violations).toHaveLength(3)
    expect(result.violations.join('\n')).toContain('/entry.js raw')
    expect(result.violations.join('\n')).toContain('/entry.js gzip')
    expect(result.violations.join('\n')).toContain('startup gzip')
  })
})
