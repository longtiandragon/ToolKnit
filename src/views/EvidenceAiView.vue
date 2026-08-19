<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import AppIcon from '@/components/AppIcon.vue'
import PageHeader from '@/components/PageHeader.vue'
import ToolLayout from '@/components/ToolLayout.vue'
import { getSessionApiKey, runEvidenceAi } from '@/lib/ai'
import { buildEvidenceAiEnvelope, extractEvidencePdfText, parseEvidenceAiResult, type EvidenceAiEnvelope, type EvidenceAiResult, type EvidenceInputSource } from '@/lib/evidence-ai'
import { isDesktop, readDesktopInputFile } from '@/lib/native'
import { useUiStore } from '@/stores/ui'
import { useWorkbenchStore } from '@/stores/workbench'

type SelectableSource = { id: string; title: string; kind: EvidenceInputSource['kind']; detail: string; recordKind: 'document' | 'source' }

const router = useRouter()
const ui = useUiStore()
const store = useWorkbenchStore()
const query = ref('')
const question = ref('')
const selectedIds = ref(new Set<string>())
const profileId = ref(store.aiProfiles[0]?.id ?? '')
const preparing = ref(false)
const asking = ref(false)
const message = ref('勾选本地笔记、题目、PDF 或文本资料；只有预览中的内容会发送。')
const envelope = ref<EvidenceAiEnvelope>()
const result = ref<EvidenceAiResult>()
let controller: AbortController | undefined

const profile = computed(() => store.aiProfiles.find(item => item.id === profileId.value))
const selectable = computed<SelectableSource[]>(() => [
  ...store.documents.map(document => ({ id: document.id, title: document.title, kind: document.kind, detail: `${document.kind === 'note' ? '笔记' : '题目'} · ${document.subject || '未分类'}`, recordKind: 'document' as const })),
  ...store.sources.filter(source => ['pdf', 'text', 'code'].includes(source.kind)).map(source => ({ id: source.id, title: source.name, kind: source.kind === 'pdf' ? 'pdf' as const : 'text' as const, detail: `${source.kind.toUpperCase()} · ${source.tags.join(' · ') || '资料库'}`, recordKind: 'source' as const })),
])
const filtered = computed(() => {
  const value = query.value.trim().toLocaleLowerCase('zh-CN')
  return (value ? selectable.value.filter(item => `${item.title} ${item.detail}`.toLocaleLowerCase('zh-CN').includes(value)) : selectable.value).slice(0, 300)
})
const selected = computed(() => selectable.value.filter(item => selectedIds.value.has(item.id)))
const sourceTitle = computed(() => new Map(selectable.value.map(item => [item.id, item.title])))

watch([question, selectedIds], () => {
  envelope.value = undefined
  result.value = undefined
}, { deep: true })
watch(() => store.aiProfiles.map(item => item.id), ids => {
  if (!ids.includes(profileId.value)) profileId.value = ids[0] ?? ''
})

function formatBytes(value: number) {
  return value < 1024 ? `${value} B` : value < 1024 * 1024 ? `${(value / 1024).toFixed(1)} KB` : `${(value / 1024 / 1024).toFixed(1)} MB`
}

function textBytes(value: string) {
  return new TextEncoder().encode(value).byteLength
}

function toggle(item: SelectableSource) {
  const next = new Set(selectedIds.value)
  if (next.has(item.id)) next.delete(item.id)
  else {
    if (next.size >= 20) { ui.toast('来源已满', '一次最多选择 20 个本地来源。', 'warning'); return }
    next.add(item.id)
  }
  selectedIds.value = next
}

async function loadEvidence(item: SelectableSource): Promise<EvidenceInputSource> {
  if (item.recordKind === 'document') {
    const document = await store.loadDocument(item.id)
    if (!document?.content.trim()) throw new Error(`“${item.title}”没有可读取正文。`)
    return { sourceId: item.id, title: item.title, kind: item.kind, text: document.content }
  }
  const source = await store.loadSourceDetail(item.id)
  if (!source) throw new Error(`“${item.title}”已不存在。`)
  if (source.content?.trim()) return { sourceId: item.id, title: item.title, kind: item.kind, text: source.content }
  if (source.kind === 'pdf' && source.managedPath && isDesktop()) {
    const file = await readDesktopInputFile(source.managedPath)
    return { sourceId: item.id, title: item.title, kind: 'pdf', text: await extractEvidencePdfText(file.name, await file.arrayBuffer()) }
  }
  throw new Error(`“${item.title}”没有文字层；扫描 PDF 请先在 PDF 工具中运行 OCR。`)
}

async function prepare() {
  if (!question.value.trim() || !selected.value.length || preparing.value) return
  preparing.value = true
  result.value = undefined
  message.value = '正在本地读取你勾选的正文与 PDF 文字层；未选择的资料不会读取。'
  try {
    const sources: EvidenceInputSource[] = []
    for (const [index, item] of selected.value.entries()) {
      message.value = `正在准备本地证据 ${index + 1}/${selected.value.length}：${item.title}`
      sources.push(await loadEvidence(item))
    }
    envelope.value = buildEvidenceAiEnvelope(question.value, sources)
    message.value = `证据载荷已就绪：${envelope.value.chunks.length} 个可定位片段、${formatBytes(envelope.value.byteCount)}。确认后才会发送。`
  } catch (error) {
    message.value = error instanceof Error ? error.message : '无法准备本地证据。'
    ui.toast('证据准备失败', message.value, 'error')
  } finally {
    preparing.value = false
  }
}

async function ask() {
  if (!envelope.value || !profile.value || asking.value) return
  controller = new AbortController()
  const job = store.addJob('ai', '资料库证据型问答', selected.value.map(item => item.title), {
    toolId: 'ai:evidence', route: '/evidence-ai',
    parameters: { sourceCount: selected.value.length, chunkCount: envelope.value.chunks.length, payloadBytes: envelope.value.byteCount },
    inputs: selected.value.map(item => ({ name: item.title })), retryable: true,
  })
  asking.value = true
  store.updateJob(job.id, { status: 'running', progress: 45, detail: '正在依据已预览的本地证据生成带定位回答。' })
  message.value = '正在生成证据型回答；证据不足时模型必须明确说明。'
  try {
    const raw = await runEvidenceAi(profile.value, getSessionApiKey(profile.value.id), envelope.value.messages, controller.signal)
    result.value = parseEvidenceAiResult(raw, envelope.value)
    store.updateJob(job.id, { status: 'succeeded', progress: 100, detail: `回答包含 ${result.value.citations.length} 条本地来源定位。` })
    message.value = `回答完成：${result.value.citations.length} 条来源定位、${result.value.cards.length} 张复习卡草稿、${result.value.terms.length} 个术语草稿。`
  } catch (error) {
    const detail = error instanceof Error ? error.message : '证据型 AI 请求失败。'
    const cancelled = controller.signal.aborted
    store.updateJob(job.id, { status: cancelled ? 'cancelled' : 'failed', progress: 100, errorCode: cancelled ? 'TOOL_CANCELLED' : 'EVIDENCE_AI_INVALID_RESPONSE', detail })
    message.value = detail
    ui.toast(cancelled ? '已停止问答' : '问答失败', detail, cancelled ? 'warning' : 'error')
  } finally {
    asking.value = false
    controller = undefined
  }
}

function citationMarkdown() {
  if (!result.value) return ''
  return result.value.citations.map((citation, index) => `${index + 1}. ${sourceTitle.value.get(citation.sourceId) ?? citation.sourceId} · ${citation.locator} — ${citation.claim}`).join('\n')
}

function resultMarkdown() {
  if (!result.value) return ''
  return `# ${question.value.trim()}\n\n${result.value.answer}\n\n## 本地证据\n\n${citationMarkdown()}\n`
}

function createNote() {
  if (!result.value) return
  const note = store.createNote(`证据问答：${question.value.trim().slice(0, 40)}`, 'AI 证据问答', resultMarkdown())
  ui.toast('已转为笔记', note.title, 'success')
  void router.push({ path: '/documents', query: { id: note.id } })
}

function createQuestion() {
  if (!result.value) return
  const draft = result.value.cards[0]
  const document = store.createQuestion()
  document.title = `证据题：${(draft?.front || question.value).slice(0, 50)}`
  document.subject = '资料复习'
  document.questionDetails = {
    source: citationMarkdown(),
    stem: draft?.front || question.value,
    answer: draft?.back || result.value.answer,
    explanation: result.value.answer,
    wrongAnswer: '',
    errorReason: '',
  }
  document.content = `# ${document.title}\n\n${draft?.front || question.value}\n\n## 答案\n\n${draft?.back || result.value.answer}\n\n## 本地证据\n\n${citationMarkdown()}\n`
  store.saveDocument(document)
  ui.toast('已转为复习题', document.title, 'success')
  void router.push({ path: '/documents', query: { id: document.id } })
}

function createTerm() {
  const term = result.value?.terms[0]
  if (!term) return
  const entry = store.createVocabularyEntry(term.term)
  entry.senses[0].definition = term.definition
  entry.senses[0].examples = [`来源：${sourceTitle.value.get(term.sourceId) ?? term.sourceId} · ${term.locator}`]
  entry.senses[0].reviewEnabled = true
  store.saveVocabularyEntry(entry)
  ui.toast('已转为单词 / 术语', term.term, 'success')
  void router.push('/words')
}

function createReviewCard() {
  if (!result.value) return
  const note = store.createNote(`复习卡：${question.value.trim().slice(0, 40)}`, 'AI 证据问答', resultMarkdown())
  note.reviewEnabled = true
  note.review = { due: new Date().toISOString(), intervalDays: 0, repetitions: 0, lapses: 0 }
  store.saveDocument(note)
  ui.toast('已加入复习', note.title, 'success')
  void router.push('/review')
}

onBeforeUnmount(() => controller?.abort())
</script>

<template>
  <div class="page-enter page-shell px-8 py-6">
    <PageHeader title="资料库证据型 AI" subtitle="只读取你勾选的笔记、题目、PDF 与文本资料；回答必须附可验证的本地页码或行号。">
      <template #lead><button class="btn-ghost btn-sm" @click="router.push('/create')"><AppIcon name="chevron-left" :size="14" />返回创作空间</button></template>
      <template #actions><span class="row gap-1.5 h-9 px-3 rounded-sm bg-surface-2 text-[12px] text-fg-3"><AppIcon name="shield" :size="14" />选中读取 · 发送前预览</span></template>
    </PageHeader>

    <ToolLayout>
      <section class="panel p-4 stack gap-3">
        <label class="stack gap-1"><span class="text-[12px] font-medium">你的问题</span><textarea v-model="question" class="field w-full min-h-24 text-[13px]" maxlength="8192" placeholder="例如：这几份资料对项目风险的结论是否一致？请列出分歧并引用页码。" :disabled="asking" /></label>
        <div class="row-between gap-3 flex-wrap"><p class="text-[11px] text-fg-3" aria-live="polite">{{ message }}</p><button class="btn-primary btn-sm" :disabled="!question.trim() || !selected.length || preparing || asking" @click="prepare"><AppIcon name="search" :size="13" />{{ preparing ? '本地读取中…' : `预览 ${selected.length} 个来源` }}</button></div>
      </section>

      <section class="panel overflow-hidden">
        <header class="row-between gap-2 px-3 py-2.5 border-b border-line"><input v-model="query" class="field max-w-80 text-[11px]" placeholder="筛选本地资料…" /><span class="text-[11px] text-fg-3">已选 {{ selected.length }} / 20</span></header>
        <ul class="grid grid-cols-1 md:grid-cols-2 gap-1 p-2 max-h-72 overflow-y-auto"><li v-for="item in filtered" :key="`${item.recordKind}-${item.id}`" class="row gap-2 p-2 rounded-sm hover:bg-surface-2"><input type="checkbox" class="accent-accent" :checked="selectedIds.has(item.id)" :disabled="asking" @change="toggle(item)" /><span class="min-w-0"><strong class="block text-[11px] truncate">{{ item.title }}</strong><small class="text-[10px] text-fg-3">{{ item.detail }}</small></span></li></ul>
      </section>

      <section v-if="envelope" class="panel overflow-hidden">
        <header class="row-between gap-3 px-4 py-3 border-b border-line flex-wrap"><span class="stack"><strong class="text-[12px]">确切证据载荷</strong><small class="text-[10px] text-fg-3">{{ envelope.chunks.length }} 个定位片段 · {{ formatBytes(envelope.byteCount) }}</small></span><span class="row gap-2"><button class="btn-ghost btn-sm" @click="envelope = undefined">返回选择</button><button v-if="asking" class="btn-default btn-sm" @click="controller?.abort()">停止</button><button v-else class="btn-primary btn-sm" :disabled="!profile" @click="ask"><AppIcon name="sparkle" :size="13" />确认并发送</button></span></header>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-1.5 p-3 max-h-52 overflow-y-auto"><span v-for="chunk in envelope.chunks" :key="`${chunk.sourceId}-${chunk.locator}`" class="p-2 rounded-sm bg-surface-2 text-[10px]"><strong>{{ chunk.title }}</strong><small class="block text-fg-3">{{ chunk.locator }} · {{ formatBytes(textBytes(chunk.text)) }}</small></span></div>
        <details class="border-t border-line"><summary class="px-4 py-2.5 text-[11px] text-fg-3 cursor-pointer">查看实际发送的 messages JSON</summary><pre class="m-0 p-4 max-h-72 overflow-auto bg-surface-2 text-[10px] whitespace-pre-wrap break-all">{{ envelope.serializedMessages }}</pre></details>
      </section>

      <section v-if="result" class="panel overflow-hidden">
        <header class="row-between gap-2 px-4 py-3 border-b border-line"><strong class="text-[13px]">证据型回答</strong><span class="text-[10px] text-fg-3">{{ result.citations.length }} 条定位</span></header>
        <div class="p-4 whitespace-pre-wrap text-[13px] leading-relaxed">{{ result.answer }}</div>
        <ol class="stack gap-1 px-4 pb-4"><li v-for="(citation, index) in result.citations" :key="`${citation.sourceId}-${citation.locator}-${index}`" class="p-2.5 rounded-sm bg-surface-2 text-[11px]"><strong>[{{ index + 1 }}] {{ sourceTitle.get(citation.sourceId) }} · {{ citation.locator }}</strong><span class="block mt-0.5 text-fg-3">{{ citation.claim }}</span></li></ol>
        <footer class="row gap-2 flex-wrap px-4 py-3 border-t border-line"><button class="btn-default btn-sm" @click="createNote">转为笔记</button><button class="btn-default btn-sm" @click="createQuestion">转为题目</button><button class="btn-default btn-sm" :disabled="!result.terms.length" @click="createTerm">转为单词 / 术语</button><button class="btn-primary btn-sm" @click="createReviewCard">加入复习</button></footer>
      </section>

      <template #aside>
        <section class="panel p-4 stack gap-3"><p class="eyebrow">AI 配置</p><select v-model="profileId" class="field text-[11px]"><option v-if="!store.aiProfiles.length" value="">尚未配置</option><option v-for="item in store.aiProfiles" :key="item.id" :value="item.id">{{ item.label }} · {{ item.model }}</option></select><button v-if="!store.aiProfiles.length" class="btn-default btn-sm" @click="router.push('/settings')">前往设置</button><p class="text-[10px] leading-relaxed text-fg-3">每个来源最多 48 KB，合计最多 256 KB。未选择的资料不会读取，正文不进入任务历史。</p></section>
        <section class="panel p-4 stack gap-2"><p class="eyebrow">定位规则</p><p class="text-[10px] leading-relaxed text-fg-3">Markdown 与题目按行号分块；PDF 复用本地文字层并保留页码。AI 返回的 sourceId / locator 必须与载荷完全匹配，否则整次响应会被拒绝。</p></section>
      </template>
    </ToolLayout>
  </div>
</template>
