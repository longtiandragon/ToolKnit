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
    { id: 'library', title: '收进资料库', description: '建立本地索引，后续继续做笔记', icon: 'inbox', to: { path: '/library' } }
  ]
  if (kind.value === 'image') return [
    { id: 'image-edit', title: '编辑与标注', description: '裁剪、旋转、标注和拼图', icon: 'palette', to: { path: '/visual' }, primary: true },
    { id: 'image-ocr', title: '离线识别文字', description: files.value.length > 1 ? `先把第一张带入识别（本次共 ${files.value.length} 张）` : '使用 Windows 本机语言包，不上传图片', icon: 'file-text', to: { path: '/ocr' } },
    { id: 'image-resize', title: '压缩图片', description: '限制尺寸并调整输出质量', icon: 'resize', to: { path: '/visual', query: { tool: 'resize' } } },
    { id: 'image-convert', title: '转换图片格式', description: 'PNG、JPG 与 WebP 互转', icon: 'image', to: { path: '/visual', query: { tool: 'convert' } } },
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
    { id: 'dedupe', title: '检查重复文件', description: '使用 SHA-256 生成去重报告', icon: 'duplicate', to: { path: '/tools', query: { group: 'organize', operation: 'dedupe-report' } } }
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
    entry = mergeVocabularyCapture(existing, capture)
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
  <div class="quick-intake page-enter mx-auto w-full max-w-320 px-8 py-6" @paste.capture="handlePaste">
    <PageHeader title="快速处理" subtitle="拖进来就行,Knitspace 判断类型后给出可直接执行的下一步">
      <template #actions>
        <span class="row gap-1.5 h-9 px-3 rounded-sm bg-surface-2 border border-line text-[12px] text-fg-2">
          <AppIcon name="shield" :size="14" class="text-success" />本机识别
        </span>
      </template>
    </PageHeader>

    <section class="intake-stage panel" :class="`kind-${kind}`">
      <div class="intake-input">
        <header><span>01</span><div><b>输入内容</b><small>拖入文件，或者直接粘贴文字</small></div><button v-if="kind !== 'empty'" class="quiet-button" @click="clearInput">清空</button></header>
        <FileDropZone v-model="files" :max-file-bytes="32 * 1024 * 1024" :max-total-bytes="96 * 1024 * 1024" title="把任何文件拖到这里" hint="PDF · 图片 · 文本 · 代码 · 单次最多 96 MB" @error="ui.toast('无法读取文件', $event, 'error')"/>
        <div class="intake-divider"><span>或者</span></div>
        <textarea v-model="text" :disabled="files.length > 0" aria-label="粘贴文字或代码" placeholder="粘贴文字、代码、JSON、网址、会议记录或作业内容…"></textarea>
        <p v-if="draftStatus" class="intake-draft-status"><AppIcon name="shield" :size="13"/><span>{{ draftStatus }}</span><button type="button" @click="clearInput">丢弃草稿</button></p>
        <button class="clipboard-read" :disabled="readingClipboard" @click="readClipboard"><AppIcon name="clipboard" :size="16"/>{{ readingClipboard ? '正在读取…' : '读取系统剪贴板' }}</button>
      </div>

      <aside class="intake-result">
        <header><span>02</span><div><b>智能建议</b><small>{{ kind === 'empty' ? '输入后自动出现' : `${summary} · 已完成本地识别` }}</small></div></header>
        <div v-if="kind !== 'empty'" class="intake-detected"><b><AppIcon :name="activeMeta.icon" :size="22"/></b><span><strong>{{ activeMeta.label }}</strong><small>{{ activeMeta.description }}</small></span><i></i></div>
        <div v-if="actions.length" class="intake-actions">
          <button v-for="action in actions" :key="action.id" :class="{ primary: action.primary }" :aria-label="`${action.title}${action.badge ? `，${action.badge}` : ''}；右键或 Shift 加 F10 打开更多操作`" aria-haspopup="menu" :aria-expanded="actionMenu?.action.id === action.id" @click="openAction(action)" @contextmenu.prevent.stop="openActionMenu($event, action)" @keydown="openActionMenuFromKeyboard($event, action)">
            <b><AppIcon :name="action.icon" :size="19"/></b><span><strong>{{ action.title }}</strong><small>{{ action.description }}</small></span><span class="intake-action-end"><i v-if="action.badge">{{ action.badge }}</i><AppIcon name="arrow-right" :size="15"/></span>
          </button>
        </div>
        <div v-else class="intake-empty"><AppIcon name="inbox" :size="28"/><b>一个入口，接住所有内容</b><p>不需要先判断该去哪个页面。Knitspace 会根据输入给出最合适的三到四个操作。</p></div>
      </aside>
    </section>

    <section class="intake-shortcuts">
      <p class="eyebrow">快速开始</p>
      <RouterLink to="/tools?group=pdf&operation=merge"><AppIcon name="file-pdf" :size="17"/><span><b>合并 PDF</b><small>多份文档合成一份</small></span></RouterLink>
      <RouterLink to="/visual?tool=resize"><AppIcon name="resize" :size="17"/><span><b>压缩图片</b><small>限制尺寸与质量</small></span></RouterLink>
      <RouterLink to="/clipboard?view=snippets"><AppIcon name="clipboard" :size="17"/><span><b>常用片段</b><small>快速复制固定内容</small></span></RouterLink>
      <RouterLink to="/developer-tools?tool=json"><AppIcon name="json" :size="17"/><span><b>格式化 JSON</b><small>校验并整理结构</small></span></RouterLink>
    </section>
    <Teleport to="body"><section v-if="actionMenu" ref="actionMenuElement" class="intake-action-context-menu" role="menu" :aria-label="`${actionMenu.action.title} 的更多操作`" :style="{ left: `${actionMenu.x}px`, top: `${actionMenu.y}px` }" @click.stop @contextmenu.prevent @keydown.stop="handleActionMenuKeydown"><p>{{ actionMenu.action.title }}</p><button role="menuitem" @click="runCurrentAction">执行“{{ actionMenu.action.title }}”</button><button v-if="hasTextInput" role="menuitem" @click="createNoteFromMenu">整理为本地笔记</button><button v-if="hasTextInput" role="menuitem" @click="createQuestionFromMenu">记录为结构化题目</button><button v-if="hasTextInput && vocabularyCaptureReady" role="menuitem" @click="createWordFromMenu">录入结构化单词</button><button v-if="hasTextInput" role="menuitem" @click="pinSnippetFromMenu">固定为常用片段</button><button v-if="files.length" role="menuitem" @click="sendToLibraryFromMenu">收进本地资料库</button><button role="menuitem" class="danger" @click="clearFromActionMenu">清空本次输入</button></section></Teleport>
  </div>
</template>

<style scoped>
.quick-intake{max-width:1180px;margin:0 auto;padding:34px 28px 64px}.intake-hero{justify-content:space-between;margin-bottom:24px}.intake-hero h2{margin:8px 0 7px;font-size:clamp(32px,4vw,50px);line-height:1.05;letter-spacing:-.045em}.intake-hero h2 em{font-style:normal}.intake-hero p:not(.eyebrow){max-width:700px;font-size:15px}.intake-privacy{display:flex;align-items:center;gap:11px;max-width:300px;padding:13px 15px;border:1px solid var(--line);border-radius:14px;background:color-mix(in srgb,var(--surface) 84%,var(--accent) 4%);color:var(--accent)}.intake-privacy span{display:grid;gap:2px}.intake-privacy b{font-size:13px}.intake-privacy small{color:var(--muted);line-height:1.45}.intake-stage{display:grid;grid-template-columns:minmax(0,1.08fr) minmax(360px,.92fr);min-height:560px;overflow:hidden}.intake-input,.intake-result{padding:25px}.intake-input{border-right:1px solid var(--line);background:linear-gradient(145deg,color-mix(in srgb,var(--surface) 96%,var(--accent) 4%),var(--surface))}.intake-result{background:var(--surface)}.intake-input>header,.intake-result>header{display:flex;align-items:center;gap:11px;margin-bottom:20px}.intake-input>header>span,.intake-result>header>span{display:grid;place-items:center;width:29px;height:29px;border-radius:9px;background:var(--ink);color:var(--fg);font:700 11px/1 monospace}.intake-input>header div,.intake-result>header div{display:grid;gap:2px}.intake-input>header b,.intake-result>header b{font-size:15px}.intake-input>header small,.intake-result>header small{color:var(--muted)}.intake-input>header button{margin-left:auto}.intake-divider{display:flex;align-items:center;gap:12px;margin:15px 0;color:var(--faint);font-size:11px}.intake-divider:before,.intake-divider:after{content:"";height:1px;flex:1;background:var(--line)}.intake-input textarea{width:100%;min-height:170px;resize:vertical;border:1px solid var(--line);border-radius:14px;padding:16px;background:var(--canvas);color:var(--ink);font:14px/1.65 var(--font-mono);outline:none}.intake-input textarea:focus{border-color:var(--accent);box-shadow:0 0 0 3px color-mix(in srgb,var(--accent) 13%,transparent)}.intake-input textarea:disabled{opacity:.48}.intake-draft-status{display:flex;min-height:32px;align-items:center;gap:7px;margin:7px 2px 0;color:var(--muted);font:650 9px var(--font-ui)}.intake-draft-status .app-icon{flex:0 0 auto;color:var(--green-strong)}.intake-draft-status button{margin-left:auto;padding:3px 0;border:0;color:var(--green-strong);background:transparent;font:700 9px var(--font-ui)}.intake-draft-status button:hover,.intake-draft-status button:focus-visible{text-decoration:underline}.intake-draft-status button:focus-visible{outline:2px solid color-mix(in srgb,var(--accent) 42%,transparent);outline-offset:3px}.clipboard-read{display:flex;align-items:center;justify-content:center;gap:7px;width:100%;margin-top:11px;padding:11px;border:1px dashed color-mix(in srgb,var(--accent) 45%,var(--line));border-radius:11px;background:transparent;color:var(--accent);font-weight:700}.intake-detected{display:flex;align-items:center;gap:13px;padding:16px;margin-bottom:13px;border:1px solid color-mix(in srgb,var(--accent) 26%,var(--line));border-radius:15px;background:color-mix(in srgb,var(--accent) 7%,var(--surface))}.intake-detected>b{display:grid;place-items:center;width:44px;height:44px;border-radius:13px;background:var(--accent);color:white}.intake-detected span{display:grid;gap:3px;min-width:0}.intake-detected strong{font-size:15px}.intake-detected small{color:var(--muted);line-height:1.4}.intake-detected i{width:8px;height:8px;margin-left:auto;border-radius:50%;background:var(--accent);box-shadow:0 0 0 5px color-mix(in srgb,var(--accent) 13%,transparent)}.intake-actions{display:grid;gap:9px}.intake-actions>button{display:grid;grid-template-columns:40px 1fr auto;align-items:center;gap:12px;width:100%;padding:13px;border:1px solid var(--line);border-radius:13px;background:var(--canvas);color:var(--ink);text-align:left;transition:border-color .18s ease,background .18s ease,box-shadow .18s ease}.intake-actions>button:hover{border-color:color-mix(in srgb,var(--accent) 48%,var(--line));background:color-mix(in srgb,var(--accent) 5%,var(--surface));box-shadow:0 7px 18px var(--accent-soft)}.intake-actions>button.primary{border-color:var(--accent);background:var(--ink);color:white}.intake-actions>button>b{display:grid;place-items:center;width:38px;height:38px;border-radius:10px;background:color-mix(in srgb,var(--accent) 12%,var(--surface));color:var(--accent)}.intake-actions>button.primary>b{background:color-mix(in srgb,var(--accent) 78%,white 8%);color:white}.intake-actions span{display:grid;gap:3px}.intake-actions strong{font-size:14px}.intake-actions small{color:var(--muted);line-height:1.35}.intake-actions>button.primary small{color:var(--line-strong)}.intake-empty{display:grid;place-items:center;align-content:center;min-height:350px;padding:45px;text-align:center;color:var(--muted)}.intake-empty svg{color:var(--accent);margin-bottom:14px}.intake-empty b{color:var(--ink);font-size:17px}.intake-empty p{max-width:310px;line-height:1.7}.intake-shortcuts{display:grid;grid-template-columns:auto repeat(4,1fr);align-items:center;gap:10px;margin-top:18px}.intake-shortcuts>.eyebrow{padding-right:8px}.intake-shortcuts>a{display:flex;align-items:center;gap:10px;min-height:62px;padding:12px 13px;border:1px solid var(--line);border-radius:12px;background:var(--surface);color:var(--ink);text-decoration:none}.intake-shortcuts>a>svg{color:var(--accent)}.intake-shortcuts span{display:grid;gap:2px}.intake-shortcuts b{font-size:13px}.intake-shortcuts small{color:var(--muted);font-size:11px}@media(max-width:900px){.intake-hero{flex-direction:column}.intake-stage{grid-template-columns:1fr}.intake-input{border-right:0;border-bottom:1px solid var(--line)}.intake-shortcuts{grid-template-columns:1fr 1fr}.intake-shortcuts>.eyebrow{grid-column:1/-1}}@media(max-width:560px){.quick-intake{padding:22px 14px 48px}.intake-stage{display:block}.intake-input,.intake-result{padding:18px}.intake-shortcuts{grid-template-columns:1fr}}
.quick-intake{padding-top:28px}.intake-hero{}.intake-hero>div:first-child{min-width:0;max-width:760px}.intake-hero h2{font-size:clamp(32px,3.25vw,44px);line-height:1.06;letter-spacing:-.04em}.intake-privacy{flex:0 0 auto}@media(max-width:560px){.quick-intake{padding-top:22px}}
.intake-actions>button:focus-visible{position:relative;z-index:1;outline:2px solid color-mix(in srgb,var(--accent) 48%,transparent);outline-offset:3px}.intake-action-context-menu{position:fixed;z-index:145;width:250px;overflow:hidden;border:1px solid color-mix(in srgb,var(--accent) 22%,var(--line));border-radius:13px;background:var(--surface);box-shadow:var(--shadow-lg);animation:intake-menu-in .14s ease-out both}.intake-action-context-menu p{overflow:hidden;margin:0;padding:11px 13px 8px;border-bottom:1px solid var(--line-weak);color:var(--muted);font:700 9px var(--font-mono);letter-spacing:.065em;text-overflow:ellipsis;white-space:nowrap}.intake-action-context-menu button{display:block;width:100%;min-height:36px;padding:0 13px;border:0;color:var(--text-secondary);background:transparent;font:650 11px var(--font-ui);text-align:left}.intake-action-context-menu button:hover,.intake-action-context-menu button:focus-visible{color:var(--green-strong);background:var(--green-bg)}.intake-action-context-menu button:focus-visible{outline:2px solid color-mix(in srgb,var(--accent) 48%,transparent);outline-offset:-2px}.intake-action-context-menu button.danger{border-top:1px solid var(--line-weak);color:var(--danger)}.intake-action-context-menu button.danger:hover,.intake-action-context-menu button.danger:focus-visible{background:var(--danger-soft)}@keyframes intake-menu-in{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:none}}
.intake-actions>button{grid-template-columns:40px minmax(0,1fr) auto}.intake-actions>button>span:not(.intake-action-end){display:grid;min-width:0;gap:3px}.intake-actions>button>span:not(.intake-action-end)>strong,.intake-actions>button>span:not(.intake-action-end)>small{overflow:hidden;text-overflow:ellipsis}.intake-actions>button>span:not(.intake-action-end)>strong{white-space:nowrap}.intake-action-end{display:flex!important;align-items:center;gap:8px;color:var(--muted)}.intake-action-end i{padding:4px 6px;border:1px solid color-mix(in srgb,var(--accent) 22%,var(--line));border-radius:999px;color:var(--accent);background:color-mix(in srgb,var(--accent) 7%,var(--surface));font:750 8px/1 var(--font-mono);font-style:normal;white-space:nowrap}.intake-actions>button.primary .intake-action-end{color:var(--line-strong)}.intake-actions>button.primary .intake-action-end i{border-color:var(--accent-soft);color:var(--fg);background:var(--surface-2)}@media(max-width:560px){.intake-action-end i{display:none}}@media(prefers-reduced-motion:reduce){.intake-actions>button,.intake-action-context-menu{animation:none;transition:none}}
</style>
