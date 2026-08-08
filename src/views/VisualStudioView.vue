<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
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
type ImageMode = 'compose' | 'convert' | 'resize' | 'crop' | 'rotate'

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
const route = useRoute()
const router = useRouter()
const imageFiles = ref<File[]>([])
const images = ref<{ name: string; url: string }[]>([])
const activeMode = ref<ImageMode>(['convert', 'resize', 'crop', 'rotate'].includes(String(route.query.tool)) ? route.query.tool as ImageMode : 'compose')
const layout = ref<LayoutKind>('single')
const title = ref('')
const watermark = ref('')
const background = ref('#172321')
const imageFormat = ref<'image/png' | 'image/jpeg' | 'image/webp'>('image/png')
const quality = ref(88)
const maxWidth = ref(1920)
const rotation = ref(90)
const cropLeft = ref(0)
const cropTop = ref(0)
const cropWidth = ref(100)
const cropHeight = ref(100)
const processedPreviewUrl = ref('')
const canvasTool = ref<CanvasTool>('select')
const annotationText = ref('重点')
const annotationColor = ref('#ffbf69')
const annotations = ref<Annotation[]>([])
const exporting = ref(false)
const copying = ref(false)
const lastOutputs = ref<FileReference[]>([])
const message = ref('导入图片后即可拼图、标注、复制或导出。')

const quickTools = [
  { id: 'compose', title: '拼图标注', description: '组合、标题与标注', icon: 'palette' },
  { id: 'convert', title: '格式转换', description: 'PNG / JPG / WebP', icon: 'image' },
  { id: 'resize', title: '压缩缩放', description: '尺寸与质量', icon: 'resize' },
  { id: 'crop', title: '裁剪图片', description: '精确裁切区域', icon: 'crop' },
  { id: 'rotate', title: '旋转图片', description: '批量调整方向', icon: 'rotate' }
] as const

const slots = computed(() => layout.value === 'single' ? 1 : layout.value === 'pair' ? 2 : 4)
const visibleImages = computed(() => images.value.slice(0, slots.value))
const activeTool = computed(() => quickTools.find((tool) => tool.id === activeMode.value) ?? quickTools[0])
const formatLabel = computed(() => imageFormat.value === 'image/jpeg' ? 'JPG' : imageFormat.value.split('/')[1].toUpperCase())
const processSummary = computed(() => activeMode.value === 'convert'
  ? `实时预览 · 输出 ${formatLabel.value}`
  : activeMode.value === 'resize'
    ? `最大宽度 ${maxWidth.value}px · 质量 ${quality.value}%`
    : activeMode.value === 'crop'
      ? `裁剪 ${cropWidth.value}% × ${cropHeight.value}% · 起点 ${cropLeft.value}%, ${cropTop.value}%`
      : activeMode.value === 'rotate' ? `顺时针 ${rotation.value}°` : '拼图、标题与标注')

watch(imageFiles, (selected) => {
  images.value.forEach((item) => URL.revokeObjectURL(item.url))
  images.value = selected.slice(0, 4).map((file) => ({ name: file.name, url: URL.createObjectURL(file) }))
  annotations.value = []
  message.value = images.value.length ? `已载入 ${images.value.length} 张图片，可以直接编辑。` : '拖入图片开始创作。'
})

watch(() => route.query.tool, (tool) => {
  activeMode.value = ['convert', 'resize', 'crop', 'rotate'].includes(String(tool)) ? tool as ImageMode : 'compose'
})

let previewVersion = 0
watch([() => imageFiles.value[0], activeMode, imageFormat, quality, maxWidth, rotation, cropLeft, cropTop, cropWidth, cropHeight], async ([file]) => {
  const version = ++previewVersion
  if (processedPreviewUrl.value) { URL.revokeObjectURL(processedPreviewUrl.value); processedPreviewUrl.value = '' }
  if (!(file instanceof File) || activeMode.value === 'compose') return
  try {
    const blob = await renderProcessedBlob(file)
    if (version !== previewVersion) return
    processedPreviewUrl.value = URL.createObjectURL(blob)
    message.value = `${activeTool.value.title}预览已更新；原图不会被修改。`
  } catch (error) {
    if (version === previewVersion) message.value = error instanceof Error ? error.message : '无法生成实时预览。'
  }
}, { immediate: true })

onBeforeUnmount(() => { images.value.forEach((item) => URL.revokeObjectURL(item.url)); if (processedPreviewUrl.value) URL.revokeObjectURL(processedPreviewUrl.value) })

function selectMode(mode: ImageMode) {
  activeMode.value = mode
  router.replace({ path: '/visual', query: mode === 'compose' ? {} : { tool: mode } })
}

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

async function renderProcessedBlob(file: File, outputType = imageFormat.value) {
  const bitmap = await createImageBitmap(file)
  const cropping = activeMode.value === 'crop'
  const left = cropping ? Math.round(bitmap.width * cropLeft.value / 100) : 0
  const top = cropping ? Math.round(bitmap.height * cropTop.value / 100) : 0
  const sourceWidth = cropping ? Math.round(bitmap.width * cropWidth.value / 100) : bitmap.width
  const sourceHeight = cropping ? Math.round(bitmap.height * cropHeight.value / 100) : bitmap.height
  if (left < 0 || top < 0 || sourceWidth < 1 || sourceHeight < 1 || left + sourceWidth > bitmap.width || top + sourceHeight > bitmap.height) {
    bitmap.close()
    throw new Error('裁剪区域超出图片，请调整起点或宽高。')
  }
  const targetWidth = activeMode.value === 'resize' ? Math.min(sourceWidth, Math.max(100, maxWidth.value)) : sourceWidth
  const targetHeight = Math.max(1, Math.round(sourceHeight * targetWidth / sourceWidth))
  const turn = activeMode.value === 'rotate' ? rotation.value : 0
  const sideways = turn % 180 !== 0
  const canvas = document.createElement('canvas')
  canvas.width = sideways ? targetHeight : targetWidth
  canvas.height = sideways ? targetWidth : targetHeight
  const context = canvas.getContext('2d')
  if (!context) { bitmap.close(); throw new Error('浏览器不支持图片画布。') }
  if (outputType === 'image/jpeg') { context.fillStyle = '#ffffff'; context.fillRect(0, 0, canvas.width, canvas.height) }
  context.translate(canvas.width / 2, canvas.height / 2)
  context.rotate(turn * Math.PI / 180)
  context.drawImage(bitmap, left, top, sourceWidth, sourceHeight, -targetWidth / 2, -targetHeight / 2, targetWidth, targetHeight)
  bitmap.close()
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, outputType, quality.value / 100))
  if (!blob) throw new Error(`无法处理“${file.name}”。`)
  return blob
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
  if (watermark.value.trim()) { ctx.fillStyle = '#a7cdb9'; ctx.font = '500 20px ui-monospace, monospace'; ctx.textAlign = 'right'; ctx.fillText(watermark.value.trim(), canvas.width - pad, canvas.height - 19) }
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
    if (!imageFiles.value.length) throw new Error('请先导入至少一张图片。')
    const blob = activeMode.value === 'compose' ? await renderCardBlob() : await renderProcessedBlob(imageFiles.value[0], 'image/png')
    await copyPngToClipboard(blob)
    message.value = '图片已复制，可以直接粘贴发送。'
    ui.toast('当前预览已复制', activeMode.value === 'compose' ? '分享画布已写入系统剪贴板。' : `${activeTool.value.title}结果已写入系统剪贴板。`, 'success')
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
    } else {
      const extension = imageFormat.value === 'image/jpeg' ? 'jpg' : imageFormat.value.split('/')[1]
      for (const file of imageFiles.value) {
        const stem = file.name.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9_\-\u4e00-\u9fff]+/g, '-') || 'image'
        outputs.push(await exportOutput(store.settings.outputDirectory, `${stem}-${activeMode.value}.${extension}`, await renderProcessedBlob(file), imageFormat.value))
      }
    }
    lastOutputs.value = outputs
    const job = store.addJob('image', activeMode.value === 'compose' ? '图片分享卡' : activeTool.value.title, images.value.map((item) => item.name), {
      toolId: `visual-${activeMode.value}`, route: `/visual${activeMode.value === 'compose' ? '' : `?tool=${activeMode.value}`}`, retryable: true,
      inputs: imageFiles.value.map((file) => ({ name: file.name, size: file.size, mime: file.type, path: (file as File & { path?: string }).path })),
      parameters: { mode: activeMode.value, layout: layout.value, title: title.value, watermark: watermark.value, background: background.value, imageFormat: imageFormat.value, quality: quality.value, maxWidth: maxWidth.value, rotation: rotation.value, cropLeft: cropLeft.value, cropTop: cropTop.value, cropWidth: cropWidth.value, cropHeight: cropHeight.value }
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
  <div class="visual-studio page-enter">
    <section class="section-heading visual-studio-heading">
      <div><p class="eyebrow">LOCAL IMAGE STUDIO</p><h2>处理、标注、拼图，<em>都在一个画布里。</em></h2><p>高频图片任务集中到图片工作室；底层处理仍然完全在本地完成。</p></div>
      <div class="visual-heading-actions"><button class="secondary-action" :disabled="copying || exporting || !images.length" @click="copyCard"><AppIcon name="duplicate" :size="15"/>{{ copying ? '复制中…' : '复制当前预览' }}</button><button class="primary-button" :disabled="exporting || copying || !images.length" @click="exportCard"><AppIcon name="image" :size="15"/>{{ exporting ? '导出中…' : `导出 ${activeMode === 'compose' ? 'PNG' : formatLabel}` }}</button></div>
    </section>

    <section class="visual-quick-tools" aria-labelledby="visual-quick-title">
      <header><div><p class="eyebrow">ALL-IN-ONE IMAGE FLOW</p><h3 id="visual-quick-title">所有图片能力都在当前画布</h3></div><small>选择功能后，参数变化立即更新预览</small></header>
      <div><button v-for="tool in quickTools" :key="tool.id" :class="{ active: activeMode === tool.id }" @click="selectMode(tool.id)"><b><AppIcon :name="tool.icon" :size="17"/></b><span><strong>{{ tool.title }}</strong><small>{{ tool.description }}</small></span><i>{{ activeMode === tool.id ? '●' : '→' }}</i></button></div>
    </section>

    <section class="visual-studio-shell panel">
      <header class="visual-studio-toolbar">
        <details class="visual-import-menu">
          <summary><AppIcon name="file-image" :size="15"/><span>添加图片</span><small>{{ images.length ? `${images.length} 张已载入` : '拖入或选择' }}</small></summary>
          <div><FileDropZone v-model="imageFiles" accept="image/*" title="拖入图片" hint="最多使用前 4 张图片" @error="message=$event"/></div>
        </details>
        <div v-if="activeMode === 'compose'" class="visual-layout-control"><span>布局</span><button :class="{ active: layout === 'single' }" @click="layout = 'single'">单图</button><button :class="{ active: layout === 'pair' }" @click="layout = 'pair'">双图</button><button :class="{ active: layout === 'grid' }" @click="layout = 'grid'">四宫格</button></div>
        <strong v-else class="visual-active-operation"><AppIcon :name="activeTool.icon" :size="14"/>{{ activeTool.title }}<small>{{ processSummary }}</small></strong>
        <span class="visual-local-badge"><AppIcon name="shield" :size="13"/>本地实时预览 · {{ images.length }} 张</span>
      </header>

      <div class="visual-creative-workspace" :class="{ 'process-mode': activeMode !== 'compose' }">
        <nav v-if="activeMode === 'compose'" class="visual-tool-rail" aria-label="图片标注工具">
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
            <div v-if="images.length && activeMode === 'compose'" class="visual-composition" :style="{ background }" @click="placeAnnotation">
              <h3 v-if="title">{{ title }}</h3>
              <div class="preview-images" :class="layout"><img v-for="item in visibleImages" :key="item.url" :src="item.url" :alt="item.name" /></div>
              <button v-for="annotation in annotations" :key="annotation.id" class="annotation-mark" :class="annotation.kind" :style="{ left: `${annotation.x * 100}%`, top: `${annotation.y * 100}%`, color: annotation.color, borderColor: annotation.color }" title="删除此标注" @click.stop="removeAnnotation(annotation.id)">{{ annotation.kind === 'arrow' ? '↗' : annotation.kind === 'text' ? annotation.text : '' }}</button>
              <small v-if="watermark">{{ watermark }}</small>
            </div>
            <div v-else-if="images.length" class="visual-process-preview">
              <header><span>处理后预览</span><small>{{ processSummary }}</small></header>
              <div><img :src="processedPreviewUrl || images[0].url" :alt="`${activeTool.title}实时预览`" /></div>
              <footer><b>{{ images[0].name }}</b><span>{{ formatLabel }} · 原文件保持不变</span></footer>
            </div>
            <div v-else class="visual-canvas-empty"><b><AppIcon name="file-image" :size="25"/></b><strong>把图片拖进工作室</strong><span>支持单图、双图和四宫格，导入后可立即复制或导出。</span><label class="primary-button">选择图片<input class="visually-hidden" type="file" accept="image/*" multiple @change="selectImages" /></label></div>
          </div>
        </main>

        <aside class="visual-properties">
          <header><p class="eyebrow">LIVE PROPERTIES</p><strong>{{ activeMode === 'compose' ? '画面属性' : activeTool.title }}</strong></header>
          <template v-if="activeMode === 'compose'">
            <label><span>标题</span><input v-model="title" placeholder="可选，例如：本周记录" /></label>
            <label><span>图片署名</span><input v-model="watermark" placeholder="可选，不默认添加品牌" /></label>
            <label class="visual-color-field"><span>画布背景</span><input v-model="background" type="color" /><code>{{ background }}</code></label>
            <div class="visual-property-separator"></div>
            <label :class="{ disabled: canvasTool !== 'text' }"><span>标注文字</span><input v-model="annotationText" :disabled="canvasTool !== 'text'" /></label>
            <label class="visual-color-field" :class="{ disabled: canvasTool === 'select' }"><span>标注颜色</span><input v-model="annotationColor" type="color" :disabled="canvasTool === 'select'"/><code>{{ annotationColor }}</code></label>
            <p>选择方框、箭头或文字后，点击画布放置标注。</p>
          </template>
          <template v-else>
            <label><span>输出格式</span><select v-model="imageFormat"><option value="image/png">PNG</option><option value="image/jpeg">JPG</option><option value="image/webp">WebP</option></select></label>
            <label v-if="activeMode === 'resize'"><span>最大宽度</span><input v-model.number="maxWidth" type="number" min="100" max="7680"/><small>{{ maxWidth }} px</small></label>
            <label v-if="activeMode === 'resize' || activeMode === 'convert'"><span>输出质量</span><input v-model.number="quality" type="range" min="20" max="100"/><small>{{ quality }}%</small></label>
            <template v-if="activeMode === 'crop'">
              <label><span>左侧起点</span><input v-model.number="cropLeft" type="range" min="0" :max="100-cropWidth"/><small>{{ cropLeft }}%</small></label>
              <label><span>顶部起点</span><input v-model.number="cropTop" type="range" min="0" :max="100-cropHeight"/><small>{{ cropTop }}%</small></label>
              <label><span>裁剪宽度</span><input v-model.number="cropWidth" type="range" min="5" :max="100-cropLeft"/><small>{{ cropWidth }}%</small></label>
              <label><span>裁剪高度</span><input v-model.number="cropHeight" type="range" min="5" :max="100-cropTop"/><small>{{ cropHeight }}%</small></label>
            </template>
            <label v-if="activeMode === 'rotate'"><span>旋转角度</span><select v-model.number="rotation"><option :value="90">顺时针 90°</option><option :value="180">180°</option><option :value="270">顺时针 270°</option></select></label>
            <p>参数改变后会重新生成第一张图片的真实处理预览；导出时批量应用到全部图片。</p>
          </template>
          <div v-if="images.length" class="visual-source-thumbs"><img v-for="item in images" :key="item.url" :src="item.url" :alt="item.name" :title="item.name"/></div>
        </aside>
      </div>

      <footer class="visual-statusbar"><p role="status">{{ message }}</p><div><button class="quiet-button" :disabled="copying || exporting || !images.length" @click="copyCard">复制当前预览</button><button class="primary-button" :disabled="exporting || copying || !images.length" @click="exportCard">导出{{ images.length > 1 && activeMode !== 'compose' ? `全部 ${images.length} 张` : '' }}</button></div></footer>
    </section>

    <section v-if="lastOutputs.length" class="visual-output-result panel"><span><b>刚刚导出 {{ lastOutputs.length }} 个文件</b><small>{{ lastOutputs.map(output => output.name).join(' · ') }}</small></span><button v-if="lastOutputs[0]?.path" class="primary-button" @click="openLocation(lastOutputs[0].path)">打开文件位置</button></section>
  </div>
</template>
