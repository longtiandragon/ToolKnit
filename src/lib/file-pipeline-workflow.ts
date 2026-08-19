import { getToolDefinition, type ArtifactPipelineStep } from '@/lib/tool-platform'
import { containsAbsoluteDesktopPath } from '@/lib/job-privacy'
import type { Job, ToolPipelineRecipe, ToolPipelineStep } from '@/types'

const MAX_STEPS = 12
const MAX_PARAMETER_ENTRIES = 32
const REPEAT_WINDOW_MS = 30 * 24 * 60 * 60 * 1000

function safeParameters(value: unknown) {
  if (value === undefined) return undefined
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('文件流水线步骤参数无效。')
  const entries = Object.entries(value)
  if (entries.length > MAX_PARAMETER_ENTRIES) throw new Error('文件流水线步骤参数过多。')
  const safe = entries.map(([key, item]) => {
    if (!key || key.length > 80 || !['string', 'number', 'boolean'].includes(typeof item)) throw new Error('文件流水线步骤包含不支持的参数。')
    if (typeof item === 'string' && (item.length > 4_096 || containsAbsoluteDesktopPath(item))) throw new Error('文件流水线步骤参数包含超长文本或本机路径。')
    return [key, item] as const
  }).sort(([left], [right]) => left.localeCompare(right))
  return Object.fromEntries(safe) as Record<string, string | number | boolean>
}

function normalizedStep(value: unknown, index: number): ArtifactPipelineStep {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`第 ${index + 1} 步格式无效。`)
  const candidate = value as { toolId?: unknown; parameters?: unknown; onError?: unknown }
  if (typeof candidate.toolId !== 'string') throw new Error(`第 ${index + 1} 步缺少工具。`)
  const definition = getToolDefinition(candidate.toolId)
  if (!definition || definition.accepts.includes('text') && definition.accepts.length === 1) throw new Error(`“${candidate.toolId}”不是文件流水线工具。`)
  const onError = candidate.onError ?? 'stop'
  if (!['stop', 'skip', 'retry'].includes(String(onError))) throw new Error(`第 ${index + 1} 步失败策略无效。`)
  const parameters = safeParameters(candidate.parameters)
  return {
    id: `file-step-${index + 1}-${candidate.toolId.replace(/[^a-zA-Z0-9_-]+/g, '-')}`,
    toolId: candidate.toolId,
    onError: onError as ArtifactPipelineStep['onError'],
    ...(parameters ? { parameters } : {}),
  }
}

function normalizedSteps(values: readonly unknown[]) {
  if (!values.length || values.length > MAX_STEPS) throw new Error(`文件流水线需要 1 到 ${MAX_STEPS} 个步骤。`)
  return values.map(normalizedStep)
}

export function serializeArtifactPipelineSteps(steps: readonly ArtifactPipelineStep[]) {
  return normalizedSteps(steps).map(step => JSON.stringify({
    toolId: step.toolId,
    ...(step.parameters ? { parameters: step.parameters } : {}),
    onError: step.onError ?? 'stop',
  }))
}

export function restoreArtifactPipelineParameters(parameters: Job['parameters']) {
  if (!parameters) return undefined
  let steps: ArtifactPipelineStep[]
  if (Array.isArray(parameters.stepConfigs)) {
    if (parameters.stepConfigs.some(value => typeof value !== 'string' || value.length > 16 * 1024)) return undefined
    try { steps = normalizedSteps(parameters.stepConfigs.map(value => JSON.parse(value))) }
    catch { return undefined }
  } else if (Array.isArray(parameters.stepIds)) {
    try { steps = normalizedSteps(parameters.stepIds.map(toolId => ({ toolId }))) }
    catch { return undefined }
  } else return undefined
  const concurrency = typeof parameters.concurrency === 'number' && Number.isInteger(parameters.concurrency)
    ? Math.max(1, Math.min(4, parameters.concurrency))
    : 2
  return { steps, concurrency }
}

export function artifactPipelineSignature(steps: readonly ArtifactPipelineStep[]) {
  return serializeArtifactPipelineSteps(steps).join('\n')
}

export function artifactRecipeMatches(recipe: ToolPipelineRecipe, steps: readonly ArtifactPipelineStep[]) {
  if (recipe.scope !== 'artifact') return false
  try { return artifactPipelineSignature(recipe.steps) === artifactPipelineSignature(steps) }
  catch { return false }
}

export function artifactRecipeSteps(recipe: ToolPipelineRecipe) {
  if (recipe.scope !== 'artifact') return undefined
  try { return normalizedSteps(recipe.steps) }
  catch { return undefined }
}

export function artifactStepsForRecipe(steps: readonly ArtifactPipelineStep[]): ToolPipelineStep[] {
  return normalizedSteps(steps).map(step => ({
    id: step.id,
    toolId: step.toolId,
    ...(step.parameters ? { parameters: { ...step.parameters } } : {}),
    onError: step.onError ?? 'stop',
  }))
}

export function repeatedArtifactPipelineRuns(jobs: readonly Job[], steps: readonly ArtifactPipelineStep[], now = Date.now()) {
  const signature = artifactPipelineSignature(steps)
  const cutoff = now - REPEAT_WINDOW_MS
  return jobs.filter(job => {
    if (job.toolId !== 'pipeline:artifacts' || job.status !== 'succeeded') return false
    const created = Date.parse(job.completedAt ?? job.createdAt)
    if (!Number.isFinite(created) || created < cutoff || created > now) return false
    const restored = restoreArtifactPipelineParameters(job.parameters)
    return restored ? artifactPipelineSignature(restored.steps) === signature : false
  }).length
}
