<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Arrow as VArrow, Layer as VLayer, Line as VLine, Rect as VRect, Stage as VStage, Text as VText, Transformer as VTransformer } from 'vue-konva/core'
import 'konva/lib/shapes/Arrow'
import 'konva/lib/shapes/Line'
import 'konva/lib/shapes/Rect'
import 'konva/lib/shapes/Text'
import 'konva/lib/shapes/Transformer'
import type { KonvaEventObject, Node as KonvaNode } from 'konva/lib/Node'
import type { Arrow as KonvaArrow } from 'konva/lib/shapes/Arrow'
import type { Line as KonvaLine } from 'konva/lib/shapes/Line'
import type { Stage as KonvaStage } from 'konva/lib/Stage'
import type { Transformer as KonvaTransformer } from 'konva/lib/shapes/Transformer'
import { arrowFromCanvasEndpoints, createAnnotation, normalizeAnnotation, type CanvasAnnotation, type CanvasTool } from '@/lib/annotation-canvas'

type Point = { x: number; y: number }
type Drawing = { kind: Exclude<CanvasTool, 'select'>; start: Point; point: Point; points: Point[] }
type KonvaRef<T> = { getNode: () => T }

const props = defineProps<{
  annotations: CanvasAnnotation[]
  tool: CanvasTool
  color: string
  text: string
  /** Logical pen stroke width at a 1000px-wide canvas; the stage and the
   *  export renderer scale it proportionally. */
  strokeWidth?: number
  disabled?: boolean
  /** The parent transforms the complete composition (image and annotations)
   * together. Disable this layer's legacy standalone viewport in that case. */
  managedViewport?: boolean
}>()

const emit = defineEmits<{
  create: [annotation: CanvasAnnotation]
  update: [annotation: CanvasAnnotation]
  remove: [id: number]
  context: [payload: { id: number; x: number; y: number }]
  canvasContext: [payload: { x: number; y: number }]
  select: [id: number | null]
  editText: [payload: { id: number; x: number; y: number }]
}>()

const host = ref<HTMLElement>()
const stageRef = ref<KonvaRef<KonvaStage>>()
const transformerRef = ref<KonvaRef<KonvaTransformer>>()
const dimensions = ref({ width: 1, height: 1 })
const selectedId = ref<number | null>(null)
const drawing = ref<Drawing | null>(null)
const viewZoom = ref(1)
const viewPan = ref({ x: 0, y: 0 })
const spacePressed = ref(false)
const panning = ref<{ startX: number; startY: number; panX: number; panY: number } | null>(null)
let resizeObserver: ResizeObserver | undefined

const stageConfig = computed(() => ({
  width: dimensions.value.width,
  height: dimensions.value.height,
  scaleX: props.managedViewport ? 1 : viewZoom.value,
  scaleY: props.managedViewport ? 1 : viewZoom.value,
  x: props.managedViewport ? 0 : viewPan.value.x,
  y: props.managedViewport ? 0 : viewPan.value.y,
}))
const transformerConfig = { rotateEnabled: true, rotationSnaps: [0, 45, 90, 135, 180, 225, 270, 315], rotationSnapTolerance: 5, keepRatio: false, enabledAnchors: ['top-left', 'top-right', 'bottom-left', 'bottom-right'], borderStroke: '#0c6557', anchorFill: '#fffefa', anchorStroke: '#0c6557', anchorSize: 8, padding: 5, ignoreStroke: true }
const draftAnnotation = computed(() => {
  const current = drawing.value
  if (!current) return null
  if (current.kind === 'box' || current.kind === 'mosaic') {
    return createAnnotation({
      kind: current.kind,
      x: Math.min(current.start.x, current.point.x),
      y: Math.min(current.start.y, current.point.y),
      width: Math.abs(current.point.x - current.start.x),
      height: Math.abs(current.point.y - current.start.y),
      text: '',
      color: props.color,
    })
  }
  if (current.kind === 'pen') {
    if (current.points.length < 2) return null
    return createAnnotation({
      kind: 'pen',
      x: current.points[0].x,
      y: current.points[0].y,
      text: '',
      color: props.color,
      strokeWidth: props.strokeWidth ?? 10,
      points: current.points,
    })
  }
  return createAnnotation({
    kind: 'arrow',
    x: current.start.x,
    y: current.start.y,
    width: current.point.x - current.start.x,
    height: current.point.y - current.start.y,
    text: '',
    color: props.color,
  })
})

function pointFromEvent(event: KonvaEventObject<MouseEvent>): Point | null {
  const stage = event.target.getStage()
  const position = stage?.getPointerPosition()
  if (!position || !dimensions.value.width || !dimensions.value.height) return null
  // The stage pans/zooms; map the raw pointer back into canvas coordinates.
  const scale = stage?.scaleX() ?? 1
  const offset = stage?.position() ?? { x: 0, y: 0 }
  const canvasX = (position.x - offset.x) / scale
  const canvasY = (position.y - offset.y) / scale
  return {
    x: Math.max(0, Math.min(1, canvasX / dimensions.value.width)),
    y: Math.max(0, Math.min(1, canvasY / dimensions.value.height)),
  }
}

function shapeConfig(annotation: CanvasAnnotation) {
  const normalized = normalizeAnnotation(annotation)
  return {
    id: `annotation-${normalized.id}`,
    name: 'canvas-annotation',
    x: normalized.x * dimensions.value.width,
    y: normalized.y * dimensions.value.height,
    width: (normalized.width ?? 0) * dimensions.value.width,
    height: (normalized.height ?? 0) * dimensions.value.height,
    rotation: normalized.rotation ?? 0,
    stroke: normalized.color,
    fill: normalized.kind === 'box' ? 'rgba(255,255,255,0.01)' : undefined,
    strokeWidth: normalized.kind === 'box' ? 3 : undefined,
    cornerRadius: normalized.kind === 'box' ? 4 : undefined,
    draggable: !props.disabled,
  }
}

function arrowConfig(annotation: CanvasAnnotation) {
  const normalized = normalizeAnnotation(annotation)
  const x = normalized.x * dimensions.value.width
  const y = normalized.y * dimensions.value.height
  return {
    id: `annotation-${normalized.id}`,
    name: 'canvas-annotation',
    points: [x, y, x + (normalized.width ?? 0) * dimensions.value.width, y + (normalized.height ?? 0) * dimensions.value.height],
    pointerLength: 11,
    pointerWidth: 11,
    stroke: normalized.color,
    fill: normalized.color,
    strokeWidth: 3,
    lineCap: 'round',
    lineJoin: 'round',
    draggable: !props.disabled,
  }
}

function textConfig(annotation: CanvasAnnotation) {
  const normalized = normalizeAnnotation(annotation)
  return {
    ...shapeConfig(normalized),
    text: normalized.text || '重点',
    fill: normalized.color,
    stroke: undefined,
    fontSize: 18,
    fontStyle: 'bold',
    fontFamily: '"Segoe UI Variable Text", "Microsoft YaHei UI", sans-serif',
    padding: 4,
  }
}

function mosaicConfig(annotation: CanvasAnnotation) {
  const normalized = normalizeAnnotation(annotation)
  return {
    ...shapeConfig(normalized),
    fill: 'rgba(15, 17, 17, 0.42)',
    strokeWidth: 2,
    dash: [10, 6],
    cornerRadius: 2,
  }
}

function penConfig(annotation: CanvasAnnotation) {
  const normalized = normalizeAnnotation(annotation)
  const points = (normalized.points ?? []).flatMap((point) => [point.x * dimensions.value.width, point.y * dimensions.value.height])
  return {
    id: `annotation-${normalized.id}`,
    name: 'canvas-annotation',
    points,
    stroke: normalized.color,
    strokeWidth: Math.max(2, (normalized.strokeWidth ?? props.strokeWidth ?? 10) * dimensions.value.width / 1000),
    lineCap: 'round',
    lineJoin: 'round',
    tension: 0.4,
    rotation: normalized.rotation ?? 0,
    draggable: !props.disabled,
  }
}

function updateDimensions() {
  const bounds = host.value?.getBoundingClientRect()
  if (!bounds?.width || !bounds.height) return
  dimensions.value = { width: Math.round(bounds.width), height: Math.round(bounds.height) }
  void nextTick(attachTransformer)
}

function attachTransformer() {
  const transformer = transformerRef.value?.getNode()
  const stage = stageRef.value?.getNode()
  if (!transformer || !stage) return
  const selected = selectedId.value === null ? undefined : props.annotations.find((annotation) => annotation.id === selectedId.value)
  const node = selected ? stage.findOne<KonvaNode>(`#annotation-${selected.id}`) : undefined
  transformer.nodes(node ? [node] : [])
  transformer.getLayer()?.batchDraw()
}

function selectAnnotation(id: number, event?: KonvaEventObject<MouseEvent>) {
  if (event) event.cancelBubble = true
  selectedId.value = id
  emit('select', id)
  void nextTick(attachTransformer)
}

function clearSelection() {
  selectedId.value = null
  emit('select', null)
  void nextTick(attachTransformer)
}

function beginDrawing(event: KonvaEventObject<MouseEvent>) {
  if (props.disabled || event.evt.button !== 0) return
  const stage = event.target.getStage()
  if (!stage || event.target !== stage) return
  const point = pointFromEvent(event)
  if (!point) return
  if (props.tool === 'select') { clearSelection(); return }
  if (props.tool === 'text') {
    const annotation = createAnnotation({ kind: 'text', x: point.x, y: point.y, text: props.text.trim() || '重点', color: props.color })
    emit('create', annotation)
    selectedId.value = annotation.id
    emit('select', annotation.id)
    return
  }
  drawing.value = { kind: props.tool, start: point, point, points: [point] }
  clearSelection()
}

function moveDrawing(event: KonvaEventObject<MouseEvent>) {
  if (!drawing.value) return
  const point = pointFromEvent(event)
  if (!point) return
  if (drawing.value.kind === 'pen') {
    const previous = drawing.value.points[drawing.value.points.length - 1]
    if (previous && Math.hypot(point.x - previous.x, point.y - previous.y) < .004) return
    drawing.value = { ...drawing.value, point, points: [...drawing.value.points, point] }
    return
  }
  drawing.value = { ...drawing.value, point }
}

function finishDrawing() {
  const current = drawing.value
  const annotation = draftAnnotation.value
  drawing.value = null
  if (!annotation) return
  if (current?.kind === 'pen') {
    if ((annotation.points ?? []).length < 2) return
    const xs = annotation.points!.map((point) => point.x)
    const ys = annotation.points!.map((point) => point.y)
    if (Math.max(...xs) - Math.min(...xs) < .012 && Math.max(...ys) - Math.min(...ys) < .012) return
    emit('create', annotation)
    selectedId.value = annotation.id
    emit('select', annotation.id)
    return
  }
  const isTiny = Math.abs(annotation.width ?? 0) < .015 || Math.abs(annotation.height ?? 0) < .015
  if (isTiny) return
  emit('create', annotation)
  selectedId.value = annotation.id
  emit('select', annotation.id)
}

function commitDrag(annotation: CanvasAnnotation, event: KonvaEventObject<MouseEvent>) {
  const stage = event.target.getStage()
  if (!stage) return
  const node = event.target
  if (annotation.kind === 'arrow') {
    const normalized = normalizeAnnotation({ ...annotation, x: annotation.x + node.x() / dimensions.value.width, y: annotation.y + node.y() / dimensions.value.height })
    node.position({ x: 0, y: 0 })
    emit('update', normalized)
    return
  }
  if (annotation.kind === 'pen') {
    const dx = node.x() / dimensions.value.width
    const dy = node.y() / dimensions.value.height
    const points = (annotation.points ?? []).map((point) => ({ x: point.x + dx, y: point.y + dy }))
    node.position({ x: 0, y: 0 })
    emit('update', normalizeAnnotation({ ...annotation, x: annotation.x + dx, y: annotation.y + dy, points }))
    return
  }
  emit('update', normalizeAnnotation({ ...annotation, x: node.x() / dimensions.value.width, y: node.y() / dimensions.value.height }))
}

function commitTransform(annotation: CanvasAnnotation, event: KonvaEventObject<MouseEvent>) {
  const node = event.target
  if (annotation.kind === 'arrow') {
    const arrow = node as KonvaArrow
    const [startX = 0, startY = 0, endX = startX, endY = startY] = arrow.points()
    const transform = arrow.getAbsoluteTransform()
    const start = transform.point({ x: startX, y: startY })
    const end = transform.point({ x: endX, y: endY })
    // The Vue config stores endpoints directly, not Konva's transient node
    // scale. Reset it before the parent applies the normalized update.
    arrow.position({ x: 0, y: 0 })
    arrow.scale({ x: 1, y: 1 })
    arrow.rotation(0)
    emit('update', arrowFromCanvasEndpoints(annotation, start, end, dimensions.value))
    return
  }
  if (annotation.kind === 'pen') {
    const line = node as KonvaLine
    const transform = line.getAbsoluteTransform()
    const points = (annotation.points ?? []).map((point) => {
      const mapped = transform.point({ x: point.x * dimensions.value.width, y: point.y * dimensions.value.height })
      return { x: mapped.x / dimensions.value.width, y: mapped.y / dimensions.value.height }
    })
    line.position({ x: 0, y: 0 })
    line.scale({ x: 1, y: 1 })
    line.rotation(0)
    emit('update', normalizeAnnotation({ ...annotation, points }))
    return
  }
  const width = node.width() * node.scaleX() / dimensions.value.width
  const height = node.height() * node.scaleY() / dimensions.value.height
  node.scaleX(1)
  node.scaleY(1)
  emit('update', normalizeAnnotation({ ...annotation, x: node.x() / dimensions.value.width, y: node.y() / dimensions.value.height, width, height, rotation: node.rotation() }))
}

function openContext(annotation: CanvasAnnotation, event: KonvaEventObject<MouseEvent>) {
  event.evt.preventDefault()
  selectAnnotation(annotation.id, event)
  emit('context', { id: annotation.id, x: event.evt.clientX, y: event.evt.clientY })
}

function editTextDirect(annotation: CanvasAnnotation, event: KonvaEventObject<MouseEvent>) {
  if (annotation.kind !== 'text') return
  event.cancelBubble = true
  selectAnnotation(annotation.id, event)
  emit('editText', { id: annotation.id, x: event.evt.clientX, y: event.evt.clientY })
}

function openCanvasContext(event: KonvaEventObject<MouseEvent>) {
  const stage = event.target.getStage()
  if (!stage || event.target !== stage) return
  event.evt.preventDefault()
  clearSelection()
  emit('canvasContext', { x: event.evt.clientX, y: event.evt.clientY })
}

/* ── Zoom and pan. Ctrl+wheel zooms around the cursor, space+drag pans, a
   double click resets — the same vocabulary the processing viewport uses,
   so the annotation canvas does not teach a second one. ── */
function handleWheel(event: WheelEvent) {
  if (props.managedViewport || !event.ctrlKey) return
  event.preventDefault()
  const bounds = host.value?.getBoundingClientRect()
  if (!bounds) return
  const cursorX = event.clientX - bounds.left
  const cursorY = event.clientY - bounds.top
  const nextZoom = Math.max(0.2, Math.min(8, viewZoom.value * Math.exp(-event.deltaY * 0.002)))
  const ratio = nextZoom / viewZoom.value
  viewPan.value = {
    x: cursorX - ratio * (cursorX - viewPan.value.x),
    y: cursorY - ratio * (cursorY - viewPan.value.y),
  }
  viewZoom.value = nextZoom
}

function resetView() {
  viewZoom.value = 1
  viewPan.value = { x: 0, y: 0 }
}

function handleSpaceKey(event: KeyboardEvent) {
  const target = event.target as HTMLElement | null
  if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return
  if (event.key !== ' ') return
  spacePressed.value = event.type === 'keydown'
  if (spacePressed.value) event.preventDefault()
}

function beginPan(event: PointerEvent) {
  if (props.managedViewport || !spacePressed.value) return
  event.preventDefault()
  event.stopPropagation()
  panning.value = { startX: event.clientX, startY: event.clientY, panX: viewPan.value.x, panY: viewPan.value.y }
  host.value?.setPointerCapture(event.pointerId)
}

function movePan(event: PointerEvent) {
  if (!panning.value) return
  event.preventDefault()
  event.stopPropagation()
  viewPan.value = {
    x: panning.value.panX + event.clientX - panning.value.startX,
    y: panning.value.panY + event.clientY - panning.value.startY,
  }
}

function endPan(event: PointerEvent) {
  if (!panning.value) return
  panning.value = null
  host.value?.releasePointerCapture(event.pointerId)
}

function handleKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') { clearSelection(); return }
  if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
    const bounds = host.value?.getBoundingClientRect()
    if (!bounds) return
    event.preventDefault()
    const annotation = selectedId.value === null ? undefined : props.annotations.find((item) => item.id === selectedId.value)
    if (annotation) {
      emit('context', {
        id: annotation.id,
        x: bounds.left + bounds.width * Math.min(.94, annotation.x + (annotation.width ?? .12) / 2),
        y: bounds.top + bounds.height * Math.min(.94, annotation.y + Math.abs(annotation.height ?? .08) / 2),
      })
    } else {
      emit('canvasContext', { x: bounds.left + Math.min(96, bounds.width / 2), y: bounds.top + Math.min(88, bounds.height / 2) })
    }
    return
  }
  if ((event.key === 'Backspace' || event.key === 'Delete') && selectedId.value !== null) {
    event.preventDefault()
    emit('remove', selectedId.value)
    clearSelection()
  }
}

function focusCanvas() {
  host.value?.focus({ preventScroll: true })
}

defineExpose({
  select(id: number | null) {
    if (id === null) clearSelection()
    else selectAnnotation(id)
    focusCanvas()
  },
  focus: focusCanvas,
})

watch(() => props.annotations, () => {
  if (selectedId.value !== null && !props.annotations.some((annotation) => annotation.id === selectedId.value)) clearSelection()
  void nextTick(attachTransformer)
}, { deep: true })

watch(selectedId, () => { void nextTick(attachTransformer) })

onMounted(() => {
  updateDimensions()
  window.addEventListener('keydown', handleSpaceKey)
  window.addEventListener('keyup', handleSpaceKey)
  if (typeof ResizeObserver !== 'undefined') {
    resizeObserver = new ResizeObserver(updateDimensions)
    if (host.value) resizeObserver.observe(host.value)
  }
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', handleSpaceKey)
  window.removeEventListener('keyup', handleSpaceKey)
  resizeObserver?.disconnect()
})
</script>

<template>
  <!-- `annotation-canvas` is a DOM hook, not a style: VisualStudioView finds
       this element with `document.querySelector('.annotation-canvas')` to
       anchor its context menus. The Konva stage is generated markup, so the
       two rules it needs — fill the host, and take the tool's cursor — are
       written here as arbitrary variants rather than left in a stylesheet. -->
  <div ref="host" class="annotation-canvas [&_.konvajs-content]:w-full! [&_.konvajs-content]:h-full! data-[tool=select]:cursor-default data-[tool=box]:cursor-crosshair data-[tool=arrow]:cursor-crosshair data-[tool=text]:cursor-crosshair data-[tool=mosaic]:cursor-crosshair data-[tool=pen]:cursor-crosshair focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--accent)]" :class="!managedViewport && spacePressed ? 'cursor-grab' : ''" :data-tool="tool" tabindex="0" role="application" aria-label="图片标注画布；选择工具后在图片上绘制，选中后可拖动、缩放和旋转" @pointerdown="focusCanvas" @keydown="handleKeydown" @wheel="handleWheel" @pointerdown.capture="beginPan" @pointermove.capture="movePan" @pointerup.capture="endPan" @pointercancel.capture="endPan" @dblclick="!managedViewport && resetView()">
    <VStage ref="stageRef" :config="stageConfig" @mousedown="beginDrawing" @mousemove="moveDrawing" @mouseup="finishDrawing" @mouseleave="finishDrawing" @contextmenu="openCanvasContext">
      <VLayer>
        <template v-for="annotation in annotations" :key="annotation.id">
          <VRect v-if="annotation.kind === 'box' || annotation.kind === 'mosaic'" :config="annotation.kind === 'mosaic' ? mosaicConfig(annotation) : shapeConfig(annotation)" @mousedown="selectAnnotation(annotation.id, $event)" @click="selectAnnotation(annotation.id, $event)" @dragend="commitDrag(annotation, $event)" @transformend="commitTransform(annotation, $event)" @contextmenu="openContext(annotation, $event)" />
          <VArrow v-else-if="annotation.kind === 'arrow'" :config="arrowConfig(annotation)" @mousedown="selectAnnotation(annotation.id, $event)" @click="selectAnnotation(annotation.id, $event)" @dragend="commitDrag(annotation, $event)" @transformend="commitTransform(annotation, $event)" @contextmenu="openContext(annotation, $event)" />
          <VLine v-else-if="annotation.kind === 'pen'" :config="penConfig(annotation)" @mousedown="selectAnnotation(annotation.id, $event)" @click="selectAnnotation(annotation.id, $event)" @dragend="commitDrag(annotation, $event)" @transformend="commitTransform(annotation, $event)" @contextmenu="openContext(annotation, $event)" />
          <VText v-else :config="textConfig(annotation)" @mousedown="selectAnnotation(annotation.id, $event)" @click="selectAnnotation(annotation.id, $event)" @dblclick="editTextDirect(annotation, $event)" @dragend="commitDrag(annotation, $event)" @transformend="commitTransform(annotation, $event)" @contextmenu="openContext(annotation, $event)" />
        </template>
        <VRect v-if="draftAnnotation?.kind === 'box' || draftAnnotation?.kind === 'mosaic'" :config="draftAnnotation.kind === 'mosaic' ? mosaicConfig(draftAnnotation) : shapeConfig(draftAnnotation)" :listening="false" />
        <VArrow v-else-if="draftAnnotation?.kind === 'arrow'" :config="arrowConfig(draftAnnotation)" :listening="false" />
        <VLine v-else-if="draftAnnotation?.kind === 'pen'" :config="penConfig(draftAnnotation)" :listening="false" />
        <VTransformer ref="transformerRef" :config="transformerConfig" />
      </VLayer>
    </VStage>
    <!-- The pills lie on the user's own picture, which can be anything from a
         white screenshot to a night photo, so they are fixed white-on-scrim in
         both themes on purpose — the same call the crop overlay makes. -->
    <p v-if="tool !== 'select'" class="absolute left-3 bottom-3 z-4 px-2 py-1 rounded-full bg-[rgb(0_0_0_/_0.68)] text-[12px] font-medium leading-tight text-white select-none pointer-events-none">{{ tool === 'text' ? '单击放置文字，双击可编辑' : tool === 'pen' ? '按住拖动涂画' : tool === 'mosaic' ? '按住并拖动选择打码区域' : '按住并拖动绘制' }}</p>
    <p v-if="!managedViewport && (viewZoom !== 1 || viewPan.x || viewPan.y)" class="absolute right-3 top-2 z-4 row gap-1 pointer-events-none">
      <button type="button" class="pointer-events-auto px-2 py-1 rounded-full bg-[rgb(0_0_0_/_0.68)] text-[11px] font-medium tabular-nums leading-tight text-white hover:bg-[rgb(0_0_0_/_0.82)]" title="恢复原始大小" @click.stop="resetView">{{ Math.round(viewZoom * 100) }}%</button>
    </p>
    <p v-if="!managedViewport && spacePressed" class="absolute right-3 bottom-3 z-4 px-2 py-1 rounded-full bg-[rgb(0_0_0_/_0.68)] text-[12px] font-medium leading-tight text-white select-none pointer-events-none">拖动平移画布</p>
  </div>
</template>
