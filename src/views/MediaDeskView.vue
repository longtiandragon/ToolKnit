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
const subtitlePath = ref('')
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
const subtitleName = computed(() => subtitlePath.value.split(/[\\/]/).filter(Boolean).at(-1) || '')
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
const canRun = computed(() => desktop && engine.value.available && Boolean(source.value?.path) && Boolean(outputDirectory.value) && !running.value && selectedOperationAvailable.value && (!['trim-clip', 'lossless-clip'].includes(operation.value) || Boolean(clipValidation.value.range)) && (operation.value !== 'add-subtitle' || Boolean(subtitlePath.value)))
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

function trackLabel(kind: string) {
  return kind === 'video' ? '视频' : kind === 'audio' ? '音频' : kind === 'subtitle' ? '字幕' : kind
}

function trackDetail(track: NonNullable<MediaFileInfo['tracks']>[number]) {
  const shape = track.kind === 'video' && track.width && track.height ? `${track.width}×${track.height}` : track.kind === 'audio' && track.channels ? `${track.channels} 声道` : ''
  return [track.codec, shape, track.language, track.title].filter(Boolean).join(' · ')
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

async function chooseSubtitle() {
  if (!desktop || selecting.value || running.value) return
  if (qaPreview) {
    subtitlePath.value = 'F:\\Subtitles\\数据结构复习课.srt'
    notice.value = '已选择“数据结构复习课.srt”。生成时会封装为新的 MKV 字幕轨。'
    return
  }
  selecting.value = true
  try {
    const { open } = await import('@tauri-apps/plugin-dialog')
    const selected = await open({
      title: '选择要加入的字幕', multiple: false,
      filters: [{ name: '字幕文件', extensions: ['srt', 'vtt', 'ass', 'ssa', 'sub', 'smi'] }],
    })
    if (typeof selected === 'string') {
      subtitlePath.value = selected
      notice.value = `已选择“${selected.split(/[\\/]/).filter(Boolean).at(-1) || selected}”；输出会生成新的 MKV 文件。`
    }
  } catch (error) { notice.value = error instanceof Error ? error.message : '无法打开字幕文件选择器。' }
  finally { selecting.value = false }
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
  if (nextOperation === 'add-subtitle') void chooseSubtitle()
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
    const sourceExtension = source.value.name.split('.').at(-1) || 'mkv'
    const extension = operation.value === 'extract-mp3' ? 'mp3' : operation.value === 'transcode-m4a' ? 'm4a' : operation.value === 'transcode-wav' ? 'wav' : operation.value === 'normalize-audio' ? (source.value.videoCodec ? 'mkv' : 'm4a') : operation.value === 'extract-subtitle' ? 'srt' : operation.value === 'extract-cover' ? 'jpg' : operation.value === 'add-subtitle' ? 'mkv' : ['remove-audio', 'remove-subtitles', 'clean-metadata'].includes(operation.value) ? sourceExtension : 'mp4'
    const name = `数据结构复习课-knitspace-${operation.value}.${extension}`
    output.value = { path: `F:\\Knitspace\\Outputs\\${name}`, name, size: 82_417_664, elapsedMs: 12_400 }
    notice.value = 'QA 输出已生成；预览没有运行 FFmpeg，也没有写入 Vault 或任务历史。'
    running.value = false
    return
  }
  const runId = newId()
  const clipRange = ['trim-clip', 'lossless-clip'].includes(operation.value) ? clipValidation.value.range : undefined
  if (['trim-clip', 'lossless-clip'].includes(operation.value) && !clipRange) return
  activeRunId.value = runId
  running.value = true
  cancelling.value = false
  mediaProgress.value = 5
  lastPersistedProgress = 5
  lastProgressStoreWrite = performance.now()
  const task = store.addJob('media', `媒体 · ${selectedOperation.value.title}`, [source.value.name], {
    toolId: `media:${operation.value}`, route: '/media', retryable: true,
    inputs: [{ name: source.value.name, path: source.value.path, size: source.value.size }],
    parameters: { operation: operation.value, outputDirectory: outputDirectory.value, runId, ...(subtitlePath.value ? { subtitlePath: subtitlePath.value } : {}), ...(clipRange ? { startSeconds: clipRange.startSeconds, durationSeconds: clipRange.durationSeconds } : {}) },
  })
  activeJobId.value = task.id
  store.updateJob(task.id, { status: 'running', progress: 5, detail: '正在启动本机 FFmpeg；媒体不会进入页面内存。' })
  notice.value = `正在处理“${source.value.name}”；可以随时停止，原文件不会被修改。`
  try {
    const result = await transcodeDesktopMedia({ inputPath: source.value.path, outputDir: outputDirectory.value, operation: operation.value, runId, ...(subtitlePath.value ? { subtitlePath: subtitlePath.value } : {}), ...(clipRange ? { startSeconds: clipRange.startSeconds, durationSeconds: clipRange.durationSeconds } : {}) })
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
  const hasAudio = Boolean(source.value.audioCodec)
  const hasVideo = Boolean(source.value.videoCodec)
  const hasSubtitle = Boolean(source.value.tracks?.some((track) => track.kind === 'subtitle'))
  const hasMedia = hasAudio || hasVideo
  const quickActions = 1 + 3 + Number(hasAudio) * 2 + Number(hasVideo) * 3 + Number(hasSubtitle) * 2 + Number(hasMedia) * 2
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
  <!-- No `media-desk__*` classes: two scoped blocks, ~130 declarations, most
       of them `color-mix(in srgb, var(--green) …)` from before the theme
       tokens existed, and a workspace pinned to 474px. -->
  <div class="page-enter h-full mx-auto w-full max-w-320 px-8 py-6" @click="closeContextMenus">
    <PageHeader title="媒体转换台" subtitle="先读元信息再决定；每次只完成一个明确的输出">
      <template #actions>
        <button class="btn-default" :disabled="refreshing" :title="engine.version || '检查媒体引擎'" @click.stop="refreshEngine">
          <i class="w-1.5 h-1.5 rounded-full shrink-0" :class="engine.available ? 'bg-success' : 'bg-warn'" aria-hidden="true" />
          {{ engine.available ? 'FFmpeg 已就绪' : 'FFmpeg 未就绪' }}
        </button>
      </template>
    </PageHeader>

    <section class="flex-1 min-h-0 grid grid-cols-[minmax(240px,280px)_minmax(0,1fr)_minmax(280px,320px)] panel overflow-hidden" :class="!desktop || !engine.available ? 'opacity-80' : ''">
      <!-- ── 01 Input ──────────────────────────────────────────────────── -->
      <aside class="stack min-h-0 border-r border-line" aria-label="输入">
        <header class="row gap-2 shrink-0 px-3 h-10 border-b border-line">
          <span class="center w-5.5 h-5.5 shrink-0 rounded-sm bg-accent-soft font-mono text-[11px] font-semibold text-accent">01</span>
          <b class="text-[11px] font-semibold text-fg-3">本地媒体</b>
        </header>

        <div class="flex-1 min-h-0 overflow-y-auto stack gap-2 p-3">
          <button
            v-if="!source"
            class="stack items-center justify-center gap-2 min-h-52 p-6 rounded-md border border-dashed border-line-strong bg-well text-center transition-colors duration-120 hover:not-disabled:border-accent hover:not-disabled:bg-accent-soft disabled:opacity-45 disabled:cursor-not-allowed"
            :disabled="!desktop || selecting || running"
            @click="chooseSource"
          >
            <AppIcon name="play" :size="24" class="text-accent" />
            <b class="text-[13px] font-medium text-fg">{{ selecting ? '正在打开选择器…' : '选择或拖入音视频' }}</b>
            <small class="text-[11px] leading-relaxed text-fg-3">MP4 · MOV · MKV · MP3 · WAV · M4A…</small>
            <small class="text-[11px] text-accent">桌面文件可直接拖到窗口</small>
          </button>

          <article
            v-else
            class="stack gap-2 p-3 rounded-md border border-line bg-well"
            :class="running ? 'cursor-wait opacity-80' : 'cursor-context-menu'"
            tabindex="0"
            role="button"
            aria-haspopup="menu"
            :aria-expanded="Boolean(sourceMenu)"
            :aria-disabled="running"
            :aria-label="running ? `${source.name} 正在转换，媒体操作暂时锁定。` : `${source.name}，按右键或菜单键打开操作。`"
            @click.stop
            @contextmenu="openSourceMenu"
            @keydown="handleSourceKeydown"
          >
            <div class="row gap-2.5">
              <span class="center w-9 h-9 shrink-0 rounded-sm bg-surface border border-line text-accent">
                <AppIcon :name="source.videoCodec ? 'play' : 'file-text'" :size="18" />
              </span>
              <span class="stack gap-0.5 min-w-0 flex-1">
                <strong class="text-[12px] font-medium truncate text-fg">{{ source.name }}</strong>
                <small class="text-[11px] truncate font-mono text-fg-3">{{ sourceSummary }}</small>
              </span>
              <i class="shrink-0 font-mono text-[11px] not-italic tabular-nums text-fg-2">{{ formatSize(source.size) }}</i>
            </div>
            <footer class="row gap-3 pt-2 border-t border-line font-mono text-[11px] tabular-nums text-fg-3">
              <span>{{ formatDuration(source.durationSeconds) }}</span>
              <span v-if="source.bitRate">{{ Math.round(source.bitRate / 1000) }} kbps</span>
            </footer>
            <ul v-if="source.tracks?.length" class="stack gap-1 pt-2 border-t border-line">
              <li v-for="track in source.tracks" :key="track.index" class="row gap-2 text-[11px] text-fg-3">
                <span class="w-8 shrink-0 text-fg-2">{{ trackLabel(track.kind) }} {{ track.index + 1 }}</span>
                <span class="min-w-0 truncate" :title="trackDetail(track)">{{ trackDetail(track) }}</span>
              </li>
            </ul>
          </article>

          <p v-if="inspecting" class="row gap-1.5 text-[11px] text-fg-3"><AppIcon name="clock" :size="13" />正在读取编码、时长和轨道…</p>
          <button v-else-if="source" class="btn-default btn-sm" :disabled="running" @click="chooseSource">更换文件</button>
        </div>
      </aside>

      <!-- ── 02 Output format ──────────────────────────────────────────── -->
      <main class="stack min-h-0" aria-label="选择输出">
        <header class="row gap-2 shrink-0 px-3 h-10 border-b border-line">
          <span class="center w-5.5 h-5.5 shrink-0 rounded-sm bg-accent-soft font-mono text-[11px] font-semibold text-accent">02</span>
          <b class="text-[11px] font-semibold text-fg-3">选择输出</b>
          <small class="ml-auto text-[11px] text-fg-3">原件保持只读</small>
        </header>

        <div class="flex-1 min-h-0 overflow-y-auto stack gap-3 p-3">
          <div class="grid grid-cols-2 gap-2">
            <button
              v-for="item in mediaOperations"
              :key="item.id"
              class="stack gap-1.5 p-2.5 rounded-md border text-left transition-colors duration-120 disabled:opacity-50 disabled:cursor-not-allowed"
              :class="operation === item.id
                ? 'border-accent bg-accent-soft'
                : 'border-line bg-well hover:not-disabled:border-line-strong hover:not-disabled:bg-surface-2'"
              :disabled="running || !mediaOperationAvailable(item, source)"
              :aria-pressed="operation === item.id"
              :title="mediaOperationUnavailableReason(item, source) || item.detail"
              @click="selectOperation(item.id)"
            >
              <span class="row gap-2.5">
                <b
                  class="center shrink-0 w-10 h-10 rounded-sm font-mono text-[11px] font-semibold leading-tight text-center"
                  :class="operation === item.id ? 'bg-accent-solid text-accent-fg' : 'bg-surface border border-line text-fg-2'"
                >
                  {{ item.extension }}
                </b>
                <span class="stack gap-0.5 min-w-0">
                  <strong class="text-[12px] font-medium truncate" :class="operation === item.id ? 'text-accent' : 'text-fg'">{{ item.title }}</strong>
                  <small class="text-[11px] truncate text-fg-3">{{ item.description }}</small>
                </span>
              </span>
              <i class="text-[11px] not-italic truncate" :class="mediaOperationUnavailableReason(item, source) ? 'text-warn' : 'text-fg-3'">
                {{ mediaOperationUnavailableReason(item, source) || item.detail }}
              </i>
            </button>
          </div>

          <section v-if="operation === 'trim-clip' || operation === 'lossless-clip'" class="stack gap-2 p-3 rounded-md border border-accent bg-accent-soft" aria-label="媒体截取区间">
            <header class="row-between gap-2">
              <b class="text-[12px] font-medium text-fg">截取区间</b>
              <small class="font-mono text-[11px] tabular-nums text-accent">{{ clipValidation.range ? `共 ${formatDuration(clipValidation.range.durationSeconds)}` : '等待有效时间' }}</small>
            </header>
            <div class="row items-end gap-2">
              <label class="stack gap-1.5 min-w-0 flex-1">
                <span class="text-[11px] text-fg-3">开始</span>
                <input ref="clipStartInput" v-model.trim="clipStart" class="field h-8 font-mono text-[12px]" inputmode="decimal" placeholder="0:00" aria-label="片段开始时间" />
              </label>
              <span class="pb-2 text-fg-3" aria-hidden="true">→</span>
              <label class="stack gap-1.5 min-w-0 flex-1">
                <span class="text-[11px] text-fg-3">结束</span>
                <input v-model.trim="clipEnd" class="field h-8 font-mono text-[12px]" inputmode="decimal" placeholder="1:00" aria-label="片段结束时间" />
              </label>
            </div>
            <figure class="relative h-1.5 m-0 rounded-full bg-surface-2" :style="clipTrackStyle" aria-hidden="true">
              <span class="absolute inset-y-0 min-w-1 rounded-full bg-accent-solid left-[var(--clip-start)] right-[calc(100%_-_var(--clip-end))]" />
            </figure>
            <p class="text-[11px] leading-relaxed" :class="clipValidation.error ? 'text-danger' : 'text-fg-3'" role="status">
              {{ clipValidation.error || (operation === 'lossless-clip' ? '支持秒数、mm:ss 或 hh:mm:ss；使用原始轨道复制，速度快且不损失画质。' : '支持秒数、mm:ss 或 hh:mm:ss；输出会重新编码以获得稳定片段。') }}
            </p>
          </section>

          <section v-if="operation === 'add-subtitle'" class="stack gap-2 p-3 rounded-md border border-accent bg-accent-soft" aria-label="加入外部字幕">
            <header class="row-between gap-2">
              <b class="text-[12px] font-medium text-fg">加入字幕轨</b>
              <small class="font-mono text-[11px] text-accent">输出 MKV</small>
            </header>
            <button class="row gap-2.5 p-2.5 rounded-md border border-line bg-well text-left transition-colors duration-120 hover:not-disabled:border-line-strong disabled:opacity-45" :disabled="running || selecting" @click="chooseSubtitle">
              <AppIcon name="file-text" :size="16" class="shrink-0 text-accent" />
              <span class="stack gap-0.5 min-w-0 flex-1">
                <b class="text-[12px] font-medium truncate text-fg">{{ subtitleName || '选择字幕文件' }}</b>
                <small class="text-[11px] truncate text-fg-3">{{ subtitlePath || '支持 SRT、VTT、ASS、SSA、SUB、SMI，单个最多 5 MB' }}</small>
              </span>
              <AppIcon name="arrow-right" :size="14" class="shrink-0 text-fg-3" />
            </button>
            <p class="text-[11px] leading-relaxed text-fg-3">原媒体与字幕文件保持不变；外部字幕会作为新的文字轨封装进 MKV。</p>
          </section>
        </div>

        <p class="row gap-2 shrink-0 px-3 py-2.5 border-t border-line text-[11px] leading-relaxed text-fg-3">
          <AppIcon name="shield" :size="14" class="shrink-0 mt-0.5 text-success" />
          FFmpeg 在后台运行；不把大媒体文件送进页面内存，也不覆盖你的输入文件。
        </p>
      </main>

      <!-- ── 03 Run ────────────────────────────────────────────────────── -->
      <aside class="stack min-h-0 border-l border-line" aria-label="输出位置">
        <header class="row gap-2 shrink-0 px-3 h-10 border-b border-line">
          <span class="center w-5.5 h-5.5 shrink-0 rounded-sm bg-accent-soft font-mono text-[11px] font-semibold text-accent">03</span>
          <b class="text-[11px] font-semibold text-fg-3">输出位置</b>
        </header>

        <div class="flex-1 min-h-0 overflow-y-auto stack gap-2.5 p-3">
          <button class="row gap-2.5 p-2.5 rounded-md border border-line bg-well text-left transition-colors duration-120 hover:not-disabled:border-line-strong disabled:opacity-45" :disabled="running" @click="chooseOutput">
            <AppIcon name="archive" :size="16" class="shrink-0 mt-0.5 text-accent" />
            <span class="stack gap-0.5 min-w-0 flex-1">
              <b class="text-[12px] font-medium truncate text-fg">{{ outputDirectoryLabel }}</b>
              <small class="text-[11px] truncate font-mono text-fg-3">{{ outputDirectory || '选择一个本地文件夹' }}</small>
            </span>
            <AppIcon name="arrow-right" :size="14" class="shrink-0 mt-0.5 text-fg-3" />
          </button>

          <div v-if="running" class="stack gap-2 p-2.5 rounded-md bg-accent-soft" role="status" aria-live="polite">
            <div class="row-between gap-2">
              <b class="text-[12px] font-medium text-accent">本机转换进度</b>
              <strong class="font-mono text-[13px] font-semibold tabular-nums text-accent">{{ mediaProgress }}%</strong>
            </div>
            <progress class="w-full h-1" max="100" :value="mediaProgress" :aria-label="`媒体转换进度 ${mediaProgress}%`" />
            <small class="text-[11px] leading-relaxed text-fg-2">{{ notice }}</small>
          </div>
          <p v-else class="text-[11px] leading-relaxed text-fg-3" role="status">{{ notice }}</p>

          <article
            v-if="output"
            class="stack gap-1 p-2.5 rounded-md border border-success bg-success-soft transition-colors duration-120 cursor-context-menu"
            tabindex="0"
            role="group"
            aria-label="刚刚生成的媒体文件；按右键或菜单键打开操作。"
            aria-haspopup="menu"
            :aria-expanded="Boolean(outputMenu)"
            @click.stop
            @contextmenu="openOutputMenu"
            @keydown="handleOutputKeydown"
          >
            <b class="row gap-1.5 text-[11px] font-semibold text-success"><AppIcon name="check" :size="13" />刚刚生成</b>
            <strong class="text-[12px] font-medium truncate text-fg">{{ output.name }}</strong>
            <small class="font-mono text-[11px] tabular-nums text-fg-3">{{ formatSize(output.size) }} · {{ (output.elapsedMs / 1000).toFixed(1) }} 秒</small>
            <button class="self-start mt-1 text-[11px] font-medium text-success underline underline-offset-2" @click.stop="revealOutput">打开文件位置</button>
          </article>
        </div>

        <footer class="shrink-0 p-3 border-t border-line">
          <button v-if="!running" class="btn-primary w-full" :disabled="!canRun" @click="run">
            <AppIcon name="play" :size="15" />生成 {{ selectedOperation.extension }}
          </button>
          <button v-else class="btn-danger w-full" :disabled="cancelling" @click="cancelRun">
            <AppIcon name="clock" :size="15" />{{ cancelling ? '正在停止…' : '停止本次转换' }}
          </button>
        </footer>
      </aside>
    </section>

    <Teleport to="body">
      <div
        v-if="sourceMenu"
        ref="sourceMenuElement"
        class="menu-panel w-56"
        role="menu"
        aria-label="媒体文件操作"
        :style="{ left: `${sourceMenu.x}px`, top: `${sourceMenu.y}px` }"
        @click.stop
        @contextmenu.prevent
        @keydown.stop="handleSourceMenuKeydown"
      >
        <p class="menu-title">当前媒体</p>
        <button v-if="source?.audioCodec" class="menu-item" role="menuitem" @click="selectOperationFromSource('extract-mp3')">提取音轨为 MP3</button>
        <button v-if="source?.audioCodec" class="menu-item" role="menuitem" @click="selectOperationFromSource('transcode-wav')">转为语音 WAV</button>
        <button v-if="source?.audioCodec" class="menu-item" role="menuitem" @click="selectOperationFromSource('normalize-audio')">标准化音量</button>
        <button v-if="source?.videoCodec" class="menu-item" role="menuitem" @click="selectOperationFromSource('mute-video')">生成静音视频</button>
        <button v-if="source?.videoCodec" class="menu-item" role="menuitem" @click="selectOperationFromSource('remove-audio')">无损移除音轨</button>
        <button v-if="source?.tracks?.some((track) => track.kind === 'subtitle')" class="menu-item" role="menuitem" @click="selectOperationFromSource('extract-subtitle')">提取字幕为 SRT</button>
        <button v-if="source?.tracks?.some((track) => track.kind === 'subtitle')" class="menu-item" role="menuitem" @click="selectOperationFromSource('remove-subtitles')">无损移除字幕轨</button>
        <button v-if="source?.videoCodec" class="menu-item" role="menuitem" @click="selectOperationFromSource('extract-cover')">提取视频封面</button>
        <button v-if="source?.audioCodec || source?.videoCodec" class="menu-item" role="menuitem" @click="selectOperationFromSource('clean-metadata')">清除媒体元数据</button>
        <button v-if="source?.audioCodec || source?.videoCodec" class="menu-item" role="menuitem" @click="selectOperationFromSource('add-subtitle')">加入外部字幕…</button>
        <button class="menu-item" role="menuitem" @click="selectClipFromSource">截取这段媒体…</button>
        <i class="menu-sep" aria-hidden="true" />
        <button class="menu-item" role="menuitem" @click="reInspect">重新读取信息</button>
        <button class="menu-item" role="menuitem" @click="revealSource">在文件夹显示</button>
        <button class="menu-item menu-item-danger" role="menuitem" @click="clearSource">移除当前文件</button>
      </div>

      <div
        v-if="outputMenu"
        ref="outputMenuElement"
        class="menu-panel w-56"
        role="menu"
        aria-label="媒体输出操作"
        :style="{ left: `${outputMenu.x}px`, top: `${outputMenu.y}px` }"
        @click.stop
        @contextmenu.prevent
        @keydown.stop="handleOutputMenuKeydown"
      >
        <p class="menu-title">刚刚生成</p>
        <button class="menu-item" role="menuitem" @click="revealOutput">打开文件位置</button>
        <button class="menu-item" role="menuitem" @click="saveOutputAsCopy">另存为…</button>
        <button class="menu-item" role="menuitem" @click="copyOutputPath">复制输出路径</button>
      </div>
    </Teleport>
  </div>
</template>
