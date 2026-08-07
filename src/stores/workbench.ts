import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { createEmptyCard, fsrs, Rating } from 'ts-fsrs'
import { v7 as uuid } from 'uuid'
import type { AiProfile, Job, QuestionType, ReviewRating, Source, SourceAnchor, StudyDocument } from '@/types'
import { questionTemplate } from '@/lib/markdown'

const STORE_KEY = 'toolknit:workspace:v1'
const scheduler: any = fsrs()

interface PersistedWorkspace {
  sources: Source[]
  documents: StudyDocument[]
  jobs: Job[]
  aiProfiles: AiProfile[]
  activeVaultName: string
}

function now() { return new Date().toISOString() }

function seedQuestion(): StudyDocument {
  const created = now()
  return {
    id: uuid(), title: '二分答案：最小可行值', kind: 'question', questionType: 'algorithm', subject: '算法',
    tags: ['二分', '边界'], difficulty: 3,
    content: `## 题目\n给定答案范围，求满足条件的最小值。\n\n## 我的尝试\n二分循环使用了 \`left < right\`，但更新分支没有保证收缩。\n\n## 错误原因\n- [ ] 概念不清\n- [x] 边界条件\n- [ ] 实现细节\n\n## 正确解法\n保持 \`left\` 为可行区间左边界，\`right\` 为可行区间右边界；当 \`mid\` 可行时令 \`right = mid\`。\n\n## 知识点\n[[二分]] [[循环不变量]]\n\n## 复盘\n写完先用单元素、全不可行和临界可行三组数据走一遍。`,
    createdAt: created, updatedAt: created, reviewEnabled: true,
    review: { due: created, intervalDays: 0, repetitions: 0, lapses: 0 }, errorTypes: ['边界条件']
  }
}

function load(): PersistedWorkspace {
  try {
    const raw = localStorage.getItem(STORE_KEY)
    if (raw) return JSON.parse(raw)
  } catch { /* reset corrupt browser fallback data */ }
  return { sources: [], documents: [seedQuestion()], jobs: [], aiProfiles: [], activeVaultName: '我的 ToolKnitVault' }
}

export const useWorkbenchStore = defineStore('workbench', () => {
  const initial = load()
  const sources = ref<Source[]>(initial.sources)
  const documents = ref<StudyDocument[]>(initial.documents)
  const jobs = ref<Job[]>(initial.jobs)
  const aiProfiles = ref<AiProfile[]>(initial.aiProfiles)
  const activeVaultName = ref(initial.activeVaultName)
  const engineInstalled = ref({ ocr: false, formula: false })

  function persist() {
    localStorage.setItem(STORE_KEY, JSON.stringify({
      sources: sources.value, documents: documents.value, jobs: jobs.value,
      aiProfiles: aiProfiles.value, activeVaultName: activeVaultName.value
    } satisfies PersistedWorkspace))
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
    const source: Source = { ...input, id: uuid(), importedAt: now(), sha256: fingerprint, tags: input.tags ?? [] }
    sources.value.unshift(source)
    persist()
    return { source, duplicate: false }
  }

  function createQuestion(source?: Source, anchor?: SourceAnchor) {
    const created = now()
    const document: StudyDocument = {
      id: uuid(), title: source ? `来自 ${source.name} 的错题` : '未命名错题', kind: 'question', questionType: source?.kind === 'code' ? 'algorithm' : 'general',
      subject: source?.kind === 'code' ? '算法' : '未分类', tags: source?.tags ?? [], difficulty: 3,
      content: questionTemplate(source ? `来自 ${source.name} 的错题` : '未命名错题'), sourceAnchor: anchor,
      createdAt: created, updatedAt: created, reviewEnabled: true,
      review: { due: created, intervalDays: 0, repetitions: 0, lapses: 0 }, errorTypes: []
    }
    documents.value.unshift(document)
    persist()
    return document
  }

  function createNote(title = '未命名笔记') {
    const created = now()
    const document: StudyDocument = { id: uuid(), title, kind: 'note', subject: '未分类', tags: [], difficulty: 0, content: `# ${title}\n`, createdAt: created, updatedAt: created, reviewEnabled: false, errorTypes: [] }
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

  function gradeDocument(id: string, rating: ReviewRating) {
    const doc = documents.value.find((item) => item.id === id)
    if (!doc?.review) return
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

  function addJob(kind: Job['kind'], label: string) {
    const job: Job = { id: uuid(), kind, label, status: 'queued', progress: 0, createdAt: now() }
    jobs.value.unshift(job); persist(); return job
  }

  function updateJob(id: string, patch: Partial<Job>) {
    const job = jobs.value.find((item) => item.id === id)
    if (job) Object.assign(job, patch)
    persist()
  }

  function saveAiProfile(profile: AiProfile) {
    const index = aiProfiles.value.findIndex((item) => item.id === profile.id)
    if (index < 0) aiProfiles.value.push(profile); else aiProfiles.value[index] = profile
    persist()
  }

  function setEngine(engine: 'ocr' | 'formula', installed: boolean) { engineInstalled.value[engine] = installed }

  return {
    sources, documents, jobs, aiProfiles, activeVaultName, engineInstalled, dueDocuments, questionCount, weakTags,
    addSource, createQuestion, createNote, saveDocument, deleteDocument, gradeDocument, addJob, updateJob, saveAiProfile, setEngine, persist
  }
})
