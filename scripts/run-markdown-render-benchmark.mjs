import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import { EditorState } from '@codemirror/state'
import { evaluateMarkdownPerformanceBudgets, markdownPerformanceBudgets } from './markdown-performance-budget.mjs'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const fixtureDirectory = resolve(projectRoot, 'benchmarks/generated')

const benchmarkProfiles = [
  { id: '1', fileName: 'markdown-stress.md', label: '1 MB' },
  { id: '3', fileName: 'markdown-stress-3mb.md', label: '3 MB' },
  { id: '5', fileName: 'markdown-stress-5mb.md', label: '5 MB' },
]

function readOption(name) {
  return process.argv.find((argument) => argument.startsWith(`${name}=`))?.slice(name.length + 1)
}

function selectedProfiles() {
  const size = readOption('--size')
  if (!size) return benchmarkProfiles
  const profile = benchmarkProfiles.find((candidate) => candidate.id === size)
  if (!profile) throw new Error('未知的基准档位。可用值：--size=1、--size=3、--size=5。')
  return [profile]
}

function runCount() {
  const value = Number(readOption('--runs') ?? '3')
  if (!Number.isInteger(value) || value < 1 || value > 10) {
    throw new Error('运行次数必须是 1 到 10 的整数，例如 --runs=3。')
  }
  return value
}

function summarize(durations) {
  const sorted = [...durations].sort((left, right) => left - right)
  const total = durations.reduce((sum, duration) => sum + duration, 0)
  const middle = sorted.length / 2
  return {
    averageMs: total / durations.length,
    medianMs: sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[Math.floor(middle)],
    fastestMs: sorted[0],
    slowestMs: sorted.at(-1),
  }
}

const profiles = selectedProfiles()
const runs = runCount()
const shouldCheckBudget = process.argv.includes('--check-budget')
const server = await createServer({
  logLevel: 'error',
  server: { middlewareMode: true, hmr: false },
})

async function closeBenchmarkServer() {
  // Vite's SSR loader can keep a module-graph handle alive on Windows after
  // the result has already been printed. A benchmark must report its timing
  // to CI instead of looking like a failed timeout because teardown stalled.
  let timeout
  const closed = await Promise.race([
    server.close().then(() => true, () => true),
    new Promise((resolve) => {
      timeout = setTimeout(() => resolve(false), 1_500)
      timeout.unref?.()
    }),
  ])
  if (timeout) clearTimeout(timeout)
  if (!closed) console.warn('基准服务器关闭超过 1.5 秒，已在输出结果后强制结束进程。')
}

let exitCode = 0
try {
  // Use Vite's module loader so this executes the exact TypeScript renderer
  // and alias resolution used by the app, rather than maintaining a second
  // Node-only Markdown implementation for benchmarks.
  const { renderMarkdownCached, renderMarkdownDeferredCode, splitMarkdownPreviewBlocks } = await server.ssrLoadModule('/src/lib/markdown.ts')
  const reports = []

  for (const profile of profiles) {
    const source = await readFile(resolve(fixtureDirectory, profile.fileName), 'utf8')

    // The first pass initializes MarkdownIt and the module graph. It is not
    // reported, because the desktop app keeps its Worker alive after startup.
    renderMarkdownDeferredCode(source)

    const durations = []
    let htmlBytes = 0
    for (let index = 0; index < runs; index += 1) {
      const startedAt = performance.now()
      const html = renderMarkdownDeferredCode(source)
      durations.push(performance.now() - startedAt)
      htmlBytes = Buffer.byteLength(html, 'utf8')
    }

    const timing = summarize(durations)
    const cacheStartedAt = performance.now()
    const cachedHtml = renderMarkdownCached(source, true)
    const firstCachedMs = performance.now() - cacheStartedAt
    const cachedDurations = []
    for (let index = 0; index < runs; index += 1) {
      const startedAt = performance.now()
      const html = renderMarkdownCached(source, true)
      cachedDurations.push(performance.now() - startedAt)
      if (html !== cachedHtml) throw new Error(`${profile.label} 缓存预览输出不稳定`)
    }
    const cachedTiming = summarize(cachedDurations)
    const editorState = EditorState.create({ doc: source })
    const editorProjectionDurations = []
    for (let index = 0; index < runs; index += 1) {
      const insertionPoint = Math.floor(editorState.doc.length / 2) + index
      const startedAt = performance.now()
      const edited = editorState.update({ changes: { from: insertionPoint, insert: 'x' } }).state
      const projected = edited.doc.toString()
      editorProjectionDurations.push(performance.now() - startedAt)
      if (projected.length !== source.length + 1) throw new Error(`${profile.label} 编辑器正文投影长度异常`)
    }
    const editorProjectionTiming = summarize(editorProjectionDurations)
    const blockCount = splitMarkdownPreviewBlocks(source)?.length ?? 0
    const report = {
      profile: profile.label,
      sourceKiB: Number((Buffer.byteLength(source, 'utf8') / 1024).toFixed(1)),
      previewKiB: Number((htmlBytes / 1024).toFixed(1)),
      incrementalBlocks: blockCount,
      runs,
      coldAverageMs: Number(timing.averageMs.toFixed(1)),
      coldMedianMs: Number(timing.medianMs.toFixed(1)),
      coldFastestMs: Number(timing.fastestMs.toFixed(1)),
      coldSlowestMs: Number(timing.slowestMs.toFixed(1)),
      firstCachedMs: Number(firstCachedMs.toFixed(1)),
      warmAverageMs: Number(cachedTiming.averageMs.toFixed(1)),
      warmMedianMs: Number(cachedTiming.medianMs.toFixed(1)),
      warmFastestMs: Number(cachedTiming.fastestMs.toFixed(1)),
      warmSlowestMs: Number(cachedTiming.slowestMs.toFixed(1)),
      editorProjectionMedianMs: Number(editorProjectionTiming.medianMs.toFixed(1)),
      editorProjectionSlowestMs: Number(editorProjectionTiming.slowestMs.toFixed(1)),
    }
    reports.push(report)
    console.log(`${profile.label}: 冷解析平均 ${report.coldAverageMs} ms；热预览平均 ${report.warmAverageMs} ms；编辑投影中位数 ${report.editorProjectionMedianMs} ms；分段 ${blockCount || '完整'}；预览 ${report.previewKiB} KiB`)
  }

  console.log(`\n${JSON.stringify({ benchmark: 'markdown-worker-render', reports }, null, 2)}`)
  console.log('说明：冷解析测量 Worker 中的 Markdown 解析与延迟代码/公式占位输出；热预览测量同一内容的缓存重用；编辑投影测量 CodeMirror 小改动后生成完整正文的成本。DOM 挂载、Vue 响应式分发、KaTeX、语法高亮和 Mermaid 不包含在此处。')
  if (shouldCheckBudget) {
    const evaluation = evaluateMarkdownPerformanceBudgets(reports)
    if (!evaluation.passed) {
      throw new Error(`Markdown 性能预算未通过：\n- ${evaluation.failures.join('\n- ')}`)
    }
    const summary = evaluation.checkedProfiles.map((profile) => {
      const budget = markdownPerformanceBudgets[profile]
      return `${profile}（冷 ≤ ${budget.maximumColdMedianMs} ms，热 ≤ ${budget.maximumWarmMedianMs} ms，编辑投影 ≤ ${budget.maximumEditorProjectionMedianMs} ms）`
    }).join('；')
    console.log(`Markdown performance budget passed: ${summary}`)
  }
} catch (error) {
  exitCode = 1
  console.error(error)
} finally {
  await closeBenchmarkServer()
}

// The benchmark owns this process. Force release of a Vite loader handle only
// after all measurements and diagnostics have reached stdout/stderr.
process.exit(exitCode)
