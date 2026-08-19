import { transformText, type TextTransformMode } from '@/lib/file-tools'
import type { ArtifactKind, ArtifactPipelineStepLog, ArtifactRef, ToolPipelineCondition, ToolPipelineErrorPolicy, ToolPipelineStep } from '@/types'

/**
 * The small, serializable contract shared by toolbox tools.
 *
 * A definition describes the user-facing capability and its execution class;
 * it does not contain a path, a File object, or any user data. That boundary
 * keeps recipes portable between browser and desktop builds and gives native
 * runners a place to join later without changing the recipe format again.
 */
export type ToolRunnerKind = 'worker' | 'native' | 'cli'
export type ToolInputKind = ArtifactKind
export type ToolOutputKind = ArtifactKind
export type ToolPlatformGroup = '文本' | '开发' | '文件' | '图片' | '媒体' | 'PDF' | '归档'
export type ToolExecutionBoundary = 'renderer-worker' | 'desktop-native' | 'external-cli'
export type ToolDestructiveLevel = 'none' | 'creates-output' | 'moves-input' | 'deletes-input'
export type ToolPermission = 'read-selected-files' | 'read-selected-directory' | 'write-new-files' | 'move-selected-files' | 'run-local-engine'

export interface ToolParameterDefinition {
  id: string
  label: string
  kind: 'text' | 'number' | 'select' | 'boolean' | 'range' | 'directory'
  required?: boolean
  options?: readonly { value: string; label: string }[]
}

export interface ToolTextResult {
  content: string
  extension: string
}

export interface ToolDefinition {
  id: string
  title: string
  description: string
  group: ToolPlatformGroup
  runner: ToolRunnerKind
  executionBoundary: ToolExecutionBoundary
  accepts: readonly ToolInputKind[]
  output: ToolOutputKind
  destructiveLevel: ToolDestructiveLevel
  permissions: readonly ToolPermission[]
  createsNewOutput: boolean
  maxConcurrency: 1 | 2 | 3 | 4
  parameters: readonly ToolParameterDefinition[]
  keywords: readonly string[]
  runText?: (input: string, parameters: Record<string, unknown>) => ToolTextResult
}

export interface TextPipelineStepResult extends ToolTextResult {
  stepId: string
  toolId: string
  title: string
  attempts: number
  skipped?: boolean
  skipReason?: 'condition' | 'error'
}

export interface TextPipelineResult extends ToolTextResult {
  steps: TextPipelineStepResult[]
}

export interface ToolPipelineProgress {
  index: number
  total: number
  step: ToolPipelineStep
  definition: ToolDefinition
  attempt: number
  skipped?: boolean
}

export interface AsyncTextPipelineOptions {
  onProgress?: (progress: ToolPipelineProgress) => void
  shouldCancel?: () => boolean
}

export class ToolPipelineCancelledError extends Error {
  constructor() {
    super('流水线已停止。')
    this.name = 'ToolPipelineCancelledError'
  }
}

export const TEXT_PIPELINE_MAX_INPUT_BYTES = 8 * 1024 * 1024
export const TEXT_PIPELINE_MAX_OUTPUT_BYTES = 16 * 1024 * 1024
export const TOOL_PIPELINE_MAX_STEPS = 12
export const TOOL_PIPELINE_MAX_RETRIES = 2

function textDefinition(id: string, title: string, description: string, mode: TextTransformMode, keywords: readonly string[]): ToolDefinition {
  return {
    id,
    title,
    description,
    group: '文本',
    runner: 'worker',
    executionBoundary: 'renderer-worker',
    accepts: ['text'],
    output: 'text',
    destructiveLevel: 'none',
    permissions: [],
    createsNewOutput: true,
    maxConcurrency: 4,
    parameters: [],
    keywords,
    runText: (input) => transformText(input, mode),
  }
}

/** Built-ins are deliberately boring: they are the compatibility bridge for
 * the text tools already present in BatchView, not a second tool catalogue. */
function artifactDefinition(definition: Omit<ToolDefinition, 'keywords'> & { keywords?: readonly string[] }): ToolDefinition {
  return { keywords: [], ...definition }
}

const definitions: readonly ToolDefinition[] = [
  textDefinition('text.json', '格式化 JSON', '整理缩进并检查 JSON 语法', 'json', ['json', '美化', '校验']),
  textDefinition('text.trim', '清理纯文本', '移除尾随空格和多余空行', 'trim', ['trim', '空格', '清理']),
  textDefinition('text.markdown', '清理 Markdown', '统一换行并压缩多余空行', 'markdown', ['markdown', 'md', '换行']),
  textDefinition('text.dedupe-lines', '删除重复行', '保留第一次出现的内容并清除空行', 'dedupe-lines', ['去重', '名单', '行']),
  textDefinition('text.sort-lines', '自然排序文本行', '按中文、数字和字母顺序整理清单', 'sort-lines', ['排序', '名单', '自然排序']),
  textDefinition('text.extract-contacts', '提取链接与邮箱', '从长文本中汇总网址和邮箱地址', 'extract-contacts', ['网址', 'url', 'email', '邮箱']),
  textDefinition('text.statistics', '统计字数与段落', '本地统计字符、词语、段落和行数', 'statistics', ['字数', '字符', '段落', '统计']),
  artifactDefinition({
    id: 'image.compress', title: '压缩图片', description: '限制最大宽度并重新编码为新图片', group: '图片', runner: 'worker', executionBoundary: 'renderer-worker',
    accepts: ['image'], output: 'image', destructiveLevel: 'creates-output', permissions: ['read-selected-files', 'write-new-files'], createsNewOutput: true, maxConcurrency: 2,
    parameters: [
      { id: 'maxWidth', label: '最大宽度', kind: 'number' },
      { id: 'quality', label: '质量', kind: 'range' },
    ],
    keywords: ['图片压缩', 'resize', 'quality'],
  }),
  artifactDefinition({
    id: 'image.clean-metadata', title: '清除图片元数据', description: '重新编码并生成不含 EXIF/GPS 的新图片', group: '图片', runner: 'worker', executionBoundary: 'renderer-worker',
    accepts: ['image'], output: 'image', destructiveLevel: 'creates-output', permissions: ['read-selected-files', 'write-new-files'], createsNewOutput: true, maxConcurrency: 2,
    parameters: [], keywords: ['EXIF', 'GPS', '隐私'],
  }),
  artifactDefinition({
    id: 'pdf.extract-pages', title: '提取 PDF 页面', description: '按页码范围为每个输入生成新 PDF', group: 'PDF', runner: 'worker', executionBoundary: 'renderer-worker',
    accepts: ['pdf'], output: 'pdf', destructiveLevel: 'creates-output', permissions: ['read-selected-files', 'write-new-files'], createsNewOutput: true, maxConcurrency: 1,
    parameters: [{ id: 'pageRange', label: '页码范围', kind: 'text', required: true }], keywords: ['PDF', '页面', 'extract'],
  }),
  artifactDefinition({
    id: 'archive.zip', title: '逐项创建 ZIP', description: '为每个输入生成独立 ZIP，不修改原件', group: '归档', runner: 'native', executionBoundary: 'desktop-native',
    accepts: ['image', 'pdf', 'media', 'files', 'archive'], output: 'archive', destructiveLevel: 'creates-output', permissions: ['read-selected-files', 'write-new-files'], createsNewOutput: true, maxConcurrency: 2,
    parameters: [], keywords: ['ZIP', '压缩包', '归档'],
  }),
  artifactDefinition({
    id: 'media.clean-metadata', title: '清除媒体元数据', description: '调用本机 FFmpeg 生成无元数据的新媒体文件', group: '媒体', runner: 'cli', executionBoundary: 'external-cli',
    accepts: ['media'], output: 'media', destructiveLevel: 'creates-output', permissions: ['read-selected-files', 'write-new-files', 'run-local-engine'], createsNewOutput: true, maxConcurrency: 1,
    parameters: [], keywords: ['FFmpeg', 'metadata', '隐私'],
  }),
]

const definitionsById = new Map(definitions.map((definition) => [definition.id, definition]))

export function listToolDefinitions(accepts?: ToolInputKind) {
  return definitions.filter(definition => !accepts || definition.accepts.includes(accepts))
}

export function getToolDefinition(toolId: string) {
  return definitionsById.get(toolId)
}

function utf8Bytes(value: string) {
  return new TextEncoder().encode(value).byteLength
}

function invalidStep(message: string): never {
  throw new Error(`流水线配置无效：${message}`)
}

export function validatePipelineSteps(steps: readonly ToolPipelineStep[]) {
  if (!Array.isArray(steps) || steps.length === 0) invalidStep('至少需要一个工具步骤。')
  if (steps.length > TOOL_PIPELINE_MAX_STEPS) invalidStep(`最多支持 ${TOOL_PIPELINE_MAX_STEPS} 个步骤。`)
  const ids = new Set<string>()
  for (const [index, step] of steps.entries()) {
    if (!step || typeof step.id !== 'string' || !step.id.trim()) invalidStep(`第 ${index + 1} 步缺少稳定 ID。`)
    if (ids.has(step.id)) invalidStep(`第 ${index + 1} 步的 ID 重复。`)
    ids.add(step.id)
    if (!step.toolId || typeof step.toolId !== 'string') invalidStep(`第 ${index + 1} 步没有工具。`)
    const definition = getToolDefinition(step.toolId)
    if (!definition) invalidStep(`找不到工具“${step.toolId}”，请重新选择。`)
    if (!definition.runText || !definition.accepts.includes('text') || definition.output !== 'text') {
      invalidStep(`工具“${definition.title}”暂不支持文本流水线。`)
    }
    if (step.parameters !== undefined && (!step.parameters || typeof step.parameters !== 'object' || Array.isArray(step.parameters))) {
      invalidStep(`第 ${index + 1} 步的参数格式不正确。`)
    }
    if (step.onError !== undefined && !(['stop', 'skip', 'retry'] as ToolPipelineErrorPolicy[]).includes(step.onError)) invalidStep(`第 ${index + 1} 步的失败策略不正确。`)
    if (step.when !== undefined && !(['always', 'non-empty', 'empty', 'changed'] as ToolPipelineCondition[]).includes(step.when)) invalidStep(`第 ${index + 1} 步的执行条件不正确。`)
  }
  return true
}

function matchesCondition(condition: ToolPipelineCondition | undefined, content: string, initial: string) {
  switch (condition ?? 'always') {
    case 'non-empty': return content.trim().length > 0
    case 'empty': return content.trim().length === 0
    case 'changed': return content !== initial
    default: return true
  }
}

export function runTextPipeline(input: string, steps: readonly ToolPipelineStep[], onProgress?: (progress: ToolPipelineProgress) => void): TextPipelineResult {
  if (typeof input !== 'string' || !input.trim()) throw new Error('请粘贴文本或选择一个文本文件。')
  if (utf8Bytes(input) > TEXT_PIPELINE_MAX_INPUT_BYTES) throw new Error('输入文本超过 8 MB，流水线已停止。')
  validatePipelineSteps(steps)
  let content = input
  let extension = 'txt'
  const results: TextPipelineStepResult[] = []
  steps.forEach((step, index) => {
    const definition = getToolDefinition(step.toolId)!
    if (!matchesCondition(step.when, content, input)) {
      onProgress?.({ index, total: steps.length, step, definition, attempt: 0, skipped: true })
      results.push({ stepId: step.id, toolId: step.toolId, title: definition.title, content, extension, attempts: 0, skipped: true, skipReason: 'condition' })
      return
    }
    const policy = step.onError ?? 'stop'
    const maxAttempts = policy === 'retry' ? TOOL_PIPELINE_MAX_RETRIES + 1 : 1
    let attempts = 0
    let completed = false
    while (!completed && attempts < maxAttempts) {
      attempts += 1
      onProgress?.({ index, total: steps.length, step, definition, attempt: attempts })
      try {
        const result = definition.runText!(content, step.parameters ?? {})
        if (utf8Bytes(result.content) > TEXT_PIPELINE_MAX_OUTPUT_BYTES) throw new Error(`步骤“${definition.title}”的输出超过 16 MB，流水线已停止。`)
        content = result.content
        extension = result.extension
        results.push({ stepId: step.id, toolId: step.toolId, title: definition.title, content, extension, attempts })
        completed = true
      } catch (error) {
        if (policy === 'skip' || attempts >= maxAttempts) {
          if (policy === 'skip') results.push({ stepId: step.id, toolId: step.toolId, title: definition.title, content, extension, attempts, skipped: true, skipReason: 'error' })
          else throw error
          completed = true
        }
      }
    }
  })
  return { content, extension, steps: results }
}

/**
 * Event-loop friendly counterpart for the desktop UI. The synchronous
 * function remains available for small deterministic callers and tests, while
 * this variant yields between steps so a Stop action can be handled before
 * the next transformation starts.
 */
export async function runTextPipelineAsync(input: string, steps: readonly ToolPipelineStep[], options: AsyncTextPipelineOptions = {}): Promise<TextPipelineResult> {
  if (typeof input !== 'string' || !input.trim()) throw new Error('请粘贴文本或选择一个文本文件。')
  if (utf8Bytes(input) > TEXT_PIPELINE_MAX_INPUT_BYTES) throw new Error('输入文本超过 8 MB，流水线已停止。')
  validatePipelineSteps(steps)
  let content = input
  let extension = 'txt'
  const results: TextPipelineStepResult[] = []
  for (const [index, step] of steps.entries()) {
    if (options.shouldCancel?.()) throw new ToolPipelineCancelledError()
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
    if (options.shouldCancel?.()) throw new ToolPipelineCancelledError()
    const definition = getToolDefinition(step.toolId)!
    if (!matchesCondition(step.when, content, input)) {
      options.onProgress?.({ index, total: steps.length, step, definition, attempt: 0, skipped: true })
      results.push({ stepId: step.id, toolId: step.toolId, title: definition.title, content, extension, attempts: 0, skipped: true, skipReason: 'condition' })
      continue
    }
    const policy = step.onError ?? 'stop'
    const maxAttempts = policy === 'retry' ? TOOL_PIPELINE_MAX_RETRIES + 1 : 1
    let attempts = 0
    let completed = false
    while (!completed && attempts < maxAttempts) {
      if (options.shouldCancel?.()) throw new ToolPipelineCancelledError()
      await new Promise<void>((resolve) => setTimeout(resolve, 0))
      if (options.shouldCancel?.()) throw new ToolPipelineCancelledError()
      attempts += 1
      options.onProgress?.({ index, total: steps.length, step, definition, attempt: attempts })
      try {
        const result = definition.runText!(content, step.parameters ?? {})
        if (utf8Bytes(result.content) > TEXT_PIPELINE_MAX_OUTPUT_BYTES) throw new Error(`步骤“${definition.title}”的输出超过 16 MB，流水线已停止。`)
        content = result.content
        extension = result.extension
        results.push({ stepId: step.id, toolId: step.toolId, title: definition.title, content, extension, attempts })
        completed = true
      } catch (error) {
        if (policy === 'skip' || attempts >= maxAttempts) {
          if (policy === 'skip') results.push({ stepId: step.id, toolId: step.toolId, title: definition.title, content, extension, attempts, skipped: true, skipReason: 'error' })
          else throw error
          completed = true
        }
      }
    }
  }
  return { content, extension, steps: results }
}

function uniqueDefinitions(ids: string[]) {
  const seen = new Set<string>()
  return ids.flatMap((id) => {
    if (seen.has(id)) return []
    const definition = getToolDefinition(id)
    if (!definition) return []
    seen.add(id)
    return [definition]
  }).slice(0, 5)
}

/** Local, deterministic smart detection for the pipeline picker. It only
 * recommends operations that are safe to run in the current text runner. */
export function suggestToolDefinitions(input: string) {
  const raw = input.trim()
  if (!raw) return uniqueDefinitions(['text.trim', 'text.json', 'text.markdown'])
  const ids: string[] = []
  try {
    const parsed = JSON.parse(raw)
    if (parsed !== null && typeof parsed === 'object') ids.push('text.json')
  } catch {
    // Not JSON; the remaining recognizers are intentionally independent.
  }
  if (/https?:\/\/|\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i.test(raw)) ids.push('text.extract-contacts')
  if (/^#{1,6}\s|```|\[[^\]]+\]\([^\n)]+\)/m.test(raw)) ids.push('text.markdown')
  const lines = raw.replace(/\r\n/g, '\n').split('\n').map((line) => line.trim()).filter(Boolean)
  if (lines.length >= 2) {
    const duplicateCount = lines.length - new Set(lines).size
    if (duplicateCount > 0) ids.push('text.dedupe-lines')
    ids.push('text.sort-lines')
  }
  ids.push('text.trim', 'text.statistics')
  return uniqueDefinitions(ids)
}

export function createPipelineStep(toolId: string, index: number): ToolPipelineStep {
  if (!getToolDefinition(toolId)) throw new Error(`找不到工具“${toolId}”。`)
  const safeId = toolId.replace(/[^a-zA-Z0-9_-]+/g, '-')
  return { id: `step-${index + 1}-${safeId}`, toolId, onError: 'stop', when: 'always' }
}

export interface ArtifactPipelineStep {
  id: string
  toolId: string
  parameters?: Record<string, string | number | boolean>
  onError?: ToolPipelineErrorPolicy
}

export interface ArtifactAdapterContext {
  signal?: AbortSignal
  step: ArtifactPipelineStep
  definition: ToolDefinition
  attempt: number
}

export type ArtifactPipelineAdapter = (
  input: ArtifactRef,
  parameters: Record<string, string | number | boolean>,
  context: ArtifactAdapterContext,
) => Promise<ArtifactRef | ArtifactRef[]>

export interface ArtifactPipelineProgress {
  stepIndex: number
  stepCount: number
  completedInputs: number
  inputCount: number
  definition: ToolDefinition
  artifact?: ArtifactRef
  attempt: number
}

export interface ArtifactPipelineOptions {
  adapters: Readonly<Record<string, ArtifactPipelineAdapter>>
  concurrency?: number
  signal?: AbortSignal
  shouldCancel?: () => boolean
  onProgress?: (progress: ArtifactPipelineProgress) => void
  onStepLog?: (log: ArtifactPipelineStepLog) => void
}

export interface ArtifactPipelineResult {
  artifacts: ArtifactRef[]
  logs: ArtifactPipelineStepLog[]
}

export class ArtifactPipelineCancelledError extends Error {
  readonly logs: ArtifactPipelineStepLog[]

  constructor(logs: ArtifactPipelineStepLog[] = []) {
    super('文件流水线已停止。已完成的新输出会保留，原件未修改。')
    this.name = 'ArtifactPipelineCancelledError'
    this.logs = logs
  }
}

export class ArtifactPipelineStepError extends Error {
  readonly logs: ArtifactPipelineStepLog[]
  readonly stepId: string

  constructor(message: string, stepId: string, logs: ArtifactPipelineStepLog[]) {
    super(message)
    this.name = 'ArtifactPipelineStepError'
    this.stepId = stepId
    this.logs = logs
  }
}

export const ARTIFACT_PIPELINE_DEFAULT_CONCURRENCY = 2
export const ARTIFACT_PIPELINE_MAX_CONCURRENCY = 4
export const ARTIFACT_PIPELINE_MAX_INPUTS = 500
export const ARTIFACT_PIPELINE_MAX_OUTPUTS = 1_000

function artifactCancelled(options: ArtifactPipelineOptions) {
  return Boolean(options.signal?.aborted || options.shouldCancel?.())
}

export function validateArtifactRef(value: ArtifactRef) {
  if (!value || typeof value !== 'object') throw new Error('流水线收到无效 ArtifactRef。')
  if (!value.id || value.id.length > 160 || /[\u0000-\u001f]/.test(value.id)) throw new Error('ArtifactRef ID 无效。')
  if (!(['text', 'files', 'directory', 'image', 'pdf', 'media', 'archive'] as ArtifactKind[]).includes(value.kind)) throw new Error('ArtifactRef 类型无效。')
  if (!value.name?.trim() || value.name.length > 512 || /[\u0000-\u001f]/.test(value.name)) throw new Error('ArtifactRef 名称无效。')
  if (value.size !== undefined && (!Number.isSafeInteger(value.size) || value.size < 0 || value.size > 1024 ** 4)) throw new Error('ArtifactRef 大小无效。')
  if (value.mime !== undefined && (value.mime.length > 255 || /[\u0000-\u001f]/.test(value.mime))) throw new Error('ArtifactRef MIME 无效。')
  if (value.locator) {
    if (!['runtime', 'desktop-path', 'vault-asset'].includes(value.locator.kind) || !value.locator.value || value.locator.value.length > 32 * 1024) throw new Error('ArtifactRef 定位引用无效。')
  }
  if (value.metadata) {
    const entries = Object.entries(value.metadata)
    if (entries.length > 32 || entries.some(([key, item]) => !key || key.length > 80 || !['string', 'number', 'boolean'].includes(typeof item))) throw new Error('ArtifactRef 元数据无效。')
  }
  return value
}

function validateArtifactSteps(steps: readonly ArtifactPipelineStep[]) {
  if (!steps.length || steps.length > TOOL_PIPELINE_MAX_STEPS) throw new Error(`文件流水线需要 1 到 ${TOOL_PIPELINE_MAX_STEPS} 个步骤。`)
  const ids = new Set<string>()
  for (const step of steps) {
    if (!step.id || ids.has(step.id)) throw new Error('文件流水线步骤缺少稳定 ID或存在重复。')
    ids.add(step.id)
    const definition = getToolDefinition(step.toolId)
    if (!definition || definition.accepts.includes('text') && definition.accepts.length === 1) throw new Error(`“${step.toolId}”不是可用的文件流水线工具。`)
    if (!['stop', 'skip', 'retry'].includes(step.onError ?? 'stop')) throw new Error('文件流水线失败策略无效。')
  }
}

function stepLog(
  step: ArtifactPipelineStep,
  definition: ToolDefinition,
  inputCount: number,
  outputCount: number,
  failedCount: number,
  startedAt: string,
  status: ArtifactPipelineStepLog['status'],
): ArtifactPipelineStepLog {
  return {
    stepId: step.id,
    toolId: definition.id,
    inputCount,
    outputCount,
    failedCount,
    startedAt,
    completedAt: new Date().toISOString(),
    status,
  }
}

/**
 * Runs lightweight references only. Adapters own a separate bounded runtime
 * registry for browser `File`/Blob values or resolve a desktop path token;
 * those bytes never become part of this result or Pinia state.
 */
export async function runArtifactPipeline(
  inputs: readonly ArtifactRef[],
  steps: readonly ArtifactPipelineStep[],
  options: ArtifactPipelineOptions,
): Promise<ArtifactPipelineResult> {
  if (!inputs.length || inputs.length > ARTIFACT_PIPELINE_MAX_INPUTS) throw new Error(`文件流水线一次支持 1 到 ${ARTIFACT_PIPELINE_MAX_INPUTS} 个输入。`)
  validateArtifactSteps(steps)
  let current = inputs.map(value => ({ ...validateArtifactRef(value), ...(value.locator ? { locator: { ...value.locator } } : {}), ...(value.metadata ? { metadata: { ...value.metadata } } : {}) }))
  const logs: ArtifactPipelineStepLog[] = []
  const requestedConcurrency = Math.round(options.concurrency ?? ARTIFACT_PIPELINE_DEFAULT_CONCURRENCY)
  if (requestedConcurrency < 1 || requestedConcurrency > ARTIFACT_PIPELINE_MAX_CONCURRENCY) throw new Error('文件流水线并发必须在 1 到 4 之间。')

  for (const [stepIndex, step] of steps.entries()) {
    if (artifactCancelled(options)) throw new ArtifactPipelineCancelledError(logs)
    const definition = getToolDefinition(step.toolId)!
    const adapter = options.adapters[definition.id]
    if (!adapter) throw new ArtifactPipelineStepError(`工具“${definition.title}”没有可用执行适配器。`, step.id, logs)
    const startedAt = new Date().toISOString()
    const stepInputCount = current.length
    const outputs: ArtifactRef[][] = Array.from({ length: current.length }, () => [])
    const errors: Array<{ index: number; error: unknown }> = []
    const concurrency = Math.min(requestedConcurrency, definition.maxConcurrency)
    let completedInputs = 0

    for (let offset = 0; offset < current.length; offset += concurrency) {
      if (artifactCancelled(options)) {
        const log = stepLog(step, definition, current.length, outputs.flat().length, errors.length, startedAt, 'cancelled')
        logs.push(log); options.onStepLog?.(log)
        throw new ArtifactPipelineCancelledError(logs)
      }
      const batch = current.slice(offset, offset + concurrency)
      const outcomes = await Promise.all(batch.map(async (artifact, batchIndex) => {
        const index = offset + batchIndex
        if (!definition.accepts.includes(artifact.kind)) return { index, error: new Error(`“${artifact.name}”不是 ${definition.title} 支持的输入类型。`) }
        const maxAttempts = (step.onError ?? 'stop') === 'retry' ? TOOL_PIPELINE_MAX_RETRIES + 1 : 1
        for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
          if (artifactCancelled(options)) return { index, cancelled: true as const }
          options.onProgress?.({ stepIndex, stepCount: steps.length, completedInputs, inputCount: current.length, definition, artifact, attempt })
          try {
            const result = await adapter(artifact, step.parameters ?? {}, { signal: options.signal, step, definition, attempt })
            const values = (Array.isArray(result) ? result : [result]).map(validateArtifactRef)
            return { index, values }
          } catch (error) {
            if (attempt >= maxAttempts) return { index, error }
          }
        }
        return { index, error: new Error('文件步骤没有返回结果。') }
      }))
      for (const outcome of outcomes) {
        completedInputs += 1
        if ('cancelled' in outcome) {
          const log = stepLog(step, definition, current.length, outputs.flat().length, errors.length, startedAt, 'cancelled')
          logs.push(log); options.onStepLog?.(log)
          throw new ArtifactPipelineCancelledError(logs)
        }
        if ('values' in outcome && outcome.values) outputs[outcome.index] = outcome.values
        else if ('error' in outcome) errors.push({ index: outcome.index, error: outcome.error })
      }
      if (errors.length && (step.onError ?? 'stop') === 'stop') break
    }

    if (errors.length && (step.onError ?? 'stop') === 'stop') {
      const log = stepLog(step, definition, current.length, outputs.flat().length, errors.length, startedAt, 'failed')
      logs.push(log); options.onStepLog?.(log)
      const first = errors[0].error
      throw new ArtifactPipelineStepError(first instanceof Error ? first.message : `步骤“${definition.title}”执行失败。`, step.id, logs)
    }
    if (errors.length) {
      for (const { index } of errors) outputs[index] = [current[index]]
    }
    current = outputs.flat()
    if (current.length > ARTIFACT_PIPELINE_MAX_OUTPUTS) {
      const log = stepLog(step, definition, stepInputCount, current.length, errors.length, startedAt, 'failed')
      logs.push(log); options.onStepLog?.(log)
      throw new ArtifactPipelineStepError(`步骤“${definition.title}”产生超过 ${ARTIFACT_PIPELINE_MAX_OUTPUTS} 个输出，流水线已停止。`, step.id, logs)
    }
    const log = stepLog(step, definition, stepInputCount, current.length, errors.length, startedAt, errors.length ? 'partial' : 'succeeded')
    logs.push(log); options.onStepLog?.(log)
  }
  return { artifacts: current, logs }
}
