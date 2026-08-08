<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { RouterLink } from 'vue-router'
import AppIcon from '@/components/AppIcon.vue'
import FileDropZone from '@/components/FileDropZone.vue'
import { chooseOutputDirectory, exportOutput } from '@/lib/output'
import { copyPngToClipboard, isDesktop, revealDesktopFile } from '@/lib/native'
import { useWorkbenchStore } from '@/stores/workbench'
import { useUiStore } from '@/stores/ui'
import type { FileReference } from '@/types'

type LayoutKind = 'single' | 'pair' | 'grid'
type AnnotationKind = 'box' | 'arrow' | 'text'
type CanvasTool = 'select' | AnnotationKind

interface Annotation {
  id: number
  kind: AnnotationKind
  x: number
  y: number
  text: string
  color: string
}

const store = useWorkbenchStore()
const ui = useUiStore()
const imageFiles = ref<File[]>([])
const images = ref<{ name: string; url: string }[]>([])
const layout = ref<LayoutKind>('single')
const title = ref('')
const watermark = ref('ToolKnit')
const background = ref('#172321')
const canvasTool = ref<CanvasTool>('select')
const annotationText = ref('重点')
const annotationColor = ref('#ffbf69')
const annotations = ref<Annotation[]>([])
const exporting = ref(false)
const copying = ref(false)
const lastOutput = ref<FileReference>()
const message = ref('导入图片后即可拼图、标注、复制或导出。')

const quickTools = [
  { id: 'convert', title: '格式转换', description: 'PNG / JPG / WebP', icon: 'image' },
  { id: 'resize', title: '压缩缩放', description: '尺寸与质量', icon: 'resize' },
  { id: 'crop', title: '裁剪图片', description: '精确裁切区域', icon: 'crop' },
  { id: 'rotate', title: '旋转图片', description: '批量调整方向', icon: 'rotate' }
] as const

const slots = computed(() => layout.value === 'single' ? 1 : layout.value === 'pair' ? 2 : 4)
const visibleImages = computed(() => images.value.slice(0, slots.value))

watch(imageFiles, (selected) => {
  images.value.forEach((item) => URL.revokeObjectURL(item.url))
  images.value = selected.slice(0, 4).map((file) => ({ name: file.name, url: URL.createObjectURL(file) }))
  annotations.value = []
  message.value = images.value.length ? `已载入 ${images.value.length} 张图片，可以直接编辑。` : '拖入图片开始创作。'
})

onBeforeUnmount(() => images.value.forEach((item) => URL.revokeObjectURL(item.url)))

function placeAnnotation(event: MouseEvent) {
  if (!images.value.length || canvasTool.value === 'select') return
  const target = event.currentTarget as HTMLElement
  const rect = target.getBoundingClientRect()
  const x = Math.max(.03, Math.min(.92, (event.clientX - rect.left) / rect.width))
  const y = Math.max(.06, Math.min(.91, (event.clientY - rect.top) / rect.height))
  annotations.value.push({ id: Date.now() + Math.random(), kind: canvasTool.value, x, y, text: annotationText.value.trim() || '重点', color: annotationColor.value })
  message.value = '标注已添加；点击标注可删除，或使用撤销。'
}

function removeAnnotation(id: number) {
  annotations.value = annotations.value.filter((item) => item.id !== id)
}

function undoAnnotation() {
  if (!annotations.value.length) return
  annotations.value = annotations.value.slice(0, -1)
  message.value = '已撤销上一个标注。'
}

function clearAnnotations() {
  annotations.value = []
  message.value = '已清空全部标注。'
}

function selectImages(event: Event) {
  imageFiles.value = Array.from((event.target as HTMLInputElement).files ?? [])
}

function drawAnnotation(ctx: CanvasRenderingContext2D, annotation: Annotation, canvasHeight: number) {
  const x = annotation.x * 1600
  const y = annotation.y * canvasHeight
  ctx.strokeStyle = annotation.color
  ctx.fillStyle = annotation.color
  ctx.lineWidth = 8
  ctx.lineJoin = 'round'
  if (annotation.kind === 'box') {
    ctx.strokeRect(x - 120, y - 78, 240, 156)
    return
  }
  if (annotation.kind === 'arrow') {
    ctx.beginPath(); ctx.moveTo(x - 145, y + 100); ctx.lineTo(x + 105, y - 70); ctx.stroke()
    ctx.beginPath(); ctx.moveTo(x + 105, y - 70); ctx.lineTo(x + 45, y - 62); ctx.lineTo(x + 82, y - 12); ctx.closePath(); ctx.fill()
    return
  }
  ctx.font = '700 34px "Noto Sans SC", sans-serif'
  ctx.fillText(annotation.text.slice(0, 26), x, y)
}

function drawCover(ctx: CanvasRenderingContext2D, image: HTMLImageElement, x: number, y: number, width: number, height: number) {
  const ratio = Math.max(width / image.naturalWidth, height / image.naturalHeight)
  const drawWidth = image.naturalWidth * ratio
  const drawHeight = image.naturalHeight * ratio
  ctx.drawImage(image, x + (width - drawWidth) / 2, y + (height - drawHeight) / 2, drawWidth, drawHeight)
}

async function renderCardBlob() {
  if (!images.value.length) throw new Error('请先导入至少一张图片。')
  const canvas = document.createElement('canvas')
  canvas.width = 1600
  canvas.height = layout.value === 'single' ? 1100 : 1200
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('浏览器不支持画布导出。')
  ctx.fillStyle = background.value
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  const loaded = await Promise.all(visibleImages.value.map((item) => new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image(); image.onload = () => resolve(image); image.onerror = reject; image.src = item.url
  })))
  const pad = 48
  const titleHeight = title.value.trim() ? 130 : 50
  const areaY = titleHeight
  const areaH = canvas.height - titleHeight - 48
  if (layout.value === 'single') drawCover(ctx, loaded[0], pad, areaY, canvas.width - pad * 2, areaH)
  else if (layout.value === 'pair') {
    const width = (canvas.width - pad * 3) / 2
    loaded.forEach((image, index) => drawCover(ctx, image, pad + index * (width + pad), areaY, width, areaH))
  } else {
    const width = (canvas.width - pad * 3) / 2
    const height = (areaH - pad) / 2
    loaded.forEach((image, index) => drawCover(ctx, image, pad + (index % 2) * (width + pad), areaY + Math.floor(index / 2) * (height + pad), width, height))
  }
  if (title.value.trim()) {
    ctx.fillStyle = '#f2f6f2'; ctx.font = '600 46px "Noto Sans SC", sans-serif'; ctx.fillText(title.value.trim().slice(0, 42), pad, 73)
  }
  annotations.value.forEach((annotation) => drawAnnotation(ctx, annotation, canvas.height))
  ctx.fillStyle = '#a7cdb9'; ctx.font = '500 20px ui-monospace, monospace'; ctx.textAlign = 'right'; ctx.fillText(watermark.value || 'ToolKnit', canvas.width - pad, canvas.height - 19)
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
    await copyPngToClipboard(await renderCardBlob())
    message.value = '图片已复制，可以直接粘贴发送。'
    ui.toast('图片已复制', '已写入系统剪贴板。', 'success')
  } catch (error) {
    ui.toast('复制失败', error instanceof Error ? error.message : '无法复制图片。', 'error')
  } finally { copying.value = false }
}

async function exportCard() {
  if (!await ensureOutputDirectory()) return
  exporting.value = true
  try {
    const blob = await renderCardBlob()
    const name = `toolknit-card-${Date.now()}.png`
    const output = await exportOutput(store.settings.outputDirectory, name, blob, 'image/png')
    lastOutput.value = output
    const job = store.addJob('image', '图片分享卡', images.value.map((item) => item.name), {
      toolId: 'visual-card', route: '/visual', retryable: true,
      inputs: imageFiles.value.map((file) => ({ name: file.name, size: file.size, mime: file.type, path: (file as File & { path?: string }).path })),
      parameters: { layout: layout.value, title: title.value, watermark: watermark.value, background: background.value }
    })
    store.updateJob(job.id, { status: 'succeeded', progress: 100, outputNames: [name], outputs: [output], detail: '已导出新的 PNG 分享卡。' })
    message.value = 'PNG 已导出，可从下方直接打开位置。'
    ui.toast('图片已导出', output.path || name, 'success', output.path ? '打开位置' : undefined, output.path ? () => openLocation(output.path) : undefined)
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
  <div class="visual-studio page-enter">
    <section class="section-heading visual-studio-heading">
      <div><p class="eyebrow">LOCAL IMAGE STUDIO</p><h2>处理、标注、拼图，<em>都在一个画布里。</em></h2><p>高频图片任务集中到图片工作室；底层处理仍然完全在本地完成。</p></div>
      <div class="visual-heading-actions"><button class="secondary-action" :disabled="copying || exporting" @click="copyCard"><AppIcon name="duplicate" :size="15"/>{{ copying ? '复制中…' : '复制图片' }}</button><button class="primary-button" :disabled="exporting || copying" @click="exportCard"><AppIcon name="image" :size="15"/>{{ exporting ? '导出中…' : '导出 PNG' }}</button></div>
    </section>

    <section class="visual-quick-tools" aria-labelledby="visual-quick-title">
      <header><div><p class="eyebrow">QUICK PROCESS</p><h3 id="visual-quick-title">常用图片处理</h3></div><RouterLink :to="{ path: '/tools', query: { group: 'image' } }">查看批处理 →</RouterLink></header>
      <div><RouterLink v-for="tool in quickTools" :key="tool.id" :to="{ path: '/tools', query: { group: 'image', operation: tool.id } }"><b><AppIcon :name="tool.icon" :size="17"/></b><span><strong>{{ tool.title }}</strong><small>{{ tool.description }}</small></span><i>→</i></RouterLink></div>
    </section>

    <section class="visual-studio-shell panel">
      <header class="visual-studio-toolbar">
        <details class="visual-import-menu">
          <summary><AppIcon name="file-image" :size="15"/><span>添加图片</span><small>{{ images.length ? `${images.length} 张已载入` : '拖入或选择' }}</small></summary>
          <div><FileDropZone v-model="imageFiles" accept="image/*" title="拖入图片" hint="最多使用前 4 张图片" @error="message=$event"/></div>
        </details>
        <div class="visual-layout-control"><span>布局</span><button :class="{ active: layout === 'single' }" @click="layout = 'single'">单图</button><button :class="{ active: layout === 'pair' }" @click="layout = 'pair'">双图</button><button :class="{ active: layout === 'grid' }" @click="layout = 'grid'">四宫格</button></div>
        <span class="visual-local-badge"><AppIcon name="shield" :size="13"/>本地画布 · {{ images.length }}/{{ slots }}</span>
      </header>

      <div class="visual-creative-workspace">
        <nav class="visual-tool-rail" aria-label="图片标注工具">
          <button :class="{ active: canvasTool === 'select' }" :aria-pressed="canvasTool === 'select'" title="查看模式" @click="canvasTool = 'select'"><AppIcon name="image" :size="17"/><span>查看</span></button>
          <button :class="{ active: canvasTool === 'box' }" :aria-pressed="canvasTool === 'box'" title="方框标注" @click="canvasTool = 'box'"><AppIcon name="crop" :size="17"/><span>方框</span></button>
          <button :class="{ active: canvasTool === 'arrow' }" :aria-pressed="canvasTool === 'arrow'" title="箭头标注" @click="canvasTool = 'arrow'"><AppIcon name="sort" :size="17"/><span>箭头</span></button>
          <button :class="{ active: canvasTool === 'text' }" :aria-pressed="canvasTool === 'text'" title="文字标注" @click="canvasTool = 'text'"><AppIcon name="file-text" :size="17"/><span>文字</span></button>
          <i></i>
          <button :disabled="!annotations.length" title="撤销标注" @click="undoAnnotation"><AppIcon name="rotate" :size="17"/><span>撤销</span></button>
          <button :disabled="!annotations.length" title="清空标注" @click="clearAnnotations"><AppIcon name="extract" :size="17"/><span>清空</span></button>
        </nav>

        <main class="visual-canvas-stage">
          <div class="visual-canvas-frame" :class="{ annotating: canvasTool !== 'select' }">
            <div v-if="images.length" class="visual-composition" :style="{ background }" @click="placeAnnotation">
              <h3 v-if="title">{{ title }}</h3>
              <div class="preview-images" :class="layout"><img v-for="item in visibleImages" :key="item.url" :src="item.url" :alt="item.name" /></div>
              <button v-for="annotation in annotations" :key="annotation.id" class="annotation-mark" :class="annotation.kind" :style="{ left: `${annotation.x * 100}%`, top: `${annotation.y * 100}%`, color: annotation.color, borderColor: annotation.color }" title="删除此标注" @click.stop="removeAnnotation(annotation.id)">{{ annotation.kind === 'arrow' ? '↗' : annotation.kind === 'text' ? annotation.text : '' }}</button>
              <small>{{ watermark || 'ToolKnit' }}</small>
            </div>
            <div v-else class="visual-canvas-empty"><b><AppIcon name="file-image" :size="25"/></b><strong>把图片拖进工作室</strong><span>支持单图、双图和四宫格，导入后可立即复制或导出。</span><label class="primary-button">选择图片<input class="visually-hidden" type="file" accept="image/*" multiple @change="selectImages" /></label></div>
          </div>
        </main>

        <aside class="visual-properties">
          <header><p class="eyebrow">PROPERTIES</p><strong>画面属性</strong></header>
          <label><span>标题</span><input v-model="title" placeholder="可选，例如：本周记录" /></label>
          <label><span>图片署名</span><input v-model="watermark" placeholder="ToolKnit" /></label>
          <label class="visual-color-field"><span>画布背景</span><input v-model="background" type="color" /><code>{{ background }}</code></label>
          <div class="visual-property-separator"></div>
          <label :class="{ disabled: canvasTool !== 'text' }"><span>标注文字</span><input v-model="annotationText" :disabled="canvasTool !== 'text'" /></label>
          <label class="visual-color-field" :class="{ disabled: canvasTool === 'select' }"><span>标注颜色</span><input v-model="annotationColor" type="color" :disabled="canvasTool === 'select'"/><code>{{ annotationColor }}</code></label>
          <p>选择方框、箭头或文字后，点击画布放置标注。</p>
          <div v-if="images.length" class="visual-source-thumbs"><img v-for="item in images" :key="item.url" :src="item.url" :alt="item.name" :title="item.name"/></div>
        </aside>
      </div>

      <footer class="visual-statusbar"><p role="status">{{ message }}</p><div><button class="quiet-button" :disabled="copying || exporting" @click="copyCard">复制图片</button><button class="primary-button" :disabled="exporting || copying" @click="exportCard">导出 PNG</button></div></footer>
    </section>

    <section v-if="lastOutput" class="visual-output-result panel"><span><b>刚刚导出</b><small>{{ lastOutput.path || lastOutput.name }}</small></span><button v-if="lastOutput.path" class="primary-button" @click="openLocation(lastOutput.path)">打开文件位置</button></section>
  </div>
</template>
