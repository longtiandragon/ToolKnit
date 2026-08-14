<script setup lang="ts">
import { computed, defineAsyncComponent, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AppIcon from '@/components/AppIcon.vue'
import PageHeader from '@/components/PageHeader.vue'
import FileDropZone from '@/components/FileDropZone.vue'
import { annotationLayerPosition, createAnnotation, duplicateAnnotation, moveAnnotationLayer, rotateAnnotation, updateAnnotationText, type AnnotationLayerMove, type CanvasAnnotation, type CanvasTool } from '@/lib/annotation-canvas'
import { canRedoAnnotationHistory, canUndoAnnotationHistory, commitAnnotationHistory, createAnnotationHistory, redoAnnotationHistory, undoAnnotationHistory } from '@/lib/annotation-history'
import { clampMenuPosition, isContextMenuShortcut, nextMenuItemIndex } from '@/lib/desktop-menu'
import { imagePreviewDebounceMs } from '@/lib/image-preview-policy'
import { filesWithinDropBudget } from '@/lib/file-drop-policy'
import { createRasterProcessPlan, safeCompressionPassLimit, type RasterProcessOptions, type RasterOutputType } from '@/lib/image-processing'
import { STITCH_MAX_FILES } from '@/lib/image-stitch'
import { newId } from '@/lib/id'
import { chooseOutputDirectory, exportOutput } from '@/lib/output'
import { blankCanvasFileName, blankCanvasPresetFromName, blankCanvasPresets, visualCanvasDimensions, visualCanvasForeground, type BlankCanvasPreset } from '@/lib/visual-blank-canvas'
import { copyPngToClipboard, copyStagedPngFiles, deleteDesktopVisualProject, getDesktopVisualProject, isDesktop, listDesktopVisualProjects, localAssetUrl, processAnimatedGif, revealDesktopFile, saveDesktopVisualProject, stageClipboardFile, type DesktopVisualProjectSummary } from '@/lib/native'
import { normalizeVisualProjectAnnotations, visualProjectSignature } from '@/lib/visual-project'
import { useWorkbenchStore } from '@/stores/workbench'
import { useUiStore } from '@/stores/ui'
import type { FileReference } from '@/types'

type LayoutKind = 'single' | 'pair' | 'grid'
type ImageMode = 'compose' | 'stitch' | 'convert' | 'resize' | 'crop' | 'rotate'
type EncodableImageType = 'image/png' | 'image/jpeg' | 'image/webp'
type SourceOutputType = EncodableImageType | 'image/gif'
type CropHandle = 'create' | 'move' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw'

interface CropRect {
  left: number
  top: number
  width: number
  height: number
}

interface CropDragState {
  handle: CropHandle
  startX: number
  startY: number
  startRect: CropRect
  originX?: number
  originY?: number
}

interface ViewportPanState {
  startX: number
  startY: number
  panX: number
  panY: number
}

interface AnnotationCanvasHandle {
  select: (id: number | null) => void
  focus: () => void
}

const store = useWorkbenchStore()
const ui = useUiStore()
const route = useRoute()
const router = useRouter()
const AnnotationCanvas = defineAsyncComponent(() => import('@/components/AnnotationCanvas.vue'))
const imageFiles = shallowRef<File[]>(store.consumeIntakeFiles().filter((file) => file.type.startsWith('image/') || /\.(png|jpe?g|webp|gif|bmp)$/i.test(file.name)))
const images = shallowRef<{ name: string; url: string; blank: boolean }[]>([])
const activeImageIndex = ref(0)
const activeMode = ref<ImageMode>(['stitch', 'convert', 'resize', 'crop', 'rotate'].includes(String(route.query.tool)) ? route.query.tool as ImageMode : 'compose')
const layout = ref<LayoutKind>('single')
const title = ref('')
const watermark = ref('')
const background = ref('#172321')
const imageFormat = ref<'source' | EncodableImageType>('source')
const quality = ref(100)
const compressionPasses = ref(1)
const maxWidth = ref(1920)
const rotation = ref(0)
const cropLeft = ref(0)
const cropTop = ref(0)
const cropWidth = ref(100)
const cropHeight = ref(100)
const processedPreviewUrl = ref('')
const processedPreviewBytes = ref(0)
const previewPending = ref(false)
const stitchOverlapMode = ref<'auto' | 'manual'>('auto')
const stitchManualOverlap = ref(15)
const stitchBlob = shallowRef<Blob>()
const stitchProgress = ref(0)
const stitchDetail = ref('')
const stitchRevision = ref(0)
const stitchResult = ref<{ width: number; height: number; overlaps: number[]; scores: number[]; warnings: string[] }>()
const CAPTURE_SHORTCUT = 'Ctrl+Alt+P'
const VISUAL_FILE_LIMIT = 32 * 1024 * 1024
const VISUAL_TOTAL_LIMIT = 96 * 1024 * 1024
const captureSessionActive = ref(false)
const captureSessionBusy = ref(false)
const captureSessionCount = ref(0)
const captureSessionLastWindow = ref('')
const captureSessionError = ref('')
let captureShortcutRegistered = false
const canvasTool = ref<CanvasTool>('select')
const annotationText = ref('重点')
const annotationColor = ref('#ffbf69')
const annotations = shallowRef<CanvasAnnotation[]>([])
const annotationHistory = shallowRef(createAnnotationHistory())
const annotationCanvas = ref<AnnotationCanvasHandle>()
const selectedAnnotationId = ref<number | null>(null)
const layerPanelOpen = ref(false)
const layerVisibleLimit = ref(40)
const annotationMenu = ref({ open: false, id: 0, x: 0, y: 0 })
const annotationMenuElement = ref<HTMLElement>()
const annotationTextEditor = ref({ open: false, id: 0, text: '', x: 0, y: 0 })
const annotationTextEditorElement = ref<HTMLElement>()
const annotationTextEditorInput = ref<HTMLInputElement>()
const projectPanelOpen = ref(false)
const projectPanelElement = ref<HTMLElement>()
const projectTitle = ref('未命名画布')
const projectId = ref<string>()
const projectCreatedAt = ref<string>()
const savedProjectSignature = ref('')
const visualProjects = ref<DesktopVisualProjectSummary[]>([])
const projectLoading = ref(false)
const projectSaving = ref(false)
const blankCanvasBusy = ref(false)
const projectMenu = ref({ open: false, x: 0, y: 0 })
const projectMenuElement = ref<HTMLElement>()
const processMenu = ref({ open: false, x: 0, y: 0 })
const processMenuElement = ref<HTMLElement>()
let annotationMenuTrigger: HTMLElement | undefined
let processMenuTrigger: HTMLElement | undefined
let projectMenuTrigger: HTMLElement | undefined
const exporting = ref(false)
const copying = ref(false)
const lastOutputs = ref<FileReference[]>([])
const message = ref('导入图片后即可拼图、标注、复制或导出。')
const previewViewport = ref<HTMLElement>()
const previewImage = ref<HTMLImageElement>()
const imageBounds = ref({ left: 0, top: 0, width: 0, height: 0 })
const imageNaturalSize = ref({ width: 0, height: 0 })
const cropDrag = ref<CropDragState | null>(null)
const cropInitialized = ref(false)
const viewportZoom = ref(1)
const viewportPan = ref({ x: 0, y: 0 })
const viewportPanning = ref(false)
const spacePressed = ref(false)
const viewportPanState = ref<ViewportPanState | null>(null)
let previewResizeObserver: ResizeObserver | undefined
let previewAbortController: AbortController | undefined
let disposed = false

const quickTools = [
  { id: 'compose', title: '画布标注', description: '空白、拼图与标注', icon: 'palette' },
  { id: 'stitch', title: '滚动长图', description: '识别重叠并连续拼接', icon: 'sort' },
  { id: 'convert', title: '格式转换', description: 'PNG / JPG / WebP', icon: 'image' },
  { id: 'resize', title: '压缩缩放', description: '尺寸与质量', icon: 'resize' },
  { id: 'crop', title: '裁剪图片', description: '精确裁切区域', icon: 'crop' },
  { id: 'rotate', title: '旋转图片', description: '批量调整方向', icon: 'rotate' }
] as const
/**
 * Six modes are two jobs, not one list: you are either making a picture (a
 * canvas you annotate, a scroll you stitch) or converting one you already
 * have. The old strip showed all six as equal cards with descriptions and
 * spent 90px of canvas height doing it, while saying nothing about the split.
 */
const modeGroups = [
  { label: '创作', ids: ['compose', 'stitch'] },
  { label: '处理', ids: ['convert', 'resize', 'crop', 'rotate'] },
] as const
const modeSections = computed(() => modeGroups.map((group) => ({
  label: group.label,
  tools: group.ids.map((id) => quickTools.find((tool) => tool.id === id)!),
})))
/* The annotation tools float over the canvas instead of taking a rail that
   only exists in one of the six modes — the rail made the canvas jump
   sideways every time you switched. */
const annotationTools: { id: CanvasTool; label: string; icon: string; hint: string }[] = [
  { id: 'select', label: '选择', icon: 'pointer', hint: '选择、移动、缩放和旋转已有标注' },
  { id: 'box', label: '方框', icon: 'square', hint: '拖出一个方框' },
  { id: 'arrow', label: '箭头', icon: 'arrow-right', hint: '从起点拖到终点画箭头' },
  { id: 'text', label: '文字', icon: 'file-text', hint: '点一下放置文字，右键可再编辑' },
]
const layoutOptions: { id: LayoutKind; label: string }[] = [
  { id: 'single', label: '单图' },
  { id: 'pair', label: '双图' },
  { id: 'grid', label: '四宫格' },
]
const cropHandles: CropHandle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']

const slots = computed(() => layout.value === 'single' ? 1 : layout.value === 'pair' ? 2 : 4)
const visibleImages = computed(() => images.value.slice(0, slots.value))
const activeImage = computed(() => images.value[activeImageIndex.value] ?? images.value[0])
const activeImageFile = computed(() => imageFiles.value[activeImageIndex.value] ?? imageFiles.value[0])
const activeBlankCanvas = computed(() => blankCanvasPresetFromName(activeImageFile.value?.name))
const compositionDimensions = computed(() => visualCanvasDimensions(layout.value, activeImageFile.value?.name))
const compositionForeground = computed(() => visualCanvasForeground(background.value))
const compositionStyle = computed(() => ({
  background: background.value,
  aspectRatio: `${compositionDimensions.value.width} / ${compositionDimensions.value.height}`,
  '--canvas-text': compositionForeground.value.text,
  '--canvas-muted': compositionForeground.value.muted,
}))
const activeTool = computed(() => quickTools.find((tool) => tool.id === activeMode.value) ?? quickTools[0])
const outputReady = computed(() => activeMode.value === 'stitch' ? Boolean(stitchBlob.value) && !previewPending.value && !captureSessionActive.value : images.value.length > 0)
const annotationMenuAnnotation = computed(() => annotationMenu.value.open ? annotations.value.find((item) => item.id === annotationMenu.value.id) : undefined)
const annotationMenuLayer = computed(() => annotationLayerPosition(annotations.value, annotationMenu.value.id))
const selectedAnnotation = computed(() => selectedAnnotationId.value === null ? undefined : annotations.value.find((item) => item.id === selectedAnnotationId.value))
const visibleAnnotationLayers = computed(() => annotations.value
  .map((annotation, index) => ({ annotation, index }))
  .reverse()
  .slice(0, layerVisibleLimit.value))
const activeSourceOutputType = computed(() => activeMode.value === 'stitch' ? 'image/png' : sourceOutputType(activeImageFile.value))
const activeOutputType = computed(() => activeMode.value === 'stitch' ? 'image/png' : imageFormat.value === 'source' ? activeSourceOutputType.value : imageFormat.value)
const sourcePassThrough = computed(() => activeMode.value !== 'stitch' && imageFormat.value === 'source' && !activeSourceOutputType.value)
const formatLabel = computed(() => {
  if (imageFormat.value !== 'source') return outputTypeLabel(imageFormat.value)
  return `源格式（${sourceExtensionLabel(activeImageFile.value)}）`
})
const qualityApplies = computed(() => {
  const outputType = activeOutputType.value
  return outputType === 'image/jpeg' || outputType === 'image/webp' || outputType === 'image/gif'
})
const repeatedCompressionApplies = computed(() => qualityApplies.value && activeOutputType.value !== 'image/gif')
const processedSizeLabel = computed(() => {
  const bytes = processedPreviewBytes.value
  if (!bytes) return ''
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(2)} MB`
})
const compressionPassLimit = computed(() => safeCompressionPassLimit(imageNaturalSize.value.width, imageNaturalSize.value.height))
const compressionPassLabel = computed(() => repeatedCompressionApplies.value && compressionPasses.value > 1 ? ` · 重复 ${compressionPasses.value} 次` : '')
const previewSource = computed(() => activeMode.value === 'crop' ? activeImage.value?.url : processedPreviewUrl.value || activeImage.value?.url)
const previewImageStyle = computed(() => imageBounds.value.width ? ({
  left: `${imageBounds.value.left}px`,
  top: `${imageBounds.value.top}px`,
  width: `${imageBounds.value.width}px`,
  height: `${imageBounds.value.height}px`,
  transform: `translate(${viewportPan.value.x}px, ${viewportPan.value.y}px) scale(${viewportZoom.value})`,
}) : undefined)
const cropSelectionStyle = computed(() => ({ left: `${cropLeft.value}%`, top: `${cropTop.value}%`, width: `${cropWidth.value}%`, height: `${cropHeight.value}%` }))
const cropLayerStyle = computed(() => ({
  left: `${imageBounds.value.left}px`,
  top: `${imageBounds.value.top}px`,
  width: `${imageBounds.value.width}px`,
  height: `${imageBounds.value.height}px`,
  transform: `translate(${viewportPan.value.x}px, ${viewportPan.value.y}px) scale(${viewportZoom.value})`,
}))
const viewportZoomLabel = computed(() => `${Math.round(viewportZoom.value * 100)}%`)
const canUndoAnnotations = computed(() => canUndoAnnotationHistory(annotationHistory.value))
const canRedoAnnotations = computed(() => canRedoAnnotationHistory(annotationHistory.value))
const activeProjectSignature = computed(() => visualProjectSignature({
  title: projectTitle.value,
  canvasTitle: title.value,
  layout: layout.value,
  background: background.value,
  watermark: watermark.value,
  annotations: annotations.value,
  images: imageFiles.value,
}))
const projectDirty = computed(() => projectId.value
  ? activeProjectSignature.value !== savedProjectSignature.value
  : imageFiles.value.length > 0 || annotations.value.length > 0)
const cropPixelSummary = computed(() => {
  const width = Math.max(1, Math.round(imageNaturalSize.value.width * cropWidth.value / 100))
  const height = Math.max(1, Math.round(imageNaturalSize.value.height * cropHeight.value / 100))
  return imageNaturalSize.value.width ? `${width} × ${height} px` : `${Math.round(cropWidth.value)}% × ${Math.round(cropHeight.value)}%`
})
const processSummary = computed(() => activeMode.value === 'stitch'
  ? captureSessionActive.value
    ? `桌面采集中 · ${captureSessionCount.value} 张 · ${CAPTURE_SHORTCUT}`
    : previewPending.value
    ? `${stitchDetail.value || '正在后台识别重叠…'} · ${stitchProgress.value}%`
    : stitchResult.value
      ? `${stitchResult.value.width} × ${stitchResult.value.height} px · ${imageFiles.value.length} 张${stitchResult.value.warnings.length ? ` · ${stitchResult.value.warnings.length} 处需检查` : ' · 重叠可信'}`
      : '按截图顺序导入 2–24 张图片'
  : sourcePassThrough.value && activeMode.value !== 'compose'
  ? `${sourceExtensionLabel(activeImageFile.value)} 保持原样 · 动画与源文件不变`
  : previewPending.value
  ? `正在更新 ${activeTool.value.title}预览…输入仍可继续调整`
  : activeMode.value === 'convert'
  ? `实时预览 · 输出 ${formatLabel.value}${qualityApplies.value ? ` · 质量 ${quality.value}%${compressionPassLabel.value}` : ' · 无损'}${processedSizeLabel.value ? ` · ${processedSizeLabel.value}` : ''}`
  : activeMode.value === 'resize'
    ? `最大宽度 ${maxWidth.value}px · ${qualityApplies.value ? `质量 ${quality.value}%${compressionPassLabel.value}` : 'PNG 无损'}${processedSizeLabel.value ? ` · ${processedSizeLabel.value}` : ''}`
    : activeMode.value === 'crop'
      ? `裁剪 ${Math.round(cropWidth.value)}% × ${Math.round(cropHeight.value)}% · 起点 ${Math.round(cropLeft.value)}%, ${Math.round(cropTop.value)}%`
      : activeMode.value === 'rotate' ? rotation.value ? `已旋转 ${rotation.value}°` : '原始方向' : '拼图、标题与标注')

/* ── Copy that has to say what this particular mode is doing ──────────────
   Six modes share one canvas, so every label around it has to change with the
   mode. Written here rather than as nested ternaries in the markup: the
   sentences are the product, and they are easier to get right when they sit
   next to each other. */
const exportLabel = computed(() => activeMode.value === 'stitch'
  ? '导出长图'
  : activeMode.value !== 'compose' && images.value.length > 1 ? `导出 ${images.value.length} 张` : '导出')
const canvasHeading = computed(() => activeMode.value === 'compose'
  ? activeBlankCanvas.value ? `${activeBlankCanvas.value.label}空白画布` : '拼图与标注'
  : activeMode.value === 'stitch' ? '滚动长图预览'
  : sourcePassThrough.value ? '源文件预览'
  : activeMode.value === 'crop' ? '在原图上框选' : '处理后预览')
const outputTitle = computed(() => activeMode.value === 'stitch'
  ? `${images.value.length} 张连续截图`
  : activeMode.value === 'compose'
    ? `${compositionDimensions.value.width} × ${compositionDimensions.value.height} px`
    : activeImage.value?.name ?? '')
const outputDetail = computed(() => activeMode.value === 'stitch'
  ? '输出 PNG · 每张源截图保持不变'
  : activeMode.value === 'compose' ? '输出 PNG · 源图与标注都不写回原件'
  : sourcePassThrough.value ? '动画与源文件字节保持不变'
  : activeMode.value === 'crop' ? `${cropPixelSummary.value} · 输出 ${formatLabel.value}`
  : `输出 ${formatLabel.value} · 原文件保持不变`)
const sourceEmptyHint = computed(() => activeMode.value === 'stitch'
  ? `按截图顺序拖入 2–${STITCH_MAX_FILES} 张同宽截图，或用桌面采集逐屏抓取。`
  : activeMode.value === 'compose' ? '先选一块空白画布，或把要拼合、标注的图片拖进来。'
  : `支持 JPG、PNG、WebP、GIF，一次最多 ${STITCH_MAX_FILES} 张一起处理。`)

function formatProjectTime(value: string | number) {
  return new Date(value).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

watch(imageFiles, (selected) => {
  images.value.forEach((item) => URL.revokeObjectURL(item.url))
  images.value = selected.slice(0, STITCH_MAX_FILES).map((file) => ({ name: file.name, url: URL.createObjectURL(file), blank: Boolean(blankCanvasPresetFromName(file.name)) }))
  activeImageIndex.value = 0
  resetAnnotationHistory()
  message.value = images.value.length ? `已载入 ${images.value.length} 张图片，可以直接编辑。` : '拖入图片开始创作。'
}, { immediate: true })

watch(() => route.query.tool, (tool) => {
  activeMode.value = ['stitch', 'convert', 'resize', 'crop', 'rotate'].includes(String(tool)) ? tool as ImageMode : 'compose'
})

watch(() => route.query.project, (project) => {
  const id = typeof project === 'string' ? project : ''
  if (id && id !== projectId.value) void openVisualProject(id)
})

watch(() => route.query.canvas, (canvas) => {
  if (canvas !== 'blank' || route.query.project) return
  const preset = blankCanvasPresets.find((item) => item.id === route.query.preset) ?? blankCanvasPresets[0]
  void createBlankCanvas(preset, Boolean(imageFiles.value.length || annotations.value.length))
}, { immediate: true })

watch(activeMode, (mode) => {
  if (mode !== 'stitch' && captureSessionActive.value) void stopCaptureSession(false)
  if (mode === 'crop' && !cropInitialized.value) {
    cropLeft.value = 10
    cropTop.value = 10
    cropWidth.value = 80
    cropHeight.value = 80
    cropInitialized.value = true
  }
  nextTick(syncImageBounds)
  resetViewport()
}, { immediate: true })

watch(previewViewport, (current, previous) => {
  if (previous && previewResizeObserver) previewResizeObserver.unobserve(previous)
  if (current && previewResizeObserver) previewResizeObserver.observe(current)
  nextTick(syncImageBounds)
})

let previewVersion = 0
let previewRenderTimer: number | undefined
watch([compressionPasses, compressionPassLimit], ([value, limit]) => {
  const normalized = Math.max(1, Math.min(limit, Math.trunc(Number(value) || 1)))
  if (value !== normalized) {
    compressionPasses.value = normalized
    message.value = `为避免画质失控或内存不足，当前图片的重复压缩范围是 1–${limit} 次。`
  }
})

function clearProcessedPreview() {
  processedPreviewBytes.value = 0
  if (!processedPreviewUrl.value) return
  URL.revokeObjectURL(processedPreviewUrl.value)
  processedPreviewUrl.value = ''
}

async function refreshVisualProjects() {
  if (!isDesktop()) return
  try { visualProjects.value = await listDesktopVisualProjects() }
  catch (error) { ui.toast('无法读取画布项目', error instanceof Error ? error.message : 'Vault 暂时不可用。', 'error') }
}

function toggleProjectPanel() {
  projectPanelOpen.value = !projectPanelOpen.value
  if (projectPanelOpen.value) void refreshVisualProjects()
}

function resetVisualProjectState() {
  projectId.value = undefined
  projectCreatedAt.value = undefined
  projectTitle.value = '未命名画布'
  title.value = ''
  watermark.value = ''
  background.value = '#172321'
  layout.value = 'single'
  imageFiles.value = []
  savedProjectSignature.value = ''
  resetAnnotationHistory()
  projectPanelOpen.value = false
}

async function createVisualProject() {
  if (projectDirty.value && !await ui.confirm({
    title: '新建画布项目？',
    message: '当前未保存的画布内容会从编辑区移除；已经导出的图片不会受影响。',
    confirmLabel: '新建画布',
  })) return
  resetVisualProjectState()
  message.value = '已新建画布项目；可以创建空白画布，或导入图片继续。'
  await router.replace({ path: '/visual' })
}

async function createBlankCanvas(preset: BlankCanvasPreset = blankCanvasPresets[0], confirmReplace = true) {
  if (blankCanvasBusy.value) return
  if (confirmReplace && projectDirty.value && !await ui.confirm({
    title: '创建新的空白画布？',
    message: '当前未保存的图片和标注会从编辑区移除；已经导出的文件不会受影响。',
    confirmLabel: '创建空白画布',
  })) return
  blankCanvasBusy.value = true
  try {
    const canvas = document.createElement('canvas')
    canvas.width = preset.width
    canvas.height = preset.height
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
    if (!blob) throw new Error('当前桌面运行环境无法创建 PNG 画布。')
    resetVisualProjectState()
    projectTitle.value = `未命名${preset.label}`
    background.value = '#fffaf0'
    imageFiles.value = [new File([blob], blankCanvasFileName(preset), { type: 'image/png', lastModified: Date.now() })]
    canvasTool.value = 'select'
    closeProcessMenu()
    await router.replace({ path: '/visual' })
    await nextTick()
    message.value = `已创建 ${preset.label} · ${preset.width} × ${preset.height}；可直接添加方框、箭头和文字。`
    annotationCanvas.value?.focus()
  } catch (error) {
    ui.toast('无法创建空白画布', error instanceof Error ? error.message : '请稍后重试。', 'error')
  } finally {
    blankCanvasBusy.value = false
  }
}

function createBlankCanvasFromMenu(preset: BlankCanvasPreset) {
  closeProcessMenu()
  void createBlankCanvas(preset)
}

async function saveVisualProject() {
  if (projectSaving.value) return
  if (!isDesktop()) { ui.toast('请使用桌面开发版', '画布项目需要保存到本机 Vault，网页预览只用于界面检查。', 'warning'); return }
  if (!imageFiles.value.length) { ui.toast('还没有可保存的画布', '请创建空白画布，或导入 1–4 张图片。', 'warning'); return }
  const name = projectTitle.value.trim()
  if (!name) { ui.toast('请输入画布项目名称', undefined, 'warning'); return }
  projectSaving.value = true
  try {
    const saved = await saveDesktopVisualProject({
      id: projectId.value ?? newId(),
      title: name,
      canvasTitle: title.value,
      layout: layout.value,
      background: background.value,
      watermark: watermark.value,
      annotations: annotations.value,
      images: imageFiles.value,
      createdAt: projectCreatedAt.value,
    })
    projectId.value = saved.id
    projectCreatedAt.value = saved.createdAt
    projectTitle.value = saved.title
    await nextTick()
    savedProjectSignature.value = activeProjectSignature.value
    await refreshVisualProjects()
    await router.replace({ path: '/visual', query: { project: saved.id } })
    store.touchContentRecent('diagram', saved.id)
    message.value = `画布项目“${saved.title}”已保存到本地 Vault。`
    ui.toast('画布项目已保存', `${saved.images.length} 个底图 · ${saved.annotations.length} 个标注`, 'success')
  } catch (error) {
    ui.toast('保存画布失败', error instanceof Error ? error.message : '无法写入本地 Vault。', 'error')
  } finally { projectSaving.value = false }
}

async function openVisualProject(id: string) {
  if (projectLoading.value || id === projectId.value && !projectDirty.value) { projectPanelOpen.value = false; return }
  if (projectDirty.value && !await ui.confirm({
    title: '打开另一个画布？',
    message: '当前未保存的改动会留在编辑器之外且无法恢复。',
    confirmLabel: '打开项目',
  })) return
  projectLoading.value = true
  try {
    const project = await getDesktopVisualProject(id)
    const files = await Promise.all(project.images.map(async (image) => {
      const response = await fetch(localAssetUrl(image.path))
      if (!response.ok) throw new Error(`无法读取源图“${image.name}”`)
      return new File([await response.blob()], image.name, {
        type: image.mime,
        lastModified: Date.parse(project.updatedAt) || Date.now(),
      })
    }))
    activeMode.value = 'compose'
    projectId.value = project.id
    projectCreatedAt.value = project.createdAt
    projectTitle.value = project.title
    title.value = project.canvasTitle
    layout.value = project.layout
    background.value = project.background
    watermark.value = project.watermark
    imageFiles.value = files
    await nextTick()
    const restored = normalizeVisualProjectAnnotations(project.annotations)
    annotationHistory.value = createAnnotationHistory(restored)
    annotations.value = annotationHistory.value.present
    await nextTick()
    savedProjectSignature.value = activeProjectSignature.value
    await router.replace({ path: '/visual', query: { project: project.id } })
    store.touchContentRecent('diagram', project.id)
    projectPanelOpen.value = false
    message.value = `已打开“${project.title}”；底图和标注均可继续编辑。`
  } catch (error) {
    ui.toast('无法打开画布项目', error instanceof Error ? error.message : '项目资源可能已损坏。', 'error')
  } finally { projectLoading.value = false }
}

async function removeVisualProject(project: DesktopVisualProjectSummary) {
  if (!await ui.confirm({
    title: `删除“${project.title}”？`,
    message: '会删除 Vault 中的画布状态和复制的源图；已导出的 PNG 不受影响。',
    danger: true,
    confirmLabel: '删除项目',
  })) return
  try {
    await deleteDesktopVisualProject(project.id)
    store.forgetContentPointers('diagram', project.id)
    if (projectId.value === project.id) {
      projectId.value = undefined
      projectCreatedAt.value = undefined
      savedProjectSignature.value = ''
      await router.replace({ path: '/visual' })
    }
    await refreshVisualProjects()
    ui.toast('画布项目已删除', undefined, 'success')
  } catch (error) { ui.toast('删除失败', error instanceof Error ? error.message : '无法删除画布项目。', 'error') }
}

async function loadDevelopmentImageFixture() {
  const fixture = String(route.query.qa)
  if (!import.meta.env.DEV || !['image', 'canvas'].includes(fixture) || imageFiles.value.length) return
  try {
    const response = await fetch('/src-tauri/icons/Square310x310Logo.png')
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const blob = await response.blob()
    imageFiles.value = [new File([blob], 'knitspace-image-qa.png', { type: 'image/png' })]
    if (fixture === 'canvas') {
      await nextTick()
      const seeded = [
        createAnnotation({ id: 101, kind: 'box', x: .12, y: .16, width: .45, height: .28, rotation: -8, text: '', color: '#ffbf69' }),
        createAnnotation({ id: 102, kind: 'arrow', x: .68, y: .68, width: -.24, height: -.18, text: '', color: '#e7d8a0' }),
        createAnnotation({ id: 103, kind: 'text', x: .5, y: .17, width: .3, height: .08, rotation: 6, text: '本地画布', color: '#fff4c9' }),
      ]
      annotationHistory.value = createAnnotationHistory(seeded)
      annotations.value = annotationHistory.value.present
      selectedAnnotationId.value = 103
      layerPanelOpen.value = true
    }
    message.value = '已载入开发环境测试图；不会出现在正式构建中。'
  } catch {
    message.value = '开发环境测试图载入失败，请改用拖放或文件选择器。'
  }
}

async function loadDevelopmentStitchFixture() {
  const fixture = String(route.query.qa)
  if (!import.meta.env.DEV || !['stitch', 'capture'].includes(fixture) || imageFiles.value.length) return
  const source = document.createElement('canvas')
  source.width = 800
  source.height = 1500
  const context = source.getContext('2d')
  if (!context) return
  context.fillStyle = '#fffdf7'
  context.fillRect(0, 0, source.width, source.height)
  context.fillStyle = '#173d31'
  context.font = '700 34px sans-serif'
  context.fillText('Knitspace 滚动截图验收', 44, 62)
  context.font = '18px sans-serif'
  for (let top = 110, row = 1; top < 1470; top += 55, row += 1) {
    context.fillStyle = row % 2 ? '#e7f1eb' : '#f4eee2'
    context.fillRect(38, top - 28, 724, 42)
    context.fillStyle = '#29473b'
    context.fillText(`第 ${String(row).padStart(2, '0')} 行 · 自动重叠识别不能丢失内容`, 58, top)
    context.fillStyle = '#3c8b6b'
    context.fillRect(710, top - 20, row * 13 % 42 + 10, 9)
  }
  const files: File[] = []
  for (const [index, top] of [0, 450, 900].entries()) {
    const frame = document.createElement('canvas')
    frame.width = 800
    frame.height = 600
    frame.getContext('2d')?.drawImage(source, 0, top, 800, 600, 0, 0, 800, 600)
    const blob = await new Promise<Blob | null>((resolve) => frame.toBlob(resolve, 'image/png'))
    if (blob) files.push(new File([blob], `scroll-${index + 1}.png`, { type: 'image/png' }))
  }
  imageFiles.value = files
  if (fixture === 'capture') {
    captureSessionActive.value = true
    captureSessionCount.value = files.length
    captureSessionLastWindow.value = '算法题解 — Microsoft Edge'
    message.value = `桌面采集中 · 已新增 ${files.length} 张；结束会话后一次性识别。`
  } else {
    message.value = '已载入 3 张开发环境连续截图；源图之间各有 150 px 重叠。'
  }
}

async function unregisterCaptureShortcut() {
  if (!captureShortcutRegistered) return
  captureShortcutRegistered = false
  try {
    const { unregister } = await import('@tauri-apps/plugin-global-shortcut')
    await unregister(CAPTURE_SHORTCUT)
  } catch {
    // The process also releases global shortcuts on exit. Leaving this best-
    // effort keeps route teardown safe when the desktop shell is closing.
  }
}

async function stopCaptureSession(announce = true) {
  closeProcessMenu()
  const wasActive = captureSessionActive.value
  captureSessionActive.value = false
  await unregisterCaptureShortcut()
  if (!wasActive) return
  captureSessionBusy.value = false
  if (imageFiles.value.length >= 2) {
    message.value = `采集结束，共新增 ${captureSessionCount.value} 张截图；正在后台识别重叠。`
  } else {
    message.value = `采集结束，目前只有 ${imageFiles.value.length} 张；至少需要 2 张才能生成滚动长图。`
  }
  if (announce) ui.toast('滚动截图采集已结束', `${captureSessionCount.value} 张新截图留在当前队列。`, 'success')
}

async function captureForegroundFrame() {
  if (!captureSessionActive.value || captureSessionBusy.value) return
  if (imageFiles.value.length >= STITCH_MAX_FILES) {
    await stopCaptureSession(false)
    ui.toast('已达到 24 张安全上限', '采集已自动结束，正在生成滚动长图。', 'warning')
    return
  }
  captureSessionBusy.value = true
  captureSessionError.value = ''
  try {
    const { captureDesktopForegroundWindow, readDesktopInputFile, sendSystemNotification } = await import('@/lib/native')
    const capture = await captureDesktopForegroundWindow()
    const capturedTitle = capture.windowTitle.trim()
    if (/^Knitspace(?:\s|$)/i.test(capturedTitle) || /(?:^|[\\/])(?:knitspace|toolknit)\.exe$/i.test(capturedTitle)) {
      throw new Error('当前前台窗口是 Knitspace。请先切换到需要滚动的目标窗口。')
    }
    const file = await readDesktopInputFile(capture.path)
    if (!captureSessionActive.value) return
    imageFiles.value = [...imageFiles.value, file].slice(0, STITCH_MAX_FILES)
    captureSessionCount.value += 1
    captureSessionLastWindow.value = capture.windowTitle
    message.value = `已采集第 ${captureSessionCount.value} 张 · ${capture.width} × ${capture.height} px；滚动目标窗口后再次按 ${CAPTURE_SHORTCUT}。`
    void sendSystemNotification('Knitspace 已采集一张', `第 ${captureSessionCount.value} 张 · 滚动后继续按 ${CAPTURE_SHORTCUT}`).catch(() => false)
    if (imageFiles.value.length >= STITCH_MAX_FILES) {
      await stopCaptureSession(false)
      ui.toast('已达到 24 张安全上限', '采集自动结束，正在生成滚动长图。', 'warning')
    }
  } catch (error) {
    captureSessionError.value = error instanceof Error ? error.message : '无法采集前台窗口。'
    message.value = captureSessionError.value
  } finally {
    captureSessionBusy.value = false
  }
}

async function startCaptureSession() {
  closeProcessMenu()
  captureSessionError.value = ''
  if (!isDesktop()) {
    captureSessionError.value = '前台窗口采集需要 Knitspace 桌面开发版。浏览器预览仍可导入已有截图。'
    return
  }
  if (captureSessionActive.value) return
  if (imageFiles.value.length >= STITCH_MAX_FILES) {
    captureSessionError.value = '当前队列已有 24 张图片。请先移除部分截图。'
    return
  }
  try {
    const { isRegistered, register, unregister } = await import('@tauri-apps/plugin-global-shortcut')
    if (await isRegistered(CAPTURE_SHORTCUT)) await unregister(CAPTURE_SHORTCUT)
    await register(CAPTURE_SHORTCUT, (event) => {
      if (event.state === 'Pressed') void captureForegroundFrame()
    })
    captureShortcutRegistered = true
    captureSessionActive.value = true
    captureSessionCount.value = 0
    captureSessionLastWindow.value = ''
    message.value = `采集会话已开始。切换到目标窗口，滚动后按 ${CAPTURE_SHORTCUT}；返回 Knitspace 点击结束。`
    ui.toast('桌面采集会话已开始', `切换到目标窗口后按 ${CAPTURE_SHORTCUT}。`, 'success')
    const { sendSystemNotification } = await import('@/lib/native')
    void sendSystemNotification('Knitspace 采集会话已开始', `切换到目标窗口，滚动后按 ${CAPTURE_SHORTCUT}。`).catch(() => false)
  } catch (error) {
    await unregisterCaptureShortcut()
    captureSessionActive.value = false
    captureSessionError.value = error instanceof Error
      ? `无法注册 ${CAPTURE_SHORTCUT}：${error.message}`
      : `无法注册 ${CAPTURE_SHORTCUT}，可能已被其他软件占用。`
  }
}

async function hideForCapture() {
  if (!captureSessionActive.value) return
  closeProcessMenu()
  const { hideMainWindow, sendSystemNotification } = await import('@/lib/native')
  await sendSystemNotification('Knitspace 采集会话进行中', `滚动目标窗口后按 ${CAPTURE_SHORTCUT}；从系统托盘重新打开 Knitspace。`).catch(() => false)
  await hideMainWindow()
}

type StitchWorkerMessage =
  | { kind: 'progress'; progress: number; detail: string }
  | { kind: 'result'; blob: Blob; width: number; height: number; overlaps: number[]; scores: number[]; warnings: string[] }
  | { kind: 'error'; error: string }

function processStitchOffThread(files: File[], signal: AbortSignal, onProgress: (progress: number, detail: string) => void) {
  return new Promise<Extract<StitchWorkerMessage, { kind: 'result' }>>((resolve, reject) => {
    let worker: Worker
    let settled = false
    try {
      worker = new Worker(new URL('../workers/image-stitch.worker.ts', import.meta.url), { type: 'module' })
    } catch (error) {
      reject(error instanceof Error ? error : new Error('无法启动滚动截图后台进程。'))
      return
    }
    const finish = (callback: () => void) => {
      if (settled) return
      settled = true
      signal.removeEventListener('abort', abort)
      worker.terminate()
      callback()
    }
    const abort = () => finish(() => reject(new DOMException('滚动截图拼接已取消。', 'AbortError')))
    signal.addEventListener('abort', abort, { once: true })
    worker.onerror = (event) => {
      event.preventDefault()
      finish(() => reject(new Error(event.message || '滚动截图后台进程异常退出。')))
    }
    worker.onmessage = ({ data }: MessageEvent<StitchWorkerMessage>) => {
      if (data.kind === 'progress') { onProgress(data.progress, data.detail); return }
      if (data.kind === 'error') { finish(() => reject(new Error(data.error))); return }
      finish(() => resolve(data))
    }
    worker.postMessage({
      files,
      overlapMode: stitchOverlapMode.value,
      manualOverlapPercent: stitchManualOverlap.value,
    })
  })
}

async function renderStitchPreview(version: number) {
  const controller = new AbortController()
  previewAbortController = controller
  stitchProgress.value = 0
  stitchDetail.value = '正在准备截图…'
  try {
    const result = await processStitchOffThread(imageFiles.value.slice(0, STITCH_MAX_FILES), controller.signal, (progress, detail) => {
      if (version !== previewVersion || disposed) return
      stitchProgress.value = progress
      stitchDetail.value = detail
    })
    if (version !== previewVersion || disposed) return
    const nextUrl = URL.createObjectURL(result.blob)
    if (version !== previewVersion || disposed) { URL.revokeObjectURL(nextUrl); return }
    const previousUrl = processedPreviewUrl.value
    processedPreviewUrl.value = nextUrl
    processedPreviewBytes.value = result.blob.size
    stitchBlob.value = result.blob
    stitchResult.value = {
      width: result.width,
      height: result.height,
      overlaps: result.overlaps,
      scores: result.scores,
      warnings: result.warnings,
    }
    if (previousUrl) requestAnimationFrame(() => URL.revokeObjectURL(previousUrl))
    message.value = result.warnings.length
      ? `长图已生成；${result.warnings.length} 处没有可靠重叠，已完整保留内容，请检查接缝。`
      : `已自动识别 ${result.overlaps.length} 处重叠并生成滚动长图。`
    await nextTick()
    syncImageBounds()
  } catch (error) {
    if (version === previewVersion && !controller.signal.aborted) {
      stitchBlob.value = undefined
      stitchResult.value = undefined
      message.value = error instanceof Error ? error.message : '无法生成滚动长图。'
    }
  } finally {
    if (previewAbortController === controller) previewAbortController = undefined
    if (version === previewVersion) previewPending.value = false
  }
}

async function renderProcessedPreview(file: File, version: number) {
  const controller = new AbortController()
  previewAbortController = controller
  try {
    // Source-format GIFs are intentionally given one extra tick before their
    // potentially expensive frame pipeline begins. The outer debounce keeps
    // slider drags from repeatedly reaching this point.
    if (imageFormat.value === 'source' && sourceOutputType(file) === 'image/gif') {
      await new Promise<void>((resolve) => setTimeout(resolve, 280))
      if (version !== previewVersion || disposed) return
    }
    const blob = await renderProcessedBlob(file, undefined, controller.signal)
    if (version !== previewVersion || disposed) return
    const nextUrl = URL.createObjectURL(blob)
    if (version !== previewVersion || disposed) { URL.revokeObjectURL(nextUrl); return }
    const previousUrl = processedPreviewUrl.value
    processedPreviewUrl.value = nextUrl
    processedPreviewBytes.value = blob.size
    if (previousUrl) requestAnimationFrame(() => URL.revokeObjectURL(previousUrl))
    message.value = `${activeTool.value.title}预览已更新；原图不会被修改。`
    await nextTick()
    syncImageBounds()
  } catch (error) {
    if (version === previewVersion && !controller.signal.aborted) message.value = error instanceof Error ? error.message : '无法生成实时预览。'
  } finally {
    if (previewAbortController === controller) previewAbortController = undefined
    if (version === previewVersion) previewPending.value = false
  }
}

watch([activeImageFile, activeMode, imageFormat, quality, compressionPasses, maxWidth, rotation], ([file]) => {
  if (activeMode.value === 'stitch') return
  const version = ++previewVersion
  previewAbortController?.abort()
  previewAbortController = undefined
  const passThrough = imageFormat.value === 'source' && file instanceof File && !sourceOutputType(file)
  if (previewRenderTimer !== undefined) window.clearTimeout(previewRenderTimer)
  previewRenderTimer = undefined
  if (!(file instanceof File) || activeMode.value === 'compose' || activeMode.value === 'crop' || passThrough) {
    previewPending.value = false
    clearProcessedPreview()
    if (passThrough) message.value = `将原样保留“${file.name}”；GIF 动画和源文件字节不会改变。`
    return
  }
  previewPending.value = true
  previewRenderTimer = window.setTimeout(() => {
    previewRenderTimer = undefined
    void renderProcessedPreview(file, version)
  }, imagePreviewDebounceMs(file.size))
}, { immediate: true })

watch([imageFiles, activeMode, stitchOverlapMode, stitchManualOverlap, stitchRevision, captureSessionActive], ([files, mode, , , , capturing]) => {
  if (mode !== 'stitch') return
  const version = ++previewVersion
  previewAbortController?.abort()
  previewAbortController = undefined
  if (previewRenderTimer !== undefined) window.clearTimeout(previewRenderTimer)
  previewRenderTimer = undefined
  clearProcessedPreview()
  stitchBlob.value = undefined
  stitchResult.value = undefined
  if (capturing) {
    previewPending.value = false
    stitchProgress.value = 0
    stitchDetail.value = '采集会话进行中'
    message.value = `桌面采集中 · 已新增 ${captureSessionCount.value} 张；结束会话后一次性识别，避免每次截图都重建长图。`
    return
  }
  if (files.length < 2) {
    previewPending.value = false
    stitchProgress.value = 0
    stitchDetail.value = ''
    message.value = '请按从上到下的顺序导入至少 2 张连续截图。'
    return
  }
  previewPending.value = true
  previewRenderTimer = window.setTimeout(() => {
    previewRenderTimer = undefined
    void renderStitchPreview(version)
  }, 180)
}, { immediate: true })

onMounted(() => {
  void loadDevelopmentImageFixture()
  void loadDevelopmentStitchFixture()
  void refreshVisualProjects()
  const linkedProject = typeof route.query.project === 'string' ? route.query.project : ''
  if (linkedProject) void openVisualProject(linkedProject)
  if (typeof ResizeObserver !== 'undefined') {
    previewResizeObserver = new ResizeObserver(syncImageBounds)
    if (previewViewport.value) previewResizeObserver.observe(previewViewport.value)
  }
  window.addEventListener('pointermove', updateCropDrag)
  window.addEventListener('pointerup', endCropDrag)
  window.addEventListener('pointercancel', endCropDrag)
  window.addEventListener('pointermove', updateViewportPan)
  window.addEventListener('pointerup', endViewportPan)
  window.addEventListener('pointercancel', endViewportPan)
  window.addEventListener('keydown', handleViewportKeyDown)
  window.addEventListener('keyup', handleViewportKeyUp)
  window.addEventListener('pointerdown', closeAnnotationMenuOnOutsidePointer)
})

onBeforeUnmount(() => {
  disposed = true
  captureSessionActive.value = false
  void unregisterCaptureShortcut()
  previewVersion += 1
  previewAbortController?.abort()
  if (previewRenderTimer !== undefined) window.clearTimeout(previewRenderTimer)
  images.value.forEach((item) => URL.revokeObjectURL(item.url))
  if (processedPreviewUrl.value) URL.revokeObjectURL(processedPreviewUrl.value)
  previewResizeObserver?.disconnect()
  window.removeEventListener('pointermove', updateCropDrag)
  window.removeEventListener('pointerup', endCropDrag)
  window.removeEventListener('pointercancel', endCropDrag)
  window.removeEventListener('pointermove', updateViewportPan)
  window.removeEventListener('pointerup', endViewportPan)
  window.removeEventListener('pointercancel', endViewportPan)
  window.removeEventListener('keydown', handleViewportKeyDown)
  window.removeEventListener('keyup', handleViewportKeyUp)
  window.removeEventListener('pointerdown', closeAnnotationMenuOnOutsidePointer)
})

function selectMode(mode: ImageMode) {
  activeMode.value = mode
  router.replace({ path: '/visual', query: {
    ...(projectId.value ? { project: projectId.value } : {}),
    ...(mode === 'compose' ? {} : { tool: mode }),
  } })
}

function selectActiveImage(index: number) {
  activeImageIndex.value = index
  message.value = `正在编辑“${images.value[index]?.name ?? '图片'}”。`
  nextTick(syncImageBounds)
  resetViewport()
}

function moveStitchFrame(index: number, direction: -1 | 1) {
  const target = index + direction
  if (target < 0 || target >= imageFiles.value.length) return
  const next = imageFiles.value.slice()
  const [file] = next.splice(index, 1)
  next.splice(target, 0, file)
  imageFiles.value = next
  activeImageIndex.value = target
  message.value = `已调整第 ${index + 1} 张截图顺序，正在重新识别重叠。`
}

function removeStitchFrame(index: number) {
  imageFiles.value = imageFiles.value.filter((_, itemIndex) => itemIndex !== index)
  activeImageIndex.value = Math.max(0, Math.min(activeImageIndex.value, imageFiles.value.length - 1))
}

function rebuildStitch() {
  if (activeMode.value !== 'stitch' || imageFiles.value.length < 2) return
  stitchRevision.value += 1
  closeProcessMenu()
}

const clampZoom = (value: number) => Math.max(0.1, Math.min(16, value))

function setViewportZoom(nextZoom: number, clientX?: number, clientY?: number) {
  const viewport = previewViewport.value
  const previousZoom = viewportZoom.value
  const zoom = clampZoom(nextZoom)
  if (!viewport || zoom === previousZoom) return
  const rect = viewport.getBoundingClientRect()
  const pointX = (clientX ?? rect.left + rect.width / 2) - rect.left - rect.width / 2
  const pointY = (clientY ?? rect.top + rect.height / 2) - rect.top - rect.height / 2
  const ratio = zoom / previousZoom
  viewportPan.value = {
    x: pointX - ratio * (pointX - viewportPan.value.x),
    y: pointY - ratio * (pointY - viewportPan.value.y),
  }
  viewportZoom.value = zoom
}

function zoomViewport(direction: number) {
  setViewportZoom(viewportZoom.value * (direction > 0 ? 1.2 : 1 / 1.2))
}

function resetViewport() {
  viewportZoom.value = 1
  viewportPan.value = { x: 0, y: 0 }
}

function actualSizeViewport() {
  if (!imageBounds.value.width || !imageNaturalSize.value.width) return
  setViewportZoom(imageNaturalSize.value.width / imageBounds.value.width)
}

function handleViewportWheel(event: WheelEvent) {
  if (!event.ctrlKey || !images.value.length) return
  event.preventDefault()
  setViewportZoom(viewportZoom.value * Math.exp(-event.deltaY * 0.002), event.clientX, event.clientY)
}

function beginViewportPan(event: PointerEvent) {
  const allowed = event.button === 1 || (event.button === 0 && (spacePressed.value || activeMode.value !== 'crop'))
  if (!allowed || !images.value.length) return
  viewportPanState.value = {
    startX: event.clientX,
    startY: event.clientY,
    panX: viewportPan.value.x,
    panY: viewportPan.value.y,
  }
  viewportPanning.value = true
  event.preventDefault()
}

function updateViewportPan(event: PointerEvent) {
  const state = viewportPanState.value
  if (!state) return
  viewportPan.value = {
    x: state.panX + event.clientX - state.startX,
    y: state.panY + event.clientY - state.startY,
  }
}

function endViewportPan() {
  viewportPanState.value = null
  viewportPanning.value = false
}

function handleViewportKeyDown(event: KeyboardEvent) {
  const target = event.target instanceof HTMLElement ? event.target : null
  const isEditing = target?.matches('input, textarea, select, button, [contenteditable="true"]')
  const shortcut = event.key.toLowerCase()
  if (activeMode.value === 'compose' && (event.ctrlKey || event.metaKey) && shortcut === 's') {
    event.preventDefault()
    void saveVisualProject()
    return
  }
  if (!isEditing && activeMode.value === 'compose' && (event.ctrlKey || event.metaKey)) {
    if (shortcut === 'z' && !event.shiftKey) { event.preventDefault(); undoAnnotations(); return }
    if (shortcut === 'y' || (shortcut === 'z' && event.shiftKey)) { event.preventDefault(); redoAnnotations(); return }
  }
  if (event.code === 'Space' && !isEditing && images.value.length) {
    event.preventDefault()
    spacePressed.value = true
  }
  if (!event.ctrlKey || !images.value.length) return
  if (event.key === '0') { event.preventDefault(); resetViewport() }
  if (event.key === '1') { event.preventDefault(); actualSizeViewport() }
}

function handleViewportKeyUp(event: KeyboardEvent) {
  if (event.code === 'Space') spacePressed.value = false
}

function openProcessMenuAt(x: number, y: number, trigger?: HTMLElement) {
  if (!images.value.length && activeMode.value !== 'stitch' && activeMode.value !== 'compose') return
  const menuHeight = activeMode.value === 'compose' && !images.value.length ? 154 : activeMode.value === 'stitch' ? 246 : activeMode.value === 'crop' || activeMode.value === 'rotate' ? 208 : 170
  const position = clampMenuPosition(x, y, { menuWidth: 218, menuHeight, margin: 10 })
  processMenuTrigger = trigger
  processMenu.value = { open: true, ...position }
  closeAnnotationMenu()
  void nextTick(() => processMenuElement.value?.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')?.focus())
}

function openProcessMenu(event: MouseEvent) {
  event.preventDefault()
  openProcessMenuAt(event.clientX, event.clientY, event.currentTarget instanceof HTMLElement ? event.currentTarget : undefined)
}

function openProcessMenuFromKeyboard(event: KeyboardEvent) {
  if (!isContextMenuShortcut(event)) return
  const trigger = event.currentTarget instanceof HTMLElement ? event.currentTarget : undefined
  if (!trigger) return
  event.preventDefault()
  const bounds = trigger.getBoundingClientRect()
  openProcessMenuAt(bounds.left + Math.min(72, bounds.width / 2), bounds.top + Math.min(64, bounds.height / 2), trigger)
}

function closeProcessMenu(restoreFocus = false) {
  processMenu.value.open = false
  if (restoreFocus) processMenuTrigger?.focus({ preventScroll: true })
}

function handleProcessMenuKeydown(event: KeyboardEvent) {
  const menu = processMenuElement.value
  if (!menu) return
  if (event.key === 'Escape') {
    event.preventDefault()
    closeProcessMenu(true)
    return
  }
  const items = [...menu.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')]
  const activeIndex = items.indexOf(document.activeElement as HTMLButtonElement)
  const nextIndex = nextMenuItemIndex(event.key, activeIndex, items.length)
  if (nextIndex === undefined) return
  event.preventDefault()
  items[nextIndex]?.focus()
}

function copyProcessPreview() {
  closeProcessMenu()
  if (!copying.value && !exporting.value) void copyCard()
}

function resetProcessViewport() {
  resetViewport()
  closeProcessMenu()
  message.value = '已适应预览区域；可用 Ctrl/⌘ 1 查看实际像素。'
}

function actualSizeProcessViewport() {
  actualSizeViewport()
  closeProcessMenu()
  message.value = '已按实际像素显示预览。'
}

function resetProcessCrop() {
  resetCrop()
  closeProcessMenu()
}

function resetProcessRotation() {
  resetRotation()
  closeProcessMenu()
}

function syncImageBounds() {
  const viewport = previewViewport.value
  const image = previewImage.value
  if (!viewport || !image || !image.naturalWidth || !image.naturalHeight) return
  const style = getComputedStyle(viewport)
  const paddingLeft = Number.parseFloat(style.paddingLeft) || 0
  const paddingRight = Number.parseFloat(style.paddingRight) || 0
  const paddingTop = Number.parseFloat(style.paddingTop) || 0
  const paddingBottom = Number.parseFloat(style.paddingBottom) || 0
  const availableWidth = Math.max(1, viewport.clientWidth - paddingLeft - paddingRight)
  const availableHeight = Math.max(1, viewport.clientHeight - paddingTop - paddingBottom)
  const scale = Math.min(availableWidth / image.naturalWidth, availableHeight / image.naturalHeight)
  const width = image.naturalWidth * scale
  const height = image.naturalHeight * scale
  imageBounds.value = {
    left: paddingLeft + (availableWidth - width) / 2,
    top: paddingTop + (availableHeight - height) / 2,
    width,
    height,
  }
}

function handlePreviewLoad(event: Event) {
  const image = event.currentTarget as HTMLImageElement
  imageNaturalSize.value = { width: image.naturalWidth, height: image.naturalHeight }
  nextTick(syncImageBounds)
}

function rotateBy(degrees: number) {
  rotation.value = (rotation.value + degrees + 360) % 360
  message.value = rotation.value ? `图片已旋转到 ${rotation.value}°，点击可继续旋转。` : '图片已恢复原始方向。'
}

function resetRotation() {
  rotation.value = 0
  message.value = '图片已恢复原始方向。'
}

function resetCrop() {
  cropLeft.value = 0
  cropTop.value = 0
  cropWidth.value = 100
  cropHeight.value = 100
  message.value = '已恢复为完整画面；拖动图片可重新框选。'
}

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))

function imagePoint(event: PointerEvent) {
  const image = previewImage.value
  if (!image) return { x: 0, y: 0 }
  const rect = image.getBoundingClientRect()
  return {
    x: clamp((event.clientX - rect.left) / rect.width * 100, 0, 100),
    y: clamp((event.clientY - rect.top) / rect.height * 100, 0, 100),
  }
}

function beginCropCreate(event: PointerEvent) {
  if (event.button !== 0) return
  const point = imagePoint(event)
  cropDrag.value = {
    handle: 'create',
    startX: event.clientX,
    startY: event.clientY,
    startRect: { left: point.x, top: point.y, width: 0, height: 0 },
    originX: point.x,
    originY: point.y,
  }
  cropLeft.value = point.x
  cropTop.value = point.y
  cropWidth.value = 0
  cropHeight.value = 0
  event.preventDefault()
}

function beginCropDrag(event: PointerEvent, handle: CropHandle) {
  if (event.button !== 0) return
  cropDrag.value = {
    handle,
    startX: event.clientX,
    startY: event.clientY,
    startRect: { left: cropLeft.value, top: cropTop.value, width: cropWidth.value, height: cropHeight.value },
  }
  event.preventDefault()
}

function updateCropDrag(event: PointerEvent) {
  const drag = cropDrag.value
  const bounds = imageBounds.value
  if (!drag || !bounds.width || !bounds.height) return
  const dx = (event.clientX - drag.startX) / (bounds.width * viewportZoom.value) * 100
  const dy = (event.clientY - drag.startY) / (bounds.height * viewportZoom.value) * 100
  const start = drag.startRect
  const minimum = 4

  if (drag.handle === 'create') {
    const point = imagePoint(event)
    const originX = drag.originX ?? point.x
    const originY = drag.originY ?? point.y
    cropLeft.value = Math.min(originX, point.x)
    cropTop.value = Math.min(originY, point.y)
    cropWidth.value = Math.max(minimum, Math.abs(point.x - originX))
    cropHeight.value = Math.max(minimum, Math.abs(point.y - originY))
    if (cropLeft.value + cropWidth.value > 100) cropWidth.value = 100 - cropLeft.value
    if (cropTop.value + cropHeight.value > 100) cropHeight.value = 100 - cropTop.value
    return
  }

  if (drag.handle === 'move') {
    cropLeft.value = clamp(start.left + dx, 0, 100 - start.width)
    cropTop.value = clamp(start.top + dy, 0, 100 - start.height)
    return
  }

  if (drag.handle.includes('w')) {
    const nextLeft = clamp(start.left + dx, 0, start.left + start.width - minimum)
    cropLeft.value = nextLeft
    cropWidth.value = start.width + start.left - nextLeft
  }
  if (drag.handle.includes('e')) cropWidth.value = clamp(start.width + dx, minimum, 100 - start.left)
  if (drag.handle.includes('n')) {
    const nextTop = clamp(start.top + dy, 0, start.top + start.height - minimum)
    cropTop.value = nextTop
    cropHeight.value = start.height + start.top - nextTop
  }
  if (drag.handle.includes('s')) cropHeight.value = clamp(start.height + dy, minimum, 100 - start.top)
}

function endCropDrag() {
  if (!cropDrag.value) return
  if (cropWidth.value < 4 || cropHeight.value < 4) resetCrop()
  else message.value = `裁剪选区已更新：${cropPixelSummary.value}。`
  cropDrag.value = null
}

function nudgeCrop(event: KeyboardEvent) {
  if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return
  event.preventDefault()
  const step = event.shiftKey ? 5 : 1
  if (event.key === 'ArrowLeft') cropLeft.value = clamp(cropLeft.value - step, 0, 100 - cropWidth.value)
  if (event.key === 'ArrowRight') cropLeft.value = clamp(cropLeft.value + step, 0, 100 - cropWidth.value)
  if (event.key === 'ArrowUp') cropTop.value = clamp(cropTop.value - step, 0, 100 - cropHeight.value)
  if (event.key === 'ArrowDown') cropTop.value = clamp(cropTop.value + step, 0, 100 - cropHeight.value)
  message.value = `裁剪选区已移动：${cropPixelSummary.value}。`
}

function removeAnnotation(id: number) {
  commitAnnotations(annotations.value.filter((item) => item.id !== id))
  if (selectedAnnotationId.value === id) selectedAnnotationId.value = null
  if (annotationMenu.value.id === id) closeAnnotationMenu()
  message.value = '标注已移除。'
}

function createCanvasAnnotation(annotation: CanvasAnnotation) {
  commitAnnotations([...annotations.value, annotation])
  selectedAnnotationId.value = annotation.id
  message.value = '标注已加入画布；选中后可移动、缩放和旋转。'
}

function updateCanvasAnnotation(annotation: CanvasAnnotation) {
  commitAnnotations(annotations.value.map((item) => item.id === annotation.id ? annotation : item))
}

function openAnnotationMenu(payload: { id: number; x: number; y: number }) {
  const annotation = annotations.value.find((item) => item.id === payload.id)
  const menuHeight = annotation?.kind === 'text' ? 320 : 284
  annotationMenuTrigger = document.querySelector<HTMLElement>('.annotation-canvas') ?? undefined
  annotationMenu.value = {
    open: true,
    id: payload.id,
    x: Math.max(10, Math.min(payload.x, window.innerWidth - 214)),
    y: Math.max(10, Math.min(payload.y, window.innerHeight - menuHeight - 10)),
  }
  void nextTick(() => annotationMenuElement.value?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus())
}

function closeAnnotationMenu(restoreFocus = false) {
  annotationMenu.value.open = false
  if (restoreFocus) annotationMenuTrigger?.focus({ preventScroll: true })
}

function closeAnnotationMenuOnOutsidePointer(event: PointerEvent) {
  const target = event.target
  if (!(target instanceof Node)) return
  if (annotationTextEditor.value.open) {
    if (annotationTextEditorElement.value?.contains(target)) return
    cancelCanvasTextEdit()
  }
  if (annotationMenu.value.open) {
    if (annotationMenuElement.value?.contains(target)) return
    closeAnnotationMenu()
  }
  if (processMenu.value.open) {
    if (processMenuElement.value?.contains(target)) return
    closeProcessMenu()
  }
  if (projectMenu.value.open) {
    if (projectMenuElement.value?.contains(target)) return
    closeProjectMenu()
  }
  if (projectPanelOpen.value && !projectPanelElement.value?.contains(target)) projectPanelOpen.value = false
}

function openProjectMenu(payload: { x: number; y: number }) {
  closeAnnotationMenu()
  closeProcessMenu()
  projectPanelOpen.value = false
  projectMenuTrigger = document.querySelector<HTMLElement>('.annotation-canvas') ?? undefined
  const position = clampMenuPosition(payload.x, payload.y, { menuWidth: 226, menuHeight: 252, margin: 10 })
  projectMenu.value = { open: true, ...position }
  void nextTick(() => projectMenuElement.value?.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')?.focus())
}

function closeProjectMenu(restoreFocus = false) {
  projectMenu.value.open = false
  if (restoreFocus) projectMenuTrigger?.focus({ preventScroll: true })
}

function handleProjectMenuKeydown(event: KeyboardEvent) {
  const menu = projectMenuElement.value
  if (!menu) return
  const items = [...menu.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')]
  const activeIndex = items.indexOf(document.activeElement as HTMLButtonElement)
  if (event.key === 'Escape') { event.preventDefault(); closeProjectMenu(true); return }
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
  event.preventDefault()
  const nextIndex = nextMenuItemIndex(event.key, activeIndex, items.length)
  if (nextIndex !== undefined) items[nextIndex]?.focus()
}

function saveProjectFromMenu() { closeProjectMenu(); void saveVisualProject() }
function copyProjectFromMenu() { closeProjectMenu(); void copyCard() }
function exportProjectFromMenu() { closeProjectMenu(); void exportCard() }
function clearProjectAnnotationsFromMenu() { closeProjectMenu(); clearAnnotations() }
function createProjectFromMenu() { closeProjectMenu(); void createVisualProject() }
async function toggleProjectFavoriteFromMenu() {
  closeProjectMenu()
  if (!projectId.value) return
  try {
    const favorite = await store.toggleContentFavorite('diagram', projectId.value)
    ui.toast(favorite ? '已收藏画布' : '已取消收藏', projectTitle.value, 'success')
  } catch (error) {
    ui.toast('收藏状态没有保存', error instanceof Error ? error.message : '本地资料库暂时没有响应。', 'error')
  }
}

function handleAnnotationMenuKeydown(event: KeyboardEvent) {
  const menu = annotationMenuElement.value
  if (!menu) return
  const shortcut = event.key.toLowerCase()
  if ((event.ctrlKey || event.metaKey) && shortcut === 'z') {
    event.preventDefault()
    if (event.shiftKey) redoAnnotations()
    else undoAnnotations()
    return
  }
  if ((event.ctrlKey || event.metaKey) && shortcut === 'y') {
    event.preventDefault()
    redoAnnotations()
    return
  }
  const items = [...menu.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')]
  const activeIndex = items.indexOf(document.activeElement as HTMLButtonElement)
  if (event.key === 'Escape') {
    event.preventDefault()
    closeAnnotationMenu(true)
    return
  }
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Home' || event.key === 'End') {
    event.preventDefault()
    const nextIndex = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (activeIndex + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length
    items[nextIndex]?.focus()
  }
}

function duplicateCanvasAnnotation(id: number) {
  const annotation = annotations.value.find((item) => item.id === id)
  if (!annotation) return
  const duplicate = duplicateAnnotation(annotation)
  commitAnnotations([...annotations.value, duplicate])
  selectCanvasAnnotation(duplicate.id)
  closeAnnotationMenu()
  message.value = '已复制标注。'
}

function editCanvasTextAnnotation(id: number) {
  const annotation = annotations.value.find((item) => item.id === id)
  if (!annotation || annotation.kind !== 'text') return
  annotationTextEditor.value = {
    open: true,
    id,
    text: annotation.text,
    x: Math.max(12, Math.min(annotationMenu.value.x, window.innerWidth - 326)),
    y: Math.max(12, Math.min(annotationMenu.value.y, window.innerHeight - 156)),
  }
  closeAnnotationMenu()
  void nextTick(() => {
    annotationTextEditorInput.value?.focus()
    annotationTextEditorInput.value?.select()
  })
}

function saveCanvasTextEdit() {
  const editor = annotationTextEditor.value
  const text = editor.text.trim()
  if (!text) {
    message.value = '文字标注不能为空。'
    annotationTextEditorInput.value?.focus()
    return
  }
  const annotation = annotations.value.find((item) => item.id === editor.id)
  if (!annotation || annotation.kind !== 'text') { cancelCanvasTextEdit(); return }
  commitAnnotations(updateAnnotationText(annotations.value, editor.id, text))
  annotationTextEditor.value.open = false
  message.value = '文字标注已更新；可用 Ctrl/⌘ Z 撤销。'
}

function cancelCanvasTextEdit() {
  if (!annotationTextEditor.value.open) return
  annotationTextEditor.value.open = false
  message.value = '已取消文字修改。'
}

function bringAnnotationToFront(id: number) {
  moveCanvasAnnotationLayer(id, 'front')
}

function annotationKindLabel(annotation: CanvasAnnotation) {
  return annotation.kind === 'box' ? '方框' : annotation.kind === 'arrow' ? '箭头' : '文字'
}

function annotationLayerSummary(annotation: CanvasAnnotation) {
  if (annotation.kind === 'text') return annotation.text || '未命名文字'
  return annotation.kind === 'box' ? '框选区域' : '指向标记'
}

function selectCanvasAnnotation(id: number | null) {
  selectedAnnotationId.value = id
  if (id !== null) canvasTool.value = 'select'
  void nextTick(() => annotationCanvas.value?.select(id))
}

function openLayerAnnotationMenu(event: MouseEvent, id: number) {
  selectCanvasAnnotation(id)
  openAnnotationMenu({ id, x: event.clientX, y: event.clientY })
}

function moveCanvasAnnotationLayer(id: number, move: AnnotationLayerMove, keepMenu = false) {
  const next = moveAnnotationLayer(annotations.value, id, move)
  if (next === annotations.value) return
  commitAnnotations(next)
  selectCanvasAnnotation(id)
  if (!keepMenu) closeAnnotationMenu()
  const labels: Record<AnnotationLayerMove, string> = { forward: '上移一层', backward: '下移一层', front: '置于最前', back: '置于最后' }
  message.value = `标注已${labels[move]}；可用 Ctrl/⌘ Z 撤销。`
}

function rotateCanvasAnnotation(id: number, degrees: number) {
  const annotation = annotations.value.find((item) => item.id === id)
  if (!annotation) return
  const rotated = rotateAnnotation(annotation, degrees)
  if (rotated === annotation) return
  commitAnnotations(annotations.value.map((item) => item.id === id ? rotated : item))
  selectCanvasAnnotation(id)
  message.value = `标注已${degrees < 0 ? '向左' : '向右'}旋转 ${Math.abs(degrees)}°；导出会保留当前角度。`
}

function commitAnnotations(next: CanvasAnnotation[]) {
  const history = commitAnnotationHistory(annotationHistory.value, next)
  if (history === annotationHistory.value) return
  annotationHistory.value = history
  annotations.value = history.present
}

function resetAnnotationHistory() {
  annotationHistory.value = createAnnotationHistory()
  annotations.value = annotationHistory.value.present
}

function undoAnnotations() {
  const history = undoAnnotationHistory(annotationHistory.value)
  if (history === annotationHistory.value) return
  annotationHistory.value = history
  annotations.value = history.present
  closeAnnotationMenu()
  message.value = '已撤销标注操作。'
}

function redoAnnotations() {
  const history = redoAnnotationHistory(annotationHistory.value)
  if (history === annotationHistory.value) return
  annotationHistory.value = history
  annotations.value = history.present
  closeAnnotationMenu()
  message.value = '已恢复标注操作。'
}

function clearAnnotations() {
  if (!annotations.value.length) return
  commitAnnotations([])
  closeAnnotationMenu()
  message.value = '已清空全部标注。'
}

function selectImages(event: Event) {
  const target = event.target as HTMLInputElement
  const selected = Array.from(target.files ?? []).filter((file) => file.size <= VISUAL_FILE_LIMIT).slice(0, STITCH_MAX_FILES)
  const budgeted = filesWithinDropBudget(selected, VISUAL_TOTAL_LIMIT)
  imageFiles.value = budgeted.files
  if (selected.length !== (target.files?.length ?? 0) || budgeted.rejected) message.value = '部分图片超过单张 32 MB 或单次 96 MB，未载入内存。'
  target.value = ''
}

function drawAnnotation(ctx: CanvasRenderingContext2D, annotation: CanvasAnnotation, canvasWidth: number, canvasHeight: number) {
  const x = annotation.x * canvasWidth
  const y = annotation.y * canvasHeight
  const width = (annotation.width ?? (annotation.kind === 'text' ? .19 : annotation.kind === 'arrow' ? .2 : .18)) * canvasWidth
  const height = (annotation.height ?? (annotation.kind === 'text' ? .06 : annotation.kind === 'arrow' ? -.15 : .15)) * canvasHeight
  ctx.strokeStyle = annotation.color
  ctx.fillStyle = annotation.color
  ctx.lineWidth = Math.max(4, canvasWidth / 200)
  ctx.lineJoin = 'round'
  if (annotation.kind === 'box') {
    ctx.save()
    ctx.translate(x, y)
    ctx.rotate((annotation.rotation ?? 0) * Math.PI / 180)
    ctx.strokeRect(0, 0, width, height)
    ctx.restore()
    return
  }
  if (annotation.kind === 'arrow') {
    const endX = x + width
    const endY = y + height
    const angle = Math.atan2(endY - y, endX - x)
    const head = Math.max(18, canvasWidth / 53)
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(endX, endY); ctx.stroke()
    ctx.beginPath(); ctx.moveTo(endX, endY); ctx.lineTo(endX - head * Math.cos(angle - Math.PI / 6), endY - head * Math.sin(angle - Math.PI / 6)); ctx.lineTo(endX - head * Math.cos(angle + Math.PI / 6), endY - head * Math.sin(angle + Math.PI / 6)); ctx.closePath(); ctx.fill()
    return
  }
  const fontSize = Math.max(24, Math.round(canvasWidth * .02125))
  ctx.font = `700 ${fontSize}px "Noto Sans SC", sans-serif`
  ctx.save()
  ctx.translate(x, y)
  ctx.rotate((annotation.rotation ?? 0) * Math.PI / 180)
  ctx.fillText(annotation.text.slice(0, 26), 0, fontSize)
  ctx.restore()
}

function drawContain(ctx: CanvasRenderingContext2D, image: HTMLImageElement, x: number, y: number, width: number, height: number) {
  const ratio = Math.min(width / image.naturalWidth, height / image.naturalHeight)
  const drawWidth = image.naturalWidth * ratio
  const drawHeight = image.naturalHeight * ratio
  ctx.drawImage(image, x + (width - drawWidth) / 2, y + (height - drawHeight) / 2, drawWidth, drawHeight)
}

function sourceExtensionLabel(file?: File) {
  const extension = file?.name.match(/\.([^.]+)$/)?.[1]?.toUpperCase()
  if (extension === 'JPEG') return 'JPG'
  return extension || '源文件'
}

function sourceOutputType(file?: File): SourceOutputType | null {
  const type = file?.type.toLowerCase()
  if (type === 'image/png') return 'image/png'
  if (type === 'image/jpeg' || type === 'image/jpg') return 'image/jpeg'
  if (type === 'image/webp') return 'image/webp'
  if (type === 'image/gif') return 'image/gif'
  const extension = file?.name.match(/\.([^.]+)$/)?.[1]?.toLowerCase()
  if (extension === 'png') return 'image/png'
  if (extension === 'jpg' || extension === 'jpeg') return 'image/jpeg'
  if (extension === 'webp') return 'image/webp'
  if (extension === 'gif') return 'image/gif'
  // Canvas cannot encode BMP. Keeping it byte-for-byte prevents fake extensions.
  return null
}

function outputTypeLabel(type: EncodableImageType) {
  return type === 'image/jpeg' ? 'JPG' : type.split('/')[1].toUpperCase()
}

class ImageWorkerBootstrapError extends Error {}

function canProcessRasterOffThread() {
  return typeof Worker !== 'undefined'
    && typeof OffscreenCanvas !== 'undefined'
    && typeof OffscreenCanvas.prototype.convertToBlob === 'function'
    && typeof createImageBitmap === 'function'
}

function rasterProcessOptions(outputType: RasterOutputType): RasterProcessOptions {
  return {
    mode: activeMode.value === 'compose' || activeMode.value === 'stitch' ? 'convert' : activeMode.value,
    outputType,
    quality: quality.value / 100,
    compressionPasses: compressionPasses.value,
    maxWidth: maxWidth.value,
    rotation: rotation.value,
    cropLeft: cropLeft.value,
    cropTop: cropTop.value,
    cropWidth: cropWidth.value,
    cropHeight: cropHeight.value,
  }
}

function processRasterOffThread(file: File, options: RasterProcessOptions, signal?: AbortSignal) {
  return new Promise<Blob>((resolve, reject) => {
    let worker: Worker
    let settled = false
    try {
      worker = new Worker(new URL('../workers/image-process.worker.ts', import.meta.url), { type: 'module' })
    } catch (error) {
      reject(new ImageWorkerBootstrapError(error instanceof Error ? error.message : '无法启动后台图片处理。'))
      return
    }

    const finish = (callback: () => void) => {
      if (settled) return
      settled = true
      signal?.removeEventListener('abort', abort)
      worker.terminate()
      callback()
    }
    const abort = () => finish(() => reject(new DOMException('图片预览已取消。', 'AbortError')))
    if (signal?.aborted) { abort(); return }
    signal?.addEventListener('abort', abort, { once: true })
    worker.onerror = (event) => {
      event.preventDefault()
      finish(() => reject(new ImageWorkerBootstrapError(event.message || '后台图片处理进程异常退出。')))
    }
    worker.onmessage = ({ data }: MessageEvent<{ blob?: Blob; error?: string }>) => {
      finish(() => data.blob ? resolve(data.blob) : reject(new Error(data.error || `无法处理“${file.name}”。`)))
    }
    worker.postMessage({ file, options })
  })
}

function abortIfNeeded(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException('图片预览已取消。', 'AbortError')
}

async function processRasterOnMainThread(file: File, options: RasterProcessOptions, signal?: AbortSignal) {
  abortIfNeeded(signal)
  const bitmap = await createImageBitmap(file)
  const plan = createRasterProcessPlan(bitmap.width, bitmap.height, options)
  const canvas = document.createElement('canvas')
  canvas.width = plan.canvasWidth
  canvas.height = plan.canvasHeight
  const context = canvas.getContext('2d')
  if (!context) { bitmap.close(); throw new Error('浏览器不支持图片画布。') }
  if (options.outputType === 'image/jpeg') { context.fillStyle = '#ffffff'; context.fillRect(0, 0, canvas.width, canvas.height) }
  context.translate(canvas.width / 2, canvas.height / 2)
  context.rotate(plan.rotation * Math.PI / 180)
  context.drawImage(bitmap, plan.left, plan.top, plan.sourceWidth, plan.sourceHeight, -plan.targetWidth / 2, -plan.targetHeight / 2, plan.targetWidth, plan.targetHeight)
  bitmap.close()
  abortIfNeeded(signal)
  const encodeCanvas = () => new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, options.outputType, plan.quality))
  let blob = await encodeCanvas()
  if (!blob) throw new Error(`无法处理“${file.name}”。`)

  for (let pass = 1; pass < plan.compressionPasses; pass += 1) {
    abortIfNeeded(signal)
    const encodedBitmap = await createImageBitmap(blob)
    context.setTransform(1, 0, 0, 1, 0, 0)
    context.clearRect(0, 0, canvas.width, canvas.height)
    if (options.outputType === 'image/jpeg') {
      context.fillStyle = '#ffffff'
      context.fillRect(0, 0, canvas.width, canvas.height)
    }
    context.drawImage(encodedBitmap, 0, 0, canvas.width, canvas.height)
    encodedBitmap.close()
    const nextBlob = await encodeCanvas()
    if (!nextBlob) throw new Error(`“${file.name}”在第 ${pass + 1} 次压缩时失败。`)
    blob = nextBlob
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
  }
  abortIfNeeded(signal)
  return blob
}

async function renderProcessedBlob(file: File, requestedOutputType?: SourceOutputType, signal?: AbortSignal) {
  const outputType = requestedOutputType ?? (imageFormat.value === 'source' ? sourceOutputType(file) ?? 'image/png' : imageFormat.value)
  if (outputType === 'image/gif') {
    abortIfNeeded(signal)
    if (activeMode.value === 'convert' && quality.value === 100) return file
    return processAnimatedGif(file, {
      quality: quality.value,
      mode: activeMode.value === 'compose' || activeMode.value === 'stitch' ? 'convert' : activeMode.value,
      maxWidth: maxWidth.value,
      rotation: rotation.value,
      cropLeft: cropLeft.value,
      cropTop: cropTop.value,
      cropWidth: cropWidth.value,
      cropHeight: cropHeight.value,
    })
  }
  const options = rasterProcessOptions(outputType)
  if (canProcessRasterOffThread()) {
    try {
      return await processRasterOffThread(file, options, signal)
    } catch (error) {
      if (!(error instanceof ImageWorkerBootstrapError)) throw error
    }
  }
  return processRasterOnMainThread(file, options, signal)
}

async function makeClipboardPng(encodedBlob: Blob) {
  if (encodedBlob.type === 'image/png') return encodedBlob
  const bitmap = await createImageBitmap(encodedBlob)
  const canvas = document.createElement('canvas')
  canvas.width = bitmap.width
  canvas.height = bitmap.height
  const context = canvas.getContext('2d')
  if (!context) { bitmap.close(); throw new Error('浏览器不支持图片画布。') }
  context.drawImage(bitmap, 0, 0)
  bitmap.close()
  const pngBlob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
  if (!pngBlob) throw new Error('无法生成剪贴板图片。')
  return pngBlob
}

async function renderCardBlob() {
  if (!images.value.length) throw new Error('请先导入至少一张图片。')
  const canvas = document.createElement('canvas')
  const dimensions = compositionDimensions.value
  canvas.width = dimensions.width
  canvas.height = dimensions.height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('浏览器不支持画布导出。')
  ctx.fillStyle = background.value
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  const loaded = await Promise.all(visibleImages.value.map((item) => new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image(); image.onload = () => resolve(image); image.onerror = reject; image.src = item.url
  })))
  const blankCanvas = Boolean(activeBlankCanvas.value && layout.value === 'single')
  const pad = blankCanvas ? 0 : Math.round(canvas.width * .03)
  const titleHeight = title.value.trim() ? Math.round(canvas.height * .118) : blankCanvas ? 0 : Math.round(canvas.height * .045)
  const areaY = titleHeight
  const areaH = canvas.height - titleHeight - pad
  if (layout.value === 'single') drawContain(ctx, loaded[0], pad, areaY, canvas.width - pad * 2, areaH)
  else if (layout.value === 'pair') {
    const width = (canvas.width - pad * 3) / 2
    loaded.forEach((image, index) => drawContain(ctx, image, pad + index * (width + pad), areaY, width, areaH))
  } else {
    const width = (canvas.width - pad * 3) / 2
    const height = (areaH - pad) / 2
    loaded.forEach((image, index) => drawContain(ctx, image, pad + (index % 2) * (width + pad), areaY + Math.floor(index / 2) * (height + pad), width, height))
  }
  if (title.value.trim()) {
    const titleSize = Math.max(30, Math.round(canvas.width * .029))
    ctx.fillStyle = compositionForeground.value.text; ctx.font = `600 ${titleSize}px "Noto Sans SC", sans-serif`; ctx.fillText(title.value.trim().slice(0, 42), Math.max(24, pad), Math.max(titleSize + 18, titleHeight * .62))
  }
  annotations.value.forEach((annotation) => drawAnnotation(ctx, annotation, canvas.width, canvas.height))
  if (watermark.value.trim()) { ctx.fillStyle = compositionForeground.value.muted; ctx.font = `500 ${Math.max(16, Math.round(canvas.width * .0125))}px ui-monospace, monospace`; ctx.textAlign = 'right'; ctx.fillText(watermark.value.trim(), canvas.width - Math.max(24, pad), canvas.height - Math.max(18, Math.round(canvas.height * .018))) }
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
  if (!blob) throw new Error('无法生成 PNG。')
  return blob
}

async function ensureOutputDirectory() {
  if (!isDesktop() || store.settings.outputDirectory) return true
  const directory = await chooseOutputDirectory()
  if (!directory) return false
  store.updateSettings({ outputDirectory: directory })
  return true
}

async function copyCard() {
  copying.value = true
  try {
    if (!activeImageFile.value) throw new Error('请先导入至少一张图片。')
    if (sourcePassThrough.value) {
      if (!isDesktop()) throw new Error('浏览器模式无法把源文件写入文件剪贴板，请使用导出。')
      const stagedPath = await stageClipboardFile(activeImageFile.value.name, activeImageFile.value)
      await copyStagedPngFiles([stagedPath])
      message.value = `源格式文件“${activeImageFile.value.name}”已复制；动画和文件内容保持不变。`
      ui.toast('源文件已复制', '可粘贴到资源管理器、QQ或其他支持文件粘贴的应用。', 'success')
      return
    }
    if (imageFormat.value === 'source' && sourceOutputType(activeImageFile.value) === 'image/gif') {
      if (!isDesktop()) throw new Error('GIF 动画压缩目前需要桌面模式。')
      const gif = await renderProcessedBlob(activeImageFile.value, 'image/gif')
      const stagedPath = await stageClipboardFile(activeImageFile.value.name, gif)
      await copyStagedPngFiles([stagedPath])
      message.value = `GIF 已按 ${quality.value}% 质量处理并复制，动画帧保持可播放。`
      ui.toast('GIF 已复制', '已作为动画文件写入系统剪贴板。', 'success')
      return
    }
    let encodedBlob: Blob
    if (activeMode.value === 'compose') encodedBlob = await renderCardBlob()
    else if (activeMode.value === 'stitch') {
      if (!stitchBlob.value) throw new Error(previewPending.value ? '滚动长图仍在生成，请稍候。' : '请先生成可用的滚动长图。')
      encodedBlob = stitchBlob.value
    } else encodedBlob = await renderProcessedBlob(activeImageFile.value)
    const blob = await makeClipboardPng(encodedBlob)
    await copyPngToClipboard(blob)
    const encodingDetail = activeMode.value === 'compose' ? '分享画布' : activeMode.value === 'stitch' ? '滚动长图' : `${formatLabel.value}${qualityApplies.value ? ` ${quality.value}% · ${compressionPasses.value} 次压缩` : ' 无损'}效果`
    message.value = `${encodingDetail}已复制，可以直接粘贴发送。`
    ui.toast('当前预览已复制', `${encodingDetail}已写入系统剪贴板。`, 'success')
  } catch (error) {
    ui.toast('复制失败', error instanceof Error ? error.message : '无法复制图片。', 'error')
  } finally { copying.value = false }
}

async function exportCard() {
  if (!await ensureOutputDirectory()) return
  exporting.value = true
  try {
    if (!imageFiles.value.length) throw new Error('请先导入至少一张图片。')
    const outputs: FileReference[] = []
    if (activeMode.value === 'compose') {
      const name = `image-card-${Date.now()}.png`
      outputs.push(await exportOutput(store.settings.outputDirectory, name, await renderCardBlob(), 'image/png'))
    } else if (activeMode.value === 'stitch') {
      if (!stitchBlob.value) throw new Error(previewPending.value ? '滚动长图仍在生成，请稍候。' : '请先生成可用的滚动长图。')
      outputs.push(await exportOutput(store.settings.outputDirectory, `scroll-capture-${Date.now()}.png`, stitchBlob.value, 'image/png'))
    } else {
      for (const file of imageFiles.value) {
        const sourceType = sourceOutputType(file)
        if (imageFormat.value === 'source' && !sourceType) {
          outputs.push(await exportOutput(store.settings.outputDirectory, file.name, file, file.type || 'application/octet-stream'))
          continue
        }
        const outputType = imageFormat.value === 'source' ? sourceType! : imageFormat.value
        const originalExtension = file.name.match(/\.([^.]+)$/)?.[1]?.toLowerCase()
        const extension = imageFormat.value === 'source' && originalExtension
          ? originalExtension
          : outputType === 'image/jpeg' ? 'jpg' : outputType.split('/')[1]
        const stem = file.name.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9_\-\u4e00-\u9fff]+/g, '-') || 'image'
        outputs.push(await exportOutput(store.settings.outputDirectory, `${stem}-${activeMode.value}.${extension}`, await renderProcessedBlob(file, outputType), outputType))
      }
    }
    lastOutputs.value = outputs
    const job = store.addJob('image', activeMode.value === 'compose' ? '图片分享卡' : activeTool.value.title, images.value.map((item) => item.name), {
      toolId: `visual-${activeMode.value}`, route: `/visual${activeMode.value === 'compose' ? '' : `?tool=${activeMode.value}`}`, retryable: true,
      inputs: imageFiles.value.map((file) => ({ name: file.name, size: file.size, mime: file.type, path: (file as File & { path?: string }).path })),
      parameters: { mode: activeMode.value, layout: layout.value, title: title.value, watermark: watermark.value, background: background.value, imageFormat: imageFormat.value, quality: quality.value, compressionPasses: compressionPasses.value, maxWidth: maxWidth.value, rotation: rotation.value, cropLeft: cropLeft.value, cropTop: cropTop.value, cropWidth: cropWidth.value, cropHeight: cropHeight.value, stitchOverlapMode: stitchOverlapMode.value, stitchManualOverlap: stitchManualOverlap.value }
    })
    store.updateJob(job.id, { status: 'succeeded', progress: 100, outputNames: outputs.map((output) => output.name), outputs, detail: `已从实时预览导出 ${outputs.length} 张图片。` })
    message.value = `已导出 ${outputs.length} 张图片，可从下方直接打开位置。`
    const firstPath = outputs.find((output) => output.path)?.path
    ui.toast('图片已导出', `${activeTool.value.title} · ${outputs.length} 张`, 'success', firstPath ? '打开位置' : undefined, firstPath ? () => openLocation(firstPath) : undefined)
  } catch (error) {
    message.value = error instanceof Error ? error.message : '导出失败。'
    ui.toast('导出失败', message.value, 'error')
  } finally { exporting.value = false }
}

async function openLocation(path?: string) {
  if (!path) return
  try { await revealDesktopFile(path) }
  catch (error) { ui.toast('无法打开文件位置', error instanceof Error ? error.message : '文件可能已移动。', 'error') }
}
</script>

<template>
  <!-- No `visual-studio` / `visual-studio-shell` / `visual-mode-strip` class
       names. The legacy sheets pin this page to a six-card mode strip, a 62px
       icon rail, a 610px minimum grid and a 230px properties column — that is
       the layout being replaced, not a skin on top of it. -->
  <div class="page-enter mx-auto w-full max-w-320 px-8 py-6">
    <PageHeader title="图像画布" subtitle="一块画布，六种处理；原件只读，导出前的每一步都在本机完成">
      <template #actions>
        <button class="btn-default" :disabled="copying || exporting || !outputReady" @click="copyCard">
          <AppIcon name="clipboard" :size="15" />{{ copying ? '复制中…' : '复制预览' }}
        </button>
        <button class="btn-primary" :disabled="exporting || copying || !outputReady" @click="exportCard">
          <AppIcon name="download" :size="15" />{{ exporting ? '导出中…' : exportLabel }}
        </button>
      </template>
    </PageHeader>

    <section class="flex-1 min-h-0 stack panel overflow-hidden">
      <!-- Mode row: two named families instead of six equal cards. -->
      <div class="row gap-5 shrink-0 h-12 px-3 border-b border-line">
        <nav v-for="section in modeSections" :key="section.label" class="row gap-1 shrink-0" :aria-label="`${section.label}模式`">
          <span class="mr-1 text-[11px] font-semibold text-fg-3">{{ section.label }}</span>
          <button
            v-for="tool in section.tools"
            :key="tool.id"
            class="row gap-1.5 h-8 px-2.5 rounded-sm text-[12px] transition-colors duration-120"
            :class="activeMode === tool.id ? 'bg-accent-soft text-accent font-medium' : 'text-fg-2 hover:bg-surface-2 hover:text-fg'"
            :title="tool.description"
            :aria-pressed="activeMode === tool.id"
            @click="selectMode(tool.id)"
          >
            <AppIcon :name="tool.icon" :size="15" />{{ tool.title }}
          </button>
        </nav>

        <div class="row gap-2 ml-auto shrink-0">
          <span class="row gap-1.5 text-[11px] text-fg-3" title="图片不会离开这台设备">
            <AppIcon name="shield" :size="13" class="text-success" />全程本机
          </span>
          <!-- A canvas you can annotate is a document, so it gets a document's
               controls: a name, a dirty marker, and one save. -->
          <div v-if="activeMode === 'compose'" ref="projectPanelElement" class="relative row gap-1">
            <button
              class="row gap-1.5 h-8 px-2.5 rounded-sm border text-[12px] transition-colors duration-120"
              :class="projectPanelOpen ? 'border-accent bg-accent-soft text-accent' : 'border-line text-fg-2 hover:border-line-strong hover:text-fg'"
              :aria-expanded="projectPanelOpen"
              aria-haspopup="dialog"
              @click="toggleProjectPanel"
            >
              <AppIcon name="folder-open" :size="14" />
              <span class="max-w-28 truncate">{{ projectTitle || '未命名画布' }}</span>
              <i v-if="projectDirty" class="w-1.5 h-1.5 rounded-full bg-warn" title="有未保存改动" aria-label="有未保存改动" />
            </button>
            <button class="btn-default btn-sm" :disabled="projectSaving || !images.length || !projectDirty" title="保存画布项目（Ctrl+S）" @click="saveVisualProject">
              {{ projectSaving ? '保存中…' : '保存' }}
            </button>

            <section v-if="projectPanelOpen" class="absolute right-0 top-full z-30 mt-2 w-84 stack panel shadow-lg" role="dialog" aria-label="画布项目">
              <header class="row-between gap-2 shrink-0 px-3 h-10 border-b border-line">
                <b class="text-[12px] font-semibold text-fg">画布项目</b>
                <button class="center w-7 h-7 rounded-sm text-fg-3 hover:bg-surface-2 hover:text-fg" aria-label="关闭画布项目" @click="projectPanelOpen = false">
                  <AppIcon name="close" :size="14" />
                </button>
              </header>
              <div class="stack gap-2.5 p-3 border-b border-line">
                <label class="stack gap-1.5">
                  <span class="text-[12px] text-fg-3">项目名称</span>
                  <input v-model="projectTitle" class="field" maxlength="120" placeholder="例如：算法长图标注" @keydown.enter.prevent="saveVisualProject" />
                </label>
                <p class="text-[11px] leading-relaxed text-fg-3">底图、画布尺寸与全部标注保存在本地 Vault，随时可以重新打开继续编辑。</p>
                <div class="row gap-2">
                  <button class="btn-default btn-sm flex-1" @click="createVisualProject"><AppIcon name="plus" :size="13" />新建</button>
                  <button class="btn-primary btn-sm flex-1" :disabled="projectSaving || !images.length || !projectDirty" @click="saveVisualProject">
                    {{ projectSaving ? '正在保存…' : projectId ? '保存更改' : '保存到 Vault' }}
                  </button>
                </div>
              </div>
              <div class="row-between gap-2 shrink-0 px-3 h-8 border-b border-line">
                <span class="text-[11px] font-semibold text-fg-3">最近项目</span>
                <span class="text-[11px] tabular-nums text-fg-3">{{ visualProjects.length }}</span>
              </div>
              <div class="stack gap-0.5 max-h-64 overflow-y-auto p-1.5">
                <p v-if="projectLoading" class="px-2 py-3 text-[12px] text-fg-3" role="status">正在打开画布项目…</p>
                <p v-else-if="!visualProjects.length" class="px-2 py-3 text-[12px] leading-relaxed text-fg-3">还没有保存过的画布。完成一次标注后保存，它会出现在这里。</p>
                <div
                  v-for="project in visualProjects"
                  v-else
                  :key="project.id"
                  class="group row gap-1 rounded-sm"
                  :class="project.id === projectId ? 'bg-accent-soft' : 'hover:bg-surface-2'"
                >
                  <button class="stack gap-0.5 min-w-0 flex-1 px-2 py-1.5 text-left" @click="openVisualProject(project.id)">
                    <b class="text-[12px] truncate" :class="project.id === projectId ? 'text-accent' : 'text-fg'">{{ project.title }}</b>
                    <small class="text-[11px] truncate text-fg-3">{{ project.imageCount }} 张源图 · {{ project.annotationCount }} 个标注 · {{ formatProjectTime(project.updatedAt) }}</small>
                  </button>
                  <button
                    class="center w-7 h-7 mr-1 shrink-0 rounded-sm text-fg-3 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 hover:bg-surface-3 hover:text-danger"
                    :aria-label="`删除 ${project.title}`"
                    title="删除画布项目"
                    @click.stop="removeVisualProject(project)"
                  >
                    <AppIcon name="trash" :size="13" />
                  </button>
                </div>
              </div>
            </section>
          </div>
        </div>
      </div>

      <div class="flex-1 min-h-0 grid grid-cols-[240px_minmax(0,1fr)_284px]">
        <!-- ── Sources ────────────────────────────────────────────────────
             The images were spread across three places: a disclosure menu in
             the toolbar, a second button in the empty state, and a thumbnail
             grid at the bottom of the settings column. On a page about images
             they are the subject, so they get a column of their own that is
             also where you reorder a stitch. -->
        <aside class="stack min-h-0 border-r border-line" :aria-label="activeMode === 'stitch' ? '截图顺序' : '源图'">
          <header class="row-between gap-2 shrink-0 px-3 h-9 border-b border-line">
            <span class="text-[11px] font-semibold text-fg-3">{{ activeMode === 'stitch' ? '截图顺序' : '源图' }}</span>
            <span class="text-[11px] tabular-nums text-fg-3">{{ activeMode === 'stitch' ? `${images.length} / ${STITCH_MAX_FILES}` : images.length }}</span>
          </header>
          <!-- Stays mounted at every state: this component owns the desktop
               window drop listener. -->
          <FileDropZone
            v-model="imageFiles"
            compact
            accept="image/*"
            :max-file-bytes="VISUAL_FILE_LIMIT"
            :max-total-bytes="VISUAL_TOTAL_LIMIT"
            :max-files="STITCH_MAX_FILES"
            title="拖入图片"
            class="shrink-0 rounded-none! border-0! border-b! border-line!"
            @error="message = $event"
          />
          <div class="flex-1 min-h-0 overflow-y-auto p-1.5">
            <p v-if="!images.length" class="px-2 py-3 text-[11px] leading-relaxed text-fg-3">{{ sourceEmptyHint }}</p>
            <ol v-else class="stack gap-0.5">
              <li
                v-for="(item, index) in images"
                :key="item.url"
                class="group row gap-1 rounded-sm"
                :class="activeImageIndex === index ? 'bg-accent-soft' : 'hover:bg-surface-2'"
              >
                <button class="row gap-2 min-w-0 flex-1 p-1.5 text-left" :aria-pressed="activeImageIndex === index" :title="item.name" @click="selectActiveImage(index)">
                  <span class="relative shrink-0">
                    <img :src="item.url" :alt="item.name" loading="lazy" decoding="async" class="w-9 h-9 rounded-sm object-cover bg-surface-2" />
                    <b class="absolute -left-1 -top-1 center min-w-4 h-4 px-1 rounded-full bg-surface border border-line text-[11px] tabular-nums text-fg-2">{{ index + 1 }}</b>
                  </span>
                  <span class="stack gap-0.5 min-w-0">
                    <b class="text-[12px] font-normal truncate" :class="activeImageIndex === index ? 'text-accent' : 'text-fg'">{{ item.name }}</b>
                    <small class="text-[11px] text-fg-3">{{ activeImageIndex === index ? '正在编辑' : '点击编辑' }}</small>
                  </span>
                </button>
                <template v-if="activeMode === 'stitch'">
                  <span class="stack shrink-0">
                    <button class="center w-5 h-4 rounded-[3px] text-[11px] text-fg-3 hover:bg-surface-3 hover:text-fg disabled:opacity-30" :disabled="index === 0" :aria-label="`将第 ${index + 1} 张上移`" @click="moveStitchFrame(index, -1)">↑</button>
                    <button class="center w-5 h-4 rounded-[3px] text-[11px] text-fg-3 hover:bg-surface-3 hover:text-fg disabled:opacity-30" :disabled="index === images.length - 1" :aria-label="`将第 ${index + 1} 张下移`" @click="moveStitchFrame(index, 1)">↓</button>
                  </span>
                  <button
                    class="center w-6 h-6 mr-1 shrink-0 rounded-sm text-fg-3 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 hover:bg-surface-3 hover:text-danger"
                    :aria-label="`移除第 ${index + 1} 张`"
                    @click="removeStitchFrame(index)"
                  >
                    <AppIcon name="close" :size="12" />
                  </button>
                </template>
              </li>
            </ol>
          </div>
        </aside>

        <!-- ── Canvas ─────────────────────────────────────────────────────
             One frame that never moves horizontally between modes. Everything
             that acts on what is in the frame — the annotation tools, rotate,
             crop reset, zoom — sits in this one header, so the canvas itself
             is never covered by its own controls. -->
        <main class="stack min-h-0 relative">
          <header class="row-between gap-3 shrink-0 px-3 h-9 border-b border-line">
            <span class="row gap-2 min-w-0 text-[12px]">
              <AppIcon :name="activeTool.icon" :size="14" class="shrink-0 text-fg-3" />
              <b class="shrink-0 font-medium text-fg">{{ canvasHeading }}</b>
              <small v-if="activeMode !== 'compose'" class="truncate text-fg-3">{{ processSummary }}</small>
            </span>
            <span class="row gap-1 shrink-0">
              <!-- The annotation tools used to be a 62px rail that only
                   existed in compose, so the canvas shifted sideways every
                   time you changed mode. -->
              <template v-if="activeMode === 'compose' && images.length">
                <button
                  v-for="tool in annotationTools"
                  :key="tool.id"
                  class="row gap-1.5 h-7 px-2 rounded-sm text-[12px] whitespace-nowrap transition-colors duration-120"
                  :class="canvasTool === tool.id ? 'bg-accent-soft text-accent font-medium' : 'text-fg-2 hover:bg-surface-2 hover:text-fg'"
                  :aria-pressed="canvasTool === tool.id"
                  :title="tool.hint"
                  @click="canvasTool = tool.id"
                >
                  <AppIcon :name="tool.icon" :size="14" />{{ tool.label }}
                </button>
                <i class="w-px h-4.5 mx-1 bg-line" aria-hidden="true" />
                <button class="center w-7 h-7 rounded-sm text-fg-2 hover:not-disabled:bg-surface-2 hover:not-disabled:text-fg disabled:opacity-35 disabled:cursor-not-allowed" :disabled="!canUndoAnnotations" title="撤销标注 (Ctrl+Z)" aria-label="撤销标注" @click="undoAnnotations">
                  <AppIcon name="review" :size="14" />
                </button>
                <button class="center w-7 h-7 rounded-sm text-fg-2 hover:not-disabled:bg-surface-2 hover:not-disabled:text-fg disabled:opacity-35 disabled:cursor-not-allowed" :disabled="!canRedoAnnotations" title="重做标注 (Ctrl+Shift+Z)" aria-label="重做标注" @click="redoAnnotations">
                  <AppIcon name="rotate" :size="14" />
                </button>
                <button class="center w-7 h-7 rounded-sm text-fg-2 hover:not-disabled:bg-surface-2 hover:not-disabled:text-danger disabled:opacity-35 disabled:cursor-not-allowed" :disabled="!annotations.length" title="清空全部标注" aria-label="清空全部标注" @click="clearAnnotations">
                  <AppIcon name="trash" :size="14" />
                </button>
              </template>
              <template v-if="images.length && activeMode === 'rotate'">
                <button class="btn-ghost btn-sm" :disabled="sourcePassThrough" aria-label="向左旋转 90 度" title="向左旋转 90°" @click="rotateBy(-90)">
                  <AppIcon name="rotate" :size="14" class="scale-x-[-1]" />左转
                </button>
                <button class="btn-ghost btn-sm" :disabled="sourcePassThrough" aria-label="向右旋转 90 度" title="向右旋转 90°" @click="rotateBy(90)">
                  <AppIcon name="rotate" :size="14" />右转
                </button>
                <button class="btn-ghost btn-sm" :disabled="sourcePassThrough || rotation === 0" @click="resetRotation">恢复原图</button>
              </template>
              <button v-else-if="images.length && activeMode === 'crop' && !sourcePassThrough" class="btn-ghost btn-sm" @click="resetCrop">选择全图</button>
              <!-- Zoom lives in the header rather than floating over the
                   bottom-right of the image, where it covered the pixels you
                   zoomed in to look at. -->
              <span v-if="images.length && activeMode !== 'compose'" class="row gap-0.5 ml-1 pl-2 border-l border-line" aria-label="画布缩放控制">
                <button class="center w-6.5 h-6.5 rounded-sm text-fg-2 hover:bg-surface-2 hover:text-fg" title="缩小" aria-label="缩小画布" @click="zoomViewport(-1)">−</button>
                <button class="center h-6.5 min-w-11 px-1 rounded-sm text-[11px] tabular-nums text-fg-2 hover:bg-surface-2 hover:text-fg" title="适应窗口 (Ctrl+0)" @click="resetViewport">{{ viewportZoomLabel }}</button>
                <button class="center w-6.5 h-6.5 rounded-sm text-fg-2 hover:bg-surface-2 hover:text-fg" title="放大" aria-label="放大画布" @click="zoomViewport(1)">＋</button>
                <button class="center h-6.5 px-1.5 rounded-sm text-[11px] text-fg-2 hover:bg-surface-2 hover:text-fg" title="实际像素 (Ctrl+1)" @click="actualSizeViewport">1:1</button>
              </span>
            </span>
          </header>

          <div
            class="flex-1 min-h-0 relative bg-well"
            :style="{ backgroundImage: 'radial-gradient(var(--line) 1px, transparent 1px)', backgroundSize: '16px 16px' }"
          >
            <!-- Compose: the preview is the export. Padding, title band and
                 signature are percentages of the canvas, and images are
                 `contain`, because that is what `renderCardBlob` draws — the
                 old preview used `cover` and quietly cropped what you saw. -->
            <div
              v-if="images.length && activeMode === 'compose'"
              class="absolute inset-0 grid justify-items-center overflow-auto p-6"
              :class="[activeBlankCanvas?.id === 'portrait' ? 'items-start' : 'items-center', canvasTool === 'select' ? '' : 'cursor-crosshair']"
            >
              <div
                class="relative stack overflow-hidden rounded-sm border border-line shadow-lg [container-type:inline-size]"
                :class="[
                  activeBlankCanvas?.id === 'portrait' ? 'w-[min(430px,100%)]' : activeBlankCanvas ? 'w-[min(650px,100%)]' : 'w-[min(760px,100%)]',
                  activeBlankCanvas && layout === 'single' ? '' : 'p-[3%]',
                ]"
                :style="compositionStyle"
                @click="closeAnnotationMenu()"
              >
                <h3 v-if="title" class="relative z-4 shrink-0 mb-[2.5%] font-display font-semibold leading-tight text-[clamp(15px,2.9cqw,34px)]" :style="{ color: 'var(--canvas-text)' }">{{ title }}</h3>
                <div class="flex-1 min-h-0 grid gap-[1.5%]" :class="layout === 'single' ? 'grid-cols-1' : layout === 'pair' ? 'grid-cols-2' : 'grid-cols-2 grid-rows-2'">
                  <img
                    v-for="item in visibleImages"
                    :key="item.url"
                    :src="item.url"
                    :alt="item.blank ? '空白画布底图' : item.name"
                    class="w-full h-full min-w-0 min-h-0 object-contain rounded-[2px]"
                    :class="item.blank ? 'opacity-0 pointer-events-none' : ''"
                  />
                </div>
                <small v-if="watermark" class="relative z-4 shrink-0 mt-[1.5%] text-right text-[clamp(10px,1.25cqw,16px)]" :style="{ color: 'var(--canvas-muted)' }">{{ watermark }}</small>
                <AnnotationCanvas
                  ref="annotationCanvas"
                  class="absolute inset-0 z-3"
                  :annotations="annotations"
                  :tool="canvasTool"
                  :color="annotationColor"
                  :text="annotationText"
                  @create="createCanvasAnnotation"
                  @update="updateCanvasAnnotation"
                  @remove="removeAnnotation"
                  @select="selectedAnnotationId = $event"
                  @context="openAnnotationMenu"
                  @canvas-context="openProjectMenu"
                />
              </div>
            </div>

            <!-- Process: one pan/zoom viewport shared by all four modes. -->
            <div
              v-else-if="images.length"
              ref="previewViewport"
              class="absolute inset-0 grid place-items-center overflow-hidden p-6 focus:outline-none focus-visible:ring-3 focus-visible:ring-[var(--accent-ring)] focus-visible:ring-inset"
              :class="[
                activeMode === 'crop' && !sourcePassThrough ? 'cursor-crosshair' : '',
                viewportPanning ? 'cursor-grabbing' : spacePressed ? 'cursor-grab' : '',
              ]"
              tabindex="0"
              role="region"
              aria-label="图片处理预览；右键或菜单键打开预览操作"
              aria-haspopup="menu"
              :aria-expanded="processMenu.open"
              @wheel="handleViewportWheel"
              @pointerdown="beginViewportPan"
              @dblclick="resetViewport"
              @contextmenu="openProcessMenu"
              @keydown="openProcessMenuFromKeyboard"
            >
              <img
                ref="previewImage"
                :src="previewSource"
                :style="previewImageStyle"
                :alt="`${activeTool.title}实时预览`"
                draggable="false"
                class="absolute block max-w-none max-h-none select-none shadow-lg"
                @load="handlePreviewLoad"
                @dragstart.prevent
              />
              <div v-if="activeMode === 'crop' && !sourcePassThrough && imageBounds.width" class="crop-layer" :style="cropLayerStyle" @pointerdown="beginCropCreate">
                <div
                  class="crop-selection"
                  :style="cropSelectionStyle"
                  tabindex="0"
                  aria-label="裁剪选区；拖动可移动，方向键可微调"
                  @pointerdown.stop="beginCropDrag($event, 'move')"
                  @keydown="nudgeCrop"
                >
                  <i v-for="handle in cropHandles" :key="handle" :class="`handle-${handle}`" aria-hidden="true" @pointerdown.stop="beginCropDrag($event, handle)"></i>
                  <span>{{ cropPixelSummary }}</span>
                </div>
              </div>
              <p class="absolute right-3 bottom-2 text-[11px] text-fg-3 pointer-events-none">Ctrl＋滚轮缩放 · 拖动平移 · 空格拖动 · 右键操作</p>
            </div>

            <!-- Empty: one offer, matched to the mode, instead of three. -->
            <div
              v-else
              class="absolute inset-0 center p-6 focus:outline-none"
              tabindex="0"
              role="region"
              :aria-label="activeMode === 'stitch' ? '滚动截图空画布；右键或菜单键可开始桌面采集' : activeMode === 'compose' ? '自由画布起点；选择尺寸、导入图片，或右键打开画布菜单' : '图片处理空画布；选择或拖入图片'"
              :aria-haspopup="activeMode === 'stitch' || activeMode === 'compose' ? 'menu' : undefined"
              :aria-expanded="activeMode === 'stitch' || activeMode === 'compose' ? processMenu.open : undefined"
              @contextmenu="(activeMode === 'stitch' || activeMode === 'compose') && openProcessMenu($event)"
              @keydown="(activeMode === 'stitch' || activeMode === 'compose') && openProcessMenuFromKeyboard($event)"
            >
              <div class="stack items-center gap-3 max-w-100 text-center">
                <span class="center w-12 h-12 rounded-lg bg-accent-soft text-accent">
                  <AppIcon :name="activeMode === 'compose' ? 'palette' : activeMode === 'stitch' ? 'camera' : 'file-image'" :size="24" />
                </span>
                <div class="stack gap-1.5">
                  <strong class="text-[15px] font-semibold text-fg">
                    {{ activeMode === 'stitch' ? '采集窗口，或加入连续截图' : activeMode === 'compose' ? '从一块空白画布开始' : '把图片拖进画布' }}
                  </strong>
                  <p class="text-[12px] leading-relaxed text-fg-3">
                    {{ activeMode === 'stitch'
                      ? `桌面版按 ${CAPTURE_SHORTCUT} 逐屏采集，结束后自动识别重叠；也可以直接导入 2–${STITCH_MAX_FILES} 张同宽截图。`
                      : activeMode === 'compose'
                        ? '空白画布可以直接画方框、箭头和文字，随时保存成可继续编辑的本地项目。'
                        : `支持 JPG、PNG、WebP、GIF，一次最多 ${STITCH_MAX_FILES} 张一起处理。` }}
                  </p>
                </div>

                <button v-if="activeMode === 'stitch'" class="btn-primary" :disabled="captureSessionBusy" @click="captureSessionActive ? stopCaptureSession() : startCaptureSession()">
                  <AppIcon name="camera" :size="15" />{{ captureSessionActive ? '结束采集并拼接' : '开始桌面采集' }}
                </button>
                <div v-else-if="activeMode === 'compose'" class="grid grid-cols-3 gap-2 w-full" aria-label="空白画布尺寸">
                  <button
                    v-for="preset in blankCanvasPresets"
                    :key="preset.id"
                    type="button"
                    class="stack gap-0.5 px-3 py-2.5 rounded-sm border border-line bg-surface text-left transition-colors duration-120 hover:not-disabled:border-accent hover:not-disabled:bg-accent-soft disabled:opacity-45 disabled:cursor-not-allowed"
                    :disabled="blankCanvasBusy"
                    @click="createBlankCanvas(preset, false)"
                  >
                    <b class="text-[12px] font-medium text-fg">{{ preset.label }}</b>
                    <small class="text-[11px] text-fg-3">{{ preset.detail }}</small>
                  </button>
                </div>
                <label v-else class="btn-primary cursor-pointer">
                  选择图片<input class="visually-hidden" type="file" accept="image/*" multiple @change="selectImages" />
                </label>

                <label v-if="activeMode === 'compose'" class="btn-ghost btn-sm cursor-pointer">
                  或直接选择图片<input class="visually-hidden" type="file" accept="image/*" multiple @change="selectImages" />
                </label>
              </div>
            </div>
          </div>

          <footer class="row-between gap-3 shrink-0 px-3 h-9 border-t border-line">
            <b class="min-w-0 truncate text-[12px] font-medium text-fg">{{ outputTitle }}</b>
            <span class="shrink-0 text-[11px] text-fg-3">{{ outputDetail }}</span>
          </footer>
        </main>

        <!-- ── Settings ───────────────────────────────────────────────────
             Grouped and titled, so a mode's parameters are one block rather
             than a run of unlabelled fields. -->
        <aside class="stack min-h-0 border-l border-line" aria-label="设置">
          <!-- The three columns share one header line, so the rule under it
               runs the full width of the workspace instead of stopping. -->
          <header class="row-between gap-2 shrink-0 px-3 h-9 border-b border-line">
            <span class="text-[11px] font-semibold text-fg-3">设置</span>
            <span class="text-[11px] truncate text-fg-3">{{ activeTool.title }}</span>
          </header>
          <div class="flex-1 min-h-0 overflow-y-auto">
          <template v-if="activeMode === 'compose'">
            <section class="stack gap-2.5 p-3 border-b border-line">
              <h3 class="text-[11px] font-semibold text-fg-3">版面</h3>
              <div class="stack gap-1.5">
                <span class="text-[12px] text-fg-3">图片排布</span>
                <div class="grid grid-cols-3 gap-1 p-0.5 rounded-sm bg-surface-2" role="group" aria-label="图片排布">
                  <button
                    v-for="option in layoutOptions"
                    :key="option.id"
                    class="center h-7 rounded-[5px] text-[12px] transition-colors duration-120"
                    :class="layout === option.id ? 'bg-surface text-fg font-medium shadow-sm' : 'text-fg-2 hover:text-fg'"
                    :aria-pressed="layout === option.id"
                    @click="layout = option.id"
                  >
                    {{ option.label }}
                  </button>
                </div>
              </div>
              <p v-if="activeBlankCanvas" class="row-between gap-2 px-2.5 py-2 rounded-sm bg-accent-soft text-[11px] text-accent">
                <span class="row gap-1.5"><AppIcon name="palette" :size="13" />{{ activeBlankCanvas.label }}</span>
                <code class="font-mono tabular-nums">{{ activeBlankCanvas.width }} × {{ activeBlankCanvas.height }}</code>
              </p>
              <label class="stack gap-1.5">
                <span class="text-[12px] text-fg-3">标题</span>
                <input v-model="title" class="field" maxlength="160" placeholder="可选，例如：本周记录" />
              </label>
              <label class="stack gap-1.5">
                <span class="text-[12px] text-fg-3">图片署名</span>
                <input v-model="watermark" class="field" maxlength="160" placeholder="可选，不默认添加品牌" />
              </label>
              <label class="stack gap-1.5">
                <span class="text-[12px] text-fg-3">画布背景</span>
                <span class="row gap-2">
                  <input v-model="background" type="color" class="w-9 h-9 shrink-0 p-0.5 rounded-sm bg-well border border-line cursor-pointer" aria-label="画布背景颜色" />
                  <code class="row flex-1 h-9 px-2.5 rounded-sm bg-well border border-line font-mono text-[12px] text-fg-2">{{ background }}</code>
                </span>
              </label>
            </section>

            <section class="stack gap-2.5 p-3 border-b border-line">
              <h3 class="text-[11px] font-semibold text-fg-3">标注</h3>
              <label class="stack gap-1.5" :class="canvasTool === 'text' ? '' : 'opacity-60'">
                <span class="text-[12px] text-fg-3">文字内容</span>
                <input v-model="annotationText" class="field" :disabled="canvasTool !== 'text'" placeholder="选择文字工具后可编辑" />
              </label>
              <label class="stack gap-1.5" :class="canvasTool === 'select' ? 'opacity-60' : ''">
                <span class="text-[12px] text-fg-3">标注颜色</span>
                <span class="row gap-2">
                  <input v-model="annotationColor" type="color" class="w-9 h-9 shrink-0 p-0.5 rounded-sm bg-well border border-line cursor-pointer disabled:opacity-45 disabled:cursor-not-allowed" :disabled="canvasTool === 'select'" aria-label="标注颜色" />
                  <code class="row flex-1 h-9 px-2.5 rounded-sm bg-well border border-line font-mono text-[12px] text-fg-2">{{ annotationColor }}</code>
                </span>
              </label>
              <p class="text-[11px] leading-relaxed text-fg-3">选中标注后可以拖动、缩放和旋转；每一步都进入撤销历史。</p>
            </section>

            <section class="stack min-h-0">
              <button
                class="row-between gap-2 shrink-0 px-3 h-9 text-left transition-colors duration-120 hover:bg-surface-2"
                type="button"
                :aria-expanded="layerPanelOpen"
                @click="layerPanelOpen = !layerPanelOpen"
              >
                <span class="row gap-2 text-[11px] font-semibold text-fg-3">
                  图层
                  <span class="chip h-4.5 px-1.5 text-[11px] tabular-nums">{{ annotations.length }}</span>
                </span>
                <AppIcon name="chevron" :size="14" class="text-fg-3 transition-transform duration-150" :class="layerPanelOpen ? 'rotate-90' : ''" />
              </button>
              <div v-if="layerPanelOpen" class="stack gap-0.5 px-1.5 pb-3">
                <p v-if="!annotations.length" class="px-2 py-2 text-[11px] leading-relaxed text-fg-3">画上方框、箭头或文字后，图层会出现在这里。</p>
                <ol v-else class="stack gap-0.5" aria-label="标注图层，顶部项目最靠前">
                  <li
                    v-for="layerItem in visibleAnnotationLayers"
                    :key="layerItem.annotation.id"
                    class="row gap-1 rounded-sm"
                    :class="selectedAnnotationId === layerItem.annotation.id ? 'bg-accent-soft' : 'hover:bg-surface-2'"
                    @contextmenu.prevent="openLayerAnnotationMenu($event, layerItem.annotation.id)"
                  >
                    <button
                      class="row gap-2 min-w-0 flex-1 px-2 py-1.5 text-left"
                      type="button"
                      :aria-pressed="selectedAnnotationId === layerItem.annotation.id"
                      @click="selectCanvasAnnotation(layerItem.annotation.id)"
                    >
                      <i class="w-3 h-3 shrink-0 rounded-[3px] border border-line" :style="{ background: layerItem.annotation.color }" aria-hidden="true" />
                      <span class="stack gap-0.5 min-w-0">
                        <b class="text-[12px] font-normal" :class="selectedAnnotationId === layerItem.annotation.id ? 'text-accent' : 'text-fg'">{{ annotationKindLabel(layerItem.annotation) }}</b>
                        <small class="text-[11px] truncate text-fg-3">{{ annotationLayerSummary(layerItem.annotation) }}</small>
                      </span>
                    </button>
                    <span class="stack shrink-0 mr-1">
                      <button class="center w-5 h-4 rounded-[3px] text-[11px] text-fg-3 hover:bg-surface-3 hover:text-fg disabled:opacity-30" type="button" title="上移一层" aria-label="上移一层" :disabled="layerItem.index === annotations.length - 1" @click="moveCanvasAnnotationLayer(layerItem.annotation.id, 'forward', true)">↑</button>
                      <button class="center w-5 h-4 rounded-[3px] text-[11px] text-fg-3 hover:bg-surface-3 hover:text-fg disabled:opacity-30" type="button" title="下移一层" aria-label="下移一层" :disabled="layerItem.index === 0" @click="moveCanvasAnnotationLayer(layerItem.annotation.id, 'backward', true)">↓</button>
                    </span>
                  </li>
                </ol>
                <button v-if="annotations.length > visibleAnnotationLayers.length" class="btn-ghost btn-sm mt-1" type="button" @click="layerVisibleLimit += 40">
                  再显示 {{ Math.min(40, annotations.length - visibleAnnotationLayers.length) }} 个
                </button>
                <div v-if="selectedAnnotation" class="row-between gap-2 mt-1.5 px-2 py-1.5 rounded-sm bg-surface-2">
                  <span class="stack gap-0.5 min-w-0">
                    <b class="text-[11px] font-medium text-fg">{{ annotationKindLabel(selectedAnnotation) }}</b>
                    <small class="text-[11px] text-fg-3">{{ selectedAnnotation.kind === 'arrow' ? '以箭头起点旋转' : `${Math.round(selectedAnnotation.rotation ?? 0)}°` }}</small>
                  </span>
                  <span class="row gap-1 shrink-0">
                    <button class="btn-default btn-sm px-2" type="button" title="向左旋转 15°" @click="rotateCanvasAnnotation(selectedAnnotation.id, -15)">−15°</button>
                    <button class="btn-default btn-sm px-2" type="button" title="向右旋转 15°" @click="rotateCanvasAnnotation(selectedAnnotation.id, 15)">＋15°</button>
                  </span>
                </div>
              </div>
            </section>
          </template>

          <template v-else-if="activeMode === 'stitch'">
            <section class="stack gap-2.5 p-3 border-b border-line">
              <h3 class="text-[11px] font-semibold text-fg-3">桌面采集</h3>
              <div
                class="stack gap-2 p-2.5 rounded-sm border"
                :class="captureSessionError ? 'border-danger bg-danger-soft' : captureSessionActive ? 'border-accent bg-accent-soft' : 'border-line bg-well'"
                :aria-busy="captureSessionBusy"
              >
                <div class="row-between gap-2">
                  <b class="row gap-1.5 text-[12px] font-medium" :class="captureSessionActive ? 'text-accent' : 'text-fg'">
                    <i class="w-1.5 h-1.5 rounded-full" :class="captureSessionActive ? 'bg-accent animate-pulse' : 'bg-fg-3'" aria-hidden="true" />
                    {{ captureSessionActive ? '采集进行中' : '从前台窗口采集' }}
                  </b>
                  <kbd class="kbd">{{ CAPTURE_SHORTCUT }}</kbd>
                </div>
                <p class="text-[11px] leading-relaxed" :class="captureSessionActive ? 'text-accent' : 'text-fg-3'">
                  {{ captureSessionActive
                    ? '切换到需要滚动的窗口，每滚动一屏按一次快捷键；结束后才统一拼接。'
                    : '快捷键只在本次会话注册，结束、切换工具或关闭页面都会立即注销。' }}
                </p>
                <div class="row-between gap-2">
                  <span class="row gap-1.5 text-[11px] text-fg-3">
                    <strong class="text-[16px] font-semibold tabular-nums" :class="captureSessionActive ? 'text-accent' : 'text-fg'">{{ captureSessionCount }}</strong>
                    张新截图
                  </span>
                  <span class="text-[11px] tabular-nums text-fg-3">{{ imageFiles.length }} / {{ STITCH_MAX_FILES }}</span>
                </div>
                <p v-if="captureSessionLastWindow" class="text-[11px] truncate text-fg-3">最近窗口：{{ captureSessionLastWindow }}</p>
                <div class="stack gap-1.5">
                  <button class="btn-primary btn-sm" :disabled="captureSessionBusy || (!captureSessionActive && imageFiles.length >= STITCH_MAX_FILES)" @click="captureSessionActive ? stopCaptureSession() : startCaptureSession()">
                    <AppIcon :name="captureSessionActive ? 'check' : 'camera'" :size="14" />
                    {{ captureSessionBusy ? '正在采集…' : captureSessionActive ? '结束并开始拼接' : '开始采集会话' }}
                  </button>
                  <button v-if="captureSessionActive" class="btn-default btn-sm" :disabled="captureSessionBusy" @click="hideForCapture">
                    <AppIcon name="minimize" :size="14" />隐藏 Knitspace
                  </button>
                </div>
                <p v-if="captureSessionError" class="row gap-1.5 text-[11px] text-danger" role="alert">
                  <AppIcon name="warning" :size="13" class="shrink-0" />{{ captureSessionError }}
                </p>
              </div>
            </section>

            <section class="stack gap-2.5 p-3 border-b border-line">
              <h3 class="text-[11px] font-semibold text-fg-3">拼接</h3>
              <label class="stack gap-1.5">
                <span class="text-[12px] text-fg-3">重叠方式</span>
                <select v-model="stitchOverlapMode" class="field">
                  <option value="auto">自动识别（推荐）</option>
                  <option value="manual">固定比例</option>
                </select>
              </label>
              <label v-if="stitchOverlapMode === 'manual'" class="stack gap-1.5">
                <span class="row-between text-[12px] text-fg-3">每张顶部重复<b class="tabular-nums text-fg">{{ stitchManualOverlap }}%</b></span>
                <input v-model.number="stitchManualOverlap" type="range" min="0" max="70" step="1" class="w-full accent-[var(--accent)]" />
              </label>
              <div class="stack gap-2 p-2.5 rounded-sm bg-surface-2">
                <b class="text-[12px] font-medium text-fg">{{ previewPending ? `${stitchProgress}% · ${stitchDetail}` : stitchResult ? `${stitchResult.width} × ${stitchResult.height} px` : '等待连续截图' }}</b>
                <progress v-if="previewPending" class="w-full h-1" max="100" :value="stitchProgress" :aria-label="stitchDetail" />
                <span class="text-[11px] leading-relaxed text-fg-3">
                  {{ stitchOverlapMode === 'auto'
                    ? '只裁掉可信的重叠区域；识别不可靠时完整保留截图并提示检查，绝不静默丢内容。'
                    : '固定裁掉每张后续截图顶部的相同比例，适合滚动距离一致的页面。' }}
                </span>
                <button class="btn-default btn-sm self-start" :disabled="previewPending || images.length < 2" @click="rebuildStitch">重新识别</button>
              </div>
              <div v-if="stitchResult?.warnings.length" class="stack gap-1 p-2.5 rounded-sm bg-warn-soft" role="status">
                <b class="text-[11px] font-medium text-warn">需要检查 {{ stitchResult.warnings.length }} 处接缝</b>
                <span v-for="warning in stitchResult.warnings" :key="warning" class="text-[11px] leading-relaxed text-warn">{{ warning }}</span>
              </div>
              <p class="text-[11px] leading-relaxed text-fg-3">左侧列表可以调整截图顺序或移除某一张；右键预览还能管理采集、重新识别和查看实际像素。</p>
            </section>
          </template>

          <template v-else>
            <section class="stack gap-2.5 p-3 border-b border-line">
              <h3 class="text-[11px] font-semibold text-fg-3">输出</h3>
              <label class="stack gap-1.5">
                <span class="text-[12px] text-fg-3">输出格式</span>
                <select v-model="imageFormat" class="field">
                  <option value="source">跟随源文件格式</option>
                  <option value="image/png">PNG</option>
                  <option value="image/jpeg">JPG</option>
                  <option value="image/webp">WebP</option>
                </select>
              </label>
              <label v-if="activeMode === 'resize' && !sourcePassThrough" class="stack gap-1.5">
                <span class="row-between text-[12px] text-fg-3">最大宽度<b class="tabular-nums text-fg">{{ maxWidth }} px</b></span>
                <input v-model.number="maxWidth" type="number" min="100" max="7680" class="field" />
              </label>
              <label v-if="qualityApplies" class="stack gap-1.5">
                <span class="row-between text-[12px] text-fg-3">输出质量<b class="tabular-nums text-fg">{{ quality }}%</b></span>
                <input v-model.number="quality" type="range" min="20" max="100" class="w-full accent-[var(--accent)]" />
                <small v-if="processedSizeLabel" class="text-[11px] tabular-nums text-fg-3">预览大小 {{ processedSizeLabel }}</small>
              </label>
              <label v-if="repeatedCompressionApplies" class="stack gap-1.5">
                <span class="text-[12px] text-fg-3">重复压缩次数</span>
                <input v-model.number="compressionPasses" type="number" min="1" :max="compressionPassLimit" step="1" class="field" />
                <small class="text-[11px] text-fg-3">当前图片最多 {{ compressionPassLimit }} 次</small>
              </label>
            </section>

            <section class="stack gap-2.5 p-3 border-b border-line">
              <h3 class="text-[11px] font-semibold text-fg-3">这次会做什么</h3>
              <div v-if="qualityApplies" class="stack gap-1.5 p-2.5 rounded-sm bg-surface-2">
                <b class="text-[12px] font-medium text-fg">{{ activeOutputType === 'image/gif' ? `GIF 动画质量 ${quality}%` : compressionPasses === 1 ? '单次压缩' : `连续压缩 ${compressionPasses} 次` }}</b>
                <span class="text-[11px] leading-relaxed text-fg-3">
                  {{ activeOutputType === 'image/gif'
                    ? '逐帧重新量化颜色并保留帧时长和循环；质量越低，颜色精度越低、编码越快。'
                    : '每次都会重新编码上一轮结果。大图会自动降低次数上限，每轮结束后立即释放位图内存。' }}
                </span>
              </div>
              <div v-else class="stack gap-1.5 p-2.5 rounded-sm bg-surface-2">
                <b class="text-[12px] font-medium text-fg">{{ sourcePassThrough ? `${sourceExtensionLabel(activeImageFile)} 原文件直出` : 'PNG 无损输出' }}</b>
                <span class="text-[11px] leading-relaxed text-fg-3">
                  {{ sourcePassThrough
                    ? 'GIF 会保留全部动画帧，其他暂不支持重编码的格式会保持源文件字节。'
                    : 'PNG 没有有损质量参数，固定按 100% 无损输出；仍可缩放、裁剪和旋转。' }}
                </span>
              </div>
              <div v-if="activeMode === 'crop' && !sourcePassThrough" class="stack gap-1.5 p-2.5 rounded-sm bg-surface-2">
                <b class="text-[12px] font-medium tabular-nums text-fg">{{ cropPixelSummary }}</b>
                <span class="text-[11px] leading-relaxed text-fg-3">在画布上拖动即可重新框选；拖边角改变大小，拖中间移动选区，方向键微调。</span>
                <button class="btn-default btn-sm self-start" @click="resetCrop">恢复完整画面</button>
              </div>
              <div v-if="activeMode === 'rotate' && !sourcePassThrough" class="stack gap-1.5 p-2.5 rounded-sm bg-surface-2">
                <b class="text-[12px] font-medium text-fg">{{ rotation ? `${rotation}°` : '原始方向' }}</b>
                <span class="text-[11px] leading-relaxed text-fg-3">用画布顶部的左转、右转按钮，可以连续点击。</span>
              </div>
              <p v-if="!sourcePassThrough" class="text-[11px] leading-relaxed text-fg-3">
                {{ activeMode === 'crop'
                  ? '裁剪作用于画布选区；导出时按同一比例应用到全部图片。'
                  : activeMode === 'rotate'
                    ? '当前方向会实时预览；导出时应用到全部图片。'
                    : '参数改变后会重新生成当前图片的真实预览；导出时应用到全部图片。' }}
              </p>
            </section>
          </template>
          </div>
        </aside>
      </div>

      <!-- One status line. The old page had a status bar here and a second
           "刚刚导出" panel below the fold saying the same thing. -->
      <footer class="row-between gap-3 shrink-0 px-3 h-10 border-t border-line">
        <p class="min-w-0 truncate text-[12px] text-fg-3" role="status">{{ message }}</p>
        <span v-if="lastOutputs.length" class="row gap-2 shrink-0">
          <span class="row gap-1.5 text-[11px] text-success" :title="lastOutputs.map((output) => output.name).join(' · ')">
            <AppIcon name="check" :size="13" />已导出 {{ lastOutputs.length }} 个文件
          </span>
          <button v-if="lastOutputs[0]?.path" class="btn-ghost btn-sm" @click="openLocation(lastOutputs[0].path)">
            <AppIcon name="folder-open" :size="13" />打开位置
          </button>
        </span>
      </footer>
    </section>

    <Teleport to="body">
      <!-- All three menus and the text editor are teleported: the workspace
           clips its own overflow, and a menu opened near its edge used to be
           cut in half. -->
      <div
        v-if="annotationMenu.open"
        ref="annotationMenuElement"
        class="menu-panel w-52"
        role="menu"
        aria-label="标注操作"
        :style="{ left: `${annotationMenu.x}px`, top: `${annotationMenu.y}px` }"
        @click.stop
        @contextmenu.prevent
        @keydown.stop="handleAnnotationMenuKeydown"
      >
        <p class="menu-title">{{ annotationMenuAnnotation ? `${annotationKindLabel(annotationMenuAnnotation)}标注` : '标注操作' }}</p>
        <button v-if="annotationMenuAnnotation?.kind === 'text'" class="menu-item" role="menuitem" @click="editCanvasTextAnnotation(annotationMenu.id)">编辑文字…</button>
        <button class="menu-item" role="menuitem" @click="duplicateCanvasAnnotation(annotationMenu.id)">复制标注</button>
        <button class="menu-item" role="menuitem" :disabled="!annotationMenuLayer.canMoveForward" @click="moveCanvasAnnotationLayer(annotationMenu.id, 'forward')">上移一层</button>
        <button class="menu-item" role="menuitem" :disabled="!annotationMenuLayer.canMoveBackward" @click="moveCanvasAnnotationLayer(annotationMenu.id, 'backward')">下移一层</button>
        <button class="menu-item" role="menuitem" :disabled="!annotationMenuLayer.canMoveForward" @click="bringAnnotationToFront(annotationMenu.id)">置于最前</button>
        <button class="menu-item" role="menuitem" :disabled="!annotationMenuLayer.canMoveBackward" @click="moveCanvasAnnotationLayer(annotationMenu.id, 'back')">置于最后</button>
        <i class="menu-sep" aria-hidden="true" />
        <button class="menu-item menu-item-danger" role="menuitem" @click="removeAnnotation(annotationMenu.id)">删除标注</button>
      </div>

      <div
        v-if="projectMenu.open"
        ref="projectMenuElement"
        class="menu-panel w-60"
        role="menu"
        aria-label="画布项目操作"
        :style="{ left: `${projectMenu.x}px`, top: `${projectMenu.y}px` }"
        @click.stop
        @contextmenu.prevent
        @keydown.stop="handleProjectMenuKeydown"
      >
        <p class="menu-title">
          画布操作<small class="font-normal">{{ projectDirty ? '未保存' : projectId ? '已保存' : '新项目' }}</small>
        </p>
        <button class="menu-item" role="menuitem" :disabled="projectSaving || !images.length || !projectDirty" @click="saveProjectFromMenu">保存画布项目<kbd class="kbd">Ctrl/⌘ S</kbd></button>
        <button class="menu-item" role="menuitem" :disabled="copying || exporting || !images.length" @click="copyProjectFromMenu">复制当前预览</button>
        <button class="menu-item" role="menuitem" :disabled="copying || exporting || !images.length" @click="exportProjectFromMenu">导出 PNG</button>
        <button class="menu-item" role="menuitem" :disabled="!projectId" @click="toggleProjectFavoriteFromMenu">{{ projectId && store.isContentFavorite('diagram', projectId) ? '取消收藏画布' : '收藏画布项目' }}</button>
        <button class="menu-item" role="menuitem" :disabled="!annotations.length" @click="clearProjectAnnotationsFromMenu">清空全部标注</button>
        <button class="menu-item" role="menuitem" @click="createProjectFromMenu">新建画布项目</button>
      </div>

      <div
        v-if="processMenu.open"
        ref="processMenuElement"
        class="menu-panel w-60"
        role="menu"
        aria-label="图片预览操作"
        :style="{ left: `${processMenu.x}px`, top: `${processMenu.y}px` }"
        @click.stop
        @contextmenu.prevent
        @keydown.stop="handleProcessMenuKeydown"
      >
        <p class="menu-title">{{ activeMode === 'compose' && !images.length ? '开始自由画布' : '预览操作' }}</p>
        <template v-if="activeMode === 'compose' && !images.length">
          <button v-for="preset in blankCanvasPresets" :key="preset.id" class="menu-item" role="menuitem" :disabled="blankCanvasBusy" @click="createBlankCanvasFromMenu(preset)">
            新建{{ preset.label }}<kbd class="kbd">{{ preset.width }} × {{ preset.height }}</kbd>
          </button>
        </template>
        <button v-if="activeMode === 'stitch'" class="menu-item" role="menuitem" :disabled="captureSessionBusy || (!captureSessionActive && imageFiles.length >= STITCH_MAX_FILES)" @click="captureSessionActive ? stopCaptureSession() : startCaptureSession()">
          {{ captureSessionActive ? '结束桌面采集并拼接' : '开始桌面采集会话' }}<kbd class="kbd">{{ CAPTURE_SHORTCUT }}</kbd>
        </button>
        <button v-if="activeMode === 'stitch' && captureSessionActive" class="menu-item" role="menuitem" :disabled="captureSessionBusy" @click="hideForCapture">隐藏 Knitspace 继续采集</button>
        <button class="menu-item" role="menuitem" :disabled="copying || exporting || !outputReady" @click="copyProcessPreview">复制当前预览</button>
        <button v-if="activeMode === 'stitch'" class="menu-item" role="menuitem" :disabled="previewPending || images.length < 2" @click="rebuildStitch">重新识别重叠</button>
        <button class="menu-item" role="menuitem" @click="resetProcessViewport">适应窗口<kbd class="kbd">Ctrl/⌘ 0</kbd></button>
        <button class="menu-item" role="menuitem" @click="actualSizeProcessViewport">实际像素<kbd class="kbd">Ctrl/⌘ 1</kbd></button>
        <button v-if="activeMode === 'crop' && !sourcePassThrough" class="menu-item" role="menuitem" @click="resetProcessCrop">恢复完整画面</button>
        <button v-if="activeMode === 'rotate' && !sourcePassThrough && rotation" class="menu-item" role="menuitem" @click="resetProcessRotation">恢复原始方向</button>
      </div>

      <section
        v-if="annotationTextEditor.open"
        ref="annotationTextEditorElement"
        class="menu-panel w-64 gap-2 p-3"
        role="dialog"
        aria-modal="false"
        aria-label="编辑文字标注"
        :style="{ left: `${annotationTextEditor.x}px`, top: `${annotationTextEditor.y}px` }"
        @keydown.stop
      >
        <header class="row-between gap-2">
          <b class="text-[12px] font-semibold text-fg">编辑文字标注</b>
          <small class="text-[11px] text-fg-3">Enter 保存 · Esc 取消</small>
        </header>
        <input
          ref="annotationTextEditorInput"
          v-model="annotationTextEditor.text"
          class="field"
          maxlength="26"
          aria-label="标注文字"
          @keydown.enter.prevent="saveCanvasTextEdit"
          @keydown.esc.prevent="cancelCanvasTextEdit"
        />
        <footer class="row justify-end gap-2">
          <button class="btn-default btn-sm" @click="cancelCanvasTextEdit">取消</button>
          <button class="btn-primary btn-sm" @click="saveCanvasTextEdit">保存</button>
        </footer>
      </section>
    </Teleport>
  </div>
</template>

<style scoped>
/*
 * The crop overlay resists utilities: eight handle positions, a rule-of-thirds
 * grid drawn with two gradients, and a 9999px shadow that dims everything
 * outside the selection.
 *
 * Its colours are deliberately fixed rather than themed. It sits on top of the
 * user's own pixels, so it has to read the same against a dark photo and a
 * white screenshot, in either UI theme.
 */
.crop-layer {
  position: absolute;
  z-index: 4;
  overflow: hidden;
  cursor: crosshair;
  touch-action: none;
  user-select: none;
}

.crop-selection {
  position: absolute;
  z-index: 2;
  box-sizing: border-box;
  min-width: 4px;
  min-height: 4px;
  border: 2px solid rgb(255 255 255 / .92);
  background-image:
    linear-gradient(to right, transparent 33.1%, rgb(255 255 255 / .38) 33.2%, rgb(255 255 255 / .38) 33.7%, transparent 33.8%, transparent 66.2%, rgb(255 255 255 / .38) 66.3%, rgb(255 255 255 / .38) 66.8%, transparent 66.9%),
    linear-gradient(to bottom, transparent 33.1%, rgb(255 255 255 / .38) 33.2%, rgb(255 255 255 / .38) 33.7%, transparent 33.8%, transparent 66.2%, rgb(255 255 255 / .38) 66.3%, rgb(255 255 255 / .38) 66.8%, transparent 66.9%);
  box-shadow: 0 0 0 9999px rgb(0 0 0 / .55);
  cursor: move;
  touch-action: none;
}

.crop-selection:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

.crop-selection > span {
  position: absolute;
  bottom: 8px;
  left: 50%;
  padding: 3px 7px;
  border-radius: 5px;
  color: #fff;
  background: rgb(0 0 0 / .72);
  font: 500 12px/1.2 var(--font-family-ui);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  transform: translateX(-50%);
  pointer-events: none;
}

.crop-selection > i {
  position: absolute;
  z-index: 3;
  width: 12px;
  height: 12px;
  border: 1px solid rgb(0 0 0 / .45);
  border-radius: 3px;
  background: #fff;
}

.crop-selection .handle-nw { top: -6px; left: -6px; cursor: nwse-resize; }
.crop-selection .handle-n { top: -6px; left: calc(50% - 6px); cursor: ns-resize; }
.crop-selection .handle-ne { top: -6px; right: -6px; cursor: nesw-resize; }
.crop-selection .handle-e { top: calc(50% - 6px); right: -6px; cursor: ew-resize; }
.crop-selection .handle-se { right: -6px; bottom: -6px; cursor: nwse-resize; }
.crop-selection .handle-s { bottom: -6px; left: calc(50% - 6px); cursor: ns-resize; }
.crop-selection .handle-sw { bottom: -6px; left: -6px; cursor: nesw-resize; }
.crop-selection .handle-w { top: calc(50% - 6px); left: -6px; cursor: ew-resize; }
</style>
