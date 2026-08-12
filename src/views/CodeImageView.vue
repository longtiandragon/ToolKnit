<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { toBlob } from 'html-to-image'
import { calculateCodeLayout, codeLongImageFileNames, estimateCodeCapturePageBodyHeight, groupCodeCapturePages, type CodeLayout } from '@/lib/code-layout'
import { getBoundedCacheValue, setBoundedCacheValue } from '@/lib/bounded-lru-cache'
import { codeLanguages, detectCodeLanguage, highlightCode, type CodeLanguage } from '@/lib/code-highlight'
import { clampMenuPosition, isContextMenuShortcut, nextMenuItemIndex } from '@/lib/desktop-menu'
import { codeDraftPersistDelay } from '@/lib/workspace-persistence'
import { useWorkbenchStore } from '@/stores/workbench'
import { useUiStore } from '@/stores/ui'
import { chooseOutputDirectory, exportOutput } from '@/lib/output'
import { copyPngToClipboard, copyStagedPngFiles, isDesktop, revealDesktopFile, setClipboardMonitor, stagePngClipboardFile } from '@/lib/native'
import type { FileReference } from '@/types'
import FileDropZone from '@/components/FileDropZone.vue'
import CodeSnapCard from '@/components/CodeSnapCard.vue'
import AppIcon from '@/components/AppIcon.vue'
import PageHeader from '@/components/PageHeader.vue'
import LargeTextEditor from '@/components/LargeTextEditor.vue'

interface LargeTextEditorHandle { flush: () => string; getValue: () => string }
type LongProgressPhase = 'render' | 'encode' | 'clipboard' | 'write'

const store = useWorkbenchStore()
const ui = useUiStore()
const codeFiles = ref<File[]>(store.consumeIntakeFiles())
const codeEditor = ref<LargeTextEditorHandle>()
const captureHost = ref<HTMLElement>()
const capturePageIndex = ref(0)
const longCaptureHost = ref<HTMLElement>()
const longActionsMenu = ref<HTMLDetailsElement>()
const longCaptureIndexes = ref<number[]>([])
const exporting = ref(false)
const copying = ref(false)
const copyPreparing = ref(false)
const copyProgress = ref({ current: 0, total: 0 })
const longProgress = ref({ active: false, current: 0, total: 0, phase: 'render' as LongProgressPhase })
const longElapsedSeconds = ref(0)
const lastOutputs = ref<FileReference[]>([])
const activePage = ref(0)
const selectedPages = ref(new Set([0]))
const previewStage = ref<HTMLElement>()
const contextMenu = ref({ open: false, x: 0, y: 0, page: 0 })
const contextMenuElement = ref<HTMLElement>()
let previewMenuTrigger: HTMLElement | undefined
let codeReadVersion = 0
let renderVersion = 0
let activeCaptures = 0
const pendingCaptures: Array<() => void> = []
let longElapsedTimer: number | undefined
let previewUpdateTimer: number | undefined
let draftSaveTimer: number | undefined
let codeLayoutWorker: Worker | undefined
let codeLayoutRevision = 0
let longCaptureRequestId = 0
const pageBlobCache = new Map<string, Promise<Blob>>()
const stagedPathCache = new Map<string, Promise<string>>()
const stagedReadyKeys = new Set<string>()
const longBlobCache = new Map<string, Promise<{ blob: Blob; pageIndexes: number[] }>>()
const highlightedPageCache = new Map<string, { source: string; result: string }>()
const LONG_IMAGE_PIXEL_RATIO = 2
const LONG_IMAGE_MAX_HEIGHT = 30_000
const LONG_IMAGE_MAX_PIXELS = 60_000_000
// PNGs and highlighted HTML are much heavier than their page metadata. Keep
// recent interaction snappy without letting a very long code file accumulate
// every rendered page in the desktop WebView.
const MAX_PAGE_BLOB_CACHE_ENTRIES = 12
const MAX_LONG_BLOB_CACHE_ENTRIES = 1
const MAX_HIGHLIGHT_CACHE_ENTRIES = 16

const code = ref(store.codeDraft?.content ?? '')
const renderedCode = ref(code.value)
const previewPending = ref(false)
const layoutPending = ref(false)
const draftPending = ref(false)
const sourceName = ref(store.codeDraft?.name ?? 'snippet.txt')
const languageOverride = ref<'auto' | CodeLanguage>('auto')
const theme = ref<'midnight' | 'forest' | 'paper'>('midnight')
const showLineNumbers = ref(true)
// Dev HMR can preserve a settings object created before codeImageAuthor existed.
// Normalize it here so opening this lazy route never crashes on undefined.trim().
const author = ref(store.settings.codeImageAuthor ?? '')
const detectedLanguage = computed(() => detectCodeLanguage(sourceName.value, renderedCode.value))
const language = computed<CodeLanguage>(() => languageOverride.value === 'auto' ? detectedLanguage.value : languageOverride.value)
const codeLayout = shallowRef<CodeLayout>(calculateCodeLayout(renderedCode.value))
const fontSize = computed(() => codeLayout.value.fontSize)
const linesPerPage = computed(() => codeLayout.value.linesPerPage)
const wrapLongLines = computed(() => codeLayout.value.longestLine > 92)
const byline = computed(() => `BY ${String(author.value ?? '').trim() || 'author'}`)
const pages = computed(() => codeLayout.value.pages)
const renderedLineCount = computed(() => codeLayout.value.lineCount)
const selectedPageIndexes = computed(() => [...selectedPages.value].filter((index) => index < pages.value.length).sort((a, b) => a - b))
const visiblePageIndexes = computed(() => {
  const length = pages.value.length
  if (length <= 80) return Array.from({ length }, (_, index) => index)
  const start = Math.max(0, Math.min(length - 61, activePage.value - 30))
  return Array.from({ length: 61 }, (_, offset) => start + offset)
})
const copyLabel = computed(() => selectedPageIndexes.value.length > 1 ? `复制已选 ${selectedPageIndexes.value.length} 页` : '复制图片')
const copyBusyLabel = computed(() => copyProgress.value.total > 1
  ? copyPreparing.value ? `首次生成 ${copyProgress.value.current}/${copyProgress.value.total}` : '正在复制…'
  : '正在复制…')
const longProgressPercent = computed(() => Math.round(longProgress.value.current / Math.max(1, longProgress.value.total) * 100))
const longProgressLabel = computed(() => longProgress.value.phase === 'render'
  ? `步骤 1/3 · 生成代码段 ${longProgress.value.current}/${longProgress.value.total}`
  : longProgress.value.phase === 'encode' ? '步骤 2/3 · 合成长图分段'
    : longProgress.value.phase === 'write' ? '步骤 3/3 · 保存连续 PNG' : '步骤 3/3 · 写入系统剪贴板')
const longProgressDetail = computed(() => longProgress.value.phase === 'render'
  ? `已真实完成 ${longProgress.value.current} / ${longProgress.value.total} 段`
  : longProgress.value.phase === 'encode' ? '超出单张安全上限的内容会自动拆分，不丢代码行'
    : longProgress.value.phase === 'write' ? '正在写入输出目录；全部文件确认完成后才会结束' : '正在写入已压缩的 PNG；系统返回成功后才会结束')

class LongCaptureCancelledError extends Error {
  constructor() {
    super('已停止当前连续长图生成。')
    this.name = 'LongCaptureCancelledError'
  }
}

function ensureLongCaptureActive(requestId: number) {
  if (requestId !== longCaptureRequestId) throw new LongCaptureCancelledError()
}

function updateLongProgress(requestId: number, progress: typeof longProgress.value) {
  ensureLongCaptureActive(requestId)
  longProgress.value = progress
}

function pageCacheKey(index: number) {
  return `${renderVersion}:${index}`
}

function highlightedPage(index: number) {
  const key = `${language.value}:${index}`
  const source = pages.value[index] ?? ''
  const cached = getBoundedCacheValue(highlightedPageCache, key)
  if (cached?.source === source) return cached.result
  const result = highlightCode(source, language.value)
  setBoundedCacheValue(highlightedPageCache, key, { source, result }, MAX_HIGHLIGHT_CACHE_ENTRIES)
  return result
}

function pageLineCount(index: number) {
  return codeLayout.value.pageLineCounts[index] ?? 1
}

function startLongElapsedTimer() {
  stopLongElapsedTimer()
  const startedAt = performance.now()
  longElapsedSeconds.value = 0
  longElapsedTimer = window.setInterval(() => { longElapsedSeconds.value = (performance.now() - startedAt) / 1000 }, 100)
}

function stopLongElapsedTimer() {
  if (longElapsedTimer !== undefined) window.clearInterval(longElapsedTimer)
  longElapsedTimer = undefined
}

function invalidatePageCache() {
  if (longProgress.value.active) longCaptureRequestId++
  renderVersion++
  pageBlobCache.clear()
  stagedPathCache.clear()
  stagedReadyKeys.clear()
  longBlobCache.clear()
  highlightedPageCache.clear()
}

function requestCodeLayout(source: string) {
  const requestId = ++codeLayoutRevision
  layoutPending.value = true
  if (!codeLayoutWorker) {
    codeLayout.value = calculateCodeLayout(source)
    layoutPending.value = false
    return
  }
  codeLayoutWorker.postMessage({ id: requestId, source })
}

function startCodeLayoutWorker() {
  if (typeof Worker === 'undefined') return
  try {
    const worker = new Worker(new URL('../workers/code-layout.worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = ({ data }: MessageEvent<{ id: number; layout: CodeLayout }>) => {
      if (data.id !== codeLayoutRevision) return
      codeLayout.value = data.layout
      layoutPending.value = false
    }
    worker.onerror = () => {
      worker.terminate()
      if (codeLayoutWorker === worker) codeLayoutWorker = undefined
      codeLayout.value = calculateCodeLayout(renderedCode.value)
      layoutPending.value = false
    }
    codeLayoutWorker = worker
    requestCodeLayout(renderedCode.value)
  } catch {
    // Older embedded WebViews can still use the same pure calculation without
    // losing correctness; modern desktop builds stay off the main thread.
    codeLayout.value = calculateCodeLayout(renderedCode.value)
    layoutPending.value = false
  }
}

watch([renderedCode, languageOverride, theme, showLineNumbers, author, fontSize, linesPerPage], invalidatePageCache, { flush: 'post' })
watch(renderedCode, requestCodeLayout, { immediate: true })

watch(() => store.codeDraft, (draft) => {
  if (!draft || draft.content === code.value) return
  code.value = draft.content
  sourceName.value = draft.name
  languageOverride.value = 'auto'
})

watch(code, (content) => {
  previewPending.value = true
  if (previewUpdateTimer !== undefined) window.clearTimeout(previewUpdateTimer)
  previewUpdateTimer = window.setTimeout(() => {
    renderedCode.value = content
    previewPending.value = false
    previewUpdateTimer = undefined
  }, 180)
}, { flush: 'post' })

watch([code, sourceName], ([content, name]) => {
  draftPending.value = true
  if (draftSaveTimer !== undefined) window.clearTimeout(draftSaveTimer)
  draftSaveTimer = window.setTimeout(() => {
    store.prepareCodeDraft(content, name || 'snippet.txt')
    draftPending.value = false
    draftSaveTimer = undefined
  }, codeDraftPersistDelay(content.length))
}, { flush: 'post' })

function flushCodeDraft() {
  const editorValue = codeEditor.value?.getValue()
  if (editorValue !== undefined && editorValue !== code.value) code.value = editorValue
  if (draftSaveTimer !== undefined) window.clearTimeout(draftSaveTimer)
  draftSaveTimer = undefined
  store.prepareCodeDraft(code.value, sourceName.value || 'snippet.txt')
  draftPending.value = false
}

async function syncRenderedCode() {
  const editorValue = codeEditor.value?.getValue()
  if (editorValue !== undefined && editorValue !== code.value) code.value = editorValue
  codeEditor.value?.flush()
  if (previewUpdateTimer !== undefined) window.clearTimeout(previewUpdateTimer)
  previewUpdateTimer = undefined
  if (renderedCode.value !== code.value) renderedCode.value = code.value
  previewPending.value = false
  await nextTick()
}

watch(author, (value) => store.updateSettings({ codeImageAuthor: value ?? '' }))
watch(() => store.settings.codeImageAuthor, (value) => {
  const normalized = value ?? ''
  if (normalized !== author.value) author.value = normalized
})

watch(codeFiles, async (files) => {
  const file = files[0]
  const version = ++codeReadVersion
  if (!file) return
  try {
    const text = await file.text()
    if (version !== codeReadVersion || codeFiles.value[0] !== file) return
    code.value = text
    sourceName.value = file.name
    languageOverride.value = 'auto'
    activePage.value = 0
  } catch (error) {
    if (version === codeReadVersion) ui.toast('无法读取代码文件', error instanceof Error ? error.message : '文件读取失败。', 'error')
  }
}, { immediate: true })

watch(() => pages.value.length, (length) => {
  if (activePage.value >= length) activePage.value = Math.max(0, length - 1)
  selectedPages.value = new Set([...selectedPages.value].filter((index) => index < length))
  if (!selectedPages.value.size) selectedPages.value.add(activePage.value)
})

const inputReferences = () => codeFiles.value.map((file) => ({ name: file.name, size: file.size, mime: file.type, path: (file as File & { path?: string }).path }))

async function ensureDirectory() {
  if (isDesktop() && !store.settings.outputDirectory) {
    const directory = await chooseOutputDirectory()
    if (!directory) return false
    store.updateSettings({ outputDirectory: directory })
  }
  return true
}

function yieldToRenderer() {
  return new Promise<void>((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)))
}

async function runCaptureTask<T>(task: () => Promise<T>, priority = false) {
  if (activeCaptures >= 1) await new Promise<void>((resolve) => priority ? pendingCaptures.unshift(resolve) : pendingCaptures.push(resolve))
  activeCaptures++
  try { return await task() }
  finally {
    activeCaptures--
    pendingCaptures.shift()?.()
  }
}

async function renderPage(index: number, version: number) {
  if (version !== renderVersion) throw new Error('代码内容已更新，旧图片生成已取消。')
  capturePageIndex.value = index
  await nextTick()
  await yieldToRenderer()
  if (version !== renderVersion) throw new Error('代码内容已更新，旧图片生成已取消。')
  await document.fonts.ready
  const node = captureHost.value?.querySelector<HTMLElement>('[data-export-frame]')
  if (!node) throw new Error('实时预览尚未准备好。')
  const blob = await toBlob(node, { pixelRatio: 2, cacheBust: false, skipFonts: true })
  if (!blob) throw new Error('无法生成代码图片。')
  return blob
}

function capturePage(index: number) {
  const key = pageCacheKey(index)
  const cached = getBoundedCacheValue(pageBlobCache, key)
  if (cached) return cached

  const version = renderVersion
  const capture = runCaptureTask(() => renderPage(index, version))
  setBoundedCacheValue(pageBlobCache, key, capture, MAX_PAGE_BLOB_CACHE_ENTRIES)
  capture.catch(() => {
    if (pageBlobCache.get(key) === capture) pageBlobCache.delete(key)
  })
  return capture
}

function getStagedPagePath(index: number) {
  const key = pageCacheKey(index)
  const cached = stagedPathCache.get(key)
  if (cached) return cached
  const staged = capturePage(index)
    .then((blob) => stagePngClipboardFile(`code-${String(index + 1).padStart(2, '0')}.png`, blob))
    .then((path) => {
      stagedReadyKeys.add(key)
      return path
    })
  stagedPathCache.set(key, staged)
  staged.catch(() => {
    if (stagedPathCache.get(key) === staged) stagedPathCache.delete(key)
  })
  return staged
}

async function stitchSegmentsOnMainThread(segments: Blob[]) {
  const images = await Promise.all(segments.map((blob) => createImageBitmap(blob)))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(...images.map((image) => image.width))
  canvas.height = images.reduce((height, image) => height + image.height, 0)
  const context = canvas.getContext('2d')
  if (!context) throw new Error('无法创建连续代码长图。')
  let y = 0
  for (const image of images) {
    context.drawImage(image, 0, y)
    y += image.height
    image.close()
  }
  const result = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
  if (!result) throw new Error('无法压缩连续代码长图。')
  return result
}

async function stitchPngSegments(segments: Blob[]) {
  if (typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined') return stitchSegmentsOnMainThread(segments)
  const source = `self.onmessage=async({data})=>{try{const images=await Promise.all(data.map(createImageBitmap));const width=Math.max(...images.map(i=>i.width));const height=images.reduce((n,i)=>n+i.height,0);const canvas=new OffscreenCanvas(width,height);const context=canvas.getContext('2d');let y=0;for(const image of images){context.drawImage(image,0,y);y+=image.height;image.close()}const result=await canvas.convertToBlob({type:'image/png'});self.postMessage({result})}catch(error){self.postMessage({error:error instanceof Error?error.message:String(error)})}}`
  const workerUrl = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }))
  let worker: Worker
  try { worker = new Worker(workerUrl) }
  catch {
    URL.revokeObjectURL(workerUrl)
    return stitchSegmentsOnMainThread(segments)
  }
  try {
    return await new Promise<Blob>((resolve, reject) => {
      worker.onmessage = ({ data }: MessageEvent<{ result?: Blob; error?: string }>) => data.result ? resolve(data.result) : reject(new Error(data.error || '长图后台压缩失败。'))
      worker.onerror = () => reject(new Error('长图后台压缩失败。'))
      worker.postMessage(segments)
    }).catch(() => stitchSegmentsOnMainThread(segments))
  } finally {
    worker.terminate()
    URL.revokeObjectURL(workerUrl)
  }
}

async function writeClipboardSafely(action: () => Promise<void>) {
  const shouldResumeMonitor = store.settings.clipboardEnabled && !store.settings.clipboardPaused
  let monitorPaused = false
  if (shouldResumeMonitor) {
    try {
      await setClipboardMonitor(true, true)
      monitorPaused = true
    } catch {
      // A stale desktop dev process may not expose the monitor command yet.
      // Clipboard writing should still be attempted in that case.
    }
  }
  try {
    await action()
  } finally {
    if (monitorPaused) {
      try { await setClipboardMonitor(true, false) }
      catch { /* 写入结果比恢复监听提示更重要；下次设置同步会恢复状态。 */ }
    }
  }
}

function plannedLongCaptureGroups(indexes: number[]) {
  const outputWidth = 720 * LONG_IMAGE_PIXEL_RATIO
  const maximumHeight = Math.min(LONG_IMAGE_MAX_HEIGHT, Math.floor(LONG_IMAGE_MAX_PIXELS / Math.max(1, outputWidth))) / LONG_IMAGE_PIXEL_RATIO
  return groupCodeCapturePages(indexes.map((index) => ({
    index,
    bodyHeight: estimateCodeCapturePageBodyHeight(pages.value[index] ?? '', fontSize.value, showLineNumbers.value, wrapLongLines.value)
  })), maximumHeight)
}

function captureLongCode(indexes: number[], completedPageCount = 0, totalPageCount = indexes.length, requestId = longCaptureRequestId) {
  const normalized = [...indexes].sort((a, b) => a - b)
  const key = `${renderVersion}:long:${normalized.join(',')}`
  const cached = getBoundedCacheValue(longBlobCache, key)
  if (cached) return cached

  const capture = (async () => {
    ensureLongCaptureActive(requestId)
    longCaptureIndexes.value = normalized
    updateLongProgress(requestId, { active: true, current: completedPageCount, total: totalPageCount, phase: 'render' })
    await nextTick()
    await yieldToRenderer()
    ensureLongCaptureActive(requestId)
    await document.fonts.ready
    ensureLongCaptureActive(requestId)
    const nodes = [...(longCaptureHost.value?.querySelectorAll<HTMLElement>('[data-long-export-frame]') ?? [])]
    if (nodes.length !== normalized.length) throw new Error('连续代码长图尚未准备好。')
    const outputWidth = Math.max(...nodes.map((node) => node.scrollWidth)) * LONG_IMAGE_PIXEL_RATIO
    const outputHeights = nodes.map((node) => node.scrollHeight * LONG_IMAGE_PIXEL_RATIO)
    const safeHeight = Math.min(LONG_IMAGE_MAX_HEIGHT, Math.floor(LONG_IMAGE_MAX_PIXELS / Math.max(1, outputWidth)))
    let safePageCount = 0
    let accumulatedHeight = 0
    for (const height of outputHeights) {
      if (accumulatedHeight + height > safeHeight) break
      accumulatedHeight += height
      safePageCount++
    }
    if (!safePageCount) throw new Error(`第 ${normalized[0] + 1} 张代码图片超过连续长图安全上限，请复制单张或导出 PDF。`)
    const capturedIndexes = normalized.slice(0, safePageCount)
    if (capturedIndexes.length !== normalized.length) {
      // The estimate intentionally stays conservative, but CSS metrics can
      // vary by embedded WebView. Re-render only the exact safe prefix rather
      // than mounting the whole remaining selection again.
      longCaptureIndexes.value = capturedIndexes
      await nextTick()
      await yieldToRenderer()
      ensureLongCaptureActive(requestId)
      nodes.splice(0, nodes.length, ...(longCaptureHost.value?.querySelectorAll<HTMLElement>('[data-long-export-frame]') ?? []))
    }
    const segments: Blob[] = []
    for (let position = 0; position < nodes.length; position++) {
      ensureLongCaptureActive(requestId)
      const blob = await runCaptureTask(() => toBlob(nodes[position], { pixelRatio: LONG_IMAGE_PIXEL_RATIO, cacheBust: false, skipFonts: true }), true)
      ensureLongCaptureActive(requestId)
      if (!blob) throw new Error(`无法生成第 ${position + 1} 段代码图片。`)
      segments.push(blob)
      updateLongProgress(requestId, { active: true, current: completedPageCount + position + 1, total: totalPageCount, phase: 'render' })
      await yieldToRenderer()
    }
    updateLongProgress(requestId, { active: true, current: completedPageCount + nodes.length, total: totalPageCount, phase: 'encode' })
    await yieldToRenderer()
    ensureLongCaptureActive(requestId)
    const blob = await stitchPngSegments(segments)
    ensureLongCaptureActive(requestId)
    return { blob, pageIndexes: capturedIndexes }
  })()
  setBoundedCacheValue(longBlobCache, key, capture, MAX_LONG_BLOB_CACHE_ENTRIES)
  capture.catch(() => {
    if (longBlobCache.get(key) === capture) longBlobCache.delete(key)
  })
  return capture
}

async function captureAdaptiveLongCode(indexes: number[], requestId: number) {
  const queuedGroups = plannedLongCaptureGroups(indexes)
  const captures: Array<{ blob: Blob; pageIndexes: number[] }> = []
  let completedPageCount = 0
  while (queuedGroups.length) {
    ensureLongCaptureActive(requestId)
    const group = queuedGroups.shift() ?? []
    if (!group.length) continue
    const capture = await captureLongCode(group, completedPageCount, indexes.length, requestId)
    ensureLongCaptureActive(requestId)
    captures.push(capture)
    completedPageCount += capture.pageIndexes.length
    const overflow = group.slice(capture.pageIndexes.length)
    if (overflow.length) queuedGroups.unshift(overflow)
  }
  return captures
}

function toggleSelectedPage(index: number) {
  const next = new Set(selectedPages.value)
  if (next.has(index) && next.size > 1) next.delete(index)
  else next.add(index)
  selectedPages.value = next
  activePage.value = index
}

function selectAllPages() {
  selectedPages.value = selectedPages.value.size === pages.value.length
    ? new Set([activePage.value])
    : new Set(pages.value.map((_, index) => index))
}

function showPreviewMenu(page: number, x: number, y: number, trigger: HTMLElement) {
  activePage.value = page
  previewMenuTrigger = trigger
  const menuWidth = 216
  const actionCount = 4 + (pages.value.length > 1 ? 3 : 0) + (selectedPageIndexes.value.length > 1 ? 3 : 0)
  const menuHeight = 64 + actionCount * 36
  const position = clampMenuPosition(x, y, { menuWidth, menuHeight, margin: 12 })
  contextMenu.value = {
    open: true,
    page,
    ...position,
  }
  void nextTick(() => contextMenuElement.value?.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')?.focus())
}

function openPreviewMenu(event: MouseEvent, page = activePage.value) {
  showPreviewMenu(page, event.clientX, event.clientY, event.currentTarget as HTMLElement)
}

function openPreviewMenuFromKeyboard(page: number, trigger: HTMLElement) {
  const bounds = trigger.getBoundingClientRect()
  showPreviewMenu(page, bounds.right - 8, bounds.top + 8, trigger)
}

function handlePreviewTriggerKeydown(event: KeyboardEvent, page = activePage.value) {
  if (!isContextMenuShortcut(event)) return
  event.preventDefault()
  event.stopPropagation()
  openPreviewMenuFromKeyboard(page, event.currentTarget as HTMLElement)
}

function closePreviewMenu() { contextMenu.value.open = false }
function closePreviewMenuWithFocus() {
  closePreviewMenu()
  previewMenuTrigger?.focus({ preventScroll: true })
}
function handlePreviewMenuKeydown(event: KeyboardEvent) {
  const menuItems = [...(contextMenuElement.value?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? [])]
  if (event.key === 'Escape') {
    event.preventDefault()
    closePreviewMenuWithFocus()
    return
  }
  const nextIndex = nextMenuItemIndex(event.key, menuItems.indexOf(document.activeElement as HTMLButtonElement), menuItems.length)
  if (nextIndex === undefined) return
  event.preventDefault()
  menuItems[nextIndex]?.focus()
}
onMounted(() => {
  startCodeLayoutWorker()
  window.addEventListener('click', closePreviewMenu)
  window.addEventListener('blur', closePreviewMenu)
  window.addEventListener('resize', closePreviewMenu)
})
onBeforeUnmount(() => {
  longCaptureRequestId++
  if (previewUpdateTimer !== undefined) window.clearTimeout(previewUpdateTimer)
  codeLayoutWorker?.terminate()
  codeLayoutWorker = undefined
  flushCodeDraft()
  stopLongElapsedTimer()
  window.removeEventListener('click', closePreviewMenu)
  window.removeEventListener('blur', closePreviewMenu)
  window.removeEventListener('resize', closePreviewMenu)
})

function addExportJob(label: string, outputs: FileReference[], detail: string) {
  const job = store.addJob('code', label, ['代码内容'], {
    toolId: 'code-image', route: '/code-image', retryable: true,
    parameters: { language: language.value, languageMode: languageOverride.value, theme: theme.value, fontSize: fontSize.value, linesPerPage: linesPerPage.value, showLineNumbers: showLineNumbers.value, author: author.value },
    inputs: inputReferences()
  })
  store.updateJob(job.id, { status: 'succeeded', progress: 100, outputNames: outputs.map((output) => output.name), outputs, detail })
}

async function openLocation(path?: string) {
  if (!path) return
  try { await revealDesktopFile(path) }
  catch (error) { ui.toast('无法打开文件位置', error instanceof Error ? error.message : '文件可能已移动。', 'error') }
}

async function copyCurrentImage(index = activePage.value) {
  await syncRenderedCode()
  index = Math.max(0, Math.min(index, pages.value.length - 1))
  copying.value = true
  copyProgress.value = { current: 1, total: 1 }
  try {
    const blob = await capturePage(index)
    await writeClipboardSafely(() => copyPngToClipboard(blob))
    store.addActivity('output', '复制代码图片', `第 ${index + 1} 张`, '/code-image')
    ui.toast('图片已复制', '可以直接粘贴到微信、QQ、邮件或文档。', 'success')
  } catch (error) {
    ui.toast('复制图片失败', error instanceof Error ? error.message : '系统剪贴板不可用。', 'error')
  } finally {
    copying.value = false
    copyPreparing.value = false
    copyProgress.value = { current: 0, total: 0 }
  }
}

async function copySelectedImages() {
  const indexes = selectedPageIndexes.value.length ? selectedPageIndexes.value : [activePage.value]
  if (indexes.length === 1) return copyCurrentImage(indexes[0])
  return copySelectedAsFiles()
}

async function copySelectedAsFiles() {
  await syncRenderedCode()
  const indexes = selectedPageIndexes.value.length ? selectedPageIndexes.value : [activePage.value]
  if (indexes.length === 1) return copyCurrentImage(indexes[0])
  copying.value = true
  copyPreparing.value = !indexes.every((index) => stagedReadyKeys.has(pageCacheKey(index)))
  copyProgress.value = { current: 0, total: indexes.length }
  try {
    const paths: string[] = []
    for (let position = 0; position < indexes.length; position++) {
      copyProgress.value = { current: position + 1, total: indexes.length }
      const pageIndex = indexes[position]
      paths.push(await getStagedPagePath(pageIndex))
    }
    await writeClipboardSafely(() => copyStagedPngFiles(paths))
    store.addActivity('output', '复制多张代码图片', `${indexes.map((index) => index + 1).join('、')} 页`, '/code-image')
    ui.toast(`${indexes.length} 张图片已复制`, '剪贴板已按资源管理器多选文件格式写入，可直接粘贴到微信、QQ或文件夹。', 'success')
  } catch (error) {
    ui.toast('复制多个文件失败', error instanceof Error ? error.message : 'Windows 文件剪贴板不可用。', 'error')
  } finally {
    copying.value = false
    copyPreparing.value = false
    copyProgress.value = { current: 0, total: 0 }
  }
}

function cancelLongCapture() {
  if (!longProgress.value.active) return
  longCaptureRequestId++
}

function closeLongActionsMenu() {
  longActionsMenu.value?.removeAttribute('open')
}

function guardLongActionsMenu(event: MouseEvent) {
  if (pages.value.length > 1 && !exporting.value && !copying.value) return
  event.preventDefault()
}

function copyAllAsLongImage() {
  closeLongActionsMenu()
  return copyPagesAsLongImage(pages.value.map((_, index) => index), '全文')
}

function copySelectedAsLongImage() {
  closeLongActionsMenu()
  const indexes = selectedPageIndexes.value.length ? selectedPageIndexes.value : [activePage.value]
  return copyPagesAsLongImage(indexes, '所选')
}

function exportAllAsLongImage() {
  closeLongActionsMenu()
  return exportPagesAsLongImage(pages.value.map((_, index) => index), '全文')
}

function exportSelectedAsLongImage() {
  closeLongActionsMenu()
  const indexes = selectedPageIndexes.value.length ? selectedPageIndexes.value : [activePage.value]
  return exportPagesAsLongImage(indexes, '所选')
}

async function copyPagesAsLongImage(indexes: number[], scope: '全文' | '所选') {
  await syncRenderedCode()
  const requestId = ++longCaptureRequestId
  copying.value = true
  try {
    ensureLongCaptureActive(requestId)
    startLongElapsedTimer()
    longProgress.value = { active: true, current: 0, total: indexes.length, phase: 'render' }
    copyProgress.value = { current: 0, total: indexes.length }
    const captures = await captureAdaptiveLongCode(indexes, requestId)
    updateLongProgress(requestId, { ...longProgress.value, active: true, phase: 'clipboard' })
    await yieldToRenderer()
    // A PNG-only Windows clipboard payload is fast but is ignored by some
    // versions of WeChat/QQ. Stage the already-rendered long image once and let
    // the native layer publish both PNG and Explorer-compatible file formats.
    const stagedPaths: string[] = []
    const stagedNames = codeLongImageFileNames(captures.length)
    for (let index = 0; index < captures.length; index++) {
      ensureLongCaptureActive(requestId)
      stagedPaths.push(await stagePngClipboardFile(stagedNames[index], captures[index].blob))
    }
    ensureLongCaptureActive(requestId)
    await writeClipboardSafely(() => copyStagedPngFiles(stagedPaths))
    ensureLongCaptureActive(requestId)
    store.addActivity('output', `复制${scope}代码长图`, `${indexes.length} 页 → ${captures.length} 张连续长图`, '/code-image')
    const title = captures.length > 1 ? `已复制 ${captures.length} 张连续长图` : indexes.length > 1 ? `已生成 ${indexes.length} 页连续代码` : '图片已复制'
    const detail = captures.length > 1 ? '内容已按安全上限自动拆分为连续图片，可多选粘贴到微信、QQ或文件夹。' : indexes.length > 1 ? '已按图片和图片文件两种格式写入，可粘贴到微信、QQ；分页之间没有重复标题栏、页脚或空隙。' : '已按图片和图片文件两种格式写入剪贴板。'
    ui.toast(title, detail, 'success')
  } catch (error) {
    if (error instanceof LongCaptureCancelledError) ui.toast('已停止生成', '当前长图未写入剪贴板；可以调整内容后重新生成。', 'info')
    else ui.toast('复制长图失败', error instanceof Error ? error.message : '系统剪贴板不可用。', 'error')
  } finally {
    copying.value = false
    stopLongElapsedTimer()
    longProgress.value = { active: false, current: 0, total: 0, phase: 'render' }
    copyProgress.value = { current: 0, total: 0 }
  }
}

async function exportPagesAsLongImage(indexes: number[], scope: '全文' | '所选') {
  await syncRenderedCode()
  if (!await ensureDirectory()) return
  const requestId = ++longCaptureRequestId
  exporting.value = true
  try {
    ensureLongCaptureActive(requestId)
    startLongElapsedTimer()
    longProgress.value = { active: true, current: 0, total: indexes.length, phase: 'render' }
    const captures = await captureAdaptiveLongCode(indexes, requestId)
    updateLongProgress(requestId, { ...longProgress.value, active: true, phase: 'write' })
    await yieldToRenderer()
    const outputs: FileReference[] = []
    const outputNames = codeLongImageFileNames(captures.length)
    for (let position = 0; position < captures.length; position++) {
      ensureLongCaptureActive(requestId)
      outputs.push(await exportOutput(store.settings.outputDirectory, outputNames[position], captures[position].blob, 'image/png'))
    }
    ensureLongCaptureActive(requestId)
    lastOutputs.value = outputs
    addExportJob(`代码${scope}连续长图导出`, outputs, `${indexes.length} 页已保存为 ${outputs.length} 张连续 PNG。`)
    const firstPath = outputs.find((output) => output.path)?.path
    ui.toast(
      outputs.length > 1 ? `已导出 ${outputs.length} 张连续长图` : '连续代码长图已导出',
      outputs.length > 1 ? '内容已按安全上限自动拆分，所有代码行均已保留。' : outputs[0]?.path || outputs[0]?.name || 'code-long.png',
      'success',
      firstPath ? '打开位置' : undefined,
      firstPath ? () => openLocation(firstPath) : undefined,
    )
  } catch (error) {
    if (error instanceof LongCaptureCancelledError) ui.toast('已停止生成', '尚未写入的连续长图不会继续导出。', 'info')
    else ui.toast('导出连续长图失败', error instanceof Error ? error.message : '无法生成连续 PNG。', 'error')
  } finally {
    exporting.value = false
    stopLongElapsedTimer()
    longProgress.value = { active: false, current: 0, total: 0, phase: 'render' }
  }
}

async function exportCurrentPage() {
  await syncRenderedCode()
  if (!await ensureDirectory()) return
  exporting.value = true
  try {
    const name = `code-${String(activePage.value + 1).padStart(2, '0')}.png`
    const output = await exportOutput(store.settings.outputDirectory, name, await capturePage(activePage.value), 'image/png')
    lastOutputs.value = [output]
    addExportJob('代码分享图导出', [output], '已导出当前 CodeSnap 图片。')
    ui.toast('代码图片已导出', output.path || name, 'success', output.path ? '打开位置' : undefined, output.path ? () => openLocation(output.path) : undefined)
  } catch (error) {
    ui.toast('导出失败', error instanceof Error ? error.message : '无法生成 PNG。', 'error')
  } finally { exporting.value = false }
}

async function exportAll() {
  await syncRenderedCode()
  if (!await ensureDirectory()) return
  exporting.value = true
  try {
    const outputs: FileReference[] = []
    for (let index = 0; index < pages.value.length; index++) {
      const name = `code-${String(index + 1).padStart(2, '0')}.png`
      outputs.push(await exportOutput(store.settings.outputDirectory, name, await capturePage(index), 'image/png'))
    }
    lastOutputs.value = outputs
    addExportJob('代码分享图批量导出', outputs, `已导出 ${outputs.length} 张高亮 PNG。`)
    const firstPath = outputs.find((output) => output.path)?.path
    ui.toast('代码图片已导出', `${outputs.length} 张高亮 PNG`, 'success', firstPath ? '打开位置' : undefined, firstPath ? () => openLocation(firstPath) : undefined)
  } catch (error) {
    ui.toast('批量导出失败', error instanceof Error ? error.message : '无法生成 PNG。', 'error')
  } finally { exporting.value = false }
}

async function exportPdf() {
  await syncRenderedCode()
  if (!await ensureDirectory()) return
  exporting.value = true
  try {
    const { PDFDocument } = await import('pdf-lib')
    const pdf = await PDFDocument.create()
    for (let index = 0; index < pages.value.length; index++) {
      const blob = await capturePage(index)
      const image = await pdf.embedPng(await blob.arrayBuffer())
      const page = pdf.addPage([image.width, image.height])
      page.drawImage(image, { x: 0, y: 0, width: image.width, height: image.height })
    }
    const name = 'codesnap.pdf'
    const output = await exportOutput(store.settings.outputDirectory, name, await pdf.save(), 'application/pdf')
    lastOutputs.value = [output]
    addExportJob('代码分享图 PDF 导出', [output], '已导出高亮代码 PDF。')
    ui.toast('代码 PDF 已导出', output.path || name, 'success', output.path ? '打开位置' : undefined, output.path ? () => openLocation(output.path) : undefined)
  } catch (error) {
    ui.toast('PDF 导出失败', error instanceof Error ? error.message : '无法生成 PDF。', 'error')
  } finally { exporting.value = false }
}
</script>

<template>
  <div class="code-image page-enter mx-auto w-full max-w-320 px-8 py-6">
    <PageHeader title="代码长图" subtitle="超长代码自动分页,也能合成连续长图;导出 PNG、PDF 或直接复制">
      <template #actions>
      <div class="code-export-actions">
        <button class="secondary-action" :disabled="exporting || copying" @click="exportCurrentPage"><AppIcon name="image" :size="15"/>导出 PNG</button>
        <button class="secondary-action" :disabled="exporting || copying" @click="exportPdf">导出 PDF</button>
        <details ref="longActionsMenu" class="code-long-actions-menu" :class="{ disabled: pages.length === 1 || exporting || copying }">
          <summary class="secondary-action" :aria-disabled="pages.length === 1 || exporting || copying" :title="pages.length === 1 ? '代码超过一张后自动启用连续长图' : `复制或导出全部 ${pages.length} 张为连续长图`" @click="guardLongActionsMenu"><AppIcon name="merge" :size="15"/><span>连续长图</span><small>{{ pages.length > 1 ? `${pages.length} 页` : '自动启用' }}</small></summary>
          <div class="code-long-actions-popover">
            <header><span>连续长图</span><small>超限自动安全拆分</small></header>
            <button type="button" :disabled="exporting || copying" @click="copyAllAsLongImage"><AppIcon name="duplicate" :size="14"/><span><b>复制全文长图</b><small>{{ pages.length }} 页写入剪贴板</small></span></button>
            <button type="button" :disabled="exporting || copying" @click="exportAllAsLongImage"><AppIcon name="file-image" :size="14"/><span><b>导出全文长图</b><small>保存为连续 PNG</small></span></button>
            <template v-if="selectedPageIndexes.length > 1 && selectedPageIndexes.length < pages.length">
              <hr />
              <button type="button" :disabled="exporting || copying" @click="copySelectedAsLongImage"><AppIcon name="duplicate" :size="14"/><span><b>复制所选长图</b><small>{{ selectedPageIndexes.length }} 页</small></span></button>
              <button type="button" :disabled="exporting || copying" @click="exportSelectedAsLongImage"><AppIcon name="file-image" :size="14"/><span><b>导出所选长图</b><small>{{ selectedPageIndexes.length }} 页</small></span></button>
            </template>
          </div>
        </details>
        <button class="primary-button code-copy-primary" :disabled="exporting || copying" @click="copySelectedImages"><AppIcon name="duplicate" :size="15"/>{{ copying ? copyBusyLabel : copyLabel }}</button>
      </div>
      </template>
    </PageHeader>

    <section class="codesnap-workspace">
      <div class="code-control-bar panel">
        <details class="code-control-menu code-import-menu">
          <summary><AppIcon name="file-code" :size="14"/><span>导入代码</span><small>拖入或选择文件</small></summary>
          <div class="code-control-popover">
            <FileDropZone v-model="codeFiles" accept=".txt,.md,.js,.ts,.tsx,.jsx,.py,.java,.cpp,.c,.cs,.go,.rs,.vue,.html,.css,.sql,text/*" :multiple="false" :max-file-bytes="8 * 1024 * 1024" title="拖入代码文件" hint="自动识别语言并实时预览；单文件最多 8 MB"/>
          </div>
        </details>

        <span class="code-auto-badge"><AppIcon name="text" :size="13"/><small>{{ fontSize }}px · 自动 {{ linesPerPage }} 行/张{{ wrapLongLines ? ' · 长行折行' : '' }}</small></span>

        <div class="code-inline-theme" role="group" aria-label="窗口主题">
          <span>主题</span>
          <div class="segmented theme-segmented"><button :class="{ active: theme === 'midnight' }" @click="theme = 'midnight'">午夜</button><button :class="{ active: theme === 'forest' }" @click="theme = 'forest'">深林</button><button :class="{ active: theme === 'paper' }" @click="theme = 'paper'">纸页</button></div>
        </div>

        <details class="code-control-menu code-advanced-menu">
          <summary><AppIcon name="settings" :size="14"/><span>偏好设置</span><small>{{ byline }}</small></summary>
          <div class="code-control-popover code-advanced-popover">
            <header><div><p class="eyebrow">智能设置</p><strong>自动排版偏好</strong></div><small>字号与分页由内容自动计算</small></header>
            <label>语言识别<select v-model="languageOverride" aria-label="代码语言"><option value="auto">自动识别（{{ codeLanguages.find(item => item.id === detectedLanguage)?.label }}）</option><option v-for="item in codeLanguages" :key="item.id" :value="item.id">{{ item.label }}</option></select></label>
            <div class="code-advanced-row"><label class="checkline"><input v-model="showLineNumbers" type="checkbox" /> 显示行号</label><label class="watermark-field"><span>作者署名</span><input v-model="author" placeholder="author" /></label></div>
          </div>
        </details>
      </div>

      <div class="codesnap-main">
        <section class="code-editor panel">
          <header><span class="mac-controls" aria-hidden="true"><i></i><i></i><i></i></span><strong>代码编辑</strong><small>{{ renderedLineCount }} 行 · {{ previewPending || layoutPending ? '正在整理预览' : draftPending ? '正在自动保存' : '已自动保存' }}</small></header>
          <LargeTextEditor ref="codeEditor" v-model="code" aria-label="代码编辑器" placeholder="在这里粘贴或输入代码…" @blur="flushCodeDraft" />
        </section>

        <section class="live-code-preview panel">
          <header><div><p class="eyebrow">实时预览</p><strong>实时图片预览</strong></div><span>右键复制 · 2× 高清</span></header>
          <div ref="previewStage" class="codesnap-stage" :class="{ 'codesnap-stage--long-lines': wrapLongLines }" title="右键或菜单键可复制当前图片">
            <CodeSnapCard
              tabindex="0"
              role="group"
              aria-haspopup="menu"
              :aria-expanded="contextMenu.open"
              aria-label="代码图片预览；右键或菜单键打开操作"
              :code-html="highlightedPage(activePage)"
              :line-count="pageLineCount(activePage)"
              :start-line="activePage * linesPerPage + 1"
              :page-number="activePage + 1"
              :total-pages="pages.length"
              :font-size="fontSize"
              :show-line-numbers="showLineNumbers"
              :watermark="byline"
              :theme="theme"
              :wrap-long-lines="wrapLongLines"
              @contextmenu.prevent.stop="openPreviewMenu($event)"
              @keydown="handlePreviewTriggerKeydown($event)"
            />
          </div>
          <div v-if="pages.length > 1" class="page-selection-strip">
            <span class="page-selection-summary">已选 {{ selectedPageIndexes.length }} / {{ pages.length }}</span>
            <div class="page-selection-scroll">
              <button v-for="index in visiblePageIndexes" :key="index" :class="{ selected: selectedPages.has(index), current: activePage === index }" aria-haspopup="menu" :aria-expanded="contextMenu.open && contextMenu.page === index" @click="toggleSelectedPage(index)" @contextmenu.prevent.stop="openPreviewMenu($event, index)" @keydown="handlePreviewTriggerKeydown($event, index)"><i>{{ selectedPages.has(index) ? '✓' : '' }}</i>第 {{ index + 1 }} 张</button>
            </div>
            <button class="select-all-pages" @click="selectAllPages">{{ selectedPages.size === pages.length ? '仅保留当前' : '全选' }}</button>
          </div>
          <div v-if="longProgress.active" class="codesnap-long-progress" role="status" aria-live="polite">
            <span><b>{{ longProgressLabel }}</b><small>{{ longProgressDetail }}</small></span>
            <progress v-if="longProgress.phase === 'render'" :value="longProgressPercent" max="100">{{ longProgressPercent }}%</progress>
            <progress v-else max="100" aria-label="处理中"></progress>
            <strong>{{ longProgress.phase === 'render' ? `${longProgressPercent}%` : `${longElapsedSeconds.toFixed(1)}s` }}</strong>
            <button v-if="longProgress.phase === 'render' || longProgress.phase === 'encode'" class="quiet-button codesnap-cancel-capture" type="button" aria-label="取消生成连续代码长图" @click="cancelLongCapture">取消</button>
          </div>
          <footer class="preview-toolbar">
            <div class="page-switcher"><button :disabled="activePage === 0" @click="activePage--">←</button><span>第 {{ activePage + 1 }} / {{ pages.length }} 张</span><button :disabled="activePage === pages.length - 1" @click="activePage++">→</button></div>
            <div><button class="quiet-button" :disabled="pages.length === 1 || exporting" @click="exportAll">导出全部 {{ pages.length }} 张</button><button class="quiet-button" :disabled="pages.length === 1 || copying" :title="pages.length === 1 ? '代码超过一张后自动启用连续长图' : `把全部 ${pages.length} 张合成连续长图`" @click="copyAllAsLongImage">复制长图</button><button class="quiet-button" :disabled="pages.length === 1 || exporting" @click="exportAllAsLongImage">导出长图</button><button class="primary-button" :disabled="copying" @click="copySelectedImages">{{ copying ? copyBusyLabel : copyLabel }}</button></div>
          </footer>
        </section>
      </div>
    </section>

    <Teleport to="body">
      <div v-if="contextMenu.open" ref="contextMenuElement" class="codesnap-context-menu" role="menu" :aria-label="`第 ${contextMenu.page + 1} 张代码图片操作`" :style="{ left: `${contextMenu.x}px`, top: `${contextMenu.y}px` }" @click.stop @contextmenu.prevent @keydown.stop="handlePreviewMenuKeydown">
        <header><span>第 {{ contextMenu.page + 1 }} 张</span><small>代码图片</small></header>
        <button role="menuitem" :disabled="copying" @click="copyCurrentImage(contextMenu.page); closePreviewMenu()"><AppIcon name="duplicate" :size="14"/>复制当前图片</button>
        <button role="menuitem" @click="toggleSelectedPage(contextMenu.page); closePreviewMenu()"><AppIcon name="plus" :size="14"/>{{ selectedPages.has(contextMenu.page) && selectedPages.size > 1 ? '从多选中移除' : '加入多选' }}</button>
        <button v-if="pages.length > 1" role="menuitem" :disabled="copying" @click="copyAllAsLongImage(); closePreviewMenu()"><AppIcon name="merge" :size="14"/>复制全文为连续长图</button>
        <button v-if="pages.length > 1" role="menuitem" :disabled="exporting" @click="exportAllAsLongImage(); closePreviewMenu()"><AppIcon name="file-image" :size="14"/>导出全文为连续长图</button>
        <button v-if="selectedPageIndexes.length > 1" role="menuitem" :disabled="copying" @click="copySelectedImages(); closePreviewMenu()"><AppIcon name="image" :size="14"/>复制所选 {{ selectedPageIndexes.length }} 张</button>
        <button v-if="selectedPageIndexes.length > 1" role="menuitem" :disabled="copying" @click="copySelectedAsLongImage(); closePreviewMenu()"><AppIcon name="merge" :size="14"/>复制为连续长图</button>
        <button v-if="selectedPageIndexes.length > 1" role="menuitem" :disabled="exporting" @click="exportSelectedAsLongImage(); closePreviewMenu()"><AppIcon name="file-image" :size="14"/>导出所选为连续长图</button>
        <hr />
        <button role="menuitem" :disabled="exporting" @click="exportCurrentPage(); closePreviewMenu()"><AppIcon name="file-image" :size="14"/>导出当前 PNG</button>
        <button v-if="pages.length > 1" role="menuitem" :disabled="exporting" @click="exportAll(); closePreviewMenu()"><AppIcon name="image" :size="14"/>导出全部 {{ pages.length }} 张 PNG</button>
        <button role="menuitem" :disabled="exporting" @click="exportPdf(); closePreviewMenu()"><AppIcon name="file-pdf" :size="14"/>导出全部为 PDF</button>
      </div>
    </Teleport>

    <section v-if="lastOutputs.length" class="code-output-result panel">
      <header><div><p class="eyebrow">导出完成</p><h3>刚刚生成的文件</h3></div><button v-if="lastOutputs[0]?.path" class="primary-button" @click="openLocation(lastOutputs[0].path)">打开输出位置</button></header>
      <div><article v-for="output in lastOutputs" :key="output.name"><AppIcon :name="output.mime === 'application/pdf' ? 'file-pdf' : 'image'" :size="16"/><span><strong>{{ output.name }}</strong><small>{{ output.path || '已通过浏览器下载' }}</small></span><button v-if="output.path" class="quiet-button" @click="openLocation(output.path)">定位文件</button></article></div>
    </section>

    <div ref="captureHost" class="codesnap-capture-host" aria-hidden="true">
      <div class="codesnap-export-frame" data-export-frame><CodeSnapCard :code-html="highlightedPage(capturePageIndex)" :line-count="pageLineCount(capturePageIndex)" :start-line="capturePageIndex * linesPerPage + 1" :page-number="capturePageIndex + 1" :total-pages="pages.length" :font-size="fontSize" :show-line-numbers="showLineNumbers" :watermark="byline" :theme="theme" :wrap-long-lines="wrapLongLines"/></div>
    </div>
    <div ref="longCaptureHost" class="codesnap-capture-host" aria-hidden="true">
      <div v-for="(pageIndex, position) in longCaptureIndexes" :key="pageIndex" class="codesnap-export-frame codesnap-long-export-frame" data-long-export-frame><CodeSnapCard :code-html="highlightedPage(pageIndex)" :line-count="pageLineCount(pageIndex)" :start-line="pageIndex * linesPerPage + 1" :page-number="1" :total-pages="1" :font-size="fontSize" :show-line-numbers="showLineNumbers" :watermark="byline" :theme="theme" :wrap-long-lines="wrapLongLines" :continuous-position="longCaptureIndexes.length === 1 ? 'single' : position === 0 ? 'start' : position === longCaptureIndexes.length - 1 ? 'end' : 'middle'"/></div>
    </div>
  </div>
</template>
