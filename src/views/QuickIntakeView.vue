<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { useRouter } from 'vue-router'
import type { VocabularyEntry } from '@/types'
import AppIcon from '@/components/AppIcon.vue'
import PageHeader from '@/components/PageHeader.vue'
import FileDropZone from '@/components/FileDropZone.vue'
import { readClipboardPayload } from '@/lib/clipboard'
import { detectIntake, intakeSummary, normalizeQuickIntakeDraft, type IntakeKind } from '@/lib/intake'
import { stageLocalFileHandoff } from '@/lib/local-file-handoff'
import { readDesktopInputFile } from '@/lib/native'
import { clampMenuPosition, isContextMenuShortcut, nextMenuItemIndex } from '@/lib/desktop-menu'
import { newId } from '@/lib/id'
import { parseQuickQuestionCapture, parseQuickVocabularyCapture, type QuickVocabularyDraft } from '@/lib/quick-learning-capture'
import { questionTemplate } from '@/lib/question-template'
import { cloneVocabularyEntry } from '@/lib/vocabulary'
import { useUiStore } from '@/stores/ui'
import { useWorkbenchStore } from '@/stores/workbench'

interface IntakeAction {
  id: string
  title: string
  description: string
  icon: string
  to?: { path: string; query?: Record<string, string | undefined> }
  primary?: boolean
  badge?: string
}

const store = useWorkbenchStore()
const ui = useUiStore()
const router = useRouter()
const files = ref<File[]>([])
const quickDraftKey = 'knitspace.quick-intake-draft.v1'
function loadQuickDraft() {
  try { return normalizeQuickIntakeDraft(window.localStorage.getItem(quickDraftKey)) }
  catch { return '' }
}
const text = ref(loadQuickDraft())
const readingClipboard = ref(false)
const actionMenu = ref<{ action: IntakeAction; x: number; y: number }>()
const actionMenuElement = ref<HTMLElement>()
let actionMenuTrigger: HTMLElement | undefined
let draftTimer: number | undefined
let learningParseTimer: number | undefined
const questionCapture = shallowRef(parseQuickQuestionCapture(text.value))
const vocabularyCapture = shallowRef(parseQuickVocabularyCapture(text.value))

const kind = computed(() => detectIntake(files.value, text.value))
const summary = computed(() => intakeSummary(kind.value, files.value.length))
const kindMeta: Record<IntakeKind, { label: string; description: string; icon: string }> = {
  empty: { label: '等待输入', description: '拖入、粘贴或选择内容后自动推荐操作', icon: 'inbox' },
  pdf: { label: '识别为 PDF', description: '可以合并、拆页、提取文字或调整页面', icon: 'file-pdf' },
  image: { label: '识别为图片', description: '可以裁剪、压缩、标注或转换格式', icon: 'file-image' },
  code: { label: '识别为代码', description: '可以制作分享图、保存片段或交给 AI 解释', icon: 'terminal' },
  json: { label: '识别为 JSON', description: '可以校验、格式化或提取结构信息', icon: 'json' },
  url: { label: '识别为网页链接', description: '可以解析编码、保存笔记或生成摘要', icon: 'link' },
  text: { label: '识别为文本', description: '可以整理成笔记、清理排版或生成摘要', icon: 'file-text' },
  mixed: { label: '识别为混合文件', description: '适合统一归档、批量命名或检查重复项', icon: 'archive' },
  files: { label: '识别为普通文件', description: '可以收进资料库或进行批量整理', icon: 'sort' }
}
const activeMeta = computed(() => kindMeta[kind.value])
const hasTextInput = computed(() => Boolean(text.value.trim()))
const draftStatus = computed(() => hasTextInput.value ? `${text.value.length.toLocaleString('zh-CN')} 字符 · 草稿保存在本机` : '')

watch(text, (value) => {
  window.clearTimeout(draftTimer)
  draftTimer = window.setTimeout(() => {
    try {
      const draft = normalizeQuickIntakeDraft(value)
      if (draft) window.localStorage.setItem(quickDraftKey, draft)
      else window.localStorage.removeItem(quickDraftKey)
    } catch { /* 捕获仍可继续；隐私模式可能禁用本地草稿。 */ }
  }, 180)
  window.clearTimeout(learningParseTimer)
  learningParseTimer = window.setTimeout(() => {
    questionCapture.value = parseQuickQuestionCapture(value)
    vocabularyCapture.value = parseQuickVocabularyCapture(value)
  }, 120)
})

const vocabularyCaptureReady = computed(() => Boolean(vocabularyCapture.value?.confident))
const questionCaptureBadge = computed(() => {
  const fields = questionCapture.value ? Object.values(questionCapture.value.details).filter(value => value.trim()).length : 0
  return fields > 1 ? `${fields} 个字段` : '题干已就绪'
})
const vocabularyCaptureBadge = computed(() => {
  const draft = vocabularyCapture.value
  if (!draft) return ''
  const parts = new Set(draft.senses.map(sense => sense.partOfSpeech).filter(Boolean)).size
  return `${draft.senses.length} 个义项${parts ? ` · ${parts} 词性` : ''}`
})

const actions = computed<IntakeAction[]>(() => {
  if (kind.value === 'pdf') return [
    { id: 'merge', title: files.value.length > 1 ? '合并这些 PDF' : '打开 PDF 工具', description: files.value.length > 1 ? `按当前顺序合并 ${files.value.length} 份文件` : '拆分、旋转、提取或添加水印', icon: 'merge', to: { path: '/tools', query: { group: 'pdf', operation: files.value.length > 1 ? 'merge' : 'split' } }, primary: true },
    { id: 'pdf-text', title: '提取 PDF 文字', description: '读取已有文字层并导出文本', icon: 'file-text', to: { path: '/tools', query: { group: 'pdf', operation: 'text' } } },
    { id: 'pdf-pages', title: '提取指定页面', description: '输入页码范围生成新文件', icon: 'split', to: { path: '/tools', query: { group: 'pdf', operation: 'extract' } } },
    { id: 'pdf-to-image', title: 'PDF 转图片', description: '逐页渲染为 PNG、JPG 或 WebP', icon: 'image', to: { path: '/tools', query: { group: 'pdf', operation: 'pdf-to-image' } } },
    { id: 'library', title: '收进资料库', description: '建立本地索引，后续继续做笔记', icon: 'inbox', to: { path: '/library' } }
  ]
  if (kind.value === 'image') return [
    { id: 'image-edit', title: '编辑与标注', description: '裁剪、旋转、标注和拼图', icon: 'palette', to: { path: '/visual' }, primary: true },
    { id: 'image-ocr', title: '离线识别文字', description: files.value.length > 1 ? `先把第一张带入识别（本次共 ${files.value.length} 张）` : '使用 Windows 本机语言包，不上传图片', icon: 'file-text', to: { path: '/ocr' } },
    { id: 'image-resize', title: '压缩图片', description: '限制尺寸并调整输出质量', icon: 'resize', to: { path: '/visual', query: { tool: 'resize' } } },
    { id: 'image-convert', title: '转换图片格式', description: 'PNG、JPG 与 WebP 互转', icon: 'image', to: { path: '/visual', query: { tool: 'convert' } } },
    { id: 'image-concat', title: '图片拼成长图', description: '多张图片上下或左右拼成一张', icon: 'gallery', to: { path: '/visual', query: { tool: 'concat' } } },
    { id: 'image-mosaic', title: '图片打码', description: '拖出区域，导出时渲染成真实马赛克', icon: 'mosaic', to: { path: '/visual', query: { annotation: 'mosaic' } } },
    { id: 'image-pdf', title: '图片合成 PDF', description: `把 ${files.value.length} 张图片整理为一份文档`, icon: 'file-pdf', to: { path: '/tools', query: { group: 'pdf', operation: 'images-to-pdf' } } }
  ]
  if (kind.value === 'json') return [
    { id: 'json', title: '格式化并校验', description: '立即定位语法问题并整理缩进', icon: 'json', to: { path: '/developer-tools', query: { tool: 'json' } }, primary: true },
    { id: 'snippet', title: '保存为常用片段', description: '固定到本地剪贴板，随时复用', icon: 'clipboard' },
    { id: 'note', title: '保存为笔记', description: '保留原始 JSON 和 Markdown 说明', icon: 'book' },
    { id: 'ai-extract', title: 'AI 提取结构', description: '发送前仍可确认具体内容', icon: 'sparkle', to: { path: '/ai', query: { action: 'extract' } } }
  ]
  if (kind.value === 'code') return [
    { id: 'code-image', title: '生成代码分享图', description: '自动高亮并按行分页', icon: 'terminal', to: { path: '/code-image' }, primary: true },
    { id: 'snippet', title: '保存为常用片段', description: '固定保存代码，复制时不用重新寻找', icon: 'clipboard' },
    { id: 'note', title: '整理成笔记', description: '使用 Markdown 保存代码与说明', icon: 'book' },
    { id: 'ai-summary', title: 'AI 解释代码', description: '使用摘要动作生成可确认草稿', icon: 'sparkle', to: { path: '/ai', query: { action: 'summarize' } } }
  ]
  if (kind.value === 'url') return [
    { id: 'url', title: '解析 URL 编码', description: '查看查询参数和特殊字符', icon: 'link', to: { path: '/developer-tools', query: { tool: 'url' } }, primary: true },
    { id: 'qrcode', title: '生成分享二维码', description: '生成可下载的高清 PNG', icon: 'qr-code', to: { path: '/developer-tools', query: { tool: 'qrcode' } } },
    { id: 'note', title: '保存链接笔记', description: '把链接留在本地笔记中', icon: 'book' },
    { id: 'snippet', title: '固定到剪贴板', description: '作为常用地址随时复制', icon: 'clipboard' }
  ]
  if (kind.value === 'text') return [
    { id: 'note', title: '整理成笔记', description: '保留原文并继续使用 Markdown 编辑', icon: 'book', primary: true },
    { id: 'question', title: '记录为题目', description: questionCapture.value?.confident ? '已识别题干、答案、解析或错因' : '把原文放进题干，再补答案与解析', icon: 'review', badge: questionCaptureBadge.value },
    ...(vocabularyCaptureReady.value
      ? [{ id: 'word', title: `录入单词“${vocabularyCapture.value?.lemma}”`, description: '保留不同词性与独立义项，不创建零散文件', icon: 'sort', badge: vocabularyCaptureBadge.value }]
      : [{ id: 'ai-summary', title: '提炼摘要', description: '发送前确认内容，结果不会覆盖原文', icon: 'sparkle', to: { path: '/ai', query: { action: 'summarize' } } }]),
    { id: 'clean-text', title: '打开文本工具箱', description: '清理、去重、排序、提取地址或统计字数', icon: 'file-text', to: { path: '/tools', query: { group: 'text', operation: 'transform', mode: 'trim' } } },
  ]
  if (kind.value === 'mixed' || kind.value === 'files') return [
    { id: 'library', title: '统一收进资料库', description: '保留来源并建立本地索引', icon: 'inbox', to: { path: '/library' }, primary: true },
    { id: 'rename', title: '批量命名预览', description: '执行前查看安全的新名称', icon: 'rename', to: { path: '/tools', query: { group: 'organize', operation: 'rename-report' } } },
    { id: 'dedupe', title: '检查文件健康', description: '查重、大文件与空项目', icon: 'duplicate', to: { path: '/tools', query: { mode: 'file-health' } } }
  ]
  return []
})

function clearInput() {
  files.value = []
  text.value = ''
  try { window.localStorage.removeItem(quickDraftKey) } catch { /* no-op */ }
}

function handlePaste(event: ClipboardEvent) {
  const pastedFiles = Array.from(event.clipboardData?.files ?? [])
  if (!pastedFiles.length) return
  event.preventDefault()
  files.value = pastedFiles
  text.value = ''
  ui.toast('已粘贴文件', `识别到 ${pastedFiles.length} 个文件，正在推荐下一步操作。`, 'success')
}

async function readClipboard() {
  readingClipboard.value = true
  try {
    const payload = await readClipboardPayload()
    if (!payload) throw new Error('剪贴板里没有可读取的文字或图片。')
    if (payload.kind === 'image') {
      let file: File | undefined
      if (payload.assetPath) file = await readDesktopInputFile(payload.assetPath)
      else if (payload.preview) {
        const blob = await (await fetch(payload.preview)).blob()
        file = new File([blob], payload.name || 'clipboard-image.png', { type: blob.type || 'image/png' })
      }
      if (!file) throw new Error('这张图片暂时无法转换为可编辑文件。')
      files.value = [file]
      text.value = ''
    } else {
      text.value = payload.content ?? ''
      files.value = []
    }
    ui.toast('已读取剪贴板', 'Knitspace 已推荐下一步操作。', 'success')
  } catch (error) {
    ui.toast('读取失败', error instanceof Error ? error.message : '系统剪贴板暂时不可用。', 'error')
  } finally {
    readingClipboard.value = false
  }
}

function noteTitle() {
  const firstLine = text.value.trim().split(/\r?\n/)[0].replace(/^#+\s*/, '').trim()
  return firstLine.slice(0, 36) || '来自快速处理的笔记'
}

async function openAction(action: IntakeAction) {
  if (action.id === 'note') {
    const note = store.createNote(noteTitle())
    note.content = `# ${note.title}\n\n${text.value.trim()}\n`
    store.saveDocument(note)
    store.addActivity('source', '从万能入口创建笔记', note.title, '/documents', note.id)
    clearInput()
    await router.push({ path: '/documents', query: { kind: 'note', document: note.id, mode: 'edit' } })
    return
  }
  if (action.id === 'question') {
    const capture = parseQuickQuestionCapture(text.value)
    if (!capture) return
    const question = store.createQuestion()
    question.title = capture.title
    question.questionType = capture.questionType
    question.subject = capture.subject
    question.tags = capture.tags
    question.questionDetails = capture.details
    question.content = questionTemplate(capture.title, { questionType: capture.questionType, subject: capture.subject, tags: capture.tags, difficulty: question.difficulty, reviewEnabled: question.reviewEnabled })
    store.saveDocument(question)
    store.addActivity('source', '从快速捕获创建题目', question.title, '/documents', question.id)
    clearInput()
    await router.push({ path: '/documents', query: { kind: 'question', document: question.id, mode: 'edit' } })
    ui.toast('已整理为结构化题目', capture.truncated ? '超长输入已按安全上限截取；请检查题干和解析。' : '题干与识别出的答案、解析、错因已经填好。', 'success')
    return
  }
  if (action.id === 'word') {
    await createVocabularyFromCapture()
    return
  }
  if (action.id === 'snippet') {
    const content = text.value.trim()
    if (!content) return
    await store.addClipboardItem({ kind: kind.value === 'code' || kind.value === 'json' ? 'code' : 'text', content, pinned: true })
    ui.toast('已保存为常用片段', '片段已固定到剪贴板顶部。', 'success')
    clearInput()
    await router.push({ path: '/clipboard', query: { view: 'snippets' } })
    return
  }
  if (action.id === 'image-ocr') {
    const file = files.value[0] as (File & { path?: string }) | undefined
    if (!file?.path) {
      ui.toast('需要桌面本地图片', '请在开发版中通过选择文件、桌面拖放或“读取剪贴板”加入图片。', 'warning')
      await router.push('/ocr')
      return
    }
    stageLocalFileHandoff('ocr', [file.path], '快速收集')
    clearInput()
    await router.push('/ocr')
    return
  }
  if (action.id === 'code-image' && text.value.trim()) store.prepareCodeDraft(text.value, 'snippet.txt')
  store.stageIntake(files.value, text.value)
  if (action.to) {
    clearInput()
    await router.push(action.to)
  }
}

function mergeVocabularyCapture(entry: VocabularyEntry, capture: QuickVocabularyDraft) {
  const next = cloneVocabularyEntry(entry)
  if (!next.pronunciation && capture.pronunciation) next.pronunciation = capture.pronunciation
  next.forms = { ...next.forms, ...capture.forms }
  for (const incoming of capture.senses) {
    const existing = next.senses.find(sense => sense.partOfSpeech.trim().toLocaleLowerCase('en-US') === incoming.partOfSpeech.trim().toLocaleLowerCase('en-US') && sense.definition.trim() === incoming.definition.trim())
    if (existing) {
      existing.examples = [...new Set([...existing.examples, ...incoming.examples])]
      existing.collocations = [...new Set([...existing.collocations, ...incoming.collocations])]
      existing.synonyms = [...new Set([...existing.synonyms, ...incoming.synonyms])]
      continue
    }
    next.senses.push({ id: newId(), ...incoming, reviewEnabled: false })
  }
  return next
}

async function createVocabularyFromCapture() {
  const capture = parseQuickVocabularyCapture(text.value)
  if (!capture?.confident) {
    ui.toast('没有识别出明确词条', '第一行请只写单词，可在后续行使用“v. / n. / 例句：/ 搭配：”。', 'info')
    return
  }
  const existing = store.vocabulary.find(entry => entry.lemma.trim().toLocaleLowerCase('en-US') === capture.lemma.toLocaleLowerCase('en-US'))
  let entry: VocabularyEntry
  if (existing) {
    const confirmed = await ui.confirm({ title: `“${existing.lemma}”已经在单词库`, message: `把这次识别出的 ${capture.senses.length} 个义项与现有词条合并；相同词性和释义不会重复。`, confirmLabel: '合并义项' })
    if (!confirmed) return
    const complete = await store.loadVocabulary(existing.id)
    if (!complete) throw new Error('已有词条已不存在。')
    entry = mergeVocabularyCapture(complete, capture)
    store.saveVocabularyEntry(entry)
  } else {
    const timestamp = new Date().toISOString()
    entry = {
      id: newId(), lemma: capture.lemma, language: capture.language, pronunciation: capture.pronunciation, forms: capture.forms,
      senses: capture.senses.map(sense => ({ id: newId(), ...sense, reviewEnabled: false })), createdAt: timestamp, updatedAt: timestamp,
    }
    await store.importVocabularyEntries([entry])
  }
  store.addActivity('source', existing ? '从快速捕获合并单词' : '从快速捕获创建单词', entry.lemma, '/words', entry.id)
  clearInput()
  await router.push({ path: '/words', query: { word: entry.id } })
  ui.toast(existing ? '已合并到现有词条' : '已录入结构化单词', `${entry.senses.length} 个义项已保存在 SQLite；可继续补充例句或开启复习卡。`, 'success')
}

function closeActionMenu(restoreFocus = false) {
  actionMenu.value = undefined
  if (restoreFocus) void nextTick(() => actionMenuTrigger?.focus({ preventScroll: true }))
}
function actionMenuHeight() {
  const itemCount = 2 + (hasTextInput.value ? 3 + (vocabularyCaptureReady.value ? 1 : 0) : 0) + (files.value.length ? 1 : 0)
  return 48 + itemCount * 36
}
function showActionMenu(action: IntakeAction, x: number, y: number, trigger: HTMLElement) {
  actionMenuTrigger = trigger
  actionMenu.value = { action, ...clampMenuPosition(x, y, { menuWidth: 250, menuHeight: actionMenuHeight(), margin: 12 }) }
  void nextTick(() => actionMenuElement.value?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus())
}
function openActionMenu(event: MouseEvent, action: IntakeAction) {
  showActionMenu(action, event.clientX, event.clientY, event.currentTarget as HTMLElement)
}
function openActionMenuFromKeyboard(event: KeyboardEvent, action: IntakeAction) {
  if (!isContextMenuShortcut(event)) return
  event.preventDefault()
  const trigger = event.currentTarget as HTMLElement
  const bounds = trigger.getBoundingClientRect()
  showActionMenu(action, bounds.right - 20, bounds.top + 22, trigger)
}
function handleActionMenuKeydown(event: KeyboardEvent) {
  const items = [...(actionMenuElement.value?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [])]
  if (event.key === 'Escape') { event.preventDefault(); closeActionMenu(true); return }
  const next = nextMenuItemIndex(event.key, items.indexOf(document.activeElement as HTMLButtonElement), items.length)
  if (next === undefined) return
  event.preventDefault()
  items[next]?.focus()
}
async function runCurrentAction() {
  const action = actionMenu.value?.action
  closeActionMenu()
  if (action) await openAction(action)
}
async function createNoteFromMenu() {
  closeActionMenu()
  await openAction({ id: 'note', title: '整理成笔记', description: '', icon: 'book' })
}
async function createQuestionFromMenu() {
  closeActionMenu()
  await openAction({ id: 'question', title: '记录为题目', description: '', icon: 'review' })
}
async function createWordFromMenu() {
  closeActionMenu()
  await openAction({ id: 'word', title: '录入结构化单词', description: '', icon: 'sort' })
}
async function pinSnippetFromMenu() {
  closeActionMenu()
  await openAction({ id: 'snippet', title: '保存为常用片段', description: '', icon: 'clipboard' })
}
async function sendToLibraryFromMenu() {
  closeActionMenu()
  store.stageIntake(files.value, text.value)
  await router.push('/library')
}
function clearFromActionMenu() { clearInput(); closeActionMenu(true) }
function closeActionMenuOnOutsideClick() { closeActionMenu() }
function closeIntakeContextMenus() { closeActionMenu() }
onMounted(() => {
  window.addEventListener('click', closeActionMenuOnOutsideClick)
  window.addEventListener('knitspace:close-context-menus', closeIntakeContextMenus)
})
onBeforeUnmount(() => {
  window.removeEventListener('click', closeActionMenuOnOutsideClick)
  window.removeEventListener('knitspace:close-context-menus', closeIntakeContextMenus)
  window.clearTimeout(draftTimer)
  window.clearTimeout(learningParseTimer)
})
</script>

<template>
  <div class="page-enter mx-auto w-full max-w-320 px-8 py-6" @paste.capture="handlePaste">
    <PageHeader title="快速处理" subtitle="拖进来就行,Knitspace 判断类型后给出可直接执行的下一步">
      <template #actions>
        <span class="row gap-1.5 h-9 px-3 rounded-sm bg-surface-2 border border-line text-[12px] text-fg-2">
          <AppIcon name="shield" :size="14" class="text-success" />本机识别
        </span>
      </template>
    </PageHeader>

    <!-- Input on the left, what to do with it on the right. The numbered
         "01 / 02" badges are gone: two panes side by side already say which
         comes first, and there was never a step three. -->
    <div class="grid gap-4 grid-cols-1 xl:grid-cols-[minmax(0,1.05fr)_minmax(360px,0.95fr)] items-start">
      <section class="pane min-h-[26rem]">
        <header class="pane-head">
          <p class="pane-title">输入内容</p>
          <button v-if="kind !== 'empty'" class="btn-ghost btn-sm" @click="clearInput">清空</button>
        </header>

        <div class="stack gap-3 p-3 flex-1">
          <FileDropZone
            v-model="files"
            :max-file-bytes="32 * 1024 * 1024"
            :max-total-bytes="96 * 1024 * 1024"
            title="把任何文件拖到这里"
            hint="PDF · 图片 · 文本 · 代码 · 单次最多 96 MB"
            @error="ui.toast('无法读取文件', $event, 'error')"
          />

          <div class="row gap-3 text-[12px] text-fg-3">
            <span class="h-px flex-1 bg-line" />或者<span class="h-px flex-1 bg-line" />
          </div>

          <textarea
            v-model="text"
            :disabled="files.length > 0"
            aria-label="粘贴文字或代码"
            class="w-full min-h-40 px-3 py-2.5 rounded-md bg-well border border-line font-mono text-[13px] leading-relaxed resize-y focus:outline-none focus:border-accent disabled:opacity-45"
            placeholder="粘贴文字、代码、JSON、网址、会议记录或作业内容…"
          />

          <p v-if="draftStatus" class="row gap-2 text-[12px] text-fg-3">
            <AppIcon name="shield" :size="13" class="shrink-0 text-success" />
            <span class="min-w-0 truncate">{{ draftStatus }}</span>
            <button type="button" class="ml-auto shrink-0 text-fg-2 underline hover:text-danger" @click="clearInput">丢弃草稿</button>
          </p>

          <button class="btn-default w-full" :disabled="readingClipboard" @click="readClipboard">
            <AppIcon name="clipboard" :size="15" />{{ readingClipboard ? '正在读取…' : '读取系统剪贴板' }}
          </button>
        </div>
      </section>

      <section class="pane min-h-[26rem]">
        <header class="pane-head">
          <p class="pane-title">下一步</p>
          <span class="text-[11px] text-fg-3 truncate">{{ kind === 'empty' ? '输入后自动出现' : `${summary} · 已在本机识别` }}</span>
        </header>

        <div v-if="kind !== 'empty'" class="stack gap-3 p-3 flex-1">
          <div class="row gap-3 p-3 rounded-md bg-accent-soft">
            <b class="center w-10 h-10 shrink-0 rounded-sm bg-accent text-accent-fg"><AppIcon :name="activeMeta.icon" :size="20" /></b>
            <span class="stack gap-0.5 min-w-0">
              <strong class="text-[14px] font-semibold text-fg">{{ activeMeta.label }}</strong>
              <small class="text-[12px] leading-snug text-fg-2">{{ activeMeta.description }}</small>
            </span>
          </div>

          <div v-if="actions.length" class="stack gap-2">
            <button
              v-for="action in actions"
              :key="action.id"
              class="row gap-3 p-3 rounded-md border text-left transition-colors"
              :class="action.primary ? 'border-accent bg-accent text-accent-fg' : 'border-line bg-surface-2 hover:border-line-strong hover:bg-surface-3'"
              :aria-label="`${action.title}${action.badge ? `，${action.badge}` : ''}；右键或 Shift 加 F10 打开更多操作`"
              aria-haspopup="menu"
              :aria-expanded="actionMenu?.action.id === action.id"
              @click="openAction(action)"
              @contextmenu.prevent.stop="openActionMenu($event, action)"
              @keydown="openActionMenuFromKeyboard($event, action)"
            >
              <b class="center w-9 h-9 shrink-0 rounded-sm" :class="action.primary ? 'bg-white/15' : 'bg-surface text-accent'">
                <AppIcon :name="action.icon" :size="18" />
              </b>
              <span class="stack gap-0.5 min-w-0 flex-1">
                <strong class="text-[13px] font-medium truncate">{{ action.title }}</strong>
                <small class="text-[11px] leading-snug" :class="action.primary ? 'opacity-80' : 'text-fg-3'">{{ action.description }}</small>
              </span>
              <span class="row gap-2 shrink-0">
                <i v-if="action.badge" class="chip h-5 px-1.5 text-[11px] not-italic" :class="action.primary ? 'bg-white/15 text-inherit' : 'bg-accent-soft text-accent'">{{ action.badge }}</i>
                <AppIcon name="arrow-right" :size="15" :class="action.primary ? '' : 'text-fg-3'" />
              </span>
            </button>
          </div>
        </div>

        <div v-else class="flex-1 stack items-center justify-center gap-2 p-8 text-center">
          <span class="center w-12 h-12 rounded-lg bg-surface-2 text-fg-3"><AppIcon name="inbox" :size="24" /></span>
          <b class="text-[14px] font-semibold text-fg">一个入口，接住所有内容</b>
          <p class="max-w-72 text-[12px] leading-relaxed text-fg-3">
            不用先想该去哪个页面。放进去之后，这里会给出最合适的三到四个操作。
          </p>
        </div>
      </section>
    </div>

    <section class="row gap-2 flex-wrap mt-4">
      <span class="row text-[12px] text-fg-3 pr-1">快速开始</span>
      <RouterLink
        v-for="shortcut in ([
          ['/tools?group=pdf&operation=merge', 'file-pdf', '合并 PDF', '多份文档合成一份'],
          ['/visual?tool=resize', 'resize', '压缩图片', '限制尺寸与质量'],
          ['/clipboard?view=snippets', 'clipboard', '常用片段', '快速复制固定内容'],
          ['/developer-tools?tool=json', 'json', '格式化 JSON', '校验并整理结构'],
        ] as const)"
        :key="shortcut[0]"
        :to="shortcut[0]"
        class="row gap-2.5 flex-1 min-w-52 px-3 py-2.5 rounded-md border border-line bg-surface transition-colors hover:border-line-strong hover:bg-surface-2"
      >
        <AppIcon :name="shortcut[1]" :size="17" class="shrink-0 text-fg-2" />
        <span class="stack gap-0.5 min-w-0">
          <b class="text-[13px] font-medium text-fg">{{ shortcut[2] }}</b>
          <small class="text-[11px] text-fg-3">{{ shortcut[3] }}</small>
        </span>
      </RouterLink>
    </section>

    <Teleport to="body">
      <div
        v-if="actionMenu"
        ref="actionMenuElement"
        class="fixed z-[145] w-62 p-1 rounded-md bg-surface border border-line-strong shadow-lg"
        role="menu"
        :aria-label="`${actionMenu.action.title} 的更多操作`"
        :style="{ left: `${actionMenu.x}px`, top: `${actionMenu.y}px` }"
        @click.stop
        @contextmenu.prevent
        @keydown.stop="handleActionMenuKeydown"
      >
        <p class="px-2.5 py-1.5 text-[11px] text-fg-3 truncate">{{ actionMenu.action.title }}</p>
        <button class="nav-item w-full" role="menuitem" @click="runCurrentAction">执行「{{ actionMenu.action.title }}」</button>
        <button v-if="hasTextInput" class="nav-item w-full" role="menuitem" @click="createNoteFromMenu">整理为本地笔记</button>
        <button v-if="hasTextInput" class="nav-item w-full" role="menuitem" @click="createQuestionFromMenu">记录为结构化题目</button>
        <button v-if="hasTextInput && vocabularyCaptureReady" class="nav-item w-full" role="menuitem" @click="createWordFromMenu">录入结构化单词</button>
        <button v-if="hasTextInput" class="nav-item w-full" role="menuitem" @click="pinSnippetFromMenu">固定为常用片段</button>
        <button v-if="files.length" class="nav-item w-full" role="menuitem" @click="sendToLibraryFromMenu">收进本地资料库</button>
        <button class="nav-item w-full hover:bg-danger-soft hover:text-danger" role="menuitem" @click="clearFromActionMenu">清空本次输入</button>
      </div>
    </Teleport>
  </div>
</template>
