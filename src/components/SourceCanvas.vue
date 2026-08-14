<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import * as pdfjs from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.mjs?url'
import AppIcon from '@/components/AppIcon.vue'
import { clampMenuPosition, isContextMenuShortcut, nextMenuItemIndex } from '@/lib/desktop-menu'
import { copyPngToClipboard } from '@/lib/native'
import { fitCanvasPreviewScale } from '@/lib/canvas-preview-scale'
import type { Source } from '@/types'

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

const props = withDefaults(defineProps<{ source: Source; initialPage?: number }>(), { initialPage: 0 })
const emit = defineEmits<{
  select: [bbox: [number, number, number, number], crop?: string]
  page: [pageIndex: number, pageCount: number]
  clear: []
}>()
const canvas = ref<HTMLCanvasElement>()
const image = ref<HTMLImageElement>()
const stage = ref<HTMLElement>()
const contextMenuElement = ref<HTMLElement>()
const pageIndex = ref(0)
const pageCount = ref(1)
const loading = ref(false)
const error = ref('')
const selection = ref<[number, number, number, number] | null>(null)
const drawing = ref(false)
const start = ref<[number, number] | null>(null)
const contextMenu = ref<{ x: number; y: number }>()
const copying = ref(false)
const copyNotice = ref('')
const renderLimited = ref(false)
let pdfDocument: any
let renderTask: any
let loadVersion = 0
let disposed = false
let contextMenuTrigger: HTMLElement | undefined

const selectionStyle = computed(() => selection.value ? { left: `${selection.value[0] * 100}%`, top: `${selection.value[1] * 100}%`, width: `${selection.value[2] * 100}%`, height: `${selection.value[3] * 100}%` } : {})
const hasSelection = computed(() => Boolean(selection.value))
const isVisualSource = computed(() => props.source.kind === 'pdf' || props.source.kind === 'image')
const canvasLabel = computed(() => props.source.kind === 'pdf'
  ? `PDF 第 ${pageIndex.value + 1} 页，共 ${pageCount.value} 页。可拖动框选；左右方向键翻页；右键或 Shift 加 F10 打开操作。`
  : props.source.kind === 'image'
    ? '图片预览。可拖动框选；右键或 Shift 加 F10 打开操作。'
    : '文本资料预览。右键或 Shift 加 F10 打开操作。')

async function loadPdf() {
  const version = ++loadVersion
  renderTask?.cancel?.()
  renderTask = undefined
  if (props.source.kind !== 'pdf' || !props.source.preview || !canvas.value) {
    const previous = pdfDocument
    pdfDocument = undefined
    try { await previous?.destroy?.() } catch { /* 已离开的 PDF 无需继续处理。 */ }
    loading.value = false
    renderLimited.value = false
    return
  }
  loading.value = true; error.value = ''
  try {
    const bytes = await fetch(props.source.preview).then((response) => response.arrayBuffer())
    if (disposed || version !== loadVersion) return
    const nextDocument = await pdfjs.getDocument({ data: bytes }).promise
    if (disposed || version !== loadVersion) { await (nextDocument as any).destroy?.(); return }
    const previous = pdfDocument
    pdfDocument = nextDocument
    try { await previous?.destroy?.() } catch { /* 新文档已经就绪，旧文档销毁失败可忽略。 */ }
    pageCount.value = pdfDocument.numPages; pageIndex.value = Math.min(pageIndex.value, Math.max(0, pageCount.value - 1)); await renderPdf()
  } catch (reason) { if (!disposed && version === loadVersion) error.value = '这个 PDF 无法读取：可能受密码保护或文件已损坏。' }
  finally { if (!disposed && version === loadVersion) loading.value = false }
}

async function renderPdf() {
  const version = loadVersion
  const document = pdfDocument
  const target = canvas.value
  if (!document || !target || disposed) return
  renderTask?.cancel?.()
  const requestedPage = pageIndex.value
  const pdfPage = await document.getPage(requestedPage + 1)
  if (disposed || version !== loadVersion || document !== pdfDocument || target !== canvas.value) return
  const sourceViewport = pdfPage.getViewport({ scale: 1 })
  const scale = fitCanvasPreviewScale(sourceViewport.width, sourceViewport.height, 1.35)
  const viewport = pdfPage.getViewport({ scale })
  const context = target.getContext('2d')
  if (!context) throw new Error('无法创建 PDF 画布。')
  // The user may have pressed the next-page key while PDF.js was decoding the
  // previous page. Do not let that old page claim the canvas afterwards.
  if (requestedPage !== pageIndex.value) return
  renderLimited.value = scale < 1.349
  target.width = Math.floor(viewport.width); target.height = Math.floor(viewport.height)
  const task = pdfPage.render({ canvasContext: context, viewport })
  renderTask = task
  try { await task.promise }
  catch (reason) { if ((reason as { name?: string })?.name !== 'RenderingCancelledException') throw reason }
  finally { if (renderTask === task) renderTask = undefined }
  if (!disposed && version === loadVersion && document === pdfDocument && requestedPage === pageIndex.value) emit('page', pageIndex.value, pageCount.value)
}

function point(event: PointerEvent): [number, number] {
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
  return [Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)), Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height))]
}
function down(event: PointerEvent) { if (props.source.kind === 'code' || props.source.kind === 'text') return; (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId); drawing.value = true; start.value = point(event); selection.value = [start.value[0], start.value[1], 0, 0] }
function move(event: PointerEvent) { if (!drawing.value || !start.value) return; const [x, y] = point(event); selection.value = [Math.min(x, start.value[0]), Math.min(y, start.value[1]), Math.abs(x - start.value[0]), Math.abs(y - start.value[1])] }
function up() {
  drawing.value = false
  if (!selection.value || selection.value[2] < .02 || selection.value[3] < .02) { selection.value = null; return }
  emit('select', selection.value, cropSelection())
}
function clearSelection() {
  if (!selection.value) return
  drawing.value = false
  start.value = null
  selection.value = null
  emit('clear')
}
function cropSelection() {
  if (!selection.value) return undefined
  const [x, y, w, h] = selection.value; const sourceCanvas = props.source.kind === 'pdf' ? canvas.value : undefined
  const target = document.createElement('canvas')
  if (sourceCanvas) { target.width = Math.max(1, Math.floor(sourceCanvas.width * w)); target.height = Math.max(1, Math.floor(sourceCanvas.height * h)); target.getContext('2d')?.drawImage(sourceCanvas, sourceCanvas.width * x, sourceCanvas.height * y, sourceCanvas.width * w, sourceCanvas.height * h, 0, 0, target.width, target.height); return target.toDataURL('image/png') }
  if (image.value) { target.width = Math.max(1, Math.floor(image.value.naturalWidth * w)); target.height = Math.max(1, Math.floor(image.value.naturalHeight * h)); target.getContext('2d')?.drawImage(image.value, image.value.naturalWidth * x, image.value.naturalHeight * y, image.value.naturalWidth * w, image.value.naturalHeight * h, 0, 0, target.width, target.height); return target.toDataURL('image/png') }
  return undefined
}
async function changePage(offset: -1 | 1) {
  const nextPage = pageIndex.value + offset
  if (nextPage < 0 || nextPage >= pageCount.value) return
  pageIndex.value = nextPage; selection.value = null; error.value = ''
  try { await renderPdf() } catch { if (!disposed) error.value = '这一页无法渲染，请尝试其他页面。' }
}
function previous() { void changePage(-1) }
function next() { void changePage(1) }

function closeContextMenu(restoreFocus = false) {
  contextMenu.value = undefined
  if (restoreFocus) contextMenuTrigger?.focus({ preventScroll: true })
}
function openContextMenu(event: MouseEvent, trigger: EventTarget | null) {
  if (!(trigger instanceof HTMLElement)) return
  const menuHeight = props.source.kind === 'pdf' ? 216 : 142
  contextMenuTrigger = trigger
  contextMenu.value = clampMenuPosition(event.clientX, event.clientY, { menuWidth: 224, menuHeight, margin: 12 })
  void nextTick(() => contextMenuElement.value?.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')?.focus())
}
function openContextMenuFromKeyboard(event: KeyboardEvent) {
  if (!isContextMenuShortcut(event) || !stage.value) return false
  event.preventDefault()
  const bounds = stage.value.getBoundingClientRect()
  openContextMenu(new MouseEvent('contextmenu', { clientX: bounds.left + 26, clientY: bounds.top + 26 }), stage.value)
  return true
}
function handleStageKeydown(event: KeyboardEvent) {
  if (openContextMenuFromKeyboard(event)) return
  if (props.source.kind === 'pdf' && event.key === 'ArrowLeft') { event.preventDefault(); previous(); return }
  if (props.source.kind === 'pdf' && event.key === 'ArrowRight') { event.preventDefault(); next(); return }
  if (event.key === 'Escape' && selection.value) { event.preventDefault(); clearSelection() }
}
function handleContextMenuKeydown(event: KeyboardEvent) {
  const items = [...(contextMenuElement.value?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? [])]
  if (!items.length) return
  if (event.key === 'Escape') { event.preventDefault(); closeContextMenu(true); return }
  const nextIndex = nextMenuItemIndex(event.key, items.indexOf(document.activeElement as HTMLButtonElement), items.length)
  if (nextIndex === undefined) return
  event.preventDefault()
  items[nextIndex]?.focus()
}
function canvasToPngBlob(target: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) => target.toBlob((blob) => blob ? resolve(blob) : reject(new Error('预览图片未能编码为 PNG。')), 'image/png'))
}
async function imagePreviewBlob() {
  const source = image.value
  if (!source?.naturalWidth || !source.naturalHeight) throw new Error('图片预览尚未准备好。')
  const scale = fitCanvasPreviewScale(source.naturalWidth, source.naturalHeight)
  const target = document.createElement('canvas')
  target.width = Math.max(1, Math.floor(source.naturalWidth * scale))
  target.height = Math.max(1, Math.floor(source.naturalHeight * scale))
  const context = target.getContext('2d')
  if (!context) throw new Error('无法创建图片画布。')
  context.drawImage(source, 0, 0, target.width, target.height)
  return canvasToPngBlob(target)
}
async function copyVisualPreview() {
  copying.value = true
  copyNotice.value = ''
  try {
    const blob = props.source.kind === 'pdf'
      ? canvas.value ? await canvasToPngBlob(canvas.value) : undefined
      : props.source.kind === 'image' ? await imagePreviewBlob() : undefined
    if (!blob) throw new Error('预览尚未准备好。')
    await copyPngToClipboard(blob)
    copyNotice.value = props.source.kind === 'pdf' ? '当前 PDF 页面已复制为 PNG。' : '当前图片预览已复制为 PNG。'
  } catch (reason) {
    copyNotice.value = reason instanceof Error ? reason.message : '复制预览失败。'
  } finally {
    copying.value = false
    closeContextMenu()
  }
}
async function copyTextPreview() {
  copyNotice.value = ''
  try {
    await navigator.clipboard.writeText(props.source.content || '')
    copyNotice.value = '资料文本已复制。'
  } catch (reason) {
    copyNotice.value = reason instanceof Error ? reason.message : '复制文本失败。'
  } finally {
    closeContextMenu()
  }
}

watch(() => props.source.id, async () => {
  pageIndex.value = Math.max(0, props.initialPage)
  selection.value = null
  await nextTick()
  void loadPdf()
}, { immediate: true })
watch(() => props.initialPage, async (page) => {
  const nextPage = Math.max(0, Math.min(page, Math.max(0, pageCount.value - 1)))
  if (nextPage === pageIndex.value) return
  pageIndex.value = nextPage
  selection.value = null
  error.value = ''
  if (props.source.kind === 'pdf' && pdfDocument) {
    try { await renderPdf() } catch { if (!disposed) error.value = '这一页无法渲染，请尝试其他页面。' }
  }
})
function closeSourceCanvasMenu() { closeContextMenu() }
onMounted(() => window.addEventListener('knitspace:close-context-menus', closeSourceCanvasMenu))
onBeforeUnmount(() => {
  window.removeEventListener('knitspace:close-context-menus', closeSourceCanvasMenu)
  disposed = true; loadVersion += 1; renderTask?.cancel?.(); void pdfDocument?.destroy?.()
})
</script>

<!--
  `canvas-stage` is the one class name here that is not decoration. `App.vue`'s
  workspace context menu asks `target.closest('…,.canvas-stage,…')` before it
  claims a right-click, and without the name every right-click over a PDF page
  would open the workspace menu instead of the preview's own.

  The stage is also the only surface in this file that does NOT follow the UI
  theme. What is inside it is the user's own PDF page or photograph — pixels
  that came out of their file — so it gets the fixed slate backdrop the code
  image studio uses for the same reason, and a white page sits on it identically
  in dark and light mode instead of flipping ground under the reader. A text
  source is different: we re-typeset that ourselves, so it keeps `bg-well`.
-->
<template>
  <div class="stack h-full min-w-0" @click="closeContextMenu()">
    <div v-if="source.kind === 'pdf'" class="row gap-1.5 shrink-0 h-9 px-2 bg-surface border-b border-line text-[12px] font-medium text-fg-2 tabular-nums"><button class="center w-7 h-7 shrink-0 rounded-sm text-fg-3 transition-colors duration-120 hover:not-disabled:bg-surface-2 hover:not-disabled:text-fg disabled:opacity-40 disabled:cursor-not-allowed" type="button" :disabled="pageIndex === 0" aria-label="上一页" title="上一页（←）" @click.stop="previous"><AppIcon name="arrow-right" :size="15" class="rotate-180" /></button><span>第 {{ pageIndex + 1 }} / {{ pageCount }} 页</span><button class="center w-7 h-7 shrink-0 rounded-sm text-fg-3 transition-colors duration-120 hover:not-disabled:bg-surface-2 hover:not-disabled:text-fg disabled:opacity-40 disabled:cursor-not-allowed" type="button" :disabled="pageIndex >= pageCount - 1" aria-label="下一页" title="下一页（→）" @click.stop="next"><AppIcon name="arrow-right" :size="15" /></button><small class="ml-auto text-[11px] font-normal text-fg-3">← → 翻页 · 右键操作</small></div>
    <div ref="stage" tabindex="0" role="region" class="canvas-stage relative grid place-items-center flex-1 min-h-75 min-w-0 overflow-auto p-4 focus:outline-none focus-visible:ring-3 focus-visible:ring-[var(--accent-ring)] focus-visible:ring-inset" :class="isVisualSource ? 'bg-slate-400 cursor-crosshair' : 'bg-well'" :aria-label="canvasLabel" :aria-busy="loading" @pointerdown="down" @pointermove="move" @pointerup="up" @pointercancel="drawing = false" @contextmenu.prevent.stop="openContextMenu($event, $event.currentTarget)" @keydown="handleStageKeydown">
      <canvas v-if="source.kind === 'pdf'" ref="canvas" class="block max-w-full max-h-full w-auto h-auto rounded-[2px] bg-white shadow-lg"></canvas>
      <img v-else-if="source.kind === 'image' && source.preview" ref="image" :src="source.preview" :alt="source.name" class="block max-w-full max-h-full w-auto h-auto rounded-[2px] bg-white shadow-lg" />
      <pre v-else class="w-full max-h-full self-stretch overflow-auto p-4 rounded-sm bg-surface border border-line font-mono text-[13px] leading-relaxed text-fg whitespace-pre-wrap [tab-size:2]">{{ source.content }}</pre>
      <span v-if="selection" class="crop-box absolute z-2 border-2 border-accent bg-accent-soft pointer-events-none" :style="selectionStyle"><i class="absolute top-[-22px] left-[-2px] px-1.5 py-0.5 rounded-t-sm rounded-br-sm bg-accent-solid text-accent-fg text-[11px] font-medium not-italic whitespace-nowrap">已框选</i></span>
      <div v-if="loading" class="absolute inset-0 z-3 stack items-center justify-center gap-2 bg-surface"><i class="w-12 h-1.5 rounded-full bg-line-strong animate-pulse"></i><i class="w-20 h-1.5 rounded-full bg-line-strong animate-pulse"></i><i class="w-8 h-1.5 rounded-full bg-line-strong animate-pulse"></i><b class="mt-1 text-[12px] font-normal text-fg-3">正在解析并渲染 PDF 页面…</b></div><span v-if="error" class="absolute right-3 bottom-3 z-4 max-w-105 px-2.5 py-2 rounded-sm bg-surface border border-danger text-[12px] leading-snug text-danger">{{ error }}</span>
    </div>
    <p v-if="source.kind === 'pdf' || source.kind === 'image'" class="shrink-0 px-3 py-2 bg-surface border-t border-line text-[12px] leading-relaxed text-fg-3">拖动框选一道题、公式或一段文字；选区会带着来源进入错题卡。{{ renderLimited ? ' 超大页面已按安全像素上限渲染。' : '' }}</p>
    <p v-if="copyNotice" class="shrink-0 px-3 py-2 bg-surface border-t border-line text-[12px] font-medium leading-relaxed text-accent" role="status">{{ copyNotice }}</p>
    <Teleport to="body">
      <section v-if="contextMenu" ref="contextMenuElement" class="menu-panel w-56" role="menu" :aria-label="`${source.name} 预览操作`" :style="{ left: `${contextMenu.x}px`, top: `${contextMenu.y}px` }" @click.stop @contextmenu.prevent @keydown.stop="handleContextMenuKeydown">
        <p class="menu-title">{{ source.kind === 'pdf' ? `PDF · 第 ${pageIndex + 1} 页` : source.kind === 'image' ? '图片预览' : '文本预览' }}</p>
        <template v-if="source.kind === 'pdf'"><button class="menu-item" type="button" role="menuitem" :disabled="pageIndex === 0" @click="previous(); closeContextMenu()"><span class="row gap-2"><AppIcon name="arrow-right" :size="14" class="rotate-180" />上一页</span></button><button class="menu-item" type="button" role="menuitem" :disabled="pageIndex >= pageCount - 1" @click="next(); closeContextMenu()"><span class="row gap-2"><AppIcon name="arrow-right" :size="14" />下一页</span></button></template>
        <button v-if="isVisualSource" class="menu-item" type="button" role="menuitem" :disabled="copying" @click="copyVisualPreview"><span class="row gap-2"><AppIcon name="duplicate" :size="14" />{{ copying ? '正在复制预览…' : '复制当前预览 PNG' }}</span></button>
        <button v-else class="menu-item" type="button" role="menuitem" @click="copyTextPreview"><span class="row gap-2"><AppIcon name="duplicate" :size="14" />复制资料文本</span></button>
        <button v-if="hasSelection" class="menu-item" type="button" role="menuitem" @click="clearSelection(); closeContextMenu()"><span class="row gap-2"><AppIcon name="close" :size="14" />清除当前选区</span></button>
      </section>
    </Teleport>
  </div>
</template>
