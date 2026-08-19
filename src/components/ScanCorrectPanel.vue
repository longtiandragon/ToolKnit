<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import AppIcon from '@/components/AppIcon.vue'
import {
  detectDocumentQuad,
  orderQuadCorners,
  toGrayscale,
  validateScanQuad,
  type ScanEnhanceMode,
  type ScanEnhanceOptions,
  type ScanPoint,
  type ScanQuad,
} from '@/lib/scan-enhance'

const props = defineProps<{
  src: string
  naturalWidth: number
  naturalHeight: number
  /** Corners in source pixels, if a previous correction should be resumed. */
  initialQuad?: ScanQuad | null
  busy?: boolean
}>()

const emit = defineEmits<{
  apply: [payload: { quad: ScanQuad; enhance: ScanEnhanceOptions }]
  cancel: []
}>()

const CORNER_LABELS = ['左上角', '右上角', '右下角', '左下角']
const DETECTION_MAX_SIDE = 900

const stage = ref<HTMLElement>()
const imageElement = ref<HTMLImageElement>()
const points = ref<ScanPoint[]>([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }])
const enhanceMode = ref<ScanEnhanceMode>('text')
const enhanceStrength = ref(70)
const dragging = ref<number | null>(null)
const error = ref('')
const hint = ref('')

const polygon = computed(() => points.value.map(point => `${point.x * 100},${point.y * 100}`).join(' '))
const readout = computed(() => points.value
  .map((point, index) => `${CORNER_LABELS[index]} ${Math.round(point.x * 100)}% / ${Math.round(point.y * 100)}%`)
  .join('　'))

function clamp01(value: number) {
  return Math.min(1, Math.max(0, value))
}

function toSourceQuad(): ScanQuad {
  return orderQuadCorners(points.value.map(point => ({
    x: clamp01(point.x) * props.naturalWidth,
    y: clamp01(point.y) * props.naturalHeight,
  })))
}

function resetToFullFrame() {
  points.value = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }]
  error.value = ''
  hint.value = '已恢复为整张图片。'
}

function beginDrag(event: PointerEvent, index: number) {
  const handle = event.currentTarget
  if (!(handle instanceof HTMLElement)) return
  event.preventDefault()
  handle.setPointerCapture(event.pointerId)
  dragging.value = index
  error.value = ''
}

function moveDrag(event: PointerEvent, index: number) {
  if (dragging.value !== index) return
  const bounds = stage.value?.getBoundingClientRect()
  if (!bounds?.width || !bounds.height) return
  points.value = points.value.map((point, at) => at === index
    ? { x: clamp01((event.clientX - bounds.left) / bounds.width), y: clamp01((event.clientY - bounds.top) / bounds.height) }
    : point)
}

function endDrag(event: PointerEvent, index: number) {
  if (dragging.value !== index) return
  const handle = event.currentTarget
  if (handle instanceof HTMLElement && handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId)
  dragging.value = null
}

function nudge(event: KeyboardEvent, index: number) {
  const step = event.shiftKey ? 0.02 : 0.005
  const offsets: Record<string, [number, number]> = {
    ArrowLeft: [-step, 0],
    ArrowRight: [step, 0],
    ArrowUp: [0, -step],
    ArrowDown: [0, step],
  }
  const offset = offsets[event.key]
  if (!offset) return
  event.preventDefault()
  error.value = ''
  points.value = points.value.map((point, at) => at === index
    ? { x: clamp01(point.x + offset[0]), y: clamp01(point.y + offset[1]) }
    : point)
}

function autoDetect() {
  error.value = ''
  const image = imageElement.value
  if (!image?.complete || !props.naturalWidth || !props.naturalHeight) {
    hint.value = '图片还没有加载完成，请稍后再试。'
    return
  }

  const scale = Math.min(1, DETECTION_MAX_SIDE / Math.max(props.naturalWidth, props.naturalHeight))
  const width = Math.max(1, Math.round(props.naturalWidth * scale))
  const height = Math.max(1, Math.round(props.naturalHeight * scale))
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) {
    error.value = '当前环境不支持画布，无法自动识别边缘。'
    return
  }

  try {
    context.drawImage(image, 0, 0, width, height)
    const detected = detectDocumentQuad(toGrayscale(context.getImageData(0, 0, width, height).data, width, height), width, height)
    if (!detected) {
      // Never invent a crop: leave the current selection and say why.
      hint.value = '没有找到明显的页面边缘，已保留当前框选，请手动拖动四角。'
      return
    }
    points.value = detected.map(point => ({ x: point.x / width, y: point.y / height }))
    hint.value = '已按内容边缘给出初始框选，透视仍需手动微调。'
  } catch {
    error.value = '无法读取图片像素，请手动拖动四角。'
  }
}

function apply() {
  if (props.busy) return
  error.value = ''
  try {
    const quad = toSourceQuad()
    validateScanQuad(quad, props.naturalWidth, props.naturalHeight)
    emit('apply', { quad, enhance: { mode: enhanceMode.value, strength: enhanceStrength.value } })
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '框选区域无法用于矫正。'
  }
}

onMounted(() => {
  if (props.initialQuad && props.naturalWidth && props.naturalHeight) {
    points.value = props.initialQuad.map(point => ({
      x: clamp01(point.x / props.naturalWidth),
      y: clamp01(point.y / props.naturalHeight),
    }))
  }
})
</script>

<template>
  <div class="stack min-h-0 flex-1" @keydown.escape.stop="emit('cancel')">
    <div class="flex-1 min-h-0 center overflow-hidden bg-well p-4">
      <div
        ref="stage"
        class="relative select-none touch-none"
        :style="{ aspectRatio: `${naturalWidth} / ${naturalHeight}`, maxWidth: '100%', maxHeight: '100%' }"
      >
        <img
          ref="imageElement"
          :src="src"
          alt="待矫正的图片；使用下方四个角点按钮调整范围"
          decoding="async"
          class="block w-full h-full object-fill"
        />
        <svg class="absolute inset-0 w-full h-full pointer-events-none" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          <defs>
            <mask id="scan-correct-mask">
              <rect width="100" height="100" fill="#fff" />
              <polygon :points="polygon" fill="#000" />
            </mask>
          </defs>
          <rect width="100" height="100" fill="rgb(0 0 0 / .55)" mask="url(#scan-correct-mask)" />
          <polygon :points="polygon" fill="none" stroke="currentColor" stroke-width="0.4" vector-effect="non-scaling-stroke" class="text-accent" />
        </svg>
        <button
          v-for="(point, index) in points"
          :key="index"
          type="button"
          class="absolute center w-7 h-7 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-accent bg-surface text-accent shadow-sm cursor-grab touch-none hover:bg-accent-soft focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          :class="dragging === index ? 'cursor-grabbing scale-110' : ''"
          :style="{ left: `${point.x * 100}%`, top: `${point.y * 100}%` }"
          :aria-label="`${CORNER_LABELS[index]}，水平 ${Math.round(point.x * 100)}%、垂直 ${Math.round(point.y * 100)}%；方向键微调，按住 Shift 加快`"
          @pointerdown="beginDrag($event, index)"
          @pointermove="moveDrag($event, index)"
          @pointerup="endDrag($event, index)"
          @pointercancel="endDrag($event, index)"
          @keydown="nudge($event, index)"
        >
          <span class="text-[10px] font-semibold tabular-nums" aria-hidden="true">{{ index + 1 }}</span>
        </button>
      </div>
    </div>

    <p v-if="error" class="row gap-2 shrink-0 px-3 py-2 border-t border-line bg-danger-soft text-[12px] text-danger" role="alert">
      <AppIcon name="warning" :size="15" class="shrink-0 mt-0.5" />
      <span class="min-w-0 flex-1 leading-relaxed">{{ error }}</span>
    </p>
    <p v-else-if="hint" class="row gap-2 shrink-0 px-3 py-2 border-t border-line bg-surface-2 text-[11px] text-fg-2" role="status">
      <AppIcon name="pointer" :size="14" class="shrink-0 mt-0.5" />
      <span class="min-w-0 flex-1 leading-relaxed">{{ hint }}</span>
    </p>

    <div class="row flex-wrap gap-x-4 gap-y-2 shrink-0 px-3 py-2 border-t border-line">
      <button class="btn-tool shrink-0" :disabled="busy" @click="autoDetect">
        <AppIcon name="sparkle" :size="14" />自动找边缘
      </button>
      <button class="btn-tool shrink-0" :disabled="busy" @click="resetToFullFrame">
        <AppIcon name="maximize" :size="14" />整张图片
      </button>
      <label class="row gap-2 shrink-0">
        <span class="text-[11px] font-semibold text-fg-3">增强</span>
        <select v-model="enhanceMode" class="field h-7 px-2 text-[12px]" :disabled="busy">
          <option value="text">文字（提白纸面）</option>
          <option value="photo">照片（保留细节）</option>
          <option value="none">不增强</option>
        </select>
      </label>
      <label class="row gap-2 shrink-0" :class="enhanceMode === 'none' ? 'opacity-50' : ''">
        <span class="text-[11px] font-semibold text-fg-3">强度</span>
        <input
          v-model.number="enhanceStrength"
          type="range"
          min="0"
          max="100"
          step="5"
          class="w-28"
          :disabled="busy || enhanceMode === 'none'"
          aria-label="增强强度百分比"
        />
        <span class="w-9 font-mono text-[11px] tabular-nums text-fg-3">{{ enhanceStrength }}%</span>
      </label>
      <span class="row gap-1.5 ml-auto shrink-0">
        <button class="btn-default btn-sm" :disabled="busy" @click="emit('cancel')">
          <AppIcon name="close" :size="13" />取消
        </button>
        <button class="btn-primary btn-sm" :disabled="busy" @click="apply">
          <AppIcon :name="busy ? 'refresh' : 'check'" :size="13" />
          {{ busy ? '正在矫正…' : '应用矫正' }}
        </button>
      </span>
    </div>

    <p class="shrink-0 px-3 py-1.5 border-t border-line bg-surface-2 font-mono text-[11px] tabular-nums text-fg-3" role="status">
      {{ readout }}
    </p>
  </div>
</template>
