<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { onBeforeRouteLeave, RouterLink, useRoute, useRouter } from 'vue-router'
import { open } from '@tauri-apps/plugin-dialog'
import AppIcon from '@/components/AppIcon.vue'
import PageHeader from '@/components/PageHeader.vue'
import UnsavedChangesDialog from '@/components/UnsavedChangesDialog.vue'
import { clampMenuPosition, isContextMenuShortcut, nextMenuItemIndex } from '@/lib/desktop-menu'
import { newId } from '@/lib/id'
import { chooseOutputDirectory, exportOutput } from '@/lib/output'
import { fixedRowVirtualWindow } from '@/lib/virtual-window'
import {
  MAX_SUBTITLE_BYTES,
  analyzeSubtitleQuality,
  formatSubtitleTimestamp,
  mergeSubtitleCues,
  parseSubtitle,
  parseSubtitleTimestamp,
  serializeSubtitle,
  shiftSubtitleCues,
  splitSubtitleCue,
  subtitleCueIndexes,
  type SubtitleCue,
  type SubtitleFormat,
} from '@/lib/subtitle'
import { subtitleWorkflowActions, subtitleWorkflowId, type SubtitleWorkflowId } from '@/lib/subtitle-workflows'
import SegmentedControl from '@/components/SegmentedControl.vue'
import { cancelDesktopTranscription, inspectDesktopInputFile, isDesktop, listenDesktopEvent, readDesktopInputFile, revealDesktopFile, transcribeDesktopMedia, type DesktopInputFileMetadata, type TranscriptionProgress } from '@/lib/native'
import { useWorkbenchStore } from '@/stores/workbench'
import { useUiStore } from '@/stores/ui'
import type { UnsavedDocumentDecision } from '@/lib/document-transition'

const store = useWorkbenchStore()
const ui = useUiStore()
const route = useRoute()
const router = useRouter()
const desktop = isDesktop()
const fileInput = ref<HTMLInputElement>()
const listElement = ref<HTMLElement>()
const sourceDraftElement = ref<HTMLTextAreaElement>()
const transcriptionCardElement = ref<HTMLElement>()
const shiftInputElement = ref<HTMLInputElement>()
const convertButtonElement = ref<HTMLButtonElement>()
const menuElement = ref<HTMLElement>()
const cues = shallowRef<SubtitleCue[]>([])
const sourceName = ref('未命名字幕.srt')
const sourceFormat = ref<SubtitleFormat>('srt')
const sourceDraft = ref('')
const sourceDraftOpen = ref(false)
const importFormat = ref<SubtitleFormat>('srt')
const warnings = ref<string[]>([])
const query = ref('')
const activeId = ref('')
const editStart = ref('')
const editEnd = ref('')
const editText = ref('')
const editError = ref('')
const dirty = ref(false)
const exporting = ref(false)
const scrollTop = ref(0)
const listHeight = ref(460)
const shiftMs = ref(500)
const menu = ref<{ cue: SubtitleCue; x: number; y: number } | null>(null)
const transcriptionOpen = ref(route.query.transcribe === '1')
const transcriptionMedia = ref<DesktopInputFileMetadata>()
const transcribing = ref(false)
const transcriptionProgress = ref(0)
const transcriptionDetail = ref('')
const transcriptionError = ref('')
const transcriptionOutput = ref('')
const transcriptionRunId = ref('')
const transcriptionJobId = ref('')
const mediaMenu = ref<{ x: number; y: number } | null>(null)
const mediaMenuElement = ref<HTMLElement>()
let mediaMenuTrigger: HTMLElement | undefined
let stopTranscriptionListener: (() => void) | undefined
const leavePrompt = ref<{ targetLabel: string }>()
let leaveContinuation: ((allow?: boolean) => void) | undefined
let menuTrigger: HTMLElement | undefined
let resizeObserver: ResizeObserver | undefined

const ROW_HEIGHT = 76

/* The four workflows you can start from nothing. The other two — convert and
   shift — are the toolbar controls they used to duplicate, which is why they
   still carry `data-subtitle-workflow`: deep links focus them by that. */
const entryWorkflows = subtitleWorkflowActions.filter((action) => !action.requiresCues)
const importFormatOptions = [
  { id: 'srt', label: 'SRT' },
  { id: 'vtt', label: 'WebVTT' },
]
const filteredCueIndexes = computed(() => subtitleCueIndexes(cues.value, query.value))
const listWindow = computed(() => fixedRowVirtualWindow(filteredCueIndexes.value.length, scrollTop.value, listHeight.value, ROW_HEIGHT, 7))
const renderedCueRows = computed(() => filteredCueIndexes.value.slice(listWindow.value.start, listWindow.value.end).map(index => ({ cue: cues.value[index], ordinal: index + 1 })))
const activeCue = computed(() => cues.value.find(cue => cue.id === activeId.value))
const qualityReport = computed(() => analyzeSubtitleQuality(cues.value))
const qualityIssueCount = computed(() => qualityReport.value.overlapCount + qualityReport.value.cpsViolationCount + qualityReport.value.lineLengthViolationCount + qualityReport.value.shortDurationCount + qualityReport.value.duplicateCount)

/* One right-hand slot with two possible occupants. Transcription used to be a
   collapsible card wedged above the timeline, so opening it pushed the
   subtitles you were checking off the screen. Written as whole class strings
   because UnoCSS extracts them statically. */
const workspaceColumns = computed(() => transcriptionOpen.value || activeCue.value
  ? 'grid-cols-[minmax(0,1fr)_minmax(300px,340px)]'
  : 'grid-cols-1')
const transcriptionBoundary = computed(() => [
  { label: '模型', value: shortPath(store.settings.transcriptionModelPath), title: store.settings.transcriptionModelPath },
  { label: '语言', value: store.settings.transcriptionLanguage === 'auto' ? '自动检测' : store.settings.transcriptionLanguage.toUpperCase(), title: '' },
  { label: '输出', value: store.settings.outputDirectory ? shortPath(store.settings.outputDirectory) : '开始时选择', title: store.settings.outputDirectory ?? '' },
])
const totalDuration = computed(() => cues.value.at(-1)?.endMs ?? 0)
const sourceBaseName = computed(() => sourceName.value.replace(/\.(srt|vtt)$/i, '') || '未命名字幕')
const byteLabel = computed(() => `${new Blob([serializeSubtitle(cues.value, sourceFormat.value)]).size.toLocaleString()} B`)
const sourceDraftBytes = computed(() => new Blob([sourceDraft.value]).size)
const transcriptionConfigured = computed(() => Boolean(store.settings.transcriptionExecutablePath && store.settings.transcriptionModelPath))
const shortPath = (value: string) => value.length > 68 ? `…${value.slice(-67)}` : value

function selectCue(cue: SubtitleCue) {
  if (activeId.value && activeId.value !== cue.id && !applyActiveEdit()) return false
  activeId.value = cue.id
  editStart.value = formatSubtitleTimestamp(cue.startMs, sourceFormat.value)
  editEnd.value = formatSubtitleTimestamp(cue.endMs, sourceFormat.value)
  editText.value = cue.text
  editError.value = ''
  return true
}

function applyActiveEdit(showFeedback = false) {
  const cue = activeCue.value
  if (!cue) return true
  const startMs = parseSubtitleTimestamp(editStart.value)
  const endMs = parseSubtitleTimestamp(editEnd.value)
  const text = editText.value.trim()
  if (startMs === undefined || endMs === undefined) {
    editError.value = '时间格式应为 00:00:01,500 或 00:00:01.500。'
    return false
  }
  if (endMs <= startMs) {
    editError.value = '结束时间必须晚于开始时间。'
    return false
  }
  if (!text) {
    editError.value = '字幕正文不能为空。'
    return false
  }
  editError.value = ''
  if (cue.startMs === startMs && cue.endMs === endMs && cue.text === text) return true
  cues.value = cues.value.map(item => item.id === cue.id ? { ...item, startMs, endMs, text } : item)
  dirty.value = true
  if (showFeedback) ui.toast('字幕已更新', `第 ${cues.value.findIndex(item => item.id === cue.id) + 1} 条`, 'success')
  return true
}

function loadParsed(source: string, filename: string) {
  const result = parseSubtitle(source, filename)
  if (!result.cues.length) {
    ui.toast('没有找到可用字幕', '请确认内容包含“开始时间 --> 结束时间”和字幕正文。', 'error')
    return false
  }
  cues.value = result.cues.map(cue => ({ ...cue, id: newId() }))
  sourceName.value = filename || `未命名字幕.${result.format}`
  sourceFormat.value = result.format
  importFormat.value = result.format
  warnings.value = result.warnings
  query.value = ''
  scrollTop.value = 0
  dirty.value = false
  selectCue(cues.value[0])
  ui.toast(`已载入 ${cues.value.length} 条字幕`, result.warnings[0] || sourceName.value, result.warnings.length ? 'warning' : 'success')
  return true
}

async function confirmReplacement() {
  if (!dirty.value) return true
  return ui.confirm({ title: '替换当前未导出的字幕？', message: '当前时间轴还有修改。继续导入会放弃这些修改。', confirmLabel: '放弃并导入', danger: true })
}

async function importFile(event: Event) {
  const input = event.currentTarget as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file || !await confirmReplacement()) return
  if (file.size > MAX_SUBTITLE_BYTES) {
    ui.toast('字幕文件过大', '单个 SRT / VTT 最多 5 MB；请先拆分超长字幕。', 'error')
    return
  }
  try { loadParsed(await file.text(), file.name) }
  catch (error) { ui.toast('无法读取字幕', error instanceof Error ? error.message : '文件读取失败。', 'error') }
}

async function parseDraft() {
  if (!sourceDraft.value.trim() || !await confirmReplacement()) return
  if (new Blob([sourceDraft.value]).size > MAX_SUBTITLE_BYTES) {
    ui.toast('粘贴内容过大', '字幕草稿最多 5 MB。', 'error')
    return
  }
  if (loadParsed(sourceDraft.value, `粘贴字幕.${importFormat.value}`)) {
    sourceDraft.value = ''
    sourceDraftOpen.value = false
  }
}

function focusWorkflowButton(id: SubtitleWorkflowId) {
  void nextTick(() => document.querySelector<HTMLButtonElement>(`[data-subtitle-workflow="${id}"]`)?.focus({ preventScroll: true }))
}

async function setTranscriptionOpen(open: boolean, syncRoute = true) {
  transcriptionOpen.value = open
  if (open) {
    await nextTick()
    transcriptionCardElement.value?.scrollIntoView({ behavior: 'auto', block: 'nearest' })
  }
  if (!syncRoute) return
  const query = { ...route.query }
  if (open) query.transcribe = '1'
  else delete query.transcribe
  await router.replace({ path: '/subtitles', query })
}

async function runSubtitleWorkflow(id: SubtitleWorkflowId, fromRoute = false) {
  if (id === 'import') {
    await nextTick()
    fileInput.value?.click()
    return
  }
  if (id === 'paste') {
    sourceDraftOpen.value = true
    await nextTick()
    sourceDraftElement.value?.focus({ preventScroll: true })
    sourceDraftElement.value?.scrollIntoView({ behavior: 'auto', block: 'center' })
    return
  }
  if (id === 'transcribe') {
    await setTranscriptionOpen(true, !fromRoute)
    return
  }
  if (id === 'create') {
    await createBlank()
    return
  }
  if (!cues.value.length) {
    focusWorkflowButton(id)
    ui.toast(id === 'convert' ? '请先载入字幕再转换' : '请先载入字幕再校准', '可以打开 SRT / VTT、粘贴源码，或从本地媒体转写。', 'info')
    return
  }
  if (id === 'convert') {
    convertButtonElement.value?.scrollIntoView({ behavior: 'auto', block: 'center' })
    convertButtonElement.value?.focus({ preventScroll: true })
    if (!fromRoute) await exportAs(sourceFormat.value === 'srt' ? 'vtt' : 'srt')
    return
  }
  shiftInputElement.value?.scrollIntoView({ behavior: 'auto', block: 'center' })
  shiftInputElement.value?.focus({ preventScroll: true })
  shiftInputElement.value?.select()
}

async function pickTranscriptionMedia() {
  if (!desktop || transcribing.value) return
  const path = await open({
    title: '选择要在本机转写的媒体',
    multiple: false,
    filters: [{ name: '音频与视频', extensions: ['mp4', 'm4v', 'mov', 'mkv', 'webm', 'avi', 'mp3', 'm4a', 'aac', 'wav', 'flac', 'ogg', 'opus'] }]
  })
  if (typeof path !== 'string') return
  try {
    transcriptionMedia.value = await inspectDesktopInputFile(path)
    transcriptionError.value = ''
    transcriptionOutput.value = ''
  } catch (error) { transcriptionError.value = error instanceof Error ? error.message : '无法读取所选媒体。' }
}

async function startTranscription() {
  if (!desktop || transcribing.value) return
  if (!transcriptionConfigured.value) { transcriptionError.value = '请先在“设置 → 本机引擎”中选择并验证 Whisper CLI 与模型。'; return }
  if (!transcriptionMedia.value) { transcriptionError.value = '请先选择要转写的本地音频或视频。'; return }
  if (!await confirmReplacement()) return
  let outputDirectory = store.settings.outputDirectory
  if (!outputDirectory) {
    outputDirectory = await chooseOutputDirectory() || ''
    if (!outputDirectory) return
    store.updateSettings({ outputDirectory })
  }
  const confirmed = await ui.confirm({
    title: '开始本机语音转写？',
    message: `媒体：${transcriptionMedia.value.name}\n模型：${store.settings.transcriptionModelPath.split(/[\\/]/).at(-1)}\n输出：${outputDirectory}\n\n只会在本机启动你选择的 CLI 与 FFmpeg，不会上传媒体。`,
    confirmLabel: '开始本机转写'
  })
  if (!confirmed) return
  const runId = newId()
  const job = store.addJob('media', '字幕 · 本机语音转写', [transcriptionMedia.value.name], {
    toolId: 'local-transcription', route: '/subtitles?transcribe=1', retryable: true,
    parameters: { engine: 'whisper-cpp', runId, language: store.settings.transcriptionLanguage },
    inputs: [{ name: transcriptionMedia.value.name, path: transcriptionMedia.value.path, size: transcriptionMedia.value.size }]
  })
  transcriptionRunId.value = runId
  transcriptionJobId.value = job.id
  transcribing.value = true
  transcriptionProgress.value = 2
  transcriptionDetail.value = '正在建立本机转写任务…'
  transcriptionError.value = ''
  transcriptionOutput.value = ''
  store.updateJob(job.id, { status: 'running', progress: 2, detail: transcriptionDetail.value })
  try {
    const output = await transcribeDesktopMedia({
      executablePath: store.settings.transcriptionExecutablePath,
      modelPath: store.settings.transcriptionModelPath,
      inputPath: transcriptionMedia.value.path,
      outputDir: outputDirectory,
      runId,
      language: store.settings.transcriptionLanguage,
    })
    const file = await readDesktopInputFile(output.path)
    if (!loadParsed(await file.text(), output.name)) throw new Error('已生成 SRT，但其中没有可编辑的字幕条目。')
    transcriptionOutput.value = output.path
    transcriptionProgress.value = 100
    transcriptionDetail.value = '转写完成，字幕已载入校对台。'
    store.updateJob(job.id, { status: 'succeeded', progress: 100, detail: `${cues.value.length} 条字幕已载入校对台。`, outputNames: [output.name], outputs: [{ name: output.name, path: output.path, size: output.size, mime: 'application/x-subrip' }] })
    ui.toast('本机转写完成', `${cues.value.length} 条字幕已载入`, 'success', '打开位置', () => void revealDesktopFile(output.path))
  } catch (error) {
    const message = error instanceof Error ? error.message : '本机转写失败。'
    const cancelled = message.includes('停止') || message.includes('取消')
    transcriptionError.value = message
    store.updateJob(job.id, { status: cancelled ? 'cancelled' : 'failed', progress: transcriptionProgress.value, errorCode: cancelled ? undefined : 'TRANSCRIPTION_FAILED', detail: message })
  } finally {
    if (transcriptionRunId.value === runId) { transcribing.value = false; transcriptionRunId.value = '' }
  }
}

async function stopTranscription() {
  if (!transcriptionRunId.value) return
  transcriptionDetail.value = '正在停止并清理临时音轨与字幕草稿…'
  if (transcriptionJobId.value) store.updateJob(transcriptionJobId.value, { errorCode: 'MEDIA_CANCEL_REQUESTED', detail: transcriptionDetail.value })
  try { await cancelDesktopTranscription(transcriptionRunId.value) }
  catch (error) { transcriptionError.value = error instanceof Error ? error.message : '停止请求未送达。' }
}

function openMediaMenu(event: MouseEvent | KeyboardEvent) {
  if (!transcriptionMedia.value) return
  event.preventDefault(); event.stopPropagation()
  mediaMenuTrigger = event.currentTarget instanceof HTMLElement ? event.currentTarget : undefined
  const bounds = mediaMenuTrigger?.getBoundingClientRect()
  const x = event instanceof MouseEvent ? event.clientX : (bounds?.right ?? 320) - 20
  const y = event instanceof MouseEvent ? event.clientY : (bounds?.top ?? 180) + 22
  mediaMenu.value = clampMenuPosition(x, y, { menuWidth: 238, menuHeight: 156, margin: 12 })
  void nextTick(() => mediaMenuElement.value?.querySelector<HTMLButtonElement>('[role=menuitem]')?.focus())
}
function openMediaMenuFromKeyboard(event: KeyboardEvent) { if (isContextMenuShortcut(event)) openMediaMenu(event) }
function closeMediaMenu(restore = false) { mediaMenu.value = null; if (restore) void nextTick(() => mediaMenuTrigger?.focus({ preventScroll: true })) }
function handleMediaMenuKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') { event.preventDefault(); closeMediaMenu(true); return }
  const items = [...(mediaMenuElement.value?.querySelectorAll<HTMLButtonElement>('[role=menuitem]:not(:disabled)') ?? [])]
  const index = nextMenuItemIndex(event.key, items.indexOf(document.activeElement as HTMLButtonElement), items.length)
  if (index === undefined) return
  event.preventDefault(); items[index]?.focus({ preventScroll: true })
}
function clearTranscriptionMedia() { transcriptionMedia.value = undefined; transcriptionOutput.value = ''; transcriptionError.value = ''; closeMediaMenu() }

async function createBlank() {
  if (cues.value.length) {
    const approved = await ui.confirm({
      title: '新建空白字幕？',
      message: dirty.value ? '当前时间轴有未导出的修改。新建会放弃这些修改。' : `当前已载入 ${cues.value.length.toLocaleString()} 条字幕。新建不会删除原文件，但会替换当前工作区。`,
      confirmLabel: '新建空白字幕',
      danger: dirty.value,
    })
    if (!approved) return false
  }
  const cue = { id: newId(), startMs: 0, endMs: 2000, text: '在这里输入第一条字幕' }
  cues.value = [cue]
  sourceName.value = `未命名字幕.${sourceFormat.value}`
  warnings.value = []
  dirty.value = true
  selectCue(cue)
  return true
}

function shiftAll(direction: -1 | 1) {
  const amount = Math.max(1, Math.min(3_600_000, Math.round(Math.abs(Number(shiftMs.value) || 0)))) * direction
  cues.value = shiftSubtitleCues(cues.value, amount)
  dirty.value = true
  if (activeCue.value) selectCue(activeCue.value)
  ui.toast('时间轴已整体平移', `${amount > 0 ? '+' : ''}${amount} ms`, 'success')
}

function insertAfter(cue: SubtitleCue) {
  const index = cues.value.findIndex(item => item.id === cue.id)
  const startMs = cue.endMs
  const next = cues.value[index + 1]
  const endMs = Math.max(startMs + 500, next ? Math.min(next.startMs, startMs + 2000) : startMs + 2000)
  const inserted = { id: newId(), startMs, endMs, text: '新字幕' }
  cues.value = [...cues.value.slice(0, index + 1), inserted, ...cues.value.slice(index + 1)]
  dirty.value = true
  closeMenu()
  selectCue(inserted)
}

function splitCue(cue: SubtitleCue) {
  const index = cues.value.findIndex(item => item.id === cue.id)
  const split = splitSubtitleCue(cue, newId())
  if (!split) { ui.toast('无法拆分这条字幕', '正文至少需要两个字符，持续时间至少需要 200 ms。', 'info'); return }
  cues.value = [...cues.value.slice(0, index), ...split, ...cues.value.slice(index + 1)]
  dirty.value = true
  closeMenu()
  selectCue(split[0])
}

function mergeNext(cue: SubtitleCue) {
  const index = cues.value.findIndex(item => item.id === cue.id)
  const next = cues.value[index + 1]
  if (!next) return
  const merged = mergeSubtitleCues(cue, next)
  cues.value = [...cues.value.slice(0, index), merged, ...cues.value.slice(index + 2)]
  dirty.value = true
  closeMenu()
  selectCue(merged)
}

function deleteCue(cue: SubtitleCue) {
  const index = cues.value.findIndex(item => item.id === cue.id)
  cues.value = cues.value.filter(item => item.id !== cue.id)
  dirty.value = true
  closeMenu()
  const next = cues.value[Math.min(index, cues.value.length - 1)]
  if (next) selectCue(next)
  else activeId.value = ''
}

async function copyCue(cue: SubtitleCue) {
  try { await navigator.clipboard.writeText(cue.text); ui.toast('已复制字幕正文', undefined, 'success') }
  catch (error) { ui.toast('复制失败', error instanceof Error ? error.message : '剪贴板不可用。', 'error') }
  closeMenu(true)
}

function openMenu(event: MouseEvent | KeyboardEvent, cue: SubtitleCue) {
  event.preventDefault()
  menuTrigger = event.currentTarget instanceof HTMLElement ? event.currentTarget : undefined
  const bounds = menuTrigger?.getBoundingClientRect()
  const x = event instanceof MouseEvent ? event.clientX : (bounds?.right ?? 250) - 14
  const y = event instanceof MouseEvent ? event.clientY : (bounds?.top ?? 120) + 18
  menu.value = { cue, ...clampMenuPosition(x, y, { menuWidth: 230, menuHeight: 208, margin: 12 }) }
  void nextTick(() => menuElement.value?.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')?.focus())
}

function handleCueKeydown(event: KeyboardEvent, cue: SubtitleCue, filteredPosition: number) {
  if (isContextMenuShortcut(event)) { openMenu(event, cue); return }
  const last = filteredCueIndexes.value.length - 1
  let target: number | undefined
  if (event.key === 'ArrowUp') target = Math.max(0, filteredPosition - 1)
  else if (event.key === 'ArrowDown') target = Math.min(last, filteredPosition + 1)
  else if (event.key === 'PageUp') target = Math.max(0, filteredPosition - Math.max(1, Math.floor(listHeight.value / ROW_HEIGHT) - 1))
  else if (event.key === 'PageDown') target = Math.min(last, filteredPosition + Math.max(1, Math.floor(listHeight.value / ROW_HEIGHT) - 1))
  else if (event.key === 'Home') target = 0
  else if (event.key === 'End') target = last
  if (target === undefined || target === filteredPosition || target < 0) return
  event.preventDefault()
  const cueIndex = filteredCueIndexes.value[target]
  const nextCue = cues.value[cueIndex]
  if (!nextCue || !selectCue(nextCue)) return
  const top = Math.max(0, target * ROW_HEIGHT - Math.max(0, listHeight.value - ROW_HEIGHT) / 2)
  listElement.value?.scrollTo({ top, behavior: 'auto' })
  scrollTop.value = top
  void nextTick(() => listElement.value?.querySelector<HTMLButtonElement>(`[data-cue-id="${CSS.escape(nextCue.id)}"]`)?.focus({ preventScroll: true }))
}

function closeMenu(restoreFocus = false) {
  menu.value = null
  if (restoreFocus) void nextTick(() => menuTrigger?.focus({ preventScroll: true }))
}

function handleMenuKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') { event.preventDefault(); closeMenu(true); return }
  const items = [...(menuElement.value?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? [])]
  const next = nextMenuItemIndex(event.key, items.indexOf(document.activeElement as HTMLButtonElement), items.length)
  if (next === undefined) return
  event.preventDefault()
  items[next]?.focus({ preventScroll: true })
}

async function exportAs(format: SubtitleFormat) {
  if (!cues.value.length || exporting.value || !applyActiveEdit()) return false
  exporting.value = true
  try {
    let outputDirectory = store.settings.outputDirectory
    if (isDesktop() && !outputDirectory) {
      outputDirectory = await chooseOutputDirectory() || ''
      if (!outputDirectory) return false
      store.updateSettings({ outputDirectory })
    }
    const filename = `${sourceBaseName.value}.${format}`
    const content = serializeSubtitle(cues.value, format)
    const output = await exportOutput(outputDirectory, filename, content, format === 'vtt' ? 'text/vtt;charset=utf-8' : 'application/x-subrip;charset=utf-8')
    const task = store.addJob('text', `字幕 · 导出 ${format.toUpperCase()}`, [sourceName.value], { toolId: 'subtitle-editor', route: '/subtitles', retryable: true })
    store.updateJob(task.id, { status: 'succeeded', progress: 100, outputNames: [output.name], outputs: [output], detail: `已导出 ${cues.value.length} 条字幕。` })
    sourceFormat.value = format
    sourceName.value = filename
    dirty.value = false
    ui.toast(`已导出 ${format.toUpperCase()}`, `${cues.value.length} 条 · ${output.name}`, 'success', output.path ? '打开位置' : undefined, output.path ? () => void revealDesktopFile(output.path!) : undefined)
    return true
  } catch (error) {
    ui.toast('字幕导出失败', error instanceof Error ? error.message : '无法写入输出文件。', 'error')
    return false
  } finally { exporting.value = false }
}

function updateListHeight() { listHeight.value = Math.max(1, listElement.value?.clientHeight ?? 460) }
function beforeUnload(event: BeforeUnloadEvent) { if (dirty.value) event.preventDefault() }

onBeforeRouteLeave((to, _from, next) => {
  if (!dirty.value) { next(); return }
  leaveContinuation = next
  leavePrompt.value = { targetLabel: `前往“${String(to.meta.title || '其他页面')}”` }
})

async function resolveLeave(decision: UnsavedDocumentDecision) {
  const next = leaveContinuation
  leaveContinuation = undefined
  leavePrompt.value = undefined
  if (!next) return
  if (decision === 'stay') { next(false); return }
  if (decision === 'discard') { dirty.value = false; next(); return }
  if (await exportAs(sourceFormat.value)) next()
  else next(false)
}

watch(sourceFormat, () => { const cue = activeCue.value; if (cue) selectCue(cue) })
watch(() => route.query.transcribe, (value) => {
  if (value === '1') void setTranscriptionOpen(true, false)
  else if (!transcribing.value) transcriptionOpen.value = false
}, { immediate: true })
watch(() => route.query.action, async (value) => {
  const action = subtitleWorkflowId(value)
  if (!action) return
  await runSubtitleWorkflow(action, true)
  const query = { ...route.query }
  delete query.action
  await router.replace({ path: '/subtitles', query })
}, { immediate: true })
onMounted(() => {
  window.addEventListener('beforeunload', beforeUnload)
  void nextTick(() => {
    updateListHeight()
    if (listElement.value) { resizeObserver = new ResizeObserver(updateListHeight); resizeObserver.observe(listElement.value) }
  })
  void listenDesktopEvent<TranscriptionProgress>('toolknit://transcription-progress', payload => {
    if (payload.runId !== transcriptionRunId.value) return
    transcriptionProgress.value = payload.progress
    transcriptionDetail.value = payload.detail
    if (transcriptionJobId.value) store.updateJob(transcriptionJobId.value, { status: 'running', progress: payload.progress, detail: payload.detail })
  }).then(unlisten => { stopTranscriptionListener = unlisten })
})
onBeforeUnmount(() => { window.removeEventListener('beforeunload', beforeUnload); resizeObserver?.disconnect(); stopTranscriptionListener?.(); if (transcriptionRunId.value) void cancelDesktopTranscription(transcriptionRunId.value) })
</script>

<template>
  <!-- No `subtitle-studio` / `subtitle-workflows` / `subtitle-workspace`
       classes: the scoped block that styled them capped the timeline at a
       hard 570px and put three stacked cards above it. -->
  <div class="page-enter h-full mx-auto w-full max-w-320 px-8 py-6" @pointerdown="closeMenu(); closeMediaMenu()">
    <PageHeader
      title="字幕校对台"
      :subtitle="cues.length ? '逐条校对时间轴；导出前不写入 Vault' : '导入 SRT / WebVTT 逐条校对，或用本机 Whisper 先转写'"
    >
      <template #actions>
        <button class="btn-default" data-subtitle-workflow="import" @click="fileInput?.click()">
          <AppIcon name="folder-open" :size="15" />{{ cues.length ? '重新导入' : '打开字幕' }}
        </button>
        <button v-if="cues.length" class="btn-primary" :disabled="exporting" @click="exportAs(sourceFormat)">
          <AppIcon name="download" :size="15" />{{ exporting ? '正在导出…' : `导出 ${sourceFormat.toUpperCase()}` }}
        </button>
      </template>
    </PageHeader>

    <section class="flex-1 min-h-0 stack panel overflow-hidden">
      <!-- The toolbar only exists once there is a timeline to act on. Six
           "quick task" cards used to sit above the page whether or not any of
           them could do anything; four of them are now the empty state and
           two are these controls. -->
      <div v-if="cues.length" class="row flex-wrap gap-x-4 gap-y-2 shrink-0 px-3 py-2 border-b border-line">
        <span class="row gap-2 min-w-0 shrink-0 max-w-64">
          <AppIcon name="file-text" :size="15" class="shrink-0 text-fg-3" />
          <span class="stack gap-0.5 min-w-0">
            <b class="text-[12px] font-medium truncate text-fg">{{ sourceName }}</b>
            <small class="text-[11px]" :class="dirty ? 'text-warn' : 'text-fg-3'">{{ dirty ? '有未导出修改' : `${sourceFormat.toUpperCase()} · 本地就绪` }}</small>
          </span>
        </span>

        <label class="row gap-1.5 min-w-40 flex-1 max-w-72 h-8 px-2.5 rounded-sm bg-well border border-line focus-within:border-accent">
          <AppIcon name="search" :size="14" class="shrink-0 text-fg-3" />
          <input v-model="query" type="search" class="min-w-0 flex-1 bg-transparent border-0 text-[12px] text-fg focus:outline-none" placeholder="搜索字幕正文" aria-label="搜索字幕正文" />
          <button v-if="query" class="center w-5 h-5 shrink-0 rounded-sm text-fg-3 hover:text-fg" aria-label="清除搜索" @click="query = ''"><AppIcon name="close" :size="12" /></button>
        </label>

        <span class="row gap-1 shrink-0">
          <span class="text-[11px] font-semibold text-fg-3">整体平移</span>
          <button class="center w-7 h-7 rounded-sm border border-line text-fg-2 hover:border-line-strong hover:text-fg" title="向前平移" aria-label="向前平移" @click="shiftAll(-1)">−</button>
          <input
            ref="shiftInputElement"
            v-model.number="shiftMs"
            data-subtitle-workflow="shift"
            type="number"
            min="1"
            max="3600000"
            class="field h-7 w-20 px-2 text-[12px] tabular-nums"
            aria-label="平移毫秒数"
          />
          <span class="text-[11px] text-fg-3">ms</span>
          <button class="center w-7 h-7 rounded-sm border border-line text-fg-2 hover:border-line-strong hover:text-fg" title="向后平移" aria-label="向后平移" @click="shiftAll(1)">+</button>
        </span>

        <span class="row gap-1 ml-auto shrink-0">
          <button class="btn-tool" :class="transcriptionOpen ? 'btn-tool-active' : ''" data-subtitle-workflow="transcribe" :aria-expanded="transcriptionOpen" @click="setTranscriptionOpen(!transcriptionOpen)">
            <AppIcon name="play" :size="14" />本机转写
          </button>
          <button class="btn-tool" data-subtitle-workflow="paste" @click="runSubtitleWorkflow('paste')"><AppIcon name="clipboard" :size="14" />粘贴源码</button>
          <button ref="convertButtonElement" class="btn-tool" data-subtitle-workflow="convert" :disabled="exporting" @click="exportAs(sourceFormat === 'srt' ? 'vtt' : 'srt')">
            转为 {{ sourceFormat === 'srt' ? 'VTT' : 'SRT' }}
          </button>
        </span>
      </div>

      <p v-if="warnings.length" class="row gap-2 shrink-0 px-3 py-2 border-b border-line bg-warn-soft text-[11px] leading-relaxed text-warn" role="status">
        <AppIcon name="warning" :size="14" class="shrink-0 mt-0.5" />
        <span class="min-w-0 flex-1">{{ warnings.join(' ') }}</span>
        <button class="shrink-0 font-medium underline underline-offset-2" @click="warnings = []">知道了</button>
      </p>

      <details v-if="cues.length" class="shrink-0 border-b border-line bg-surface-2 text-[11px]">
        <summary class="row-between gap-3 px-3 py-2 cursor-pointer select-none list-none">
          <span class="row gap-2 min-w-0">
            <AppIcon name="shield" :size="14" class="shrink-0" :class="qualityIssueCount ? 'text-warn' : 'text-success'" />
            <b class="font-medium text-fg">字幕质量检查</b>
            <span class="text-fg-3">{{ qualityIssueCount ? `${qualityIssueCount} 项待检查` : '未发现明显问题' }}</span>
          </span>
          <span class="row gap-2 shrink-0 tabular-nums text-fg-3">
            <span>峰值 {{ qualityReport.maxCps }} CPS</span>
            <span>最长 {{ qualityReport.maxLineLength }} 字</span>
          </span>
        </summary>
        <div class="grid grid-cols-2 gap-px mx-3 mb-2 rounded-sm overflow-hidden border border-line bg-line">
          <span class="row-between gap-2 px-2 py-1.5 bg-surface"><span>重叠</span><b :class="qualityReport.overlapCount ? 'text-warn' : 'text-fg-3'">{{ qualityReport.overlapCount }}</b></span>
          <span class="row-between gap-2 px-2 py-1.5 bg-surface"><span>超速 CPS</span><b :class="qualityReport.cpsViolationCount ? 'text-warn' : 'text-fg-3'">{{ qualityReport.cpsViolationCount }}</b></span>
          <span class="row-between gap-2 px-2 py-1.5 bg-surface"><span>过长一行</span><b :class="qualityReport.lineLengthViolationCount ? 'text-warn' : 'text-fg-3'">{{ qualityReport.lineLengthViolationCount }}</b></span>
          <span class="row-between gap-2 px-2 py-1.5 bg-surface"><span>过短时长</span><b :class="qualityReport.shortDurationCount ? 'text-warn' : 'text-fg-3'">{{ qualityReport.shortDurationCount }}</b></span>
          <span class="row-between gap-2 px-2 py-1.5 bg-surface"><span>重复正文</span><b :class="qualityReport.duplicateCount ? 'text-warn' : 'text-fg-3'">{{ qualityReport.duplicateCount }}</b></span>
          <span class="row-between gap-2 px-2 py-1.5 bg-surface text-fg-3">提示仅供校对参考，不会自动改写</span>
        </div>
        <ul v-if="qualityReport.issues.length" class="stack gap-1 px-3 pb-2 text-fg-2">
          <li v-for="issue in qualityReport.issues.slice(0, 5)" :key="`${issue.cueId}-${issue.kind}`" class="row gap-1.5"><span class="w-1 h-1 shrink-0 rounded-full bg-warn" />{{ issue.message }}</li>
          <li v-if="qualityReport.issues.length > 5" class="text-fg-3">还有 {{ qualityReport.issues.length - 5 }} 项，已省略列表展示。</li>
        </ul>
      </details>

      <div class="flex-1 min-h-0 grid" :class="workspaceColumns">
        <!-- Pasting is a mode, not a card stacked above the timeline: while
             you are pasting, the source *is* the work surface. -->
        <section v-if="sourceDraftOpen" class="stack min-h-0" aria-label="粘贴字幕源码">
          <header class="row-between gap-2 shrink-0 px-3 h-9 border-b border-line">
            <span class="text-[11px] font-semibold text-fg-3">粘贴字幕源码</span>
            <button class="btn-tool" @click="sourceDraftOpen = false">收起</button>
          </header>
          <textarea
            ref="sourceDraftElement"
            v-model="sourceDraft"
            class="flex-1 min-h-0 px-3 py-2.5 bg-well border-0 font-mono text-[12px] leading-relaxed text-fg resize-none focus:outline-none"
            spellcheck="false"
            aria-label="字幕源码"
            placeholder="1&#10;00:00:01,000 --> 00:00:03,500&#10;在这里粘贴字幕…"
          />
          <footer class="row-between gap-3 shrink-0 px-3 h-11 border-t border-line">
            <span class="row gap-2 min-w-0">
              <SegmentedControl
                :options="importFormatOptions"
                :model-value="importFormat"
                label="粘贴字幕格式"
                size="compact"
                @update:model-value="importFormat = $event as 'srt' | 'vtt'"
              />
              <small class="text-[11px] tabular-nums" :class="sourceDraftBytes > MAX_SUBTITLE_BYTES ? 'text-danger' : 'text-fg-3'">
                {{ sourceDraftBytes.toLocaleString() }} / {{ MAX_SUBTITLE_BYTES.toLocaleString() }} B
              </small>
            </span>
            <button class="btn-primary btn-sm shrink-0" :disabled="!sourceDraft.trim()" @click="parseDraft">解析并载入</button>
          </footer>
        </section>

        <!-- Nothing loaded: the four entry workflows, in the place where the
             timeline will appear, instead of a grid of cards above it. -->
        <section v-else-if="!cues.length" class="center min-h-0 p-6" aria-label="开始校对字幕">
          <div class="stack items-center gap-4 w-full max-w-140 text-center">
            <span class="center w-12 h-12 rounded-lg bg-accent-soft text-accent"><AppIcon name="file-text" :size="24" /></span>
            <div class="stack gap-1.5">
              <strong class="text-[15px] font-semibold text-fg">导入字幕，或直接粘贴时间轴</strong>
              <p class="text-[12px] leading-relaxed text-fg-3">单个文件最多 5 MB、20,000 条字幕。只在浏览器内存中解析，导出前不会写入 Vault。</p>
            </div>
            <div class="grid grid-cols-2 gap-2 w-full">
              <button
                v-for="action in entryWorkflows"
                :key="action.id"
                type="button"
                :data-subtitle-workflow="action.id"
                class="row gap-2.5 px-3 py-2.5 rounded-sm border border-line bg-well text-left transition-colors duration-120 hover:border-accent hover:bg-accent-soft"
                @click="runSubtitleWorkflow(action.id)"
              >
                <span class="center w-8 h-8 shrink-0 rounded-sm bg-surface border border-line text-accent"><AppIcon :name="action.icon" :size="16" /></span>
                <span class="stack gap-0.5 min-w-0">
                  <b class="text-[12px] font-medium truncate text-fg">{{ action.label }}</b>
                  <small class="text-[11px] truncate text-fg-3">{{ action.detail }}</small>
                </span>
              </button>
            </div>
          </div>
        </section>

        <!-- The timeline. It takes what is left of the window rather than a
             hard 570px, so a long subtitle file shows twice as many lines on
             a normal screen. -->
        <main v-else class="stack min-h-0" aria-label="时间轴">
          <header class="row-between gap-2 shrink-0 px-3 h-9 border-b border-line">
            <span class="row gap-2 text-[11px]">
              <b class="font-semibold text-fg-3">{{ query ? '搜索结果' : '全部字幕' }}</b>
              <span class="tabular-nums text-fg-2">{{ query ? filteredCueIndexes.length : cues.length }}</span>
            </span>
            <small class="text-[11px] text-fg-3">↑ ↓ / PgUp PgDn 定位 · 右键编辑结构</small>
          </header>
          <!-- Windowed: row height is `ROW_HEIGHT`, so `h-19` and that
               constant have to stay in step. -->
          <div
            ref="listElement"
            class="flex-1 min-h-0 overflow-y-auto bg-well"
            role="listbox"
            aria-label="字幕时间轴"
            @scroll.passive="scrollTop = ($event.currentTarget as HTMLElement).scrollTop"
          >
            <div :style="{ height: `${listWindow.before}px` }" aria-hidden="true" />
            <button
              v-for="(row, renderedIndex) in renderedCueRows"
              :key="row.cue.id"
              v-memo="[row.cue.id, row.cue.startMs, row.cue.endMs, row.cue.text, activeId === row.cue.id]"
              :data-cue-id="row.cue.id"
              class="row gap-3 w-full h-19 px-3 text-left border-b border-line border-l-2 transition-colors duration-120"
              :class="activeId === row.cue.id ? 'border-l-accent bg-accent-soft' : 'border-l-transparent hover:bg-surface-2'"
              role="option"
              :aria-selected="activeId === row.cue.id"
              aria-haspopup="menu"
              :aria-expanded="menu?.cue.id === row.cue.id"
              @click="selectCue(row.cue)"
              @contextmenu="openMenu($event, row.cue)"
              @keydown="handleCueKeydown($event, row.cue, listWindow.start + renderedIndex)"
            >
              <i class="center w-6 h-6 shrink-0 rounded-sm bg-surface-2 font-mono text-[11px] not-italic tabular-nums text-fg-3">{{ row.ordinal }}</i>
              <span class="stack gap-0.5 shrink-0 w-24 font-mono text-[11px] tabular-nums">
                <b :class="activeId === row.cue.id ? 'text-accent' : 'text-fg-2'">{{ formatSubtitleTimestamp(row.cue.startMs, sourceFormat) }}</b>
                <small class="text-fg-3">{{ formatSubtitleTimestamp(row.cue.endMs, sourceFormat) }}</small>
              </span>
              <p class="min-w-0 flex-1 text-[12px] leading-relaxed line-clamp-2" :class="activeId === row.cue.id ? 'text-fg' : 'text-fg-2'">{{ row.cue.text }}</p>
            </button>
            <div :style="{ height: `${listWindow.after}px` }" aria-hidden="true" />
            <div v-if="!filteredCueIndexes.length" class="stack items-center gap-2 py-16 text-center">
              <AppIcon name="search" :size="20" class="text-fg-3" />
              <b class="text-[12px] font-medium text-fg">没有匹配字幕</b>
              <button class="btn-tool" @click="query = ''">清除搜索</button>
            </div>
          </div>
        </main>

        <!-- ── Right column ───────────────────────────────────────────────
             One slot, two occupants. Transcription used to be a collapsible
             card wedged between the task grid and the timeline, so opening it
             pushed the subtitles you were checking off the screen. -->
        <aside v-if="transcriptionOpen" ref="transcriptionCardElement" class="stack min-h-0 border-l border-line" aria-label="本机语音转文字">
          <header class="row-between gap-2 shrink-0 px-3 h-9 border-b border-line">
            <span class="text-[11px] font-semibold text-fg-3">本机语音转文字</span>
            <button class="center w-7 h-7 rounded-sm text-fg-3 hover:bg-surface-2 hover:text-fg" aria-label="收起本机语音转文字" @click="setTranscriptionOpen(false)">
              <AppIcon name="close" :size="14" />
            </button>
          </header>
          <div class="flex-1 min-h-0 overflow-y-auto stack gap-2.5 p-3">
            <div v-if="!transcriptionConfigured" class="stack gap-2 p-2.5 rounded-sm bg-warn-soft" role="status">
              <b class="row gap-1.5 text-[12px] font-medium text-warn"><AppIcon name="warning" :size="14" />尚未配置本机转写引擎</b>
              <p class="text-[11px] leading-relaxed text-fg-2">Knitspace 不内置大模型。请先选择你自己的 CLI 与模型；选择路径本身不会执行程序。</p>
              <RouterLink class="btn-primary btn-sm self-start" to="/settings?section=engines">前往设置</RouterLink>
            </div>
            <template v-else>
              <button
                v-if="!transcriptionMedia"
                class="stack gap-1 p-3 rounded-sm border border-dashed border-line-strong bg-well text-left transition-colors duration-120 hover:not-disabled:border-accent hover:not-disabled:bg-accent-soft disabled:opacity-45"
                :disabled="transcribing"
                @click="pickTranscriptionMedia"
              >
                <b class="row gap-2 text-[12px] font-medium text-fg"><AppIcon name="folder-open" :size="15" class="text-accent" />选择本地媒体</b>
                <small class="text-[11px] leading-relaxed text-fg-3">MP4、MOV、MKV、MP3、M4A、WAV、FLAC 等</small>
              </button>
              <article
                v-else
                class="row gap-2 p-2.5 rounded-sm bg-surface-2"
                tabindex="0"
                aria-haspopup="menu"
                :aria-expanded="Boolean(mediaMenu)"
                title="右键或 Shift + F10 查看媒体操作"
                @contextmenu="openMediaMenu"
                @keydown="openMediaMenuFromKeyboard"
              >
                <AppIcon name="play" :size="15" class="shrink-0 mt-0.5 text-accent" />
                <span class="stack gap-0.5 min-w-0 flex-1">
                  <b class="text-[12px] font-medium truncate text-fg">{{ transcriptionMedia.name }}</b>
                  <small class="text-[11px] truncate font-mono text-fg-3" :title="transcriptionMedia.path">
                    {{ shortPath(transcriptionMedia.path) }} · {{ (transcriptionMedia.size / 1024 / 1024).toFixed(1) }} MB
                  </small>
                </span>
                <button class="btn-tool shrink-0" :disabled="transcribing" @click.stop="pickTranscriptionMedia">更换</button>
              </article>

              <dl class="grid gap-px rounded-sm bg-line border border-line overflow-hidden">
                <div v-for="item in transcriptionBoundary" :key="item.label" class="row-between gap-3 px-2.5 py-1.5 bg-surface">
                  <dt class="shrink-0 text-[11px] text-fg-3">{{ item.label }}</dt>
                  <dd class="min-w-0 truncate font-mono text-[11px] text-fg-2" :title="item.title">{{ item.value }}</dd>
                </div>
              </dl>

              <div v-if="transcribing" class="stack gap-2 p-2.5 rounded-sm bg-accent-soft" role="status" aria-live="polite">
                <div class="row-between gap-2">
                  <b class="min-w-0 truncate text-[12px] font-medium text-accent">{{ transcriptionDetail }}</b>
                  <span class="shrink-0 text-[12px] font-semibold tabular-nums text-accent">{{ transcriptionProgress }}%</span>
                </div>
                <progress class="w-full h-1" max="100" :value="transcriptionProgress" />
                <div class="row-between gap-2">
                  <small class="text-[11px] text-fg-2">准备音轨 → 本机识别 → 载入校对台</small>
                  <button class="btn-default btn-sm shrink-0" @click="stopTranscription">停止并清理</button>
                </div>
              </div>

              <p v-if="transcriptionError" class="row gap-2 p-2.5 rounded-sm bg-danger-soft text-[11px] leading-relaxed text-danger" role="alert">
                <AppIcon name="warning" :size="14" class="shrink-0 mt-0.5" />
                <span class="min-w-0 flex-1">{{ transcriptionError }}</span>
                <RouterLink
                  v-if="!transcriptionConfigured || transcriptionError.includes('CLI') || transcriptionError.includes('模型')"
                  to="/settings?section=engines"
                  class="shrink-0 font-medium underline underline-offset-2"
                >
                  检查设置
                </RouterLink>
              </p>

              <p v-if="transcriptionOutput && !transcribing" class="row-between gap-2 p-2.5 rounded-sm bg-success-soft text-[11px] text-success">
                <span class="row gap-1.5 min-w-0"><AppIcon name="check" :size="14" class="shrink-0" />字幕已安全写入新文件</span>
                <button class="shrink-0 font-medium underline underline-offset-2" @click="revealDesktopFile(transcriptionOutput)">打开位置</button>
              </p>
            </template>
          </div>
          <footer v-if="transcriptionConfigured && !transcribing" class="stack gap-2 shrink-0 p-3 border-t border-line">
            <button class="btn-primary btn-sm" :disabled="!transcriptionMedia" @click="startTranscription">开始本机转写</button>
            <small class="row gap-1.5 text-[11px] text-fg-3"><AppIcon name="shield" :size="13" class="shrink-0 text-success" />不会覆盖原媒体，也不会把媒体送进 WebView</small>
          </footer>
        </aside>

        <aside v-else-if="activeCue" class="stack min-h-0 border-l border-line" aria-label="字幕条编辑">
          <header class="row-between gap-2 shrink-0 px-3 h-9 border-b border-line">
            <span class="text-[11px] font-semibold text-fg-3">第 {{ cues.findIndex((cue) => cue.id === activeId) + 1 }} 条</span>
            <span class="chip h-5 px-1.5 text-[11px]" :class="dirty ? 'bg-warn-soft text-warn' : 'bg-success-soft text-success'">{{ dirty ? '未导出' : '已同步' }}</span>
          </header>
          <div class="flex-1 min-h-0 overflow-y-auto stack gap-2.5 p-3">
            <div class="row items-end gap-2">
              <label class="stack gap-1.5 min-w-0 flex-1">
                <span class="text-[12px] text-fg-3">开始时间</span>
                <input v-model="editStart" class="field h-8 font-mono text-[12px]" spellcheck="false" />
              </label>
              <span class="pb-2 text-fg-3" aria-hidden="true">→</span>
              <label class="stack gap-1.5 min-w-0 flex-1">
                <span class="text-[12px] text-fg-3">结束时间</span>
                <input v-model="editEnd" class="field h-8 font-mono text-[12px]" spellcheck="false" />
              </label>
            </div>
            <label class="stack gap-1.5">
              <span class="text-[12px] text-fg-3">字幕正文</span>
              <textarea v-model="editText" class="field-area min-h-36 text-[12px]" />
            </label>
            <p class="text-[11px] leading-relaxed" :class="editError ? 'text-danger' : 'text-fg-3'">
              {{ editError || '支持换行；导出时会保持为同一条字幕。' }}
            </p>
            <p class="text-[11px] leading-relaxed text-fg-3">拆分与合并请在左侧字幕上打开右键菜单。列表只挂载当前视口附近的行，所以长字幕也不会卡。</p>
          </div>
          <footer class="row justify-end gap-2 shrink-0 p-3 border-t border-line">
            <button class="btn-default btn-sm" @click="insertAfter(activeCue)"><AppIcon name="plus" :size="13" />在后面插入</button>
            <button class="btn-primary btn-sm" @click="applyActiveEdit(true)">应用修改</button>
          </footer>
        </aside>
      </div>
    </section>

    <input ref="fileInput" class="visually-hidden" type="file" accept=".srt,.vtt,text/vtt,application/x-subrip" @change="importFile" />

    <Teleport to="body">
      <section
        v-if="menu"
        ref="menuElement"
        class="menu-panel w-60"
        role="menu"
        :style="{ left: `${menu.x}px`, top: `${menu.y}px` }"
        @pointerdown.stop
        @click.stop
        @contextmenu.prevent
        @keydown.stop="handleMenuKeydown"
      >
        <p class="menu-title">第 {{ cues.findIndex((cue) => cue.id === menu?.cue.id) + 1 }} 条字幕</p>
        <button class="menu-item" role="menuitem" @click="splitCue(menu.cue)"><span class="row gap-2"><AppIcon name="split" :size="14" />从正文中间拆分</span></button>
        <button class="menu-item" role="menuitem" :disabled="cues.at(-1)?.id === menu.cue.id" @click="mergeNext(menu.cue)"><span class="row gap-2"><AppIcon name="merge" :size="14" />与下一条合并</span></button>
        <button class="menu-item" role="menuitem" @click="insertAfter(menu.cue)"><span class="row gap-2"><AppIcon name="plus" :size="14" />在后面插入</span></button>
        <button class="menu-item" role="menuitem" @click="copyCue(menu.cue)"><span class="row gap-2"><AppIcon name="duplicate" :size="14" />复制字幕正文</span></button>
        <i class="menu-sep" aria-hidden="true" />
        <button class="menu-item menu-item-danger" role="menuitem" @click="deleteCue(menu.cue)"><span class="row gap-2"><AppIcon name="trash" :size="14" />删除这条字幕</span></button>
      </section>

      <section
        v-if="mediaMenu && transcriptionMedia"
        ref="mediaMenuElement"
        class="menu-panel w-64"
        role="menu"
        aria-label="转写媒体操作"
        :style="{ left: `${mediaMenu.x}px`, top: `${mediaMenu.y}px` }"
        @pointerdown.stop
        @click.stop
        @contextmenu.prevent
        @keydown.stop="handleMediaMenuKeydown"
      >
        <p class="menu-title"><span class="min-w-0 truncate">{{ transcriptionMedia.name }}</span></p>
        <button class="menu-item" role="menuitem" :disabled="transcribing" @click="closeMediaMenu(); pickTranscriptionMedia()"><span class="row gap-2"><AppIcon name="folder-open" :size="14" />重新选择媒体</span></button>
        <button class="menu-item" role="menuitem" @click="closeMediaMenu(); revealDesktopFile(transcriptionMedia.path)"><span class="row gap-2"><AppIcon name="inbox" :size="14" />在资源管理器中查看</span></button>
        <button class="menu-item menu-item-danger" role="menuitem" :disabled="transcribing" @click="clearTranscriptionMedia"><span class="row gap-2"><AppIcon name="trash" :size="14" />清除所选媒体</span></button>
      </section>
    </Teleport>

    <UnsavedChangesDialog v-if="leavePrompt" :item-label="sourceName" :target-label="leavePrompt.targetLabel" item-kind="字幕" @decision="resolveLeave" />
  </div>
</template>
