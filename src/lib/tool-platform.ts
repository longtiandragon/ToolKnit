import { transformText, type TextTransformMode } from '@/lib/file-tools'
import type { ToolPipelineCondition, ToolPipelineErrorPolicy, ToolPipelineStep } from '@/types'

/**
 * The small, serializable contract shared by toolbox tools.
 *
 * A definition describes the user-facing capability and its execution class;
 * it does not contain a path, a File object, or any user data. That boundary
 * keeps recipes portable between browser and desktop builds and gives native
 * runners a place to join later without changing the recipe format again.
 */
export type ToolRunnerKind = 'worker' | 'native' | 'cli'
export type ToolInputKind = 'text' | 'file'
export type ToolOutputKind = 'text' | 'file'
export type ToolPlatformGroup = '文本' | '开发' | '文件' | '图片' | '媒体' | 'PDF'

export interface ToolParameterDefinition {
  id: string
  label: string
  kind: 'text' | 'number' | 'select' | 'boolean'
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
  accepts: readonly ToolInputKind[]
  output: ToolOutputKind
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
    accepts: ['text'],
    output: 'text',
    parameters: [],
    keywords,
    runText: (input) => transformText(input, mode),
  }
}

/** Built-ins are deliberately boring: they are the compatibility bridge for
 * the text tools already present in BatchView, not a second tool catalogue. */
const definitions: readonly ToolDefinition[] = [
  textDefinition('text.json', '格式化 JSON', '整理缩进并检查 JSON 语法', 'json', ['json', '美化', '校验']),
  textDefinition('text.trim', '清理纯文本', '移除尾随空格和多余空行', 'trim', ['trim', '空格', '清理']),
  textDefinition('text.markdown', '清理 Markdown', '统一换行并压缩多余空行', 'markdown', ['markdown', 'md', '换行']),
  textDefinition('text.dedupe-lines', '删除重复行', '保留第一次出现的内容并清除空行', 'dedupe-lines', ['去重', '名单', '行']),
  textDefinition('text.sort-lines', '自然排序文本行', '按中文、数字和字母顺序整理清单', 'sort-lines', ['排序', '名单', '自然排序']),
  textDefinition('text.extract-contacts', '提取链接与邮箱', '从长文本中汇总网址和邮箱地址', 'extract-contacts', ['网址', 'url', 'email', '邮箱']),
  textDefinition('text.statistics', '统计字数与段落', '本地统计字符、词语、段落和行数', 'statistics', ['字数', '字符', '段落', '统计']),
]

const definitionsById = new Map(definitions.map((definition) => [definition.id, definition]))

export function listToolDefinitions() {
  return [...definitions]
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
