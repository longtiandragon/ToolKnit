<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { Markmap } from 'markmap-view'
import { clampMenuPosition, isContextMenuShortcut, nextMenuItemIndex } from '@/lib/desktop-menu'
import { mindmapRasterDimensions } from '@/lib/mindmap-raster'
import { chooseOutputDirectory, exportOutput } from '@/lib/output'
import { copyPngToClipboard, isDesktop } from '@/lib/native'
import { useWorkbenchStore } from '@/stores/workbench'
import { useUiStore } from '@/stores/ui'

const props = defineProps<{ source: string; title?: string }>()
const store = useWorkbenchStore()
const ui = useUiStore()
const svg = ref<SVGElement>()
const stage = ref<HTMLElement>()
const state = ref<'empty' | 'loading' | 'ready' | 'error'>('empty')
const errorMessage = ref('')
const expandLevel = ref(4)
const contextMenu = ref<{ x: number; y: number } | null>(null)
const contextMenuElement = ref<HTMLElement>()
const hasHeadings = computed(() => /^#{1,6}\s+\S/m.test(props.source))
const exporting = ref(false)
const copying = ref(false)

let instance: Markmap | undefined
let transformer: { transform: (source: string) => { root: Parameters<Markmap['setData']>[0] } } | undefined
let root: Parameters<Markmap['setData']>[0]
let updateTimer: number | undefined
let revision = 0
let resizeObserver: ResizeObserver | undefined
let contextMenuTrigger: HTMLElement | undefined
let rasterRevision = 0

function clearMindmap() {
  instance?.destroy()
  instance = undefined
}

async function renderMindmap() {
  const currentRevision = ++revision
  if (!hasHeadings.value || !svg.value) {
    clearMindmap()
    state.value = 'empty'
    return
  }
  state.value = 'loading'
  errorMessage.value = ''
  try {
    const [{ Transformer }, { Markmap }] = await Promise.all([
      import('markmap-lib'),
      import('markmap-view')
    ])
    if (currentRevision !== revision || !svg.value) return
    transformer ??= new Transformer()
    const result = transformer.transform(props.source)
    root = result.root
    if (!instance) {
      instance = Markmap.create(svg.value, {
        autoFit: true,
        duration: 180,
        fitRatio: 0.84,
        initialExpandLevel: expandLevel.value,
        maxWidth: 210,
        pan: true,
        scrollForPan: false,
        zoom: true
      }, result.root)
    } else {
      await instance.setData(result.root, { initialExpandLevel: expandLevel.value })
      await instance.fit()
    }
    if (currentRevision !== revision) return
    state.value = 'ready'
  } catch (error) {
    if (currentRevision !== revision) return
    clearMindmap()
    state.value = 'error'
    errorMessage.value = error instanceof Error ? error.message : '无法从当前 Markdown 生成思维导图。'
  }
}

function scheduleRender(source = props.source) {
  if (updateTimer !== undefined) window.clearTimeout(updateTimer)
  const delay = source.length > 180_000 ? 420 : 160
  updateTimer = window.setTimeout(() => { void renderMindmap() }, delay)
}

function fitMindmap() {
  void instance?.fit()
}

async function setExpandLevel(level: number) {
  if (!instance || !root) return
  expandLevel.value = level
  state.value = 'loading'
  try {
    await instance.setData(root, { initialExpandLevel: level })
    await instance.fit()
    state.value = 'ready'
  } catch (error) {
    clearMindmap()
    state.value = 'error'
    errorMessage.value = error instanceof Error ? error.message : '图谱层级没有更新。'
  }
}

function closeContextMenu(restoreFocus = false) {
  contextMenu.value = null
  if (restoreFocus) void nextTick(() => contextMenuTrigger?.focus())
}

function openContextMenu(event: MouseEvent, target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return
  const trigger = target
  contextMenuTrigger = trigger
  contextMenu.value = clampMenuPosition(event.clientX, event.clientY, { menuWidth: 218, menuHeight: 304, margin: 12 })
  void nextTick(() => contextMenuElement.value?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus())
}

function openContextMenuFromKeyboard(event: KeyboardEvent) {
  if (!isContextMenuShortcut(event) || !stage.value) return
  event.preventDefault()
  const bounds = stage.value.getBoundingClientRect()
  openContextMenu(new MouseEvent('contextmenu', { clientX: bounds.left + 32, clientY: bounds.top + 32 }), stage.value)
}

function handleContextMenuKeydown(event: KeyboardEvent) {
  const items = [...(contextMenuElement.value?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [])]
  if (!items.length) return
  if (event.key === 'Escape') { event.preventDefault(); closeContextMenu(true); return }
  const nextIndex = nextMenuItemIndex(event.key, items.indexOf(document.activeElement as HTMLButtonElement), items.length)
  if (nextIndex === undefined) return
  event.preventDefault()
  items[nextIndex]?.focus()
}

async function chooseExpandLevel(level: number) {
  closeContextMenu()
  await setExpandLevel(level)
  stage.value?.focus()
}

function rebuildMindmap() {
  closeContextMenu()
  scheduleRender()
  stage.value?.focus()
}

function mindmapTitle() {
  const heading = props.source.match(/^#\s+(.+)$/m)?.[1]?.trim()
  return props.title?.trim() || heading || 'Knitspace 思维导图'
}

function mindmapFilename() {
  const stem = mindmapTitle()
    .replace(/\.[^.]+$/, '')
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80) || 'knitspace-mindmap'
  return `${stem}-mindmap.svg`
}

/** Exports the rendered viewport only. This deliberately clones existing SVG
 * DOM instead of re-transforming Markdown, so export never competes with a
 * large note's live editing/render pipeline. */
function serializeVisibleMindmap() {
  const current = svg.value
  if (!current) throw new Error('图谱尚未准备好，无法导出。')
  const clone = current.cloneNode(true) as SVGElement
  const bounds = current.getBoundingClientRect()
  const width = Math.max(720, Math.ceil(bounds.width || Number(current.getAttribute('width')) || 960))
  const height = Math.max(480, Math.ceil(bounds.height || Number(current.getAttribute('height')) || 640))
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  clone.setAttribute('width', String(width))
  clone.setAttribute('height', String(height))
  clone.setAttribute('role', 'img')
  clone.setAttribute('aria-label', `${mindmapTitle()}思维导图`)
  const style = document.createElementNS('http://www.w3.org/2000/svg', 'style')
  style.textContent = '.markmap-link,.markmap-node>line{stroke:rgba(12,101,87,.48)}.markmap-foreign{color:#1a2723;font:13px/1.35 "Segoe UI Variable Text","Microsoft YaHei UI",sans-serif}.markmap-foreign div{color:#1a2723}'
  clone.prepend(style)
  return `<?xml version="1.0" encoding="UTF-8"?>\n${new XMLSerializer().serializeToString(clone)}`
}

async function rasterizeVisibleMindmap(currentRevision = ++rasterRevision) {
  const current = svg.value
  if (!current) throw new Error('图谱尚未准备好，无法复制。')
  const bounds = current.getBoundingClientRect()
  const dimensions = mindmapRasterDimensions(bounds.width || Number(current.getAttribute('width')) || 960, bounds.height || Number(current.getAttribute('height')) || 640, window.devicePixelRatio)
  const source = new Blob([serializeVisibleMindmap()], { type: 'image/svg+xml;charset=utf-8' })
  const sourceUrl = URL.createObjectURL(source)
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const next = new Image()
      next.decoding = 'async'
      next.onload = () => resolve(next)
      next.onerror = () => reject(new Error('浏览器无法将当前 SVG 转为 PNG。'))
      next.src = sourceUrl
    })
    if (currentRevision !== rasterRevision) throw new Error('图谱已切换，已取消旧的图片复制。')
    const canvas = document.createElement('canvas')
    canvas.width = dimensions.width
    canvas.height = dimensions.height
    const context = canvas.getContext('2d', { alpha: false })
    if (!context) throw new Error('浏览器无法建立图片导出画布。')
    context.fillStyle = '#fffefa'
    context.fillRect(0, 0, dimensions.width, dimensions.height)
    context.drawImage(image, 0, 0, dimensions.width, dimensions.height)
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
    if (!blob) throw new Error('图谱 PNG 编码失败。')
    if (currentRevision !== rasterRevision) throw new Error('图谱已切换，已取消旧的图片复制。')
    return { blob, dimensions }
  } finally {
    URL.revokeObjectURL(sourceUrl)
  }
}

async function copyMindmapPng() {
  if (copying.value || state.value !== 'ready') return
  closeContextMenu()
  copying.value = true
  try {
    const { blob, dimensions } = await rasterizeVisibleMindmap()
    await copyPngToClipboard(blob)
    store.addActivity('output', '复制思维导图 PNG', `${dimensions.width} × ${dimensions.height}px${dimensions.limited ? ' · 已按安全像素上限缩放' : ''}`, '/documents')
    ui.toast('导图 PNG 已复制', '可以直接粘贴到微信、QQ、邮件或文档。', 'success')
  } catch (error) {
    const detail = error instanceof Error ? error.message : '无法复制当前思维导图。'
    ui.toast('复制 PNG 失败', detail, 'error')
  } finally {
    copying.value = false
  }
}

async function exportMindmapSvg() {
  if (exporting.value || state.value !== 'ready') return
  closeContextMenu()
  exporting.value = true
  const title = mindmapTitle()
  try {
    if (isDesktop() && !store.settings.outputDirectory) {
      const directory = await chooseOutputDirectory()
      if (!directory) return
      store.updateSettings({ outputDirectory: directory })
    }
    const filename = mindmapFilename()
    const output = await exportOutput(store.settings.outputDirectory, filename, serializeVisibleMindmap(), 'image/svg+xml')
    const job = store.addJob('image', '导出思维导图 SVG', [title], { toolId: 'markdown-mindmap', route: '/documents' })
    store.updateJob(job.id, { status: 'succeeded', progress: 100, outputNames: [filename], outputs: [output], detail: '已导出当前图谱视图为 SVG 矢量文件。' })
    ui.toast('思维导图已导出', output.path || filename, 'success')
  } catch (error) {
    const detail = error instanceof Error ? error.message : '无法导出当前思维导图。'
    ui.toast('导出失败', detail, 'error')
  } finally {
    exporting.value = false
  }
}

watch(() => props.source, (source) => {
  // A PNG is a snapshot of the visible graph. If the source changes during
  // decode, invalidate that work rather than copying a stale diagram.
  rasterRevision += 1
  scheduleRender(source)
})

onMounted(() => {
  scheduleRender()
  resizeObserver = new ResizeObserver(() => {
    if (state.value === 'ready') fitMindmap()
  })
  if (svg.value) resizeObserver.observe(svg.value)
})

onBeforeUnmount(() => {
  revision += 1
  rasterRevision += 1
  if (updateTimer !== undefined) window.clearTimeout(updateTimer)
  resizeObserver?.disconnect()
  clearMindmap()
})
</script>

<template>
  <section class="markdown-mindmap" :class="`markdown-mindmap--${state}`" aria-label="Markdown 思维导图" @click="closeContextMenu()">
    <header>
      <div><span>脑图 · 由正文生成</span><small>滚轮缩放，拖拽平移，点击节点收合。</small></div>
      <div class="markdown-mindmap__actions"><button class="quiet-button" :disabled="state !== 'ready'" @click.stop="fitMindmap">适应画布</button><button class="quiet-button markdown-mindmap__copy" :disabled="state !== 'ready' || copying" title="复制当前导图为 PNG" @click.stop="copyMindmapPng">{{ copying ? '正在复制…' : '复制 PNG' }}</button><button class="quiet-button markdown-mindmap__export" :disabled="state !== 'ready' || exporting" @click.stop="exportMindmapSvg">{{ exporting ? '导出中…' : '导出 SVG' }}</button><button class="more-button" aria-label="图谱更多操作" :disabled="state !== 'ready'" @click.stop="openContextMenu($event, $event.currentTarget)">•••</button></div>
    </header>
    <div ref="stage" tabindex="0" class="markdown-mindmap__stage" :aria-busy="state === 'loading'" aria-label="当前笔记的思维导图；右键或 Shift 加 F10 打开图谱菜单" @click="closeContextMenu()" @contextmenu.prevent.stop="openContextMenu($event, $event.currentTarget)" @keydown="openContextMenuFromKeyboard">
      <svg v-show="state === 'ready' || state === 'loading'" ref="svg" aria-label="当前笔记的思维导图" />
      <div v-if="state === 'empty'" class="markdown-mindmap__empty"><b>用标题写出层级。</b><p>从 <code># 主题</code>、<code>## 分支</code> 开始，Knitspace 会即时生成一张可缩放的思维导图。</p></div>
      <div v-else-if="state === 'loading'" class="markdown-mindmap__loading"><i></i><span>正在整理标题结构…</span></div>
      <div v-else-if="state === 'error'" class="markdown-mindmap__error"><b>图谱暂时无法生成</b><p>{{ errorMessage }}</p></div>
    </div>
    <Teleport to="body">
      <section v-if="contextMenu" ref="contextMenuElement" class="markdown-mindmap__menu" role="menu" aria-label="图谱操作" :style="{ left: `${contextMenu.x}px`, top: `${contextMenu.y}px` }" @click.stop @contextmenu.prevent @keydown.stop="handleContextMenuKeydown">
        <p>图谱视图</p>
        <button role="menuitem" @click="fitMindmap(); closeContextMenu()">适应画布</button>
        <button role="menuitem" :class="{ selected: expandLevel === 2 }" @click="chooseExpandLevel(2)">概览：只看一级分支</button>
        <button role="menuitem" :class="{ selected: expandLevel === 4 }" @click="chooseExpandLevel(4)">展开：显示三层结构</button>
        <button role="menuitem" :class="{ selected: expandLevel === -1 }" @click="chooseExpandLevel(-1)">展开全部标题</button>
        <button role="menuitem" class="separator" :disabled="copying" @click="copyMindmapPng">{{ copying ? '正在复制 PNG…' : '复制当前视图 PNG' }}</button>
        <button role="menuitem" class="separator" :disabled="exporting" @click="exportMindmapSvg">{{ exporting ? '正在导出 SVG…' : '导出当前视图 SVG' }}</button>
        <button role="menuitem" class="separator" @click="rebuildMindmap">重新生成图谱</button>
      </section>
    </Teleport>
  </section>
</template>
