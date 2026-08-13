<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AppIcon from '@/components/AppIcon.vue'
import PageHeader from '@/components/PageHeader.vue'
import { clampMenuPosition, isContextMenuShortcut, nextMenuItemIndex } from '@/lib/desktop-menu'
import { firstAvailableMediaOperation, isSupportedMediaPath, mediaOperationAvailable, mediaOperationUnavailableReason, mediaOperations, mediaOutputMime, routeMediaOperation, type MediaOperation } from '@/lib/media-operation'
import { cancelDesktopMediaTranscode, getMediaEngineStatus, inspectDesktopMedia, isDesktop, listenDesktopEvent, listenWindowFileDrops, revealDesktopFile, saveOutputAs, transcodeDesktopMedia, type MediaEngineStatus, type MediaFileInfo, type MediaOutput, type MediaTranscodeProgress } from '@/lib/native'
import { newId } from '@/lib/id'
import { chooseOutputDirectory } from '@/lib/output'
import { useWorkbenchStore } from '@/stores/workbench'
import { useUiStore } from '@/stores/ui'
import { formatMediaTimecode, mediaClipPercent, validateMediaClipRange } from '@/lib/media-clip'

const store = useWorkbenchStore()
const ui = useUiStore()
const route = useRoute()
const router = useRouter()
const runtimeDesktop = isDesktop()
const qaPreview = route.query.qa === 'preview' && window.location.hostname === '127.0.0.1' && ['1420', '1421'].includes(window.location.port)
const desktop = runtimeDesktop || qaPreview
const engine = shallowRef<MediaEngineStatus>({ available: false })
const source = shallowRef<MediaFileInfo>()
const output = shallowRef<MediaOutput>()
const operation = ref<MediaOperation>(routeMediaOperation(route.query.operation))
const clipStart = ref('0:00')
const clipEnd = ref('1:00')
const clipStartInput = ref<HTMLInputElement>()
const selecting = ref(false)
const inspecting = ref(false)
const refreshing = ref(false)
const running = ref(false)
const cancelling = ref(false)
const mediaProgress = ref(0)
const activeRunId = ref('')
const activeJobId = ref('')
const notice = ref(desktop ? '选择一份本地媒体文件；先读取信息，再生成新输出。' : '媒体转换仅在桌面端可用。')
const sourceMenu = ref<{ x: number; y: number } | null>(null)
const sourceMenuElement = ref<HTMLElement>()
const outputMenu = ref<{ x: number; y: number } | null>(null)
const outputMenuElement = ref<HTMLElement>()
let sourceMenuTrigger: HTMLElement | undefined
let outputMenuTrigger: HTMLElement | undefined
let removeProgressListener: (() => void) | undefined
let removeFileDropListener: (() => void) | undefined
let lastPersistedProgress = 0
let lastProgressStoreWrite = 0

const selectedOperation = computed(() => mediaOperations.find((item) => item.id === operation.value) ?? mediaOperations[0])
const selectedOperationAvailable = computed(() => mediaOperationAvailable(selectedOperation.value, source.value))
const clipValidation = computed(() => validateMediaClipRange(clipStart.value, clipEnd.value, source.value?.durationSeconds))
const clipTrackStyle = computed<Record<string, string>>(() => {
  const range = clipValidation.value.range
  return {
    '--clip-start': `${mediaClipPercent(range?.startSeconds ?? 0, source.value?.durationSeconds)}%`,
    '--clip-end': `${mediaClipPercent(range?.endSeconds ?? 0, source.value?.durationSeconds)}%`,
  }
})
const sourceSummary = computed(() => {
  if (!source.value) return '尚未选择媒体'
  const parts = [source.value.formatName, source.value.videoCodec && source.value.width && source.value.height ? `${source.value.width} × ${source.value.height}` : undefined, source.value.audioCodec]
  return parts.filter(Boolean).join(' · ') || '已读取本地文件'
})
const outputDirectory = computed(() => qaPreview ? 'F:\\Knitspace\\Outputs' : store.settings.outputDirectory)
const canRun = computed(() => desktop && engine.value.available && Boolean(source.value?.path) && Boolean(outputDirectory.value) && !running.value && selectedOperationAvailable.value && (operation.value !== 'trim-clip' || Boolean(clipValidation.value.range)))
const outputDirectoryLabel = computed(() => outputDirectory.value ? outputDirectory.value.split(/[\\/]/).filter(Boolean).at(-1) || outputDirectory.value : '尚未选择')

function formatSize(value?: number) {
  if (!value) return '—'
  if (value < 1024 * 1024) return `${Math.max(1, Math.round(value / 1024))} KB`
  if (value < 1024 * 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`
  return `${(value / 1024 / 1024 / 1024).toFixed(2)} GB`
}

function formatDuration(value?: number) {
  if (!Number.isFinite(value) || !value || value < 0) return '时长未知'
  const total = Math.round(value)
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60
  return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}` : `${minutes}:${String(seconds).padStart(2, '0')}`
}

async function refreshEngine() {
  if (!desktop || refreshing.value) return
  if (qaPreview) {
    engine.value = { available: true, version: 'FFmpeg 8.0 · QA PREVIEW' }
    notice.value = 'FFmpeg 已就绪。所有媒体只在本机处理，输出会生成新文件。'
    return
  }
  refreshing.value = true
  try {
    engine.value = await getMediaEngineStatus()
    notice.value = engine.value.available
      ? 'FFmpeg 已就绪。所有媒体只在本机处理，输出会生成新文件。'
      : '未检测到 FFmpeg。安装后将 ffmpeg 与 ffprobe 加入系统 PATH，再重新打开此页。'
  } catch (error) {
    engine.value = { available: false }
    notice.value = error instanceof Error ? error.message : '无法检查本机媒体引擎。'
  } finally { refreshing.value = false }
}

async function inspectSource(path: string) {
  if (inspecting.value || running.value) return
  inspecting.value = true
  output.value = undefined
  try {
    source.value = await inspectDesktopMedia(path)
    clipStart.value = '0:00'
    clipEnd.value = formatMediaTimecode(Math.min(source.value.durationSeconds ?? 60, 60))
    if (!mediaOperationAvailable(selectedOperation.value, source.value)) selectOperation(firstAvailableMediaOperation(source.value))
    notice.value = `已读取“${source.value.name}”。选择一个明确的输出任务即可开始。`
  } catch (error) {
    source.value = undefined
    notice.value = error instanceof Error ? error.message : '无法读取媒体文件。'
  } finally { inspecting.value = false }
}

async function chooseSource() {
  if (!desktop || selecting.value || running.value) return
  if (qaPreview) {
    source.value = { path: 'F:\\Recordings\\数据结构复习课.mp4', name: '数据结构复习课.mp4', size: 486_539_264, durationSeconds: 3_742, formatName: 'mov,mp4,m4a', audioCodec: 'aac', videoCodec: 'h264', width: 1920, height: 1080, bitRate: 3_824_000 }
    output.value = undefined
    notice.value = '已读取“数据结构复习课.mp4”。选择一个明确的输出任务即可开始。'
    return
  }
  selecting.value = true
  try {
    const { open } = await import('@tauri-apps/plugin-dialog')
    const selected = await open({
      title: '选择本地音频或视频', multiple: false,
      filters: [{ name: '音频与视频', extensions: ['mp4', 'm4v', 'mov', 'mkv', 'webm', 'avi', 'mp3', 'm4a', 'aac', 'wav', 'flac', 'ogg', 'opus'] }],
    })
    if (typeof selected === 'string') await inspectSource(selected)
  } catch (error) { notice.value = error instanceof Error ? error.message : '无法打开文件选择器。' }
  finally { selecting.value = false }
}

async function chooseOutput() {
  if (!desktop || running.value) return
  if (qaPreview) {
    notice.value = 'QA 预览固定使用 Knitspace Outputs；没有写入真实设置。'
    return
  }
  try {
    const directory = await chooseOutputDirectory()
    if (!directory) return
    store.updateSettings({ outputDirectory: directory })
    notice.value = `输出目录已设为“${directory.split(/[\\/]/).filter(Boolean).at(-1) || directory}”。`
  } catch (error) { notice.value = error instanceof Error ? error.message : '无法选择输出目录。' }
}

function selectOperation(nextOperation: MediaOperation) {
  const definition = mediaOperations.find((item) => item.id === nextOperation)
  if (definition && !mediaOperationAvailable(definition, source.value)) return
  operation.value = nextOperation
  void router.replace({ query: { ...route.query, operation: nextOperation === 'trim-clip' ? 'clip' : nextOperation } })
}

function selectClipFromSource() {
  selectOperation('trim-clip')
  closeSourceMenu()
  void nextTick(() => clipStartInput.value?.focus({ preventScroll: true }))
}

function selectOperationFromSource(nextOperation: MediaOperation) {
  selectOperation(nextOperation)
  closeSourceMenu(true)
}

function handleDroppedPaths(paths: string[]) {
  if (running.value || inspecting.value) return
  const selected = paths.find(isSupportedMediaPath)
  if (!selected) {
    if (paths.length) ui.toast('没有可读取的媒体', '请拖入 MP4、MOV、MKV、MP3、WAV、M4A 等常见音视频文件。', 'warning')
    return
  }
  if (paths.length > 1) ui.toast('已接收第一份媒体', '媒体工作台一次只生成一个明确输出。', 'info')
  void inspectSource(selected)
}

async function run() {
  if (!source.value?.path || !outputDirectory.value || !canRun.value) return
  if (qaPreview) {
    running.value = true
    mediaProgress.value = 100
    const extension = operation.value === 'extract-mp3' ? 'mp3' : operation.value === 'transcode-m4a' ? 'm4a' : operation.value === 'transcode-wav' ? 'wav' : 'mp4'
    const name = `数据结构复习课-knitspace-${operation.value}.${extension}`
    output.value = { path: `F:\\Knitspace\\Outputs\\${name}`, name, size: 82_417_664, elapsedMs: 12_400 }
    notice.value = 'QA 输出已生成；预览没有运行 FFmpeg，也没有写入 Vault 或任务历史。'
    running.value = false
    return
  }
  const runId = newId()
  const clipRange = operation.value === 'trim-clip' ? clipValidation.value.range : undefined
  if (operation.value === 'trim-clip' && !clipRange) return
  activeRunId.value = runId
  running.value = true
  cancelling.value = false
  mediaProgress.value = 5
  lastPersistedProgress = 5
  lastProgressStoreWrite = performance.now()
  const task = store.addJob('media', `媒体 · ${selectedOperation.value.title}`, [source.value.name], {
    toolId: `media:${operation.value}`, route: '/media', retryable: true,
    inputs: [{ name: source.value.name, path: source.value.path, size: source.value.size }],
    parameters: { operation: operation.value, outputDirectory: outputDirectory.value, runId, ...(clipRange ? { startSeconds: clipRange.startSeconds, durationSeconds: clipRange.durationSeconds } : {}) },
  })
  activeJobId.value = task.id
  store.updateJob(task.id, { status: 'running', progress: 5, detail: '正在启动本机 FFmpeg；媒体不会进入页面内存。' })
  notice.value = `正在处理“${source.value.name}”；可以随时停止，原文件不会被修改。`
  try {
    const result = await transcodeDesktopMedia({ inputPath: source.value.path, outputDir: outputDirectory.value, operation: operation.value, runId, ...(clipRange ? { startSeconds: clipRange.startSeconds, durationSeconds: clipRange.durationSeconds } : {}) })
    output.value = result
    store.updateJob(task.id, {
      status: 'succeeded', progress: 100, outputNames: [result.name],
      outputs: [{ name: result.name, path: result.path, size: result.size, mime: mediaOutputMime(result.name) }],
      detail: `已生成新媒体文件，用时 ${(result.elapsedMs / 1000).toFixed(1)} 秒。`,
    })
    notice.value = `已生成“${result.name}”，原文件没有被修改。`
    ui.toast('媒体已转换', `${selectedOperation.value.title} · ${formatSize(result.size)}`, 'success', '打开位置', () => void revealDesktopFile(result.path))
  } catch (error) {
    const detail = error instanceof Error ? error.message : '媒体转换失败。'
    const cancelled = cancelling.value || store.jobs.find((job) => job.id === task.id)?.errorCode === 'MEDIA_CANCEL_REQUESTED' || detail.includes('任务已停止')
    store.updateJob(task.id, { status: cancelled ? 'cancelled' : 'failed', progress: mediaProgress.value, errorCode: cancelled ? 'MEDIA_TRANSCODE_CANCELLED' : 'MEDIA_TRANSCODE_FAILED', detail })
    notice.value = detail
    ui.toast(cancelled ? '媒体转换已停止' : '媒体转换失败', detail, cancelled ? 'warning' : 'error')
  } finally {
    if (activeRunId.value === runId) { activeRunId.value = ''; activeJobId.value = '' }
    running.value = false
    cancelling.value = false
  }
}

async function cancelRun() {
  if (!activeRunId.value || cancelling.value) return
  cancelling.value = true
  notice.value = '已发送停止请求，正在清理未完成的临时输出…'
  try { await cancelDesktopMediaTranscode(activeRunId.value) }
  catch (error) {
    cancelling.value = false
    ui.toast('无法停止转换', error instanceof Error ? error.message : '媒体任务状态不可用。', 'error')
  }
}

function handleMediaProgress(payload: MediaTranscodeProgress) {
  if (!activeRunId.value || payload.runId !== activeRunId.value) return
  if (cancelling.value) return
  const progress = Math.max(mediaProgress.value, Math.min(99, Math.round(payload.progress)))
  mediaProgress.value = progress
  notice.value = payload.detail
  const shouldPersist = progress >= lastPersistedProgress + 2 || performance.now() - lastProgressStoreWrite >= 700
  if (activeJobId.value && shouldPersist) {
    lastPersistedProgress = progress
    lastProgressStoreWrite = performance.now()
    store.updateJob(activeJobId.value, { status: 'running', progress, detail: payload.detail })
  }
}

function showSourceMenu(x: number, y: number, trigger: HTMLElement) {
  if (!source.value || running.value) return
  closeOutputMenu()
  sourceMenuTrigger = trigger
  const quickActions = 4 + Number(Boolean(source.value.audioCodec)) * 2 + Number(Boolean(source.value.videoCodec))
  sourceMenu.value = clampMenuPosition(x, y, { menuWidth: 212, menuHeight: 35 + quickActions * 35 })
  void nextTick(() => sourceMenuElement.value?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus())
}

function openSourceMenu(event: MouseEvent) { event.preventDefault(); showSourceMenu(event.clientX, event.clientY, event.currentTarget as HTMLElement) }
function openSourceMenuFromKeyboard(trigger: HTMLElement) { const bounds = trigger.getBoundingClientRect(); showSourceMenu(bounds.right + 8, bounds.top + 8, trigger) }
function closeSourceMenu(restoreFocus = false) { sourceMenu.value = null; if (restoreFocus) sourceMenuTrigger?.focus({ preventScroll: true }) }
function handleSourceKeydown(event: KeyboardEvent) { if (!isContextMenuShortcut(event)) return; event.preventDefault(); openSourceMenuFromKeyboard(event.currentTarget as HTMLElement) }
function handleSourceMenuKeydown(event: KeyboardEvent) {
  const items = [...(sourceMenuElement.value?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [])]
  if (event.key === 'Escape') { event.preventDefault(); closeSourceMenu(true); return }
  const next = nextMenuItemIndex(event.key, items.indexOf(document.activeElement as HTMLButtonElement), items.length)
  if (next === undefined) return
  event.preventDefault(); items[next]?.focus()
}
async function revealSource() { if (source.value?.path) await revealDesktopFile(source.value.path); closeSourceMenu() }
async function reInspect() { if (!running.value && source.value?.path) await inspectSource(source.value.path); closeSourceMenu(true) }
function clearSource() { if (running.value) return; source.value = undefined; output.value = undefined; notice.value = '已清除当前媒体。选择另一份本地文件继续。'; closeSourceMenu(true) }

function showOutputMenu(x: number, y: number, trigger: HTMLElement) {
  if (!output.value) return
  closeSourceMenu()
  outputMenuTrigger = trigger
  outputMenu.value = clampMenuPosition(x, y, { menuWidth: 212, menuHeight: 138 })
  void nextTick(() => outputMenuElement.value?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus())
}
function openOutputMenu(event: MouseEvent) { event.preventDefault(); showOutputMenu(event.clientX, event.clientY, event.currentTarget as HTMLElement) }
function openOutputMenuFromKeyboard(trigger: HTMLElement) { const bounds = trigger.getBoundingClientRect(); showOutputMenu(bounds.right + 8, bounds.top + 8, trigger) }
function closeOutputMenu(restoreFocus = false) { outputMenu.value = null; if (restoreFocus) outputMenuTrigger?.focus({ preventScroll: true }) }
function handleOutputKeydown(event: KeyboardEvent) { if (!isContextMenuShortcut(event)) return; event.preventDefault(); openOutputMenuFromKeyboard(event.currentTarget as HTMLElement) }
function handleOutputMenuKeydown(event: KeyboardEvent) {
  const items = [...(outputMenuElement.value?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [])]
  if (event.key === 'Escape') { event.preventDefault(); closeOutputMenu(true); return }
  const next = nextMenuItemIndex(event.key, items.indexOf(document.activeElement as HTMLButtonElement), items.length)
  if (next === undefined) return
  event.preventDefault(); items[next]?.focus()
}
async function revealOutput() { if (output.value?.path) await revealDesktopFile(output.value.path); closeOutputMenu() }
async function copyOutputPath() {
  if (!output.value?.path) return
  try {
    await navigator.clipboard.writeText(output.value.path)
    ui.toast('输出路径已复制', output.value.path, 'success')
  } catch (error) { ui.toast('复制路径失败', error instanceof Error ? error.message : '系统剪贴板暂时不可用。', 'error') }
  finally { closeOutputMenu(true) }
}
async function saveOutputAsCopy() {
  const current = output.value
  if (!current) return
  try {
    const saved = await saveOutputAs(current.path, current.name)
    if (saved) ui.toast('已另存媒体输出', saved, 'success')
  } catch (error) { ui.toast('另存失败', error instanceof Error ? error.message : '无法复制当前媒体输出。', 'error') }
  finally { closeOutputMenu(true) }
}
function closeContextMenus() { closeSourceMenu(); closeOutputMenu() }

watch(() => route.query.operation, (value) => {
  const nextOperation = routeMediaOperation(value)
  const definition = mediaOperations.find((item) => item.id === nextOperation) ?? mediaOperations[0]
  operation.value = mediaOperationAvailable(definition, source.value) ? nextOperation : firstAvailableMediaOperation(source.value)
})

onMounted(() => {
  if (qaPreview) {
    source.value = { path: 'F:\\Recordings\\数据结构复习课.mp4', name: '数据结构复习课.mp4', size: 486_539_264, durationSeconds: 3_742, formatName: 'mov,mp4,m4a', audioCodec: 'aac', videoCodec: 'h264', width: 1920, height: 1080, bitRate: 3_824_000 }
  }
  void refreshEngine()
  if (runtimeDesktop) {
    void listenDesktopEvent<MediaTranscodeProgress>('toolknit://media-progress', handleMediaProgress).then((unlisten) => { removeProgressListener = unlisten }).catch(() => undefined)
    void listenWindowFileDrops(handleDroppedPaths).then((unlisten) => { removeFileDropListener = unlisten }).catch(() => undefined)
  }
})
onBeforeUnmount(() => {
  removeProgressListener?.()
  removeFileDropListener?.()
  // The page owns progress updates. Do not leave an invisible transcode
  // running after navigation, where no view can surface its cancellation.
  if (activeRunId.value) void cancelDesktopMediaTranscode(activeRunId.value).catch(() => undefined)
})
</script>

<template>
  <div class="media-desk page-enter mx-auto w-full max-w-320 px-8 py-6" @click="closeContextMenus">
    <PageHeader title="媒体转换台" subtitle="先读元信息再决定;每次只完成一个明确的输出">
      <template #actions>
        <button
          class="btn-default"
          :disabled="refreshing"
          :title="engine.version || '检查媒体引擎'"
          @click.stop="refreshEngine"
        >
          <i class="w-1.5 h-1.5 rounded-full shrink-0" :class="engine.available ? 'bg-success' : 'bg-warn'" aria-hidden="true" />
          {{ engine.available ? 'FFmpeg 已就绪' : 'FFmpeg 未就绪' }}
        </button>
      </template>
    </PageHeader>

    <section class="media-desk__workspace panel" :class="{ unavailable: !desktop || !engine.available }">
      <aside class="media-desk__source">
        <header><span>01</span><div><p class="eyebrow">输入</p><h3>本地媒体</h3></div></header>
        <button v-if="!source" class="media-desk__drop" :disabled="!desktop || selecting || running" @click="chooseSource"><AppIcon name="play" :size="25"/><b>{{ selecting ? '正在打开选择器…' : '选择或拖入音视频' }}</b><small>MP4 · MOV · MKV · MP3 · WAV · M4A…</small><i>桌面文件可直接拖到窗口</i></button>
        <article v-else class="media-desk__source-card" :class="{ locked: running }" tabindex="0" role="button" aria-haspopup="menu" :aria-expanded="Boolean(sourceMenu)" :aria-disabled="running" :aria-label="running ? `${source.name} 正在转换，媒体操作暂时锁定。` : `${source.name}，按右键或菜单键打开操作。`" @click.stop @contextmenu="openSourceMenu" @keydown="handleSourceKeydown">
          <b><AppIcon :name="source.videoCodec ? 'play' : 'file-text'" :size="21"/></b><div><strong>{{ source.name }}</strong><small>{{ sourceSummary }}</small></div><i>{{ formatSize(source.size) }}</i><footer><span>{{ formatDuration(source.durationSeconds) }}</span><span v-if="source.bitRate">{{ Math.round(source.bitRate / 1000) }} kbps</span></footer>
        </article>
        <p v-if="inspecting" class="media-desk__loading"><AppIcon name="clock" :size="14"/> 正在读取编码、时长和轨道…</p>
        <button v-else-if="source" class="quiet-button media-desk__change" :disabled="running" @click="chooseSource">更换文件</button>
      </aside>

      <main class="media-desk__operation">
        <header><span>02</span><div><h3>选择输出</h3></div><small>原件保持只读</small></header>
        <div class="media-desk__operations">
          <button v-for="item in mediaOperations" :key="item.id" :disabled="running || !mediaOperationAvailable(item, source)" :class="{ active: operation === item.id }" :aria-pressed="operation === item.id" :title="mediaOperationUnavailableReason(item, source) || item.detail" @click="selectOperation(item.id)"><b>{{ item.extension }}</b><span><strong>{{ item.title }}</strong><small>{{ item.description }}</small></span><i>{{ mediaOperationUnavailableReason(item, source) || item.detail }}</i></button>
        </div>
        <section v-if="operation === 'trim-clip'" class="media-desk__clip" aria-label="媒体截取区间">
          <header><b>截取区间</b><small>{{ clipValidation.range ? `共 ${formatDuration(clipValidation.range.durationSeconds)}` : '等待有效时间' }}</small></header>
          <div><label><span>开始</span><input ref="clipStartInput" v-model.trim="clipStart" inputmode="decimal" placeholder="0:00" aria-label="片段开始时间" /></label><i>→</i><label><span>结束</span><input v-model.trim="clipEnd" inputmode="decimal" placeholder="1:00" aria-label="片段结束时间" /></label></div>
          <figure :style="clipTrackStyle" aria-hidden="true"><span></span></figure>
          <p :class="{ error: clipValidation.error }" role="status">{{ clipValidation.error || '支持秒数、mm:ss 或 hh:mm:ss；输出会重新编码以获得稳定片段。' }}</p>
        </section>
        <div class="media-desk__promise"><AppIcon name="shield" :size="16"/><p><b>可预期的输出</b><span>FFmpeg 在后台运行；不把大媒体文件送进页面内存，也不覆盖你的输入文件。</span></p></div>
      </main>

      <aside class="media-desk__output">
        <header><span>03</span><div><h3>输出位置</h3></div></header>
        <button class="media-desk__directory" :disabled="running" @click="chooseOutput"><AppIcon name="archive" :size="18"/><span><b>{{ outputDirectoryLabel }}</b><small>{{ outputDirectory || '选择一个本地文件夹' }}</small></span><AppIcon name="arrow-right" :size="15"/></button>
        <button v-if="!running" class="new-task media-desk__run" :disabled="!canRun" @click="run"><AppIcon name="play" :size="16"/>{{ `生成 ${selectedOperation.extension}` }}</button>
        <button v-else class="media-desk__cancel" :disabled="cancelling" @click="cancelRun"><AppIcon name="clock" :size="16"/>{{ cancelling ? '正在停止…' : '停止本次转换' }}</button>
        <div v-if="running" class="media-desk__progress" role="status" aria-live="polite"><span><b>本机转换进度</b><small>{{ notice }}</small></span><strong>{{ mediaProgress }}%</strong><progress max="100" :value="mediaProgress" :aria-label="`媒体转换进度 ${mediaProgress}%`"></progress></div>
        <p v-else class="media-desk__status" role="status">{{ notice }}</p>
        <article v-if="output" class="media-desk__result media-desk__result--interactive" tabindex="0" role="group" aria-label="刚刚生成的媒体文件；按右键或菜单键打开操作。" aria-haspopup="menu" :aria-expanded="Boolean(outputMenu)" @click.stop @contextmenu="openOutputMenu" @keydown="handleOutputKeydown"><b>刚刚生成</b><strong>{{ output.name }}</strong><small>{{ formatSize(output.size) }} · {{ (output.elapsedMs / 1000).toFixed(1) }} 秒</small><button @click.stop="revealOutput">打开文件位置</button></article>
      </aside>
    </section>

    <div v-if="sourceMenu" ref="sourceMenuElement" class="media-desk__menu" role="menu" aria-label="媒体文件操作" :style="{ left: `${sourceMenu.x}px`, top: `${sourceMenu.y}px` }" @click.stop @contextmenu.prevent @keydown.stop="handleSourceMenuKeydown"><p>当前媒体</p><button v-if="source?.audioCodec" role="menuitem" @click="selectOperationFromSource('extract-mp3')">提取音轨为 MP3</button><button v-if="source?.audioCodec" role="menuitem" @click="selectOperationFromSource('transcode-wav')">转为语音 WAV</button><button v-if="source?.videoCodec" role="menuitem" @click="selectOperationFromSource('mute-video')">生成静音视频</button><button role="menuitem" @click="selectClipFromSource">截取这段媒体…</button><button role="menuitem" @click="reInspect">重新读取信息</button><button role="menuitem" @click="revealSource">在文件夹显示</button><button role="menuitem" class="danger" @click="clearSource">移除当前文件</button></div>
    <div v-if="outputMenu" ref="outputMenuElement" class="media-desk__menu" role="menu" aria-label="媒体输出操作" :style="{ left: `${outputMenu.x}px`, top: `${outputMenu.y}px` }" @click.stop @contextmenu.prevent @keydown.stop="handleOutputMenuKeydown"><p>刚刚生成</p><button role="menuitem" @click="revealOutput">打开文件位置</button><button role="menuitem" @click="saveOutputAsCopy">另存为…</button><button role="menuitem" @click="copyOutputPath">复制输出路径</button></div>
  </div>
</template>

<style scoped>
.media-desk{max-width:1280px;margin:0 auto;padding:30px 28px 64px}.media-desk__heading{display:flex;align-items:end;justify-content:space-between;gap:30px;margin-bottom:20px}.media-desk__heading h2{max-width:720px;margin:7px 0 8px;color:var(--text);font:680 clamp(29px,3.2vw,43px)/1.08 var(--font-display);letter-spacing:-.04em}.media-desk__heading h2 em{color:var(--green-strong);font-style:normal}.media-desk__heading>div>p:last-child{max-width:670px;margin:0;color:var(--muted);font-size:12px;line-height:1.7}.media-desk__engine{display:grid;grid-template-columns:8px auto;grid-template-rows:auto auto;align-items:center;column-gap:8px;min-width:180px;padding:11px 13px;border:1px solid var(--line);border-radius:12px;background:var(--surface-2);color:var(--muted);text-align:left}.media-desk__engine i{grid-row:1/3;width:7px;height:7px;border-radius:50%;background:var(--warn)}.media-desk__engine.ready{border-color:color-mix(in srgb,var(--green) 32%,var(--line));color:var(--green-strong);background:var(--green-bg)}.media-desk__engine.ready i{background:var(--green);box-shadow:0 0 0 4px color-mix(in srgb,var(--green) 12%,transparent)}.media-desk__engine span{font:720 11px var(--font-ui)}.media-desk__engine small{margin-top:2px;font:11px var(--font-mono);letter-spacing:.06em}.media-desk__workspace{display:grid;grid-template-columns:minmax(220px,.75fr) minmax(400px,1.25fr) minmax(250px,.83fr);min-height:474px;overflow:visible;border:1px solid var(--line);border-radius:16px;background:var(--surface);box-shadow:0 18px 46px var(--accent-soft)}.media-desk__workspace>aside,.media-desk__operation{min-width:0;padding:19px}.media-desk__source{border-right:1px solid var(--line-weak);background:linear-gradient(165deg,var(--surface-2),var(--surface-2))}.media-desk__output{border-left:1px solid var(--line-weak);background:linear-gradient(180deg,var(--surface),var(--surface-2))}.media-desk__workspace header{display:flex;align-items:center;gap:9px}/* A step index, so it reads as a marker rather than as a filled button. */
.media-desk__workspace header>span{display:grid;place-items:center;width:25px;height:25px;border-radius:8px;background:var(--accent-soft);color:var(--accent);font:700 11px var(--font-mono)}.media-desk__workspace header div{display:grid;gap:2px}.media-desk__workspace header p{margin:0;font:700 11px var(--font-mono);letter-spacing:.07em;color:var(--muted)}.media-desk__workspace header h3{margin:0;color:var(--text);font:700 14px var(--font-ui)}.media-desk__drop{display:grid;place-items:center;align-content:center;width:100%;min-height:285px;margin-top:18px;padding:28px;border:1px dashed color-mix(in srgb,var(--green) 38%,var(--line));border-radius:13px;background:var(--surface-2);color:var(--green-strong);transition:border-color .16s ease,background .16s ease,transform .16s ease}.media-desk__drop:hover:not(:disabled){border-color:var(--green);background:var(--green-bg);transform:translateY(-1px)}.media-desk__drop b{margin-top:11px;color:var(--text);font:700 12px var(--font-ui)}.media-desk__drop small{margin-top:5px;color:var(--muted);font:11px var(--font-mono);text-align:center;line-height:1.6}.media-desk__source-card{display:grid;grid-template-columns:37px minmax(0,1fr) auto;gap:10px;align-items:center;min-height:126px;margin-top:18px;padding:13px;border:1px solid color-mix(in srgb,var(--green) 30%,var(--line));border-radius:13px;background:var(--green-bg);cursor:context-menu;outline:none}.media-desk__source-card:focus-visible{box-shadow:0 0 0 3px color-mix(in srgb,var(--green) 17%,transparent)}.media-desk__source-card>b{display:grid;place-items:center;width:36px;height:36px;border-radius:10px;color:var(--green-strong);background:var(--surface)}.media-desk__source-card>div{display:grid;gap:4px;min-width:0}.media-desk__source-card strong,.media-desk__source-card small{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.media-desk__source-card strong{color:var(--text);font:700 11px var(--font-ui)}.media-desk__source-card small{color:var(--muted);font:11px var(--font-mono)}.media-desk__source-card>i{align-self:start;color:var(--green-strong);font:700 11px var(--font-mono);font-style:normal}.media-desk__source-card footer{grid-column:1/-1;display:flex;gap:8px;padding-top:8px;border-top:1px solid color-mix(in srgb,var(--green) 17%,var(--line));color:var(--muted);font:11px var(--font-mono)}.media-desk__change{width:100%;margin-top:10px}.media-desk__loading{display:flex;align-items:center;gap:6px;margin:12px 1px;color:var(--muted);font-size:11px}.media-desk__operation>header>small{margin-left:auto;color:var(--muted);font:11px var(--font-mono)}.media-desk__operations{display:grid;gap:8px;margin-top:18px}.media-desk__operations button{display:grid;grid-template-columns:46px minmax(0,1fr) auto;align-items:center;gap:11px;width:100%;min-height:77px;padding:11px;border:1px solid var(--line);border-radius:12px;background:var(--surface-2);color:var(--text);text-align:left;transition:border-color .16s ease,background .16s ease,transform .16s ease}.media-desk__operations button:hover{border-color:color-mix(in srgb,var(--green) 38%,var(--line));transform:translateX(2px)}.media-desk__operations button.active{border-color:var(--green);background:var(--green-bg);box-shadow:inset 3px 0 0 var(--green)}.media-desk__operations b{display:grid;place-items:center;width:45px;height:45px;border-radius:10px;background:var(--accent-solid);color:var(--accent-fg);font:700 11px var(--font-mono)}.media-desk__operations span{display:grid;gap:4px;min-width:0}.media-desk__operations strong{font:700 12px var(--font-ui)}.media-desk__operations small{color:var(--muted);font-size:11px}.media-desk__operations i{max-width:124px;color:var(--muted);font:11px/1.45 var(--font-mono);font-style:normal;text-align:right}.media-desk__promise{display:flex;gap:9px;align-items:flex-start;margin-top:15px;padding:12px;border-top:1px solid var(--line-weak);color:var(--green-strong)}.media-desk__promise p{display:grid;gap:3px;margin:0}.media-desk__promise b{font:700 11px var(--font-ui)}.media-desk__promise span{color:var(--muted);font-size:11px;line-height:1.5}.media-desk__directory{display:flex;align-items:center;gap:9px;width:100%;margin-top:18px;padding:11px;border:1px solid var(--line);border-radius:11px;background:var(--surface-2);color:var(--green-strong);text-align:left}.media-desk__directory>span{display:grid;gap:3px;min-width:0;flex:1}.media-desk__directory b,.media-desk__directory small{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.media-desk__directory b{color:var(--text);font:700 11px var(--font-ui)}.media-desk__directory small{color:var(--muted);font:11px var(--font-mono)}.media-desk__run{display:flex;justify-content:center;width:100%;margin-top:12px}.media-desk__status{min-height:66px;margin:14px 0 0;color:var(--muted);font-size:11px;line-height:1.65}.media-desk__result{display:grid;gap:4px;padding:11px;border:1px solid color-mix(in srgb,var(--green) 30%,var(--line));border-radius:11px;background:var(--green-bg)}.media-desk__result>b{color:var(--green-strong);font:700 11px var(--font-mono);letter-spacing:.06em}.media-desk__result strong{overflow:hidden;color:var(--text);font:700 11px var(--font-ui);text-overflow:ellipsis;white-space:nowrap}.media-desk__result small{color:var(--muted);font:11px var(--font-mono)}.media-desk__result button{justify-self:start;margin-top:4px;padding:0;border:0;color:var(--green-strong);background:none;font:700 11px var(--font-ui);text-decoration:underline}.media-desk__menu{position:fixed;z-index:160;width:212px;overflow:hidden;margin:0;padding:0;border:1px solid var(--accent-soft);border-radius:11px;background:var(--surface);box-shadow:var(--shadow-lg);animation:knit-menu-in .14s ease-out both}.media-desk__menu p{margin:0;padding:10px 12px 7px;border-bottom:1px solid var(--line-weak);color:var(--muted);font:700 11px var(--font-mono);letter-spacing:.06em}.media-desk__menu button{display:block;width:100%;min-height:35px;padding:0 12px;border:0;color:var(--text-secondary);background:transparent;font:600 11px var(--font-ui);text-align:left}.media-desk__menu button:hover,.media-desk__menu button:focus-visible{color:var(--green-strong);background:var(--green-bg)}.media-desk__menu button.danger{color:var(--danger)}.media-desk__menu button:focus-visible{outline:2px solid color-mix(in srgb,var(--green) 48%,transparent);outline-offset:-2px}.media-desk__workspace.unavailable{opacity:.78}.media-desk__workspace.unavailable .media-desk__operation,.media-desk__workspace.unavailable .media-desk__output{filter:saturate(.75)}@media(max-width:1080px){.media-desk__workspace{grid-template-columns:minmax(210px,.8fr) minmax(0,1.2fr)}.media-desk__output{grid-column:1/-1;border-top:1px solid var(--line-weak);border-left:0}.media-desk__output{display:grid;grid-template-columns:1fr 1fr;gap:12px}.media-desk__output>header{grid-column:1/-1}.media-desk__directory,.media-desk__run{margin-top:0}.media-desk__status{margin:0}.media-desk__result{grid-column:1/-1}}@media(max-width:720px){.media-desk{padding:22px 14px 48px}.media-desk__heading{align-items:flex-start;flex-direction:column}.media-desk__workspace{display:block}.media-desk__source,.media-desk__operation{border-bottom:1px solid var(--line-weak)}.media-desk__source,.media-desk__output{border-right:0;border-left:0}.media-desk__output{display:grid;grid-template-columns:1fr}.media-desk__output>header,.media-desk__result{grid-column:auto}.media-desk__operations i{display:none}}
</style>

<style scoped>
.media-desk__result--interactive{cursor:context-menu;outline:none;transition:border-color .16s ease,box-shadow .16s ease,background .16s ease}
.media-desk__drop>i{margin-top:7px;color:var(--green-strong);font:700 11px var(--font-ui);font-style:normal}
.media-desk__operations{grid-template-columns:repeat(2,minmax(0,1fr))}
.media-desk__operations button{grid-template-columns:42px minmax(0,1fr);gap:8px;min-height:84px;padding:10px}
.media-desk__operations b{width:41px;height:41px;font-size:11px;line-height:1.15;text-align:center}
.media-desk__operations strong{font-size:11px}.media-desk__operations small{font-size:11px}
.media-desk__operations i{grid-column:1/-1;max-width:none;overflow:hidden;font-size:11px;text-align:left;text-overflow:ellipsis;white-space:nowrap}
.media-desk__operations button:disabled i{color:var(--fg-3)}
.media-desk__engine small,.media-desk__workspace header p,.media-desk__operation>header>small,.media-desk__directory small,.media-desk__result>b,.media-desk__result small,.media-desk__clip>header small,.media-desk__clip label span,.media-desk__clip p{font-size:11px}
@media(max-width:720px){.media-desk__operations{grid-template-columns:1fr}.media-desk__operations i{display:block}}
@media(min-width:721px) and (max-width:1080px){
  .media-desk__workspace{grid-template-columns:minmax(210px,.78fr) minmax(0,1.42fr)}
  .media-desk__source{grid-column:1;grid-row:1;border-right:1px solid var(--line-weak)}
  .media-desk__operation{grid-column:2;grid-row:1/3}
  .media-desk__output{display:block;grid-column:1;grid-row:2;border-top:1px solid var(--line-weak);border-right:1px solid var(--line-weak);border-left:0}
  .media-desk__directory{margin-top:14px}.media-desk__run,.media-desk__cancel{margin-top:10px}
  .media-desk__status{min-height:42px;margin-top:10px}.media-desk__result{margin-top:9px}
}
.media-desk__result--interactive:hover{border-color:color-mix(in srgb,var(--green) 48%,var(--line));background:color-mix(in srgb,var(--green-bg) 72%,var(--surface-raised))}
.media-desk__result--interactive:focus-visible{box-shadow:0 0 0 3px color-mix(in srgb,var(--green) 19%,transparent)}
.media-desk__source-card.locked{cursor:wait;filter:saturate(.78)}
.media-desk__operations button:hover:not(:disabled){border-color:color-mix(in srgb,var(--green) 38%,var(--line));transform:translateX(2px)}
.media-desk__operations button:disabled{cursor:not-allowed;opacity:.62;transform:none}
.media-desk__run,.media-desk__cancel{display:flex;justify-content:center;width:100%;margin-top:12px}
.media-desk__cancel{align-items:center;gap:7px;min-height:38px;border:1px solid color-mix(in srgb,var(--danger) 42%,var(--line));border-radius:10px;background:var(--danger-soft);color:var(--danger);font:700 11px var(--font-ui)}
.media-desk__cancel:hover:not(:disabled){border-color:var(--danger);background:var(--danger-soft)}
.media-desk__cancel:disabled{cursor:wait;opacity:.72}
.media-desk__cancel:focus-visible{outline:2px solid color-mix(in srgb,var(--danger) 58%,transparent);outline-offset:2px}
.media-desk__progress{display:grid;grid-column:1/-1;grid-template-columns:minmax(0,1fr) auto;gap:6px 10px;align-items:end;min-height:66px;margin-top:14px;color:var(--muted)}
.media-desk__progress span{display:grid;gap:3px;min-width:0}.media-desk__progress b{color:var(--text);font:700 11px var(--font-ui)}
.media-desk__progress small{overflow:hidden;font:11px var(--font-mono);line-height:1.4;text-overflow:ellipsis;white-space:nowrap}
.media-desk__progress strong{color:var(--green-strong);font:700 13px var(--font-mono)}
.media-desk__progress progress{grid-column:1/-1;width:100%;height:5px;accent-color:var(--green)}
.media-desk__clip{display:grid;gap:9px;margin-top:10px;padding:11px;border:1px solid color-mix(in srgb,var(--green) 24%,var(--line));border-radius:11px;background:color-mix(in srgb,var(--green-bg) 58%,var(--surface-raised))}.media-desk__clip>header{display:flex;justify-content:space-between}.media-desk__clip>header b{color:var(--text);font:700 11px var(--font-ui)}.media-desk__clip>header small{color:var(--green-strong);font:700 11px var(--font-mono)}.media-desk__clip>div{display:grid;grid-template-columns:1fr auto 1fr;gap:7px;align-items:end}.media-desk__clip label{display:grid;gap:4px}.media-desk__clip label span{color:var(--muted);font:700 11px var(--font-mono)}.media-desk__clip input{width:100%;min-width:0;height:32px;padding:0 8px;border:1px solid var(--line);border-radius:7px;background:var(--surface-raised);color:var(--text);font:700 11px var(--font-mono)}.media-desk__clip input:focus{border-color:var(--green);outline:2px solid color-mix(in srgb,var(--green) 25%,transparent);outline-offset:1px}.media-desk__clip>div>i{padding-bottom:8px;color:var(--muted);font:11px var(--font-mono);font-style:normal}.media-desk__clip figure{position:relative;height:5px;margin:0;border-radius:99px;background:var(--accent-soft)}.media-desk__clip figure span{position:absolute;top:0;bottom:0;left:var(--clip-start);right:calc(100% - var(--clip-end));min-width:3px;border-radius:inherit;background:var(--green)}.media-desk__clip p{min-height:24px;margin:0;color:var(--muted);font-size:11px;line-height:1.5}.media-desk__clip p.error{color:var(--danger)}
</style>
