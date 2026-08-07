<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import * as pdfjs from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.mjs?url'
import type { Source } from '@/types'

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

const props = withDefaults(defineProps<{ source: Source; initialPage?: number }>(), { initialPage: 0 })
const emit = defineEmits<{ select: [bbox: [number, number, number, number], crop?: string]; page: [pageIndex: number, pageCount: number] }>()
const canvas = ref<HTMLCanvasElement>()
const image = ref<HTMLImageElement>()
const pageIndex = ref(0)
const pageCount = ref(1)
const loading = ref(false)
const error = ref('')
const selection = ref<[number, number, number, number] | null>(null)
const drawing = ref(false)
const start = ref<[number, number] | null>(null)
let pdfDocument: any

const selectionStyle = computed(() => selection.value ? { left: `${selection.value[0] * 100}%`, top: `${selection.value[1] * 100}%`, width: `${selection.value[2] * 100}%`, height: `${selection.value[3] * 100}%` } : {})

async function loadPdf() {
  if (props.source.kind !== 'pdf' || !props.source.preview || !canvas.value) return
  loading.value = true; error.value = ''
  try {
    const bytes = await fetch(props.source.preview).then((response) => response.arrayBuffer())
    pdfDocument?.destroy?.(); pdfDocument = await pdfjs.getDocument({ data: bytes }).promise
    pageCount.value = pdfDocument.numPages; pageIndex.value = Math.min(pageIndex.value, Math.max(0, pageCount.value - 1)); await renderPdf()
  } catch (reason) { error.value = '这个 PDF 无法读取：可能受密码保护或文件已损坏。' }
  finally { loading.value = false }
}

async function renderPdf() {
  if (!pdfDocument || !canvas.value) return
  const pdfPage = await pdfDocument.getPage(pageIndex.value + 1)
  const viewport = pdfPage.getViewport({ scale: 1.35 })
  const target = canvas.value; const context = target.getContext('2d')!
  target.width = Math.floor(viewport.width); target.height = Math.floor(viewport.height)
  await pdfPage.render({ canvasContext: context, viewport }).promise
  emit('page', pageIndex.value, pageCount.value)
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
function cropSelection() {
  if (!selection.value) return undefined
  const [x, y, w, h] = selection.value; const sourceCanvas = props.source.kind === 'pdf' ? canvas.value : undefined
  const target = document.createElement('canvas')
  if (sourceCanvas) { target.width = Math.max(1, Math.floor(sourceCanvas.width * w)); target.height = Math.max(1, Math.floor(sourceCanvas.height * h)); target.getContext('2d')?.drawImage(sourceCanvas, sourceCanvas.width * x, sourceCanvas.height * y, sourceCanvas.width * w, sourceCanvas.height * h, 0, 0, target.width, target.height); return target.toDataURL('image/png') }
  if (image.value) { target.width = Math.max(1, Math.floor(image.value.naturalWidth * w)); target.height = Math.max(1, Math.floor(image.value.naturalHeight * h)); target.getContext('2d')?.drawImage(image.value, image.value.naturalWidth * x, image.value.naturalHeight * y, image.value.naturalWidth * w, image.value.naturalHeight * h, 0, 0, target.width, target.height); return target.toDataURL('image/png') }
  return undefined
}
function previous() { if (pageIndex.value > 0) { pageIndex.value--; selection.value = null; renderPdf() } }
function next() { if (pageIndex.value < pageCount.value - 1) { pageIndex.value++; selection.value = null; renderPdf() } }

watch(() => [props.source.id, props.initialPage] as const, async () => { pageIndex.value = Math.max(0, props.initialPage); selection.value = null; await nextTick(); loadPdf() }, { immediate: true })
onBeforeUnmount(() => pdfDocument?.destroy?.())
</script>

<template>
  <div class="source-canvas">
    <div v-if="source.kind === 'pdf'" class="page-toolbar"><button :disabled="pageIndex === 0" @click="previous">←</button><span>第 {{ pageIndex + 1 }} / {{ pageCount }} 页</span><button :disabled="pageIndex >= pageCount - 1" @click="next">→</button></div>
    <div class="canvas-stage" :class="{ selectable: source.kind === 'pdf' || source.kind === 'image' }" @pointerdown="down" @pointermove="move" @pointerup="up">
      <canvas v-if="source.kind === 'pdf'" ref="canvas"></canvas>
      <img v-else-if="source.kind === 'image' && source.preview" ref="image" :src="source.preview" :alt="source.name" />
      <pre v-else>{{ source.content }}</pre>
      <span v-if="selection" class="crop-box" :style="selectionStyle"><i>已框选</i></span>
      <span v-if="loading" class="canvas-status">正在渲染 PDF…</span><span v-if="error" class="canvas-status error">{{ error }}</span>
    </div>
    <p v-if="source.kind === 'pdf' || source.kind === 'image'" class="crop-tip">拖动框选一道题、公式或一段文字；选区会带着来源进入错题卡。</p>
  </div>
</template>
