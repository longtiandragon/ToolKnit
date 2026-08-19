import { invoke } from '@tauri-apps/api/core'
import { newId } from '@/lib/id'
import type {
  AutomationRecipeHydration,
  AutomationRecipeKind,
  AutomationRecipeRecord,
  ToolPipelineRecipe,
  ToolPipelineStep,
  ToolRecipe,
} from '@/types'

export interface AutomationRecipeState {
  recipes: ToolRecipe[]
  pipelineRecipes: ToolPipelineRecipe[]
  desktopVaultActive: boolean
  persist: () => void
}

export type ToolRecipeInput = Omit<ToolRecipe, 'id' | 'createdAt' | 'lastRunAt'> & { id?: string }
export type PipelineRecipeInput = Omit<ToolPipelineRecipe, 'id' | 'createdAt' | 'updatedAt' | 'lastRunAt'> & { id?: string }

function isDesktop() {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

function timestamp() {
  return new Date().toISOString()
}

function cloneSteps(steps: ToolPipelineStep[]) {
  return steps.map(step => ({
    ...step,
    ...(step.parameters ? { parameters: { ...step.parameters } } : {}),
  }))
}

function toolRecord(recipe: ToolRecipe): AutomationRecipeRecord {
  return {
    id: recipe.id,
    title: recipe.title,
    kind: 'tool',
    definition: {
      group: recipe.group,
      operation: recipe.operation,
      parameters: { ...recipe.parameters },
    },
    createdAt: recipe.createdAt,
    updatedAt: recipe.lastRunAt ?? recipe.createdAt,
    ...(recipe.lastRunAt ? { lastRunAt: recipe.lastRunAt } : {}),
  }
}

function pipelineRecord(recipe: ToolPipelineRecipe): AutomationRecipeRecord {
  const scope = recipe.scope === 'artifact' ? 'artifact' : 'text'
  return {
    id: recipe.id,
    title: recipe.title,
    kind: scope === 'artifact' ? 'artifact-pipeline' : 'text-pipeline',
    definition: { version: 1, scope, steps: cloneSteps(recipe.steps) },
    createdAt: recipe.createdAt,
    updatedAt: recipe.updatedAt,
    ...(recipe.lastRunAt ? { lastRunAt: recipe.lastRunAt } : {}),
  }
}

export function automationRecordsFromRecipes(recipes: ToolRecipe[], pipelineRecipes: ToolPipelineRecipe[]) {
  return [...recipes.map(toolRecord), ...pipelineRecipes.map(pipelineRecord)]
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

function primitiveParameters(value: unknown, allowBoolean: boolean) {
  const source = objectValue(value)
  if (!source) return undefined
  const entries = Object.entries(source)
  if (entries.some(([key, item]) => !key || key.length > 80
    || !(['string', 'number'].includes(typeof item) || (allowBoolean && typeof item === 'boolean')))) return undefined
  return Object.fromEntries(entries) as Record<string, string | number | boolean>
}

function pipelineSteps(value: unknown) {
  if (!Array.isArray(value) || !value.length || value.length > 12) return undefined
  const result: ToolPipelineStep[] = []
  for (const item of value) {
    const step = objectValue(item)
    const parameters = step ? primitiveParameters(step.parameters, true) : undefined
    if (!step || typeof step.id !== 'string' || typeof step.toolId !== 'string'
      || (step.parameters !== undefined && !parameters)
      || (step.onError !== undefined && !['stop', 'skip', 'retry'].includes(String(step.onError)))
      || (step.when !== undefined && !['always', 'non-empty', 'empty', 'changed'].includes(String(step.when)))) return undefined
    result.push({
      id: step.id,
      toolId: step.toolId,
      ...(parameters ? { parameters } : {}),
      ...(step.onError ? { onError: step.onError as ToolPipelineStep['onError'] } : {}),
      ...(step.when ? { when: step.when as ToolPipelineStep['when'] } : {}),
    })
  }
  return result
}

export function recipesFromAutomationRecords(records: readonly AutomationRecipeRecord[]) {
  const recipes: ToolRecipe[] = []
  const pipelineRecipes: ToolPipelineRecipe[] = []
  for (const record of records) {
    const definition = objectValue(record.definition)
    if (!definition || !record.id || !record.title || !record.createdAt || !record.updatedAt) continue
    if (record.kind === 'tool') {
      const parameters = primitiveParameters(definition.parameters, false)
      if (!parameters || !['pdf', 'image', 'text', 'organize'].includes(String(definition.group))
        || typeof definition.operation !== 'string') continue
      recipes.push({
        id: record.id,
        title: record.title,
        group: definition.group as ToolRecipe['group'],
        operation: definition.operation,
        parameters: parameters as ToolRecipe['parameters'],
        createdAt: record.createdAt,
        ...(record.lastRunAt ? { lastRunAt: record.lastRunAt } : {}),
      })
      continue
    }
    const expectedScope = record.kind === 'artifact-pipeline' ? 'artifact' : record.kind === 'text-pipeline' ? 'text' : undefined
    const steps = pipelineSteps(definition.steps)
    if (!expectedScope || definition.version !== 1 || definition.scope !== expectedScope || !steps) continue
    pipelineRecipes.push({
      id: record.id,
      title: record.title,
      version: 1,
      scope: expectedScope,
      steps,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      ...(record.lastRunAt ? { lastRunAt: record.lastRunAt } : {}),
    })
  }
  return { recipes, pipelineRecipes }
}

export async function hydrateAutomationRecipes(recipes: ToolRecipe[], pipelineRecipes: ToolPipelineRecipe[]) {
  if (!isDesktop()) return undefined
  const hydration = await invoke<AutomationRecipeHydration>('hydrate_default_automation_recipes', {
    browserRecipes: automationRecordsFromRecipes(recipes, pipelineRecipes),
  })
  return { ...hydration, ...recipesFromAutomationRecords(hydration.recipes) }
}

export async function replaceAutomationRecipes(recipes: ToolRecipe[], pipelineRecipes: ToolPipelineRecipe[]) {
  if (!isDesktop()) return { recipes, pipelineRecipes }
  const records = await invoke<AutomationRecipeRecord[]>('replace_default_automation_recipes', {
    recipes: automationRecordsFromRecipes(recipes, pipelineRecipes),
  })
  return recipesFromAutomationRecords(records)
}

async function saveRecord(record: AutomationRecipeRecord, desktopAutomationActive: boolean) {
  if (!desktopAutomationActive) return record
  return invoke<AutomationRecipeRecord>('save_default_automation_recipe', { recipe: record })
}

export async function saveToolRecipe(state: AutomationRecipeState, input: ToolRecipeInput) {
  const existing = input.id ? state.recipes.find(recipe => recipe.id === input.id) : undefined
  const recipe: ToolRecipe = {
    title: input.title.trim().slice(0, 120),
    group: input.group,
    operation: input.operation,
    parameters: { ...input.parameters },
    id: existing?.id ?? input.id ?? newId(),
    createdAt: existing?.createdAt ?? timestamp(),
    ...(existing?.lastRunAt ? { lastRunAt: existing.lastRunAt } : {}),
  }
  const decoded = recipesFromAutomationRecords([await saveRecord(toolRecord(recipe), state.desktopVaultActive)]).recipes[0]
  if (!decoded) throw new Error('配方定义无效，未写入本地资料库。')
  state.recipes = [decoded, ...state.recipes.filter(item => item.id !== decoded.id)]
  state.persist()
  return decoded
}

export async function savePipelineRecipe(state: AutomationRecipeState, input: PipelineRecipeInput) {
  const now = timestamp()
  const existing = input.id ? state.pipelineRecipes.find(recipe => recipe.id === input.id) : undefined
  const recipe: ToolPipelineRecipe = {
    id: existing?.id ?? input.id ?? newId(),
    title: input.title.trim().slice(0, 120),
    version: 1,
    scope: input.scope === 'artifact' ? 'artifact' : 'text',
    steps: cloneSteps(input.steps),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    ...(existing?.lastRunAt ? { lastRunAt: existing.lastRunAt } : {}),
  }
  const decoded = recipesFromAutomationRecords([await saveRecord(pipelineRecord(recipe), state.desktopVaultActive)]).pipelineRecipes[0]
  if (!decoded) throw new Error('流水线定义无效，未写入本地资料库。')
  state.pipelineRecipes = [decoded, ...state.pipelineRecipes.filter(item => item.id !== decoded.id)]
  state.persist()
  return decoded
}

export async function removeAutomationRecipe(state: AutomationRecipeState, id: string) {
  if (state.desktopVaultActive) await invoke('delete_default_automation_recipe', { id })
  state.recipes = state.recipes.filter(recipe => recipe.id !== id)
  state.pipelineRecipes = state.pipelineRecipes.filter(recipe => recipe.id !== id)
  state.persist()
}

async function touchRecipeRecord(state: AutomationRecipeState, record: AutomationRecipeRecord) {
  try {
    const saved = await saveRecord(record, state.desktopVaultActive)
    const decoded = recipesFromAutomationRecords([saved])
    if (decoded.recipes[0]) state.recipes = [decoded.recipes[0], ...state.recipes.filter(item => item.id !== saved.id)]
    if (decoded.pipelineRecipes[0]) state.pipelineRecipes = [decoded.pipelineRecipes[0], ...state.pipelineRecipes.filter(item => item.id !== saved.id)]
    state.persist()
  } catch {
    // Completing the user's file task must not be turned into a failure merely
    // because optional recent-run metadata could not be updated.
  }
}

export function touchToolRecipe(state: AutomationRecipeState, id: string) {
  const recipe = state.recipes.find(item => item.id === id)
  if (!recipe) return Promise.resolve()
  const lastRunAt = timestamp()
  return touchRecipeRecord(state, toolRecord({ ...recipe, lastRunAt }))
}

export function touchPipelineRecipe(state: AutomationRecipeState, id: string) {
  const recipe = state.pipelineRecipes.find(item => item.id === id)
  if (!recipe) return Promise.resolve()
  const lastRunAt = timestamp()
  return touchRecipeRecord(state, pipelineRecord({ ...recipe, lastRunAt, updatedAt: lastRunAt }))
}

export async function renameAutomationRecipe(state: AutomationRecipeState, id: string, title: string) {
  const tool = state.recipes.find(recipe => recipe.id === id)
  if (tool) return saveToolRecipe(state, { ...tool, id, title })
  const pipeline = state.pipelineRecipes.find(recipe => recipe.id === id)
  if (pipeline) return savePipelineRecipe(state, { ...pipeline, id, title })
  throw new Error('没有找到要重命名的自动化配方。')
}

export async function duplicateAutomationRecipe(state: AutomationRecipeState, id: string) {
  const tool = state.recipes.find(recipe => recipe.id === id)
  if (tool) return saveToolRecipe(state, { ...tool, id: undefined, title: `${tool.title} · 副本` })
  const pipeline = state.pipelineRecipes.find(recipe => recipe.id === id)
  if (pipeline) return savePipelineRecipe(state, { ...pipeline, id: undefined, title: `${pipeline.title} · 副本` })
  throw new Error('没有找到要复制的自动化配方。')
}

export function automationRecipePreviewLocation(kind: AutomationRecipeKind, id: string) {
  if (kind === 'text-pipeline') return { path: '/tools', query: { mode: 'pipeline', recipe: id } }
  if (kind === 'artifact-pipeline') return { path: '/tools', query: { mode: 'file-pipeline', recipe: id } }
  return { path: '/tools', query: { recipe: id } }
}
