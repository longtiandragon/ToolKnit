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
const filteredCueIndexes = computed(() => subtitleCueIndexes(cues.value, query.value))
const listWindow = computed(() => fixedRowVirtualWindow(filteredCueIndexes.value.length, scrollTop.value, listHeight.value, ROW_HEIGHT, 7))
const renderedCueRows = computed(() => filteredCueIndexes.value.slice(listWindow.value.start, listWindow.value.end).map(index => ({ cue: cues.value[index], ordinal: index + 1 })))
const activeCue = computed(() => cues.value.find(cue => cue.id === activeId.value))
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
  <div class="subtitle-studio page-enter mx-auto w-full max-w-320 px-8 py-6" @pointerdown="closeMenu(); closeMediaMenu()">
    <PageHeader
      title="字幕校对台"
      :subtitle="cues.length ? '本地草稿已载入,可逐条校对时间轴' : '导入 SRT / WebVTT 逐条校对,或用本机 Whisper 先转写'"
      :stats="[{ label: '字幕条', value: cues.length.toLocaleString() }]"
    />

    <section class="subtitle-workflows" aria-labelledby="subtitle-workflow-heading">
      <header><div><p class="eyebrow">快捷任务</p><h3 id="subtitle-workflow-heading">从任务开始，不必先理解整张时间轴</h3></div><p>六项常用工作流保持在同一页；字幕条目仍可右键拆分、合并与插入。</p></header>
      <nav aria-label="字幕常用任务">
        <button
          v-for="action in subtitleWorkflowActions"
          :key="action.id"
          type="button"
          :data-subtitle-workflow="action.id"
          :class="{ muted: action.requiresCues && !cues.length }"
          @click="runSubtitleWorkflow(action.id)"
        >
          <span><AppIcon :name="action.icon" :size="16" /></span>
          <div><b>{{ action.label }}</b><small>{{ action.detail }}</small></div>
          <i>{{ action.requiresCues && !cues.length ? '载入后可用' : '开始' }}</i>
        </button>
      </nav>
    </section>

    <section v-if="sourceDraftOpen" class="subtitle-source-panel panel" aria-labelledby="subtitle-source-heading">
      <header><div><p class="eyebrow">粘贴源文本</p><h3 id="subtitle-source-heading">粘贴字幕源码</h3><p>解析成功前不会替换当前时间轴；存在未导出修改时仍会再次确认。</p></div><button type="button" class="quiet-button" @click="sourceDraftOpen = false">收起</button></header>
      <textarea ref="sourceDraftElement" v-model="sourceDraft" spellcheck="false" aria-label="字幕源码" placeholder="1&#10;00:00:01,000 --> 00:00:03,500&#10;在这里粘贴字幕…" />
      <footer><div role="group" aria-label="粘贴字幕格式"><button type="button" :class="{ active: importFormat === 'srt' }" @click="importFormat = 'srt'">SRT</button><button type="button" :class="{ active: importFormat === 'vtt' }" @click="importFormat = 'vtt'">WebVTT</button></div><span>{{ sourceDraftBytes.toLocaleString() }} / {{ MAX_SUBTITLE_BYTES.toLocaleString() }} B</span><button type="button" class="primary-button" :disabled="!sourceDraft.trim()" @click="parseDraft">解析并载入</button></footer>
    </section>

    <section ref="transcriptionCardElement" class="transcription-card panel" :class="{ expanded: transcriptionOpen, running: transcribing }">
      <button type="button" class="transcription-card__toggle" :aria-expanded="transcriptionOpen" @click="setTranscriptionOpen(!transcriptionOpen)"><span><AppIcon name="play" :size="18" /></span><div><p class="eyebrow">本地语音转文字</p><b>从音频或视频生成字幕草稿</b><small>{{ transcriptionConfigured ? '本机引擎已配置 · 开始前仍会确认媒体、模型与输出位置' : '需要先选择 whisper.cpp CLI、模型，并安装 FFmpeg' }}</small></div><i>{{ transcriptionOpen ? '收起' : '展开' }}</i></button>
      <div v-if="transcriptionOpen" class="transcription-card__body">
        <div v-if="!transcriptionConfigured" class="transcription-unconfigured" role="status"><AppIcon name="warning" :size="18" /><div><b>尚未配置本机转写引擎</b><p>Knitspace 不内置大模型。请先选择你自己的 CLI 与模型；选择路径本身不会执行程序。</p></div><RouterLink class="primary-button" to="/settings?section=engines">前往设置</RouterLink></div>
        <template v-else>
          <button v-if="!transcriptionMedia" class="transcription-pick" :disabled="transcribing" @click="pickTranscriptionMedia"><AppIcon name="folder-open" :size="20" /><span><b>选择本地媒体</b><small>MP4、MOV、MKV、MP3、M4A、WAV、FLAC 等</small></span><i>选择文件 →</i></button>
          <article v-else class="transcription-media" tabindex="0" aria-haspopup="menu" :aria-expanded="Boolean(mediaMenu)" title="右键或 Shift + F10 查看媒体操作" @contextmenu="openMediaMenu" @keydown="openMediaMenuFromKeyboard"><span><AppIcon name="play" :size="19" /></span><div><b>{{ transcriptionMedia.name }}</b><small :title="transcriptionMedia.path">{{ shortPath(transcriptionMedia.path) }} · {{ (transcriptionMedia.size / 1024 / 1024).toFixed(1) }} MB</small></div><button class="quiet-button" :disabled="transcribing" @click.stop="pickTranscriptionMedia">更换</button></article>
          <div class="transcription-boundary"><span><b>模型</b><small :title="store.settings.transcriptionModelPath">{{ shortPath(store.settings.transcriptionModelPath) }}</small></span><span><b>语言</b><small>{{ store.settings.transcriptionLanguage === 'auto' ? '自动检测' : store.settings.transcriptionLanguage.toUpperCase() }}</small></span><span><b>输出</b><small :title="store.settings.outputDirectory">{{ store.settings.outputDirectory ? shortPath(store.settings.outputDirectory) : '开始时选择' }}</small></span></div>
          <div v-if="transcribing" class="transcription-running" role="status" aria-live="polite"><div><b>{{ transcriptionDetail }}</b><span>{{ transcriptionProgress }}%</span></div><progress max="100" :value="transcriptionProgress" /><footer><small>准备音轨 → 本机识别 → 载入校对台</small><button class="quiet-button" @click="stopTranscription">停止并清理</button></footer></div>
          <p v-if="transcriptionError" class="transcription-error" role="alert"><AppIcon name="warning" :size="15" /><span>{{ transcriptionError }}</span><RouterLink v-if="!transcriptionConfigured || transcriptionError.includes('CLI') || transcriptionError.includes('模型')" to="/settings?section=engines">检查设置</RouterLink></p>
          <div v-if="transcriptionOutput && !transcribing" class="transcription-output"><span><AppIcon name="check" :size="15" />字幕输出已安全写入新文件</span><button @click="revealDesktopFile(transcriptionOutput)">打开位置</button></div>
          <footer v-if="!transcribing" class="transcription-actions"><span><AppIcon name="shield" :size="14" />不会覆盖原媒体，也不会把媒体送入 WebView</span><button class="primary-button" :disabled="!transcriptionMedia" @click="startTranscription">开始本机转写</button></footer>
        </template>
      </div>
    </section>

    <section v-if="!cues.length" class="subtitle-intake panel">
      <div class="subtitle-intake__intro"><span><AppIcon name="file-text" :size="24" /></span><div><p class="eyebrow">在本机开始</p><h3>导入字幕，或直接粘贴时间轴</h3><p>单个文件最多 5 MB、20,000 条字幕。只在浏览器内存中解析；导出前不会写入 Vault。</p></div></div>
      <div class="subtitle-intake__actions"><button type="button" class="primary-button" @click="fileInput?.click()"><AppIcon name="folder-open" :size="15" />选择 SRT / VTT</button><button type="button" class="quiet-button" @click="runSubtitleWorkflow('paste')"><AppIcon name="clipboard" :size="15" />粘贴源码</button><button type="button" class="quiet-button" @click="createBlank"><AppIcon name="plus" :size="15" />新建空白</button></div>
    </section>

    <template v-else>
      <section class="subtitle-toolbar panel">
        <div class="subtitle-toolbar__file"><span><AppIcon name="file-text" :size="16" /></span><div><b>{{ sourceName }}</b><small>{{ dirty ? '有未导出修改' : `${sourceFormat.toUpperCase()} · 本地就绪` }}</small></div></div>
        <label class="subtitle-toolbar__search"><AppIcon name="search" :size="14" /><input v-model="query" type="search" placeholder="搜索字幕正文" /><button v-if="query" aria-label="清除搜索" @click="query = ''"><AppIcon name="close" :size="12" /></button></label>
        <div class="subtitle-toolbar__shift"><span>整体平移</span><button title="向前平移" @click="shiftAll(-1)">−</button><input ref="shiftInputElement" v-model.number="shiftMs" type="number" min="1" max="3600000" aria-label="平移毫秒数" /><small>ms</small><button title="向后平移" @click="shiftAll(1)">+</button></div>
        <div class="subtitle-toolbar__actions"><button class="quiet-button" @click="setTranscriptionOpen(true)"><AppIcon name="play" :size="14" />从媒体转写</button><button class="quiet-button" @click="fileInput?.click()"><AppIcon name="folder-open" :size="14" />重新导入</button><button class="primary-button" :disabled="exporting" @click="exportAs(sourceFormat)"><AppIcon name="extract" :size="14" />{{ exporting ? '正在导出…' : `导出 ${sourceFormat.toUpperCase()}` }}</button><button ref="convertButtonElement" class="quiet-button" :disabled="exporting" @click="exportAs(sourceFormat === 'srt' ? 'vtt' : 'srt')">转为 {{ sourceFormat === 'srt' ? 'VTT' : 'SRT' }}</button></div>
      </section>

      <section v-if="warnings.length" class="subtitle-warnings" role="status"><AppIcon name="warning" :size="15" /><span>{{ warnings.join(' ') }}</span><button @click="warnings = []">知道了</button></section>

      <section class="subtitle-workspace panel">
        <main>
          <header><div><p class="eyebrow">时间轴</p><h3>{{ query ? `搜索结果 ${filteredCueIndexes.length}` : `全部字幕 ${cues.length}` }}</h3></div><small>↑ ↓ / PgUp PgDn 定位 · 右键或 Shift + F10 编辑结构</small></header>
          <div ref="listElement" class="subtitle-list" role="listbox" aria-label="字幕时间轴" @scroll.passive="scrollTop = ($event.currentTarget as HTMLElement).scrollTop">
            <div :style="{ height: `${listWindow.before}px` }" aria-hidden="true" />
            <button v-for="(row, renderedIndex) in renderedCueRows" :key="row.cue.id" v-memo="[row.cue.id, row.cue.startMs, row.cue.endMs, row.cue.text, activeId === row.cue.id]" :data-cue-id="row.cue.id" role="option" :aria-selected="activeId === row.cue.id" :class="{ active: activeId === row.cue.id }" aria-haspopup="menu" :aria-expanded="menu?.cue.id === row.cue.id" @click="selectCue(row.cue)" @contextmenu="openMenu($event, row.cue)" @keydown="handleCueKeydown($event, row.cue, listWindow.start + renderedIndex)"><i>{{ row.ordinal }}</i><span><b>{{ formatSubtitleTimestamp(row.cue.startMs, sourceFormat) }}</b><small>{{ formatSubtitleTimestamp(row.cue.endMs, sourceFormat) }}</small></span><p>{{ row.cue.text }}</p></button>
            <div :style="{ height: `${listWindow.after}px` }" aria-hidden="true" />
            <div v-if="!filteredCueIndexes.length" class="subtitle-list__empty"><AppIcon name="search" :size="20" /><b>没有匹配字幕</b><button @click="query = ''">清除搜索</button></div>
          </div>
        </main>
        <aside v-if="activeCue" class="subtitle-inspector">
          <header><div><p class="eyebrow">字幕条编辑</p><h3>第 {{ cues.findIndex(cue => cue.id === activeId) + 1 }} 条</h3></div><span :class="{ dirty }">{{ dirty ? '未导出' : '已同步' }}</span></header>
          <div class="subtitle-inspector__time"><label><span>开始时间</span><input v-model="editStart" spellcheck="false" /></label><i>→</i><label><span>结束时间</span><input v-model="editEnd" spellcheck="false" /></label></div>
          <label class="subtitle-inspector__text"><span>字幕正文</span><textarea v-model="editText" /></label>
          <p class="subtitle-inspector__error" :class="{ visible: editError }">{{ editError || '支持换行；导出时会保持为同一条字幕。' }}</p>
          <div class="subtitle-inspector__buttons"><button class="quiet-button" @click="insertAfter(activeCue)"><AppIcon name="plus" :size="14" />在后面插入</button><button class="primary-button" @click="applyActiveEdit(true)">应用修改</button></div>
          <section><b>局部工作流</b><p>先校正文案，再调整时间；拆分与合并请在左侧字幕上打开右键菜单。</p><small>解析和列表渲染均有上限，长字幕只挂载当前视口附近的行。</small></section>
        </aside>
      </section>
    </template>

    <input ref="fileInput" class="visually-hidden" type="file" accept=".srt,.vtt,text/vtt,application/x-subrip" @change="importFile" />
    <section v-if="menu" ref="menuElement" class="subtitle-menu" role="menu" :style="{ left: `${menu.x}px`, top: `${menu.y}px` }" @pointerdown.stop @click.stop @contextmenu.prevent @keydown.stop="handleMenuKeydown"><p>第 {{ cues.findIndex(cue => cue.id === menu?.cue.id) + 1 }} 条字幕</p><button role="menuitem" @click="splitCue(menu.cue)"><AppIcon name="split" :size="14" />从正文中间拆分</button><button role="menuitem" :disabled="cues.at(-1)?.id === menu.cue.id" @click="mergeNext(menu.cue)"><AppIcon name="merge" :size="14" />与下一条合并</button><button role="menuitem" @click="insertAfter(menu.cue)"><AppIcon name="plus" :size="14" />在后面插入</button><button role="menuitem" @click="copyCue(menu.cue)"><AppIcon name="duplicate" :size="14" />复制字幕正文</button><button class="danger" role="menuitem" @click="deleteCue(menu.cue)"><AppIcon name="trash" :size="14" />删除这条字幕</button></section>
    <section v-if="mediaMenu && transcriptionMedia" ref="mediaMenuElement" class="subtitle-menu transcription-media-menu" role="menu" aria-label="转写媒体操作" :style="{ left: `${mediaMenu.x}px`, top: `${mediaMenu.y}px` }" @pointerdown.stop @click.stop @contextmenu.prevent @keydown.stop="handleMediaMenuKeydown"><p>{{ transcriptionMedia.name }}</p><button role="menuitem" :disabled="transcribing" @click="closeMediaMenu(); pickTranscriptionMedia()"><AppIcon name="folder-open" :size="14" />重新选择媒体</button><button role="menuitem" @click="closeMediaMenu(); revealDesktopFile(transcriptionMedia.path)"><AppIcon name="inbox" :size="14" />在资源管理器中查看</button><button role="menuitem" :disabled="transcribing" @click="clearTranscriptionMedia"><AppIcon name="trash" :size="14" />清除所选媒体</button></section>
    <UnsavedChangesDialog v-if="leavePrompt" :item-label="sourceName" :target-label="leavePrompt.targetLabel" item-kind="字幕" @decision="resolveLeave" />
  </div>
</template>

<style scoped>
.subtitle-studio{max-width:1390px;margin:0 auto;padding:28px 30px 58px;color:var(--text)}
.subtitle-studio__hero{grid-template-columns:minmax(0,1fr) 250px;overflow:hidden;box-shadow:0 20px 50px var(--accent-soft)}
.subtitle-studio__hero>div{position:relative;display:flex;align-items:flex-start;flex-direction:column;justify-content:center;padding:32px 40px;background-size:27px 27px}.subtitle-studio__hero>div:after{display:none}.subtitle-studio__hero .eyebrow{}.subtitle-studio__hero h2{position:relative;z-index:1;max-width:760px;margin:10px 0 11px;font:720 clamp(29px,3.3vw,44px)/1.08 var(--font-display);letter-spacing:-.045em}.subtitle-studio__hero h2 em{font-style:normal}.subtitle-studio__hero>div>p:last-child{position:relative;z-index:1;max-width:750px;font-size:12px;line-height:1.72}.subtitle-studio__hero>aside{display:grid;grid-template-rows:auto 1fr auto auto;padding:22px;border-left:1px solid var(--surface-2)}.subtitle-studio__hero>aside>span{display:flex;align-items:center;gap:7px;font-size:9px}.subtitle-studio__hero>aside i{width:7px;height:7px;}.subtitle-studio__hero>aside i.ready{box-shadow:0 0 0 4px var(--accent-soft)}.subtitle-studio__hero>aside strong{align-self:end;font:760 48px/1 var(--font-mono);letter-spacing:-.07em}.subtitle-studio__hero>aside small{font:8px var(--font-mono);letter-spacing:.09em}.subtitle-studio__hero>aside footer{margin-top:14px;padding-top:12px;border-top:1px solid var(--surface-2);font:8px var(--font-mono)}
.subtitle-workflows{display:grid;grid-template-columns:242px minmax(0,1fr);gap:10px;margin-top:14px}.subtitle-workflows>header{display:flex;align-items:flex-start;flex-direction:column;justify-content:center;padding:13px 15px;border:1px solid var(--accent-soft);border-radius:14px;background:linear-gradient(135deg,var(--green-bg),var(--surface))}.subtitle-workflows h3{margin-top:5px;color:var(--text);font:710 14px/1.25 var(--font-display);letter-spacing:-.015em}.subtitle-workflows>header>p:last-child{margin:7px 0 0;color:var(--muted);font:9px/1.55 var(--font-ui)}.subtitle-workflows nav{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:1px;overflow:hidden;border:1px solid var(--line);border-radius:14px;background:var(--line);box-shadow:0 8px 22px var(--accent-soft)}.subtitle-workflows nav button{display:grid;min-width:0;grid-template-columns:30px minmax(0,1fr) auto;align-items:center;gap:8px;min-height:58px;padding:8px 10px;border:0;color:var(--text);background:var(--surface);text-align:left;cursor:pointer}.subtitle-workflows nav button:hover,.subtitle-workflows nav button:focus-visible{z-index:1;color:var(--green-strong);background:var(--green-bg)}.subtitle-workflows nav button:focus-visible{outline:2px solid color-mix(in srgb,var(--green) 48%,transparent);outline-offset:-2px}.subtitle-workflows nav button>span{display:grid;width:29px;height:29px;place-items:center;border:1px solid var(--accent-soft);border-radius:8px;color:var(--green-strong);background:var(--surface)}.subtitle-workflows nav button>div{display:grid;min-width:0;gap:3px}.subtitle-workflows nav b,.subtitle-workflows nav small{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.subtitle-workflows nav b{font:670 10px var(--font-ui)}.subtitle-workflows nav small{color:var(--muted);font:8px var(--font-ui)}.subtitle-workflows nav i{color:var(--green-strong);font:700 8px var(--font-ui);font-style:normal;white-space:nowrap}.subtitle-workflows nav button.muted i{color:var(--warn)}.subtitle-workflows nav button.muted>span{color:var(--fg-2);background:var(--surface-2)}
.subtitle-source-panel{display:grid;gap:11px;margin-top:12px;padding:15px;border-radius:15px;background:var(--surface)}.subtitle-source-panel>header{display:flex;align-items:flex-start;justify-content:space-between;gap:16px}.subtitle-source-panel h3{margin-top:4px;color:var(--text);font:700 15px var(--font-display)}.subtitle-source-panel header p:last-child{margin:4px 0 0;color:var(--muted);font:9px/1.5 var(--font-ui)}.subtitle-source-panel textarea{min-height:154px;resize:vertical;padding:13px;border:1px solid var(--line);border-radius:11px;color:var(--text);background:var(--canvas);font:10px/1.65 var(--font-mono);outline:0}.subtitle-source-panel textarea:focus{border-color:var(--green);box-shadow:0 0 0 3px color-mix(in srgb,var(--green) 12%,transparent)}.subtitle-source-panel>footer{display:grid;grid-template-columns:auto 1fr auto;align-items:center;gap:11px}.subtitle-source-panel>footer>div{display:flex;gap:4px;padding:3px;border-radius:8px;background:var(--surface-2)}.subtitle-source-panel>footer>div button{min-height:28px;padding:0 9px;border:0;border-radius:6px;color:var(--muted);background:transparent;font:700 9px var(--font-ui)}.subtitle-source-panel>footer>div button.active{color:var(--green-strong);background:var(--surface);box-shadow:0 1px 4px var(--accent-soft)}.subtitle-source-panel>footer>span{color:var(--muted);font:8px var(--font-mono);text-align:right}.subtitle-intake{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:17px;margin-top:15px;padding:22px;border-radius:16px;background:var(--surface)}.subtitle-intake__intro{display:flex;align-items:center;gap:13px}.subtitle-intake__intro>span{display:grid;width:48px;height:48px;place-items:center;border-radius:13px;color:var(--green-strong);background:var(--green-bg)}.subtitle-intake__intro h3{margin:4px 0;color:var(--text);font:700 18px var(--font-display)}.subtitle-intake__intro div>p:last-child{color:var(--muted);font-size:9px}.subtitle-intake__actions{display:flex;align-items:center;gap:8px}.subtitle-intake__actions button{display:flex;align-items:center;gap:6px;min-height:36px}
.subtitle-toolbar{display:grid;grid-template-columns:minmax(190px,.75fr) minmax(190px,.9fr) auto auto;align-items:center;gap:10px;margin-top:14px;padding:11px;border-radius:14px;background:var(--surface)}.subtitle-toolbar__file{display:flex;min-width:0;align-items:center;gap:8px}.subtitle-toolbar__file>span{display:grid;width:32px;height:32px;flex:0 0 auto;place-items:center;border-radius:9px;color:var(--green-strong);background:var(--green-bg)}.subtitle-toolbar__file>div{display:grid;min-width:0;gap:2px}.subtitle-toolbar__file b,.subtitle-toolbar__file small{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.subtitle-toolbar__file b{font:680 10px var(--font-ui)}.subtitle-toolbar__file small{color:var(--muted);font:8px var(--font-mono)}.subtitle-toolbar__search{display:flex;min-width:0;align-items:center;gap:6px;height:34px;padding:0 8px;border:1px solid var(--line);border-radius:9px;color:var(--muted);background:var(--canvas)}.subtitle-toolbar__search:focus-within{border-color:var(--green);box-shadow:0 0 0 2px color-mix(in srgb,var(--green) 12%,transparent)}.subtitle-toolbar__search input{min-width:0;flex:1;border:0;outline:0;color:var(--text);background:transparent;font-size:9px}.subtitle-toolbar__search button{display:grid;width:22px;height:22px;padding:0;place-items:center;border:0;color:var(--muted);background:transparent}.subtitle-toolbar__shift{display:flex;align-items:center;gap:4px;color:var(--muted);font:8px var(--font-mono);white-space:nowrap}.subtitle-toolbar__shift>button{width:27px;height:29px;padding:0;border:1px solid var(--line);border-radius:6px;color:var(--green-strong);background:var(--surface-raised);font-size:15px}.subtitle-toolbar__shift input{width:68px;height:29px;padding:0 5px;border:1px solid var(--line);border-radius:6px;color:var(--text);background:var(--canvas);font:9px var(--font-mono)}.subtitle-toolbar__actions{display:flex;gap:5px}.subtitle-toolbar__actions button{display:flex;align-items:center;gap:5px;min-height:32px;padding-inline:8px;font-size:8px}.subtitle-warnings{display:flex;align-items:flex-start;gap:8px;margin:9px 2px 0;padding:9px 11px;border:1px solid var(--warn-soft);border-radius:9px;color:var(--warn);background:var(--warn-soft);font-size:9px;line-height:1.5}.subtitle-warnings span{flex:1}.subtitle-warnings button{padding:0;border:0;color:var(--warn);background:transparent;font-weight:700}
.subtitle-workspace{display:grid;grid-template-columns:minmax(0,1fr) 330px;height:570px;min-height:0;margin-top:10px;overflow:hidden;border-radius:16px;background:var(--surface)}.subtitle-workspace>main{display:grid;min-width:0;min-height:0;grid-template-rows:auto 1fr;border-right:1px solid var(--line-weak)}.subtitle-workspace>main>header,.subtitle-inspector>header{display:flex;align-items:end;justify-content:space-between;gap:12px;padding:14px 16px 11px;border-bottom:1px solid var(--line-weak)}.subtitle-workspace h3{margin-top:4px;font:700 15px var(--font-display)}.subtitle-workspace>main>header small{color:var(--muted);font:8px var(--font-mono)}.subtitle-list{min-height:0;overflow:auto;overflow-anchor:none;background:var(--surface-2);scrollbar-gutter:stable}.subtitle-list>[role=option]{display:grid;width:100%;height:76px;grid-template-columns:28px 108px minmax(0,1fr);align-items:center;gap:10px;padding:9px 14px;border:0;border-bottom:1px solid var(--line-weak);color:var(--text-secondary);background:transparent;text-align:left}.subtitle-list>[role=option]:hover,.subtitle-list>[role=option]:focus-visible{color:var(--green-strong);background:var(--accent-soft)}.subtitle-list>[role=option]:focus-visible{outline:2px solid color-mix(in srgb,var(--green) 45%,transparent);outline-offset:-2px}.subtitle-list>[role=option].active{color:var(--green-strong);background:var(--green-bg);box-shadow:inset 3px 0 var(--green)}.subtitle-list>[role=option]>i{display:grid;width:25px;height:25px;place-items:center;border-radius:7px;color:var(--muted);background:var(--surface-2);font:700 8px var(--font-mono);font-style:normal}.subtitle-list>[role=option]>span{display:grid;gap:4px}.subtitle-list>[role=option] b,.subtitle-list>[role=option] small{font:8px var(--font-mono)}.subtitle-list>[role=option] b{color:var(--green-strong)}.subtitle-list>[role=option] small{color:var(--muted)}.subtitle-list>[role=option]>p{display:-webkit-box;overflow:hidden;margin:0;font:10px/1.55 var(--font-ui);-webkit-box-orient:vertical;-webkit-line-clamp:2}.subtitle-list__empty{display:grid;min-height:300px;place-content:center;justify-items:center;gap:7px;color:var(--muted)}.subtitle-list__empty b{color:var(--text);font-size:12px}.subtitle-list__empty button{padding:0;border:0;color:var(--green-strong);background:transparent;font-size:9px}
.subtitle-inspector{display:flex;min-width:0;min-height:0;flex-direction:column;background:linear-gradient(165deg,var(--surface-2),var(--surface))}.subtitle-inspector>header span{padding:4px 7px;border-radius:999px;color:var(--green-strong);background:var(--green-bg);font:700 8px var(--font-ui)}.subtitle-inspector>header span.dirty{color:var(--warn);background:var(--warn-soft)}.subtitle-inspector__time{display:grid;grid-template-columns:1fr auto 1fr;align-items:end;gap:6px;padding:15px 15px 0}.subtitle-inspector label{display:grid;gap:5px}.subtitle-inspector label>span{color:var(--muted);font:700 8px var(--font-ui)}.subtitle-inspector input,.subtitle-inspector textarea{width:100%;border:1px solid var(--line);border-radius:8px;color:var(--text);background:var(--surface-raised);outline:0}.subtitle-inspector input:focus,.subtitle-inspector textarea:focus{border-color:var(--green);box-shadow:0 0 0 3px color-mix(in srgb,var(--green) 11%,transparent)}.subtitle-inspector input{height:34px;padding:0 7px;font:8px var(--font-mono)}.subtitle-inspector__time i{padding-bottom:9px;color:var(--muted);font-style:normal}.subtitle-inspector__text{padding:13px 15px 0}.subtitle-inspector textarea{min-height:145px;resize:vertical;padding:10px;font:11px/1.65 var(--font-ui)}.subtitle-inspector__error{min-height:34px;margin:0;padding:7px 15px;color:var(--muted);font-size:8px;line-height:1.5}.subtitle-inspector__error.visible{color:var(--danger)}.subtitle-inspector__buttons{display:flex;justify-content:flex-end;gap:7px;padding:0 15px 14px}.subtitle-inspector__buttons button{display:flex;align-items:center;gap:5px;min-height:33px;font-size:9px}.subtitle-inspector>section{margin:auto 15px 15px;padding:12px;border:1px solid var(--accent-soft);border-radius:10px;background:var(--green-bg)}.subtitle-inspector>section b{color:var(--green-strong);font-size:9px}.subtitle-inspector>section p,.subtitle-inspector>section small{display:block;margin:5px 0 0;color:var(--muted);font-size:8px;line-height:1.55}
.subtitle-menu{position:fixed;z-index:155;width:230px;overflow:hidden;border:1px solid var(--accent-soft);border-radius:11px;background:var(--surface);box-shadow:var(--shadow-lg);animation:knit-menu-in .14s ease-out both}.subtitle-menu>p{margin:0;padding:10px 12px 8px;border-bottom:1px solid var(--line-weak);color:var(--muted);font:700 9px var(--font-mono)}.subtitle-menu button{display:flex;width:100%;min-height:38px;align-items:center;gap:8px;padding:0 12px;border:0;border-bottom:1px solid var(--line-weak);color:var(--text-secondary);background:transparent;font:650 10px var(--font-ui);text-align:left}.subtitle-menu button:last-child{border-bottom:0}.subtitle-menu button:hover:not(:disabled),.subtitle-menu button:focus-visible:not(:disabled){color:var(--green-strong);background:var(--green-bg)}.subtitle-menu button:focus-visible{outline:2px solid color-mix(in srgb,var(--green) 48%,transparent);outline-offset:-2px}.subtitle-menu button:disabled{color:var(--muted);opacity:.45;cursor:not-allowed}.subtitle-menu button.danger{color:var(--danger)}.visually-hidden{position:fixed!important;width:1px!important;height:1px!important;overflow:hidden!important;opacity:0!important;pointer-events:none!important}
.subtitle-studio__hero{min-height:186px}.subtitle-studio__hero>div{padding:25px 36px}.subtitle-studio__hero h2{margin:8px 0 9px;font-size:clamp(28px,3vw,39px)}.subtitle-studio__hero>div>p:last-child{font-size:11px;line-height:1.65}.subtitle-studio__hero>aside{padding:19px}.subtitle-studio__hero>aside strong{font-size:43px}.subtitle-studio__hero>aside footer{margin-top:11px;padding-top:10px}
@media(max-width:1120px){.subtitle-workflows{grid-template-columns:1fr}.subtitle-workflows>header{display:grid;grid-template-columns:auto minmax(0,1fr);column-gap:14px}.subtitle-workflows>header>p:last-child{grid-column:2;margin:0}.subtitle-toolbar{grid-template-columns:1fr 1fr}.subtitle-toolbar__actions{justify-content:flex-end}.subtitle-workspace{grid-template-columns:minmax(0,1fr) 300px}}@media(max-width:820px){.subtitle-studio{padding:22px 16px 48px}.subtitle-studio__hero{}.subtitle-studio__hero>aside{display:none}.subtitle-workflows>header{display:block}.subtitle-workflows>header>p:last-child{margin-top:7px}.subtitle-workflows nav{grid-template-columns:repeat(2,minmax(0,1fr))}.subtitle-source-panel>footer{grid-template-columns:auto 1fr}.subtitle-source-panel>footer>.primary-button{grid-column:1/-1;justify-self:end}.subtitle-intake{grid-template-columns:1fr}.subtitle-intake__actions{flex-wrap:wrap}.subtitle-toolbar{grid-template-columns:1fr}.subtitle-toolbar__actions{justify-content:flex-start;flex-wrap:wrap}.subtitle-workspace{height:auto;grid-template-columns:1fr}.subtitle-workspace>main{height:520px;border-right:0}.subtitle-inspector{min-height:480px;border-top:1px solid var(--line-weak)}}@media(prefers-reduced-motion:reduce){.subtitle-menu{animation:none}}
.transcription-card{margin-top:14px;overflow:hidden;border-radius:15px;background:var(--surface)}.transcription-card__toggle{display:grid;width:100%;grid-template-columns:42px minmax(0,1fr) auto;align-items:center;gap:12px;padding:13px 16px;border:0;color:var(--text);background:transparent;text-align:left}.transcription-card__toggle>span{display:grid;width:40px;height:40px;place-items:center;border-radius:11px;color:var(--green-strong);background:var(--green-bg)}.transcription-card__toggle>div{display:grid;gap:2px}.transcription-card__toggle b{font:700 12px var(--font-display)}.transcription-card__toggle small{color:var(--muted);font-size:8px}.transcription-card__toggle>i{color:var(--green-strong);font:700 8px var(--font-ui);font-style:normal}.transcription-card__body{display:grid;gap:11px;padding:0 16px 16px;border-top:1px solid var(--line-weak)}.transcription-unconfigured{display:flex;align-items:center;gap:12px;margin-top:14px;padding:14px;border:1px solid var(--warn-soft);border-radius:11px;color:var(--warn);background:var(--warn-soft)}.transcription-unconfigured>div{min-width:0;flex:1}.transcription-unconfigured b{font-size:10px}.transcription-unconfigured p{margin:3px 0 0;color:var(--warn);font-size:8px;line-height:1.55}.transcription-unconfigured a{white-space:nowrap}.transcription-pick{display:flex;align-items:center;gap:11px;margin-top:14px;padding:13px;border:1px dashed var(--accent-soft);border-radius:11px;color:var(--green-strong);background:var(--accent-soft);text-align:left}.transcription-pick>span{display:grid;flex:1;gap:3px}.transcription-pick b{font-size:10px}.transcription-pick small{color:var(--muted);font-size:8px}.transcription-pick>i{font:700 8px var(--font-ui);font-style:normal}.transcription-media{display:grid;grid-template-columns:38px minmax(0,1fr) auto;align-items:center;gap:10px;margin-top:14px;padding:10px;border:1px solid var(--line);border-radius:11px;background:var(--canvas)}.transcription-media:focus-visible{outline:2px solid color-mix(in srgb,var(--green) 45%,transparent);outline-offset:2px}.transcription-media>span{display:grid;width:36px;height:36px;place-items:center;border-radius:9px;color:var(--green-strong);background:var(--green-bg)}.transcription-media>div{display:grid;min-width:0;gap:3px}.transcription-media b,.transcription-media small{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.transcription-media b{font-size:10px}.transcription-media small{color:var(--muted);font:8px var(--font-mono)}.transcription-boundary{display:grid;grid-template-columns:1.3fr .5fr 1fr;gap:7px}.transcription-boundary>span{display:grid;min-width:0;gap:3px;padding:9px 10px;border-radius:9px;background:var(--surface-2)}.transcription-boundary b{color:var(--muted);font-size:8px}.transcription-boundary small{overflow:hidden;color:var(--text-secondary);font:8px var(--font-mono);text-overflow:ellipsis;white-space:nowrap}.transcription-running{display:grid;gap:8px;padding:12px;border:1px solid var(--accent-soft);border-radius:10px;background:var(--green-bg)}.transcription-running>div,.transcription-running footer{display:flex;align-items:center;justify-content:space-between;gap:10px}.transcription-running b{font-size:9px}.transcription-running>div span{color:var(--green-strong);font:700 9px var(--font-mono)}.transcription-running progress{width:100%;height:7px;accent-color:var(--green)}.transcription-running small{color:var(--muted);font-size:8px}.transcription-error{display:flex;align-items:flex-start;gap:7px;margin:0;padding:9px 10px;border-radius:8px;color:var(--danger);background:var(--danger-soft);font-size:8px;line-height:1.5}.transcription-error span{flex:1}.transcription-error a{color:inherit;font-weight:700}.transcription-output,.transcription-actions{display:flex;align-items:center;justify-content:space-between;gap:12px}.transcription-output{padding:8px 10px;border-radius:8px;color:var(--green-strong);background:var(--green-bg);font-size:8px}.transcription-output span{display:flex;align-items:center;gap:6px}.transcription-output button{padding:0;border:0;color:inherit;background:transparent;font-weight:700}.transcription-actions{padding-top:2px}.transcription-actions>span{display:flex;align-items:center;gap:6px;color:var(--muted);font-size:8px}.transcription-media-menu{height:auto}@media(max-width:820px){.transcription-boundary{grid-template-columns:1fr}.transcription-actions,.transcription-output{align-items:stretch;flex-direction:column}}
.subtitle-workflows nav small{font-size:9px}.subtitle-workflows nav i{font-size:9px}
</style>
