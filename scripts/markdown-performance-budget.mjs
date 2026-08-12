export const markdownPerformanceBudgets = {
  '1 MB': {
    maximumColdMedianMs: 500,
    maximumWarmMedianMs: 150,
    maximumEditorProjectionMedianMs: 80,
    maximumWarmToColdRatio: 0.85,
    maximumPreviewToSourceRatio: 1.35,
    minimumIncrementalBlocks: 240,
  },
  '3 MB': {
    maximumColdMedianMs: 1_200,
    maximumWarmMedianMs: 350,
    maximumEditorProjectionMedianMs: 160,
    maximumWarmToColdRatio: 0.85,
    maximumPreviewToSourceRatio: 1.35,
    minimumIncrementalBlocks: 480,
  },
  '5 MB': {
    maximumColdMedianMs: 2_000,
    maximumWarmMedianMs: 600,
    maximumEditorProjectionMedianMs: 260,
    maximumWarmToColdRatio: 0.85,
    maximumPreviewToSourceRatio: 1.35,
    minimumIncrementalBlocks: 720,
  },
}

function finite(value) {
  return typeof value === 'number' && Number.isFinite(value)
}

export function evaluateMarkdownPerformanceBudgets(reports, budgets = markdownPerformanceBudgets) {
  const failures = []
  const checkedProfiles = []

  for (const report of reports) {
    const budget = budgets[report.profile]
    if (!budget) {
      failures.push(`${report.profile}: 缺少性能预算配置`)
      continue
    }
    checkedProfiles.push(report.profile)

    if (!finite(report.coldMedianMs) || report.coldMedianMs > budget.maximumColdMedianMs) {
      failures.push(`${report.profile}: 冷解析中位数 ${report.coldMedianMs} ms，预算 ≤ ${budget.maximumColdMedianMs} ms`)
    }
    if (!finite(report.warmMedianMs) || report.warmMedianMs > budget.maximumWarmMedianMs) {
      failures.push(`${report.profile}: 热缓存中位数 ${report.warmMedianMs} ms，预算 ≤ ${budget.maximumWarmMedianMs} ms`)
    }
    if (!finite(report.editorProjectionMedianMs) || report.editorProjectionMedianMs > budget.maximumEditorProjectionMedianMs) {
      failures.push(`${report.profile}: 编辑投影中位数 ${report.editorProjectionMedianMs} ms，预算 ≤ ${budget.maximumEditorProjectionMedianMs} ms`)
    }

    const warmToColdRatio = report.coldMedianMs > 0 ? report.warmMedianMs / report.coldMedianMs : Number.POSITIVE_INFINITY
    if (!finite(warmToColdRatio) || warmToColdRatio > budget.maximumWarmToColdRatio) {
      failures.push(`${report.profile}: 热缓存/冷解析比 ${(warmToColdRatio * 100).toFixed(1)}%，预算 ≤ ${(budget.maximumWarmToColdRatio * 100).toFixed(0)}%`)
    }

    const previewToSourceRatio = report.sourceKiB > 0 ? report.previewKiB / report.sourceKiB : Number.POSITIVE_INFINITY
    if (!finite(previewToSourceRatio) || previewToSourceRatio > budget.maximumPreviewToSourceRatio) {
      failures.push(`${report.profile}: 预览/原文体积比 ${previewToSourceRatio.toFixed(2)}，预算 ≤ ${budget.maximumPreviewToSourceRatio}`)
    }
    if (!Number.isInteger(report.incrementalBlocks) || report.incrementalBlocks < budget.minimumIncrementalBlocks) {
      failures.push(`${report.profile}: 安全分段 ${report.incrementalBlocks}，预算 ≥ ${budget.minimumIncrementalBlocks}`)
    }
  }

  return { passed: failures.length === 0, checkedProfiles, failures }
}
