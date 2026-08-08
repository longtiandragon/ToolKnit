import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import type { ActivityRecord, AiProfile, ClipboardItem, FavoriteTool, FileReference, Job, QuestionType, ReviewRating, Source, SourceAnchor, StudyDocument, ToolRecipe, ToolUsage, WorkbenchSettings } from '@/types'
import { newId } from '@/lib/id'
import { questionTemplate } from '@/lib/question-template'
import { createWorkspaceBackup, defaultWorkbenchSettings, parsePersistedWorkspace, parseWorkspaceBackup, type WorkspaceSnapshot } from '@/lib/workspace-backup'
import { normalizeFavoriteOrder, pruneClipboardHistory } from '@/lib/workbench-utils'

const STORE_KEY = 'toolknit:workspace:v1'
const CLIPBOARD_KEY = 'toolknit:clipboard:v1'
type PersistedWorkspace = WorkspaceSnapshot

function now() { return new Date().toISOString() }

function seedQuestion(): StudyDocument {
  const created = now()
  return {
    id: newId(), title: '二分答案：最小可行值', kind: 'question', questionType: 'algorithm', subject: '算法',
    tags: ['二分', '边界'], difficulty: 3,
    content: `## 题目\n给定答案范围，求满足条件的最小值。\n\n## 我的尝试\n二分循环使用了 \`left < right\`，但更新分支没有保证收缩。\n\n## 错误原因\n- [ ] 概念不清\n- [x] 边界条件\n- [ ] 实现细节\n\n## 正确解法\n保持 \`left\` 为可行区间左边界，\`right\` 为可行区间右边界；当 \`mid\` 可行时令 \`right = mid\`。\n\n## 知识点\n[[二分]] [[循环不变量]]\n\n## 复盘\n写完先用单元素、全不可行和临界可行三组数据走一遍。`,
    createdAt: created, updatedAt: created, reviewEnabled: true,
    review: { due: created, intervalDays: 0, repetitions: 0, lapses: 0 }, errorTypes: ['边界条件']
  }
}

function load(): PersistedWorkspace {
  try {
    const raw = localStorage.getItem(STORE_KEY)
    if (raw) {
      const restored = parsePersistedWorkspace(raw)
      if (restored) return restored
    }
  } catch { /* reset corrupt browser fallback data */ }
  return { sources: [], documents: [seedQuestion()], jobs: [], aiProfiles: [], activeVaultName: '我的 ToolKnitVault', recipes: [], favorites: [], toolUsages: [], activities: [], settings: { ...defaultWorkbenchSettings } }
}

function loadClipboard() {
  try { const value = JSON.parse(localStorage.getItem(CLIPBOARD_KEY) ?? '[]'); return Array.isArray(value) ? value as ClipboardItem[] : [] } catch { return [] }
}

export const useWorkbenchStore = defineStore('workbench', () => {
  const initial = load()
  const sources = ref<Source[]>(initial.sources)
  const documents = ref<StudyDocument[]>(initial.documents)
  const jobs = ref<Job[]>(initial.jobs)
  const aiProfiles = ref<AiProfile[]>(initial.aiProfiles)
  const activeVaultName = ref(initial.activeVaultName)
  const codeDraft = ref(initial.codeDraft)
  const recipes = ref<ToolRecipe[]>(initial.recipes)
  const favorites = ref<FavoriteTool[]>(initial.favorites ?? [])
  const toolUsages = ref<ToolUsage[]>(initial.toolUsages ?? [])
  const activities = ref<ActivityRecord[]>(initial.activities ?? [])
  const settings = ref<WorkbenchSettings>({ ...defaultWorkbenchSettings, ...initial.settings })
  const clipboardItems = ref<ClipboardItem[]>(loadClipboard())
  const engineInstalled = ref({ ocr: false, formula: false })

  function persist() {
    localStorage.setItem(STORE_KEY, JSON.stringify({
      sources: sources.value, documents: documents.value, jobs: jobs.value,
      aiProfiles: aiProfiles.value, activeVaultName: activeVaultName.value, codeDraft: codeDraft.value, recipes: recipes.value,
      favorites: favorites.value, toolUsages: toolUsages.value, activities: activities.value, settings: settings.value
    } satisfies PersistedWorkspace))
    localStorage.setItem(CLIPBOARD_KEY, JSON.stringify(clipboardItems.value))
  }

  function exportBrowserBackup() {
    return createWorkspaceBackup({ sources: sources.value, documents: documents.value, jobs: jobs.value, aiProfiles: aiProfiles.value, activeVaultName: activeVaultName.value, codeDraft: codeDraft.value, recipes: recipes.value, favorites: favorites.value, toolUsages: toolUsages.value, activities: activities.value, settings: settings.value })
  }

  function restoreBrowserBackup(serialized: string) {
    const backup = parseWorkspaceBackup(serialized)
    sources.value = backup.sources; documents.value = backup.documents; jobs.value = backup.jobs; aiProfiles.value = backup.aiProfiles; recipes.value = backup.recipes; favorites.value = backup.favorites ?? []; toolUsages.value = backup.toolUsages ?? []; activities.value = backup.activities ?? []; settings.value = { ...defaultWorkbenchSettings, ...backup.settings }; activeVaultName.value = backup.activeVaultName; codeDraft.value = backup.codeDraft; persist()
    return { sources: backup.sources.length, documents: backup.documents.length, recipes: backup.recipes.length }
  }

  const dueDocuments = computed(() => documents.value.filter((document) => document.reviewEnabled && document.review && new Date(document.review.due) <= new Date()))
  const questionCount = computed(() => documents.value.filter((document) => document.kind === 'question').length)
  const weakTags = computed(() => {
    const scores = new Map<string, number>()
    for (const doc of documents.value.filter((item) => item.kind === 'question')) {
      const penalty = (doc.review?.lapses ?? 0) * 2 + (doc.errorTypes.length || 1) + Math.max(0, 4 - doc.difficulty)
      for (const tag of doc.tags) scores.set(tag, (scores.get(tag) ?? 0) + penalty)
    }
    return [...scores.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([tag, score]) => ({ tag, score }))
  })

  async function hash(content: string) {
    const bytes = new TextEncoder().encode(content)
    const result = await crypto.subtle.digest('SHA-256', bytes)
    return [...new Uint8Array(result)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
  }

  async function addSource(input: Omit<Source, 'id' | 'importedAt' | 'sha256' | 'tags'> & { tags?: string[] }) {
    const fingerprint = await hash(`${input.name}:${input.size}:${input.content ?? input.preview ?? ''}`)
    const duplicate = sources.value.find((source) => source.sha256 === fingerprint)
    if (duplicate) return { source: duplicate, duplicate: true }
    const source: Source = { ...input, id: newId(), importedAt: now(), sha256: fingerprint, tags: input.tags ?? [] }
    sources.value.unshift(source)
    persist()
    return { source, duplicate: false }
  }

  function touchSource(id: string) {
    const source = sources.value.find((item) => item.id === id)
    if (!source) return
    source.lastOpenedAt = now()
    addActivity('source', `打开资料：${source.name}`, undefined, '/library', id)
  }

  function createQuestion(source?: Source, anchor?: SourceAnchor) {
    const created = now()
    const document: StudyDocument = {
      id: newId(), title: source ? `来自 ${source.name} 的错题` : '未命名错题', kind: 'question', questionType: source?.kind === 'code' ? 'algorithm' : 'general',
      subject: source?.kind === 'code' ? '算法' : '未分类', tags: source?.tags ?? [], difficulty: 3,
      content: questionTemplate(source ? `来自 ${source.name} 的错题` : '未命名错题'), sourceAnchor: anchor,
      createdAt: created, updatedAt: created, reviewEnabled: true,
      review: { due: created, intervalDays: 0, repetitions: 0, lapses: 0 }, errorTypes: []
    }
    documents.value.unshift(document)
    persist()
    return document
  }

  function attachCrop(sourceId: string, dataUrl?: string) {
    if (!dataUrl) return undefined
    const source = sources.value.find((item) => item.id === sourceId)
    if (!source) return undefined
    const id = newId(); source.crops = { ...(source.crops ?? {}), [id]: dataUrl }; persist(); return id
  }

  function createNote(title = '未命名笔记') {
    const created = now()
    const document: StudyDocument = { id: newId(), title, kind: 'note', subject: '未分类', tags: [], difficulty: 0, content: `# ${title}\n`, createdAt: created, updatedAt: created, reviewEnabled: false, errorTypes: [] }
    documents.value.unshift(document)
    persist()
    return document
  }

  function saveDocument(next: StudyDocument) {
    const index = documents.value.findIndex((document) => document.id === next.id)
    if (index === -1) return
    documents.value[index] = { ...next, updatedAt: now() }
    persist()
  }

  function deleteDocument(id: string) {
    documents.value = documents.value.filter((document) => document.id !== id)
    persist()
  }

  async function gradeDocument(id: string, rating: ReviewRating) {
    const doc = documents.value.find((item) => item.id === id)
    if (!doc?.review) return
    const { createEmptyCard, fsrs, Rating } = await import('ts-fsrs')
    const scheduler: any = fsrs()
    const card: any = createEmptyCard(new Date(doc.createdAt))
    card.due = new Date(doc.review.due).getTime()
    card.reps = doc.review.repetitions
    card.lapses = doc.review.lapses
    card.last_review = doc.review.lastReviewedAt ? new Date(doc.review.lastReviewedAt) : undefined
    const map: Record<ReviewRating, any> = { Again: Rating.Again, Hard: Rating.Hard, Good: Rating.Good, Easy: Rating.Easy }
    const result: any = scheduler.next(card, new Date(), map[rating])
    const due = result.card.due instanceof Date ? result.card.due.toISOString() : new Date(result.card.due).toISOString()
    doc.review = {
      due,
      intervalDays: Number(result.card.scheduled_days ?? result.card.elapsed_days ?? 0),
      repetitions: Number(result.card.reps ?? doc.review.repetitions + 1),
      lapses: Number(result.card.lapses ?? doc.review.lapses + (rating === 'Again' ? 1 : 0)),
      lastReviewedAt: now()
    }
    doc.updatedAt = now()
    persist()
  }

  function addJob(kind: Job['kind'], label: string, inputNames: string[] = [], meta: Partial<Job> = {}) {
    const job: Job = { id: newId(), kind, label, inputNames, status: 'queued', progress: 0, createdAt: now(), retryable: false, ...meta }
    jobs.value.unshift(job); addActivity('job', `创建任务：${label}`, inputNames.join('、'), meta.route, job.id); return job
  }

  function updateJob(id: string, patch: Partial<Job>) {
    const job = jobs.value.find((item) => item.id === id)
    if (job) Object.assign(job, patch)
    if (job && patch.status === 'running' && !job.startedAt) job.startedAt = now()
    if (job && (patch.status === 'succeeded' || patch.status === 'failed' || patch.status === 'cancelled')) {
      job.completedAt = now()
      addActivity(patch.status === 'succeeded' ? 'output' : 'job', `${patch.status === 'succeeded' ? '完成' : '失败'}：${job.label}`, patch.detail, job.route, job.id)
    } else persist()
  }

  function removeJob(id: string) { jobs.value = jobs.value.filter((item) => item.id !== id); persist() }

  function addActivity(kind: ActivityRecord['kind'], title: string, detail?: string, route?: string, relatedId?: string) {
    activities.value.unshift({ id: newId(), kind, title, detail, route, relatedId, createdAt: now() })
    activities.value = activities.value.slice(0, 300)
    persist()
  }

  function recordToolUsage(toolId: string, route: string) {
    toolUsages.value = [{ toolId, route, usedAt: now() }, ...toolUsages.value.filter((item) => item.toolId !== toolId)].slice(0, 40)
    addActivity('tool', '打开工具', toolId, route, toolId)
  }

  function toggleFavorite(toolId: string) {
    const existing = favorites.value.find((item) => item.toolId === toolId)
    if (existing) favorites.value = favorites.value.filter((item) => item.toolId !== toolId)
    else favorites.value.push({ toolId, order: favorites.value.length, shortcut: favorites.value.length < 9 ? favorites.value.length + 1 : undefined })
    favorites.value = normalizeFavoriteOrder(favorites.value.map((item) => item.toolId))
    addActivity('system', existing ? '取消收藏工具' : '收藏工具', toolId)
  }

  function reorderFavorites(toolIds: string[]) {
    favorites.value = normalizeFavoriteOrder(toolIds)
    persist()
  }

  function updateSettings(patch: Partial<WorkbenchSettings>) { settings.value = { ...settings.value, ...patch }; persist() }

  function pruneClipboard() {
    clipboardItems.value = pruneClipboardHistory(clipboardItems.value, settings.value.clipboardLimit, settings.value.clipboardRetentionDays)
  }

  async function addClipboardItem(input: Omit<ClipboardItem, 'id' | 'capturedAt' | 'hash'> & { hash?: string }) {
    const fingerprint = input.hash ?? await hash(input.content ?? input.assetPath ?? input.preview ?? '')
    const existing = clipboardItems.value.find((item) => item.hash === fingerprint)
    if (existing) {
      existing.capturedAt = now(); clipboardItems.value = [existing, ...clipboardItems.value.filter((item) => item.id !== existing.id)]
    } else clipboardItems.value.unshift({ ...input, id: newId(), hash: fingerprint, capturedAt: now() })
    pruneClipboard(); addActivity('clipboard', '保存剪贴板内容', input.kind); return existing ?? clipboardItems.value[0]
  }

  function removeClipboardItem(id: string) { clipboardItems.value = clipboardItems.value.filter((item) => item.id !== id); persist() }
  function clearClipboard() { clipboardItems.value = clipboardItems.value.filter((item) => item.pinned); addActivity('clipboard', '清空剪贴板历史', '已保留固定项目') }
  function toggleClipboardPin(id: string) { const item = clipboardItems.value.find((entry) => entry.id === id); if (item) item.pinned = !item.pinned; pruneClipboard(); persist() }

  function saveRecipe(input: Omit<ToolRecipe, 'id' | 'createdAt' | 'lastRunAt'>) {
    const recipe: ToolRecipe = { ...input, id: newId(), createdAt: now() }
    recipes.value.unshift(recipe)
    persist()
    return recipe
  }

  function removeRecipe(id: string) {
    recipes.value = recipes.value.filter((recipe) => recipe.id !== id)
    persist()
  }

  function touchRecipe(id: string) {
    const recipe = recipes.value.find((item) => item.id === id)
    if (!recipe) return
    recipe.lastRunAt = now()
    persist()
  }

  function saveAiProfile(profile: AiProfile) {
    const index = aiProfiles.value.findIndex((item) => item.id === profile.id)
    if (index < 0) aiProfiles.value.push(profile); else aiProfiles.value[index] = profile
    persist()
  }

  function removeAiProfile(id: string) {
    aiProfiles.value = aiProfiles.value.filter((profile) => profile.id !== id)
    persist()
  }

  function setEngine(engine: 'ocr' | 'formula', installed: boolean) { engineInstalled.value[engine] = installed }

  function prepareCodeImage(source: Source) {
    const content = source.content?.trim()
    if (!content) throw new Error('这份资料没有可导出的文本内容。')
    codeDraft.value = { content, name: source.name }
    persist()
  }

  return {
    sources, documents, jobs, aiProfiles, activeVaultName, codeDraft, recipes, favorites, toolUsages, activities, settings, clipboardItems, engineInstalled, dueDocuments, questionCount, weakTags,
    addSource, touchSource, createQuestion, createNote, saveDocument, deleteDocument, gradeDocument, attachCrop, addJob, updateJob, removeJob, addActivity, recordToolUsage, toggleFavorite, reorderFavorites, updateSettings, addClipboardItem, removeClipboardItem, clearClipboard, toggleClipboardPin, pruneClipboard, saveRecipe, removeRecipe, touchRecipe, saveAiProfile, removeAiProfile, setEngine, prepareCodeImage, persist, exportBrowserBackup, restoreBrowserBackup
  }
})
