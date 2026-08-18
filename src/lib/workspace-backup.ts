import type { ActivityRecord, AiProfile, ContentFavorite, ContentRecent, EntityRelation, FavoriteTool, Job, Source, StudyDocument, ToolboxBoardLayout, ToolPipelineRecipe, ToolRecipe, ToolUsage, VocabularyEntry, WorkbenchSettings } from '@/types'
import { cloneStudyDocument } from '@/lib/study-document'
import { cloneVocabularyEntry } from '@/lib/vocabulary'

export interface WorkspaceSnapshot {
  sources: Source[]
  documents: StudyDocument[]
  vocabulary?: VocabularyEntry[]
  relations?: EntityRelation[]
  jobs: Job[]
  aiProfiles: AiProfile[]
  activeVaultName: string
  codeDraft?: { content: string; name: string }
  recipes: ToolRecipe[]
  pipelineRecipes?: ToolPipelineRecipe[]
  favorites?: FavoriteTool[]
  contentFavorites?: ContentFavorite[]
  contentRecents?: ContentRecent[]
  toolUsages?: ToolUsage[]
  activities?: ActivityRecord[]
  settings?: WorkbenchSettings
}

export interface WorkspaceBackup extends WorkspaceSnapshot {
  format: 'toolknit-browser-backup'
  schemaVersion: 7
  exportedAt: string
}

const MAX_BACKUP_CHARACTERS = 25_000_000
const LEGACY_DEFAULT_VAULT_NAMES = new Set(['ToolKnitVault', 'ToolKnit Vault', '我的 ToolKnitVault', '我的 ToolKnit Vault'])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasStrings(value: Record<string, unknown>, keys: string[]) {
  return keys.every((key) => typeof value[key] === 'string')
}

function validArray(value: unknown, validator: (item: Record<string, unknown>) => boolean) {
  return Array.isArray(value) && value.every((item) => isRecord(item) && validator(item))
}

function validSource(value: Record<string, unknown>) {
  return hasStrings(value, ['id', 'name', 'kind', 'mime', 'importedAt']) && ['image', 'pdf', 'code', 'text'].includes(String(value.kind)) && typeof value.size === 'number' && (value.tags === undefined || Array.isArray(value.tags))
}

function validDocument(value: Record<string, unknown>) {
  return hasStrings(value, ['id', 'title', 'kind', 'subject', 'content', 'createdAt', 'updatedAt'])
    && ['question', 'note'].includes(String(value.kind))
    && (value.tags === undefined || Array.isArray(value.tags))
    && (value.errorTypes === undefined || Array.isArray(value.errorTypes))
    && (value.reviewEnabled === undefined || typeof value.reviewEnabled === 'boolean')
    && (value.questionDetails === undefined || isRecord(value.questionDetails) && hasStrings(value.questionDetails, ['stem', 'answer', 'explanation', 'wrongAnswer', 'errorReason']))
}

function validVocabulary(value: Record<string, unknown>) {
  return hasStrings(value, ['id', 'lemma', 'language', 'createdAt', 'updatedAt'])
    && isRecord(value.forms)
    && Array.isArray(value.senses)
    && value.senses.every((sense) => isRecord(sense) && hasStrings(sense, ['id', 'partOfSpeech', 'definition']) && Array.isArray(sense.examples) && (sense.collocations === undefined || Array.isArray(sense.collocations)) && Array.isArray(sense.synonyms))
}

function validRelation(value: Record<string, unknown>) {
  return hasStrings(value, ['fromId', 'toId', 'relationType', 'createdAt'])
    && ['related', 'prerequisite', 'variation'].includes(String(value.relationType))
    && value.fromId !== value.toId
}

function validJob(value: Record<string, unknown>) {
  return hasStrings(value, ['id', 'kind', 'label', 'status', 'createdAt']) && typeof value.progress === 'number'
}

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function normalizeSource(value: Source): Source {
  const crops = isRecord(value.crops) ? Object.fromEntries(Object.entries(value.crops).filter((entry): entry is [string, string] => typeof entry[1] === 'string')) : undefined
  return {
    ...value,
    size: Number.isFinite(value.size) ? Math.max(0, value.size) : 0,
    tags: stringArray(value.tags),
    lastOpenedAt: typeof value.lastOpenedAt === 'string' ? value.lastOpenedAt : undefined,
    originalPath: typeof value.originalPath === 'string' ? value.originalPath : undefined,
    managedPath: typeof value.managedPath === 'string' ? value.managedPath : undefined,
    preview: typeof value.preview === 'string' ? value.preview : undefined,
    content: typeof value.content === 'string' ? value.content : undefined,
    pageCount: typeof value.pageCount === 'number' && Number.isFinite(value.pageCount) ? Math.max(1, Math.round(value.pageCount)) : undefined,
    ...(crops ? { crops } : { crops: undefined })
  }
}

function normalizeFavorites(value: unknown): FavoriteTool[] {
  if (!Array.isArray(value)) return []
  const ids = value
    .filter((item) => isRecord(item) && typeof item.toolId === 'string' && typeof item.order === 'number')
    .sort((left, right) => Number((left as Record<string, unknown>).order) - Number((right as Record<string, unknown>).order))
    .map((item) => (item as Record<string, unknown>).toolId as string)
  return [...new Set(ids)].map((toolId, order) => ({ toolId, order, shortcut: order < 9 ? order + 1 : undefined }))
}

function normalizeContentFavorites(value: unknown): ContentFavorite[] {
  if (!Array.isArray(value)) return []
  const validKinds = new Set(['note', 'question', 'word', 'source', 'diagram'])
  const seen = new Set<string>()
  return value.flatMap((item) => {
    if (!isRecord(item) || typeof item.itemId !== 'string' || !validKinds.has(String(item.itemKind)) || typeof item.addedAt !== 'string') return []
    const key = `${item.itemKind}:${item.itemId}`
    if (seen.has(key)) return []
    seen.add(key)
    return [{ itemId: item.itemId, itemKind: item.itemKind as ContentFavorite['itemKind'], addedAt: item.addedAt }]
  }).sort((left, right) => right.addedAt.localeCompare(left.addedAt)).slice(0, 256)
}

function normalizeContentRecents(value: unknown): ContentRecent[] {
  if (!Array.isArray(value)) return []
  const validKinds = new Set(['note', 'question', 'word', 'source', 'diagram'])
  const seen = new Set<string>()
  return value.flatMap((item) => {
    if (!isRecord(item) || typeof item.itemId !== 'string' || !validKinds.has(String(item.itemKind)) || typeof item.openedAt !== 'string') return []
    const key = `${item.itemKind}:${item.itemId}`
    if (seen.has(key)) return []
    seen.add(key)
    return [{ itemId: item.itemId, itemKind: item.itemKind as ContentRecent['itemKind'], openedAt: item.openedAt }]
  }).sort((left, right) => right.openedAt.localeCompare(left.openedAt)).slice(0, 128)
}

function normalizeFileReferences(value: unknown) {
  if (!Array.isArray(value)) return undefined
  return value.flatMap((entry) => isRecord(entry) && typeof entry.name === 'string' ? [{ name: entry.name, ...(typeof entry.path === 'string' ? { path: entry.path } : {}), ...(typeof entry.size === 'number' && Number.isFinite(entry.size) ? { size: Math.max(0, entry.size) } : {}), ...(typeof entry.mime === 'string' ? { mime: entry.mime } : {}) }] : [])
}

function normalizeJob(value: Job): Job {
  const parameters = isRecord(value.parameters) ? Object.fromEntries(Object.entries(value.parameters).filter(([, item]) => typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean' || Array.isArray(item) && item.every((part) => typeof part === 'string'))) as Job['parameters'] : undefined
  return {
    ...value,
    progress: Number.isFinite(value.progress) ? Math.min(100, Math.max(0, value.progress)) : 0,
    inputNames: stringArray(value.inputNames),
    outputNames: stringArray(value.outputNames),
    inputs: normalizeFileReferences(value.inputs),
    outputs: normalizeFileReferences(value.outputs),
    parameters
  }
}

function validProfile(value: Record<string, unknown>) {
  return hasStrings(value, ['id', 'label', 'baseUrl', 'model']) && typeof value.hasKey === 'boolean'
}

function validRecipe(value: Record<string, unknown>) {
  return hasStrings(value, ['id', 'title', 'group', 'operation', 'createdAt']) && isRecord(value.parameters)
}

function validPipeline(value: Record<string, unknown>) {
  if (!hasStrings(value, ['id', 'title', 'createdAt', 'updatedAt']) || value.version !== 1 || !Array.isArray(value.steps)) return false
  // Policy values are checked by the pipeline runner before execution. Keeping
  // this backup validator focused on the serializable recipe shape preserves
  // forward compatibility when a newer runner adds another policy.
  return value.steps.length > 0 && value.steps.length <= 12 && value.steps.every((step) => isRecord(step) && hasStrings(step, ['id', 'toolId']) && (step.parameters === undefined || isRecord(step.parameters)))
}

export const defaultWorkbenchSettings: WorkbenchSettings = {
  outputDirectory: '', markdownWorkspaceDirectory: '', codeImageAuthor: 'author', codeImageLinesPerPage: 0, codeImageFontSize: 0, codeImageCardWidth: 720, privateToolsManifestPath: '',
  transcriptionExecutablePath: '', transcriptionModelPath: '', transcriptionLanguage: 'auto', clipboardEnabled: false, clipboardPaused: false,
  clipboardLimit: 100, clipboardRetentionDays: 30, closeBehavior: 'ask',
  notificationsEnabled: true, autoCheckUpdates: true, documentAutoSave: true,
  readingScale: 'comfortable', readingDensity: 'comfortable', readingWidth: 'balanced', readingPaperTone: 'warm', reduceMotion: false
}

/* Shape-only. Whether a key still names a real workbench is decided when the
   board is built (`toolbox-board.ts`), which is the only place that knows the
   catalogue — and which lives in the toolbox route chunk rather than here, in
   the startup bundle. This just refuses anything that is not strings. */
function stringList(value: unknown, limit: number) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string').slice(0, limit) : []
}

function normalizeToolboxBoard(value: unknown): ToolboxBoardLayout | undefined {
  if (!isRecord(value)) return undefined
  const toolOrder: Record<string, string[]> = {}
  if (isRecord(value.toolOrder)) {
    for (const [key, ids] of Object.entries(value.toolOrder).slice(0, 40)) {
      const list = stringList(ids, 120)
      if (list.length) toolOrder[key] = list
    }
  }
  const board: ToolboxBoardLayout = {
    blockOrder: stringList(value.blockOrder, 40),
    hiddenBlocks: stringList(value.hiddenBlocks, 40),
    expandedBlocks: stringList(value.expandedBlocks, 40),
    toolOrder,
  }
  const empty = !board.blockOrder.length && !board.hiddenBlocks.length && !board.expandedBlocks.length && !Object.keys(toolOrder).length
  return empty ? undefined : board
}

function normalizeSettings(value: unknown): WorkbenchSettings {
  const input = isRecord(value) ? value : {}
  const numberWithin = (key: string, fallback: number, minimum: number, maximum: number) => {
    const candidate = input[key]
    return typeof candidate === 'number' && Number.isFinite(candidate)
      ? Math.min(maximum, Math.max(minimum, Math.round(candidate)))
      : fallback
  }
  const closeBehavior = ['ask', 'tray', 'quit'].includes(String(input.closeBehavior))
    ? input.closeBehavior as WorkbenchSettings['closeBehavior']
    : defaultWorkbenchSettings.closeBehavior
  const enumSetting = <Key extends 'readingScale' | 'readingDensity' | 'readingWidth' | 'readingPaperTone'>(key: Key, values: readonly WorkbenchSettings[Key][]) =>
    values.includes(input[key] as WorkbenchSettings[Key]) ? input[key] as WorkbenchSettings[Key] : defaultWorkbenchSettings[key]
  const toolboxBoard = normalizeToolboxBoard(input.toolboxBoard)
  return {
    outputDirectory: typeof input.outputDirectory === 'string' ? input.outputDirectory : defaultWorkbenchSettings.outputDirectory,
    markdownWorkspaceDirectory: typeof input.markdownWorkspaceDirectory === 'string' ? input.markdownWorkspaceDirectory : defaultWorkbenchSettings.markdownWorkspaceDirectory,
    codeImageAuthor: typeof input.codeImageAuthor === 'string' ? input.codeImageAuthor : defaultWorkbenchSettings.codeImageAuthor,
    // 0 means automatic, so this cannot go through `numberWithin`, which would
    // pull a restored 0 up to the smallest manual page height. The bounds are
    // repeated rather than imported: `code-layout` belongs to the code-image
    // route chunk, and this module is in the startup bundle.
    codeImageLinesPerPage: typeof input.codeImageLinesPerPage === 'number' && Number.isFinite(input.codeImageLinesPerPage) && input.codeImageLinesPerPage > 0
      ? Math.min(200, Math.max(5, Math.round(input.codeImageLinesPerPage)))
      : defaultWorkbenchSettings.codeImageLinesPerPage,
    codeImageFontSize: typeof input.codeImageFontSize === 'number' && Number.isFinite(input.codeImageFontSize) && input.codeImageFontSize > 0
      ? Math.min(32, Math.max(10, Math.round(input.codeImageFontSize)))
      : defaultWorkbenchSettings.codeImageFontSize,
    codeImageCardWidth: [720, 900, 1080].includes(input.codeImageCardWidth as number)
      ? input.codeImageCardWidth as number
      : defaultWorkbenchSettings.codeImageCardWidth,
    privateToolsManifestPath: typeof input.privateToolsManifestPath === 'string' ? input.privateToolsManifestPath : defaultWorkbenchSettings.privateToolsManifestPath,
    transcriptionExecutablePath: typeof input.transcriptionExecutablePath === 'string' ? input.transcriptionExecutablePath : defaultWorkbenchSettings.transcriptionExecutablePath,
    transcriptionModelPath: typeof input.transcriptionModelPath === 'string' ? input.transcriptionModelPath : defaultWorkbenchSettings.transcriptionModelPath,
    transcriptionLanguage: ['auto', 'zh', 'en', 'ja', 'ko'].includes(String(input.transcriptionLanguage)) ? input.transcriptionLanguage as WorkbenchSettings['transcriptionLanguage'] : defaultWorkbenchSettings.transcriptionLanguage,
    clipboardEnabled: typeof input.clipboardEnabled === 'boolean' ? input.clipboardEnabled : defaultWorkbenchSettings.clipboardEnabled,
    clipboardPaused: typeof input.clipboardPaused === 'boolean' ? input.clipboardPaused : defaultWorkbenchSettings.clipboardPaused,
    clipboardLimit: numberWithin('clipboardLimit', defaultWorkbenchSettings.clipboardLimit, 10, 1000),
    clipboardRetentionDays: numberWithin('clipboardRetentionDays', defaultWorkbenchSettings.clipboardRetentionDays, 1, 3650),
    closeBehavior,
    notificationsEnabled: typeof input.notificationsEnabled === 'boolean' ? input.notificationsEnabled : defaultWorkbenchSettings.notificationsEnabled,
    autoCheckUpdates: typeof input.autoCheckUpdates === 'boolean' ? input.autoCheckUpdates : defaultWorkbenchSettings.autoCheckUpdates,
    documentAutoSave: typeof input.documentAutoSave === 'boolean' ? input.documentAutoSave : defaultWorkbenchSettings.documentAutoSave,
    readingScale: enumSetting('readingScale', ['compact', 'comfortable', 'large']),
    readingDensity: enumSetting('readingDensity', ['compact', 'comfortable', 'airy']),
    readingWidth: enumSetting('readingWidth', ['focused', 'balanced', 'wide']),
    readingPaperTone: enumSetting('readingPaperTone', ['warm', 'neutral', 'mist', 'night']),
    reduceMotion: typeof input.reduceMotion === 'boolean' ? input.reduceMotion : defaultWorkbenchSettings.reduceMotion,
    ...(toolboxBoard ? { toolboxBoard } : {}),
    ...(typeof input.lastUpdateCheck === 'string' ? { lastUpdateCheck: input.lastUpdateCheck } : {}),
    ...(typeof input.lastBackupAt === 'string' ? { lastBackupAt: input.lastBackupAt } : {}),
    ...(typeof input.lastManualBackupAt === 'string' ? { lastManualBackupAt: input.lastManualBackupAt } : {}),
    ...(typeof input.lastAutomaticBackupAt === 'string' ? { lastAutomaticBackupAt: input.lastAutomaticBackupAt } : {})
  }
}

/** Only migrate former product defaults. A user-created vault name is data,
 * not branding, and must remain exactly as they chose it. */
function normalizeActiveVaultName(value: unknown) {
  const candidate = typeof value === 'string' ? value.trim() : ''
  if (!candidate || LEGACY_DEFAULT_VAULT_NAMES.has(candidate)) return '我的 KnitspaceVault'
  return candidate
}

export function normalizeWorkspace(value: unknown): WorkspaceSnapshot | undefined {
  if (!isRecord(value)) return undefined
  if (!validArray(value.sources, validSource) || !validArray(value.documents, validDocument)) return undefined
  if (value.vocabulary !== undefined && !validArray(value.vocabulary, validVocabulary)) return undefined
  if (value.relations !== undefined && !validArray(value.relations, validRelation)) return undefined
  if (value.jobs !== undefined && !validArray(value.jobs, validJob)) return undefined
  if (value.aiProfiles !== undefined && !validArray(value.aiProfiles, validProfile)) return undefined
  if (value.recipes !== undefined && !validArray(value.recipes, validRecipe)) return undefined
  if (value.pipelineRecipes !== undefined && !validArray(value.pipelineRecipes, validPipeline)) return undefined
  if (value.activeVaultName !== undefined && typeof value.activeVaultName !== 'string') return undefined
  if (value.codeDraft !== undefined && (!isRecord(value.codeDraft) || !hasStrings(value.codeDraft, ['content', 'name']))) return undefined
  return {
    sources: (value.sources as unknown as Source[]).map(normalizeSource),
    documents: (value.documents as unknown as StudyDocument[]).map(cloneStudyDocument),
    vocabulary: ((value.vocabulary ?? []) as unknown as VocabularyEntry[]).map(cloneVocabularyEntry),
    relations: ((value.relations ?? []) as unknown as EntityRelation[]).map((relation) => ({ ...relation })),
    jobs: ((value.jobs ?? []) as unknown as Job[]).map(normalizeJob),
    aiProfiles: (value.aiProfiles ?? []) as unknown as AiProfile[],
    activeVaultName: normalizeActiveVaultName(value.activeVaultName),
    codeDraft: value.codeDraft as WorkspaceSnapshot['codeDraft'],
    recipes: (value.recipes ?? []) as unknown as ToolRecipe[],
    pipelineRecipes: (value.pipelineRecipes ?? []) as unknown as ToolPipelineRecipe[],
    favorites: normalizeFavorites(value.favorites),
    contentFavorites: normalizeContentFavorites(value.contentFavorites),
    contentRecents: normalizeContentRecents(value.contentRecents),
    toolUsages: Array.isArray(value.toolUsages) ? value.toolUsages.filter((item): item is ToolUsage => isRecord(item) && hasStrings(item, ['toolId', 'route', 'usedAt'])) : [],
    activities: Array.isArray(value.activities) ? value.activities.filter((item): item is ActivityRecord => isRecord(item) && hasStrings(item, ['id', 'kind', 'title', 'createdAt'])) : [],
    settings: normalizeSettings(value.settings)
  }
}

export function parsePersistedWorkspace(serialized: string) {
  try {
    return normalizeWorkspace(JSON.parse(serialized))
  } catch {
    return undefined
  }
}

export function createWorkspaceBackup(snapshot: WorkspaceSnapshot, exportedAt = new Date().toISOString()) {
  const backup: WorkspaceBackup = { format: 'toolknit-browser-backup', schemaVersion: 7, exportedAt, ...snapshot, favorites: snapshot.favorites ?? [], contentFavorites: snapshot.contentFavorites ?? [], contentRecents: snapshot.contentRecents ?? [], toolUsages: snapshot.toolUsages ?? [], activities: snapshot.activities ?? [], settings: normalizeSettings(snapshot.settings) }
  return JSON.stringify(backup, null, 2)
}

export function parseWorkspaceBackup(serialized: string) {
  if (serialized.length > MAX_BACKUP_CHARACTERS) throw new Error('备份文件超过 25 MB，浏览器版无法安全恢复。')
  let parsed: unknown
  try { parsed = JSON.parse(serialized) } catch { throw new Error('备份文件不是有效的 JSON。') }
  if (!isRecord(parsed) || parsed.format !== 'toolknit-browser-backup' || ![1, 2, 3, 4, 5, 6, 7].includes(Number(parsed.schemaVersion))) {
    throw new Error('这不是可恢复的 Knitspace 浏览器备份。')
  }
  const snapshot = normalizeWorkspace(parsed)
  if (!snapshot) throw new Error('备份结构不完整或包含无效数据，未修改当前资料库。')
  return snapshot
}
