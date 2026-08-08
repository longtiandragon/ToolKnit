<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { PDFDocument, StandardFonts, degrees, rgb } from 'pdf-lib'
import * as pdfjs from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.mjs?url'
import { useWorkbenchStore } from '@/stores/workbench'
import { useUiStore } from '@/stores/ui'
import type { FileReference, ToolRecipe } from '@/types'
import { buildRenamePreview, cleanOutputName, parsePageIndexes, transformText } from '@/lib/file-tools'
import { chooseOutputDirectory, exportOutput } from '@/lib/output'
import { isDesktop } from '@/lib/native'
import AppIcon from '@/components/AppIcon.vue'
import FileDropZone from '@/components/FileDropZone.vue'

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

type ToolGroup = 'pdf' | 'image' | 'text' | 'organize'
type ToolOption = [id: string, label: string]

const store = useWorkbenchStore()
const ui = useUiStore()
const route = useRoute()
const router = useRouter()
const group = ref<ToolGroup>('pdf')
const operation = ref('merge')
const files = ref<File[]>([])
const input = ref<HTMLInputElement>()
const running = ref(false)
const message = ref('选择工具和文件后，会先显示本次任务的输入与输出。')
const outputName = ref('toolknit-output')
const pageRange = ref('1')
const rotation = ref(90)
const watermarkText = ref('CONFIDENTIAL')
const watermarkOpacity = ref(18)
const watermarkColor = ref('#536b62')
const pageNumberStart = ref(1)
const pageNumberPosition = ref<'bottom-center' | 'bottom-right'>('bottom-center')
const imageFormat = ref<'image/png' | 'image/jpeg' | 'image/webp'>('image/png')
const cropLeft = ref(0)
const cropTop = ref(0)
const cropWidth = ref(100)
const cropHeight = ref(100)
const maxWidth = ref(1920)
const quality = ref(88)
const textInput = ref('')
const textMode = ref<'json' | 'trim' | 'markdown'>('json')
const renamePrefix = ref('整理文件')
const recipeTitle = ref('')
const activeRecipeId = ref<string>()

const groups: [ToolGroup, string, string, string][] = [
  ['pdf', 'file-pdf', 'PDF', '合并、拆页、旋转、提取页面'],
  ['text', 'file-text', '文本', 'JSON 格式化与文本清理'],
  ['organize', 'sort', '整理', '命名预览与哈希去重报告']
]

const operationMap: Record<ToolGroup, ToolOption[]> = {
  pdf: [['merge', '合并 PDF'], ['split', '按页拆分'], ['rotate', '旋转 PDF'], ['extract', '提取指定页'], ['reorder', '重排页面'], ['watermark', '添加水印'], ['page-number', '添加页码'], ['images-to-pdf', '图片转 PDF'], ['text', '提取文本']],
  image: [['convert', '转换图片'], ['resize', '缩放并压缩'], ['crop', '裁剪图片'], ['rotate', '旋转图片']],
  text: [['transform', '文本转换']],
  organize: [['rename-report', '命名预览'], ['dedupe-report', '哈希去重报告']]
}

const operations = computed(() => operationMap[group.value])
const accept = computed(() => group.value === 'pdf' && operation.value !== 'images-to-pdf'
  ? '.pdf,application/pdf'
  : group.value === 'pdf'
    ? 'image/*'
    : group.value === 'image'
      ? 'image/*'
      : group.value === 'text'
        ? '.txt,.md,.json,.js,.ts,.py,.java,.csv,text/*,application/json'
        : '*/*')
const hasParameters = computed(() => group.value !== 'pdf' || ['extract', 'reorder', 'watermark', 'page-number', 'rotate', 'split', 'text'].includes(operation.value))
const usesOutputName = computed(() => group.value === 'text' || group.value === 'organize' || (group.value === 'pdf' && ['merge', 'images-to-pdf'].includes(operation.value)))
const canRun = computed(() => !running.value && (files.value.length > 0 || (group.value === 'text' && textInput.value.trim().length > 0)))
const outputHint = computed(() => {
  if (!files.value.length && !(group.value === 'text' && textInput.value.trim())) return '等待输入内容'
  if (group.value === 'pdf' && operation.value === 'split') return `将把 ${files.value.length} 份 PDF 拆成独立页面`
  if (group.value === 'organize') return '仅生成预览报告，不修改原文件'
  return `将为 ${Math.max(files.value.length, 1)} 个输入生成新输出`
})

function clearFiles() {
  files.value = []
  if (input.value) input.value.value = ''
}

function setGroup(next: ToolGroup) {
  group.value = next
  operation.value = operationMap[next][0][0]
  activeRecipeId.value = undefined
  clearFiles()
  message.value = '已切换工具。请选择本次输入。'
}

function setOperation(next: string) {
  operation.value = next
  clearFiles()
  message.value = '已切换操作。请重新选择符合要求的输入。'
}

function choose(event: Event) {
  files.value = Array.from((event.target as HTMLInputElement).files ?? [])
  message.value = files.value.length ? `已选择 ${files.value.length} 个输入文件。原件不会被修改。` : '未选择文件。'
}

function dropFiles(event: DragEvent) {
  files.value = Array.from(event.dataTransfer?.files ?? [])
  message.value = files.value.length ? `已拖入 ${files.value.length} 个文件。执行前请核对参数。` : '没有读取到文件。'
}

function recipeParameters() {
  return {
    outputName: outputName.value, pageRange: pageRange.value, rotation: rotation.value,
    imageFormat: imageFormat.value, cropLeft: cropLeft.value, cropTop: cropTop.value,
    cropWidth: cropWidth.value, cropHeight: cropHeight.value, maxWidth: maxWidth.value,
    quality: quality.value, watermarkText: watermarkText.value, watermarkOpacity: watermarkOpacity.value,
    watermarkColor: watermarkColor.value, pageNumberStart: pageNumberStart.value,
    pageNumberPosition: pageNumberPosition.value, textMode: textMode.value, renamePrefix: renamePrefix.value
  }
}

function applyRecipe(recipe: ToolRecipe) {
  group.value = recipe.group
  operation.value = recipe.operation
  const params = recipe.parameters
  outputName.value = String(params.outputName ?? outputName.value)
  pageRange.value = String(params.pageRange ?? pageRange.value)
  rotation.value = Number(params.rotation ?? rotation.value)
  imageFormat.value = params.imageFormat === 'image/jpeg' || params.imageFormat === 'image/webp' || params.imageFormat === 'image/png' ? params.imageFormat : imageFormat.value
  cropLeft.value = Number(params.cropLeft ?? cropLeft.value)
  cropTop.value = Number(params.cropTop ?? cropTop.value)
  cropWidth.value = Number(params.cropWidth ?? cropWidth.value)
  cropHeight.value = Number(params.cropHeight ?? cropHeight.value)
  maxWidth.value = Number(params.maxWidth ?? maxWidth.value)
  quality.value = Number(params.quality ?? quality.value)
  watermarkText.value = String(params.watermarkText ?? watermarkText.value)
  watermarkOpacity.value = Number(params.watermarkOpacity ?? watermarkOpacity.value)
  watermarkColor.value = String(params.watermarkColor ?? watermarkColor.value)
  pageNumberStart.value = Number(params.pageNumberStart ?? pageNumberStart.value)
  pageNumberPosition.value = params.pageNumberPosition === 'bottom-right' ? 'bottom-right' : 'bottom-center'
  textMode.value = params.textMode === 'trim' || params.textMode === 'markdown' || params.textMode === 'json' ? params.textMode : textMode.value
  renamePrefix.value = String(params.renamePrefix ?? renamePrefix.value)
  recipeTitle.value = recipe.title
  activeRecipeId.value = recipe.id
  clearFiles()
  message.value = `已载入配方“${recipe.title}”。请选择本次输入文件。`
}

function saveCurrentRecipe() {
  const groupLabel = groups.find((item) => item[0] === group.value)?.[1] ?? '工具'
  const operationLabel = operations.value.find((item) => item[0] === operation.value)?.[1] ?? '操作'
  const title = recipeTitle.value.trim() || `${groupLabel} · ${operationLabel}`
  const recipe = store.saveRecipe({ title, group: group.value, operation: operation.value, parameters: recipeParameters() })
  recipeTitle.value = recipe.title
  activeRecipeId.value = recipe.id
  message.value = `已保存配方“${recipe.title}”。配方不会保存文件路径或内容。`
}

watch(() => route.query, (query) => {
  if (query.group === 'image') {
    router.replace({ path: '/visual', query: { tool: typeof query.operation === 'string' ? query.operation : 'convert' } })
    return
  }
  const replayId = typeof query.replay === 'string' ? query.replay : undefined
  if (replayId) {
    const job = store.jobs.find((item) => item.id === replayId)
    if (job?.parameters && job.toolId) {
      const [nextGroup, ...parts] = job.toolId.split(':')
      if (nextGroup === 'image') { router.replace({ path: '/visual', query: { tool: parts.join(':') || 'convert' } }); return }
      if (nextGroup in operationMap) applyRecipe({ id: `replay-${job.id}`, title: `上次参数 · ${job.label}`, group: nextGroup as ToolGroup, operation: parts.join(':'), parameters: job.parameters as ToolRecipe['parameters'], createdAt: job.createdAt })
      message.value = '已恢复上次参数。为保护隐私，请重新选择输入文件。'
      return
    }
  }
  const recipeId = typeof query.recipe === 'string' ? query.recipe : undefined
  if (recipeId) {
    if (recipeId === activeRecipeId.value) return
    const recipe = store.recipes.find((item) => item.id === recipeId)
    if (recipe?.group === 'image') { router.replace({ path: '/visual', query: { tool: recipe.operation } }); return }
    if (recipe) applyRecipe(recipe)
    return
  }

  const requestedGroup = typeof query.group === 'string' && query.group in operationMap ? query.group as ToolGroup : 'pdf'
  const requestedOperation = typeof query.operation === 'string' && operationMap[requestedGroup].some(([id]) => id === query.operation)
    ? query.operation
    : operationMap[requestedGroup][0][0]
  group.value = requestedGroup
  operation.value = requestedOperation
  if (query.mode === 'json' || query.mode === 'trim' || query.mode === 'markdown') textMode.value = query.mode
  activeRecipeId.value = undefined
  clearFiles()
  message.value = typeof query.group === 'string' ? `已打开“${operations.value.find(([id]) => id === operation.value)?.[1]}”。请选择输入。` : '选择工具和文件后，会先显示本次任务的输入与输出。'
}, { immediate: true })

function bytes(data: Uint8Array) {
  return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer
}

async function save(name: string, data: Blob | ArrayBuffer | Uint8Array | string, type: string) { return exportOutput(store.settings.outputDirectory, name, data, type) }

async function imageToBlob(file: File) {
  const bitmap = await createImageBitmap(file)
  const left = operation.value === 'crop' ? Math.round(bitmap.width * cropLeft.value / 100) : 0
  const top = operation.value === 'crop' ? Math.round(bitmap.height * cropTop.value / 100) : 0
  const sourceWidth = operation.value === 'crop' ? Math.round(bitmap.width * cropWidth.value / 100) : bitmap.width
  const sourceHeight = operation.value === 'crop' ? Math.round(bitmap.height * cropHeight.value / 100) : bitmap.height
  if (left < 0 || top < 0 || sourceWidth < 1 || sourceHeight < 1 || left + sourceWidth > bitmap.width || top + sourceHeight > bitmap.height) {
    bitmap.close()
    throw new Error('裁剪区域无效，请确认左上角与宽高百分比不超出图片。')
  }
  const width = Math.min(sourceWidth, Math.max(1, maxWidth.value))
  const height = Math.round(sourceHeight * (width / sourceWidth))
  const turn = operation.value === 'rotate' ? rotation.value : 0
  const sideways = turn % 180 !== 0
  const canvas = document.createElement('canvas')
  canvas.width = sideways ? height : width
  canvas.height = sideways ? width : height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('浏览器不支持图片处理。')
  context.translate(canvas.width / 2, canvas.height / 2)
  context.rotate(turn * Math.PI / 180)
  context.drawImage(bitmap, left, top, sourceWidth, sourceHeight, -width / 2, -height / 2, width, height)
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, imageFormat.value, quality.value / 100))
  bitmap.close()
  if (!blob) throw new Error(`无法转换“${file.name}”。`)
  return blob
}

async function imageToPng(file: File) {
  const bitmap = await createImageBitmap(file)
  const canvas = document.createElement('canvas')
  canvas.width = bitmap.width
  canvas.height = bitmap.height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('浏览器不支持图片转 PDF。')
  context.drawImage(bitmap, 0, 0)
  bitmap.close()
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
  if (!blob) throw new Error(`无法读取“${file.name}”。`)
  return { data: await blob.arrayBuffer(), width: canvas.width, height: canvas.height }
}

async function makeWatermarkPng(text: string, color: string) {
  const canvas = document.createElement('canvas')
  canvas.width = 1600
  canvas.height = 300
  const context = canvas.getContext('2d')
  if (!context) throw new Error('浏览器不支持水印绘制。')
  context.fillStyle = color
  context.font = '700 112px "Microsoft YaHei", "Noto Sans SC", sans-serif'
  context.textAlign = 'center'
  context.textBaseline = 'middle'
  context.fillText(text.slice(0, 34), canvas.width / 2, canvas.height / 2)
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
  if (!blob) throw new Error('无法生成水印图层。')
  return blob.arrayBuffer()
}

async function extractPdfText(file: File) {
  const document = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise
  const pages: string[] = []
  for (let pageIndex = 1; pageIndex <= document.numPages; pageIndex += 1) {
    const page = await document.getPage(pageIndex)
    const content = await page.getTextContent()
    const line = content.items.map((item: any) => typeof item.str === 'string' ? item.str : '').join(' ').replace(/\s+/g, ' ').trim()
    pages.push(`--- 第 ${pageIndex} 页 ---\n${line}`)
  }
  const output = pages.join('\n\n')
  if (!output.replace(/--- 第 \d+ 页 ---/g, '').trim()) throw new Error(`“${file.name}”没有可提取文字。它可能是扫描件，请等待 OCR 引擎接入。`)
  return output
}

async function runPdf() {
  if (operation.value === 'images-to-pdf') {
    const images = files.value.filter((file) => file.type.startsWith('image/'))
    if (!images.length) throw new Error('请选择至少一张图片。')
    const output = await PDFDocument.create()
    for (const file of images) {
      const image = await imageToPng(file)
      const embedded = await output.embedPng(image.data)
      const page = output.addPage([image.width, image.height])
      page.drawImage(embedded, { x: 0, y: 0, width: image.width, height: image.height })
    }
    const name = `${outputName.value || 'toolknit'}-images.pdf`
    return [await save(name, bytes(await output.save()), 'application/pdf')]
  }

  const pdfs = files.value.filter((file) => file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf'))
  if (!pdfs.length) throw new Error('请选择至少一份 PDF。')
  if (operation.value === 'merge') {
    const output = await PDFDocument.create()
    for (const file of pdfs) {
      const source = await PDFDocument.load(await file.arrayBuffer())
      const pages = await output.copyPages(source, source.getPageIndices())
      pages.forEach((page) => output.addPage(page))
    }
    const name = `${outputName.value || 'toolknit'}-merged.pdf`
    return [await save(name, bytes(await output.save()), 'application/pdf')]
  }
  if (operation.value === 'split') {
    const outputs: FileReference[] = []
    for (const file of pdfs) {
      const source = await PDFDocument.load(await file.arrayBuffer())
      for (const index of source.getPageIndices()) {
        const output = await PDFDocument.create()
        const [page] = await output.copyPages(source, [index])
        output.addPage(page)
        const name = `${cleanOutputName(file.name)}-p${index + 1}.pdf`
        outputs.push(await save(name, bytes(await output.save()), 'application/pdf'))
      }
    }
    return outputs
  }
  if (operation.value === 'rotate') {
    const outputs: FileReference[] = []
    for (const file of pdfs) {
      const source = await PDFDocument.load(await file.arrayBuffer())
      source.getPages().forEach((page) => page.setRotation(degrees((page.getRotation().angle + rotation.value) % 360)))
      const name = `${cleanOutputName(file.name)}-rotated.pdf`
      outputs.push(await save(name, bytes(await source.save()), 'application/pdf'))
    }
    return outputs
  }
  if (operation.value === 'page-number') {
    const outputs: FileReference[] = []
    for (const file of pdfs) {
      const source = await PDFDocument.load(await file.arrayBuffer())
      const font = await source.embedFont(StandardFonts.Helvetica)
      source.getPages().forEach((page, index) => {
        const { width } = page.getSize()
        const number = String(pageNumberStart.value + index)
        const size = 11
        const textWidth = font.widthOfTextAtSize(number, size)
        page.drawText(number, { x: pageNumberPosition.value === 'bottom-right' ? width - textWidth - 30 : (width - textWidth) / 2, y: 18, size, font, color: rgb(.32, .37, .35), opacity: .9 })
      })
      const name = `${cleanOutputName(file.name)}-numbered.pdf`
      outputs.push(await save(name, bytes(await source.save()), 'application/pdf'))
    }
    return outputs
  }
  if (operation.value === 'watermark') {
    const outputs: FileReference[] = []
    const text = watermarkText.value.trim()
    if (!text) throw new Error('请输入水印文字。')
    const watermark = await makeWatermarkPng(text, watermarkColor.value)
    for (const file of pdfs) {
      const source = await PDFDocument.load(await file.arrayBuffer())
      const image = await source.embedPng(watermark)
      source.getPages().forEach((page) => {
        const { width, height } = page.getSize()
        const ratio = Math.min(width * .78 / image.width, height * .24 / image.height)
        const drawWidth = image.width * ratio
        const drawHeight = image.height * ratio
        page.drawImage(image, { x: (width - drawWidth) / 2, y: (height - drawHeight) / 2, width: drawWidth, height: drawHeight, opacity: Math.max(.03, Math.min(1, watermarkOpacity.value / 100)), rotate: degrees(rotation.value) })
      })
      const name = `${cleanOutputName(file.name)}-watermarked.pdf`
      outputs.push(await save(name, bytes(await source.save()), 'application/pdf'))
    }
    return outputs
  }
  if (operation.value === 'text') {
    const outputs: FileReference[] = []
    for (const file of pdfs) {
      const name = `${cleanOutputName(file.name)}-text.txt`
      outputs.push(await save(name, await extractPdfText(file), 'text/plain;charset=utf-8'))
    }
    return outputs
  }

  const source = await PDFDocument.load(await pdfs[0].arrayBuffer())
  const indexes = parsePageIndexes(pageRange.value, source.getPageCount())
  const output = await PDFDocument.create()
  const pages = await output.copyPages(source, indexes)
  pages.forEach((page) => output.addPage(page))
  const suffix = operation.value === 'reorder' ? 'reordered' : 'extract'
  const name = `${cleanOutputName(pdfs[0].name)}-${suffix}.pdf`
  return [await save(name, bytes(await output.save()), 'application/pdf')]
}

async function runImage() {
  const inputs = files.value.filter((file) => file.type.startsWith('image/'))
  if (!inputs.length) throw new Error('请选择至少一张图片。')
  const extension = imageFormat.value === 'image/jpeg' ? 'jpg' : imageFormat.value.split('/')[1]
  const outputs: FileReference[] = []
  for (const file of inputs) {
    const blob = await imageToBlob(file)
    const name = `${cleanOutputName(file.name)}-toolknit.${extension}`
    outputs.push(await save(name, blob, imageFormat.value))
  }
  return outputs
}

async function runText() {
  const raw = textInput.value || (files.value[0] ? await files.value[0].text() : '')
  const result = transformText(raw, textMode.value)
  const name = `${outputName.value || 'toolknit'}-clean.${result.extension}`
  return [await save(name, result.content, `text/${result.extension};charset=utf-8`)]
}

async function runOrganize() {
  if (!files.value.length) throw new Error('请选择至少一个文件。')
  if (operation.value === 'rename-report') {
    const lines = buildRenamePreview(files.value.map((file) => file.name), renamePrefix.value)
    const name = `${outputName.value || 'toolknit'}-rename-preview.txt`
    return [await save(name, lines.join('\n'), 'text/plain;charset=utf-8')]
  }
  const map = new Map<string, string[]>()
  for (const file of files.value) {
    const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await file.arrayBuffer()))).map((value) => value.toString(16).padStart(2, '0')).join('')
    map.set(digest, [...(map.get(digest) ?? []), file.name])
  }
  const duplicates = [...map.values()].filter((items) => items.length > 1)
  const name = `${outputName.value || 'toolknit'}-dedupe-report.txt`
  return [await save(name, duplicates.length ? duplicates.map((items) => items.join('  =  ')).join('\n') : '未发现重复文件。', 'text/plain;charset=utf-8')]
}

async function run() {
  if (!canRun.value) {
    message.value = '请先选择文件或输入文本。'
    return
  }
  if (isDesktop() && !store.settings.outputDirectory) {
    const directory = await chooseOutputDirectory()
    if (!directory) { message.value = '已取消：需要先选择默认输出目录。'; return }
    store.updateSettings({ outputDirectory: directory })
  }
  running.value = true
  const kind = group.value as 'pdf' | 'image' | 'text' | 'archive'
  const label = `${groups.find((item) => item[0] === group.value)?.[1]} · ${operations.value.find((item) => item[0] === operation.value)?.[1]}`
  const toolId = `${group.value}:${operation.value}`
  const inputs: FileReference[] = files.value.map((file) => ({ name:file.name, size:file.size, mime:file.type, path:(file as File & { path?:string }).path }))
  const job = store.addJob(kind, label, files.value.map((file) => file.name), { toolId, route:'/tools', parameters:recipeParameters(), inputs, retryable:true })
  store.updateJob(job.id, { status: 'running', progress: 15, detail: '正在准备输入文件…' })
  try {
    const outputs = group.value === 'pdf' ? await runPdf() : group.value === 'image' ? await runImage() : group.value === 'text' ? await runText() : await runOrganize()
    const outputNames = outputs.map((item) => item.name)
    store.updateJob(job.id, { status: 'succeeded', progress: 100, outputNames, outputs, detail: '已生成新输出，原文件未修改。' })
    if (activeRecipeId.value) store.touchRecipe(activeRecipeId.value)
    message.value = `任务完成：已生成 ${outputNames.length} 个输出文件。`
    ui.toast('任务已完成', `${label} · ${outputNames.length} 个输出`, 'success', '查看历史', () => location.hash = '#/history')
  } catch (error) {
    const detail = error instanceof Error ? error.message : '工具执行失败。'
    store.updateJob(job.id, { status: 'failed', progress: 100, errorCode: 'TOOL_EXECUTION_FAILED', detail })
    message.value = detail
    ui.toast('处理失败', detail, 'error')
  } finally {
    running.value = false
  }
}
</script>

<template>
  <div class="tool-center page-enter">
    <section class="page-heading tool-heading">
      <div>
        <p class="eyebrow">FILE PROCESSING CENTER</p>
        <h2>选择一个工具，<em>完成一件事情。</em></h2>
        <p>输入、参数和输出集中在同一条任务流中；所有正式工具都生成新文件。</p>
      </div>
      <div class="tool-promise"><b>本地处理</b><span>不覆盖原文件</span></div>
    </section>

    <section class="tool-shell">
      <aside class="tool-nav" aria-label="工具分类">
        <button v-for="item in groups" :key="item[0]" :class="{ active: group === item[0] }" @click="setGroup(item[0])">
          <b><AppIcon :name="item[1]" :size="18" /> {{ item[2] }}</b><span>{{ item[3] }}</span>
        </button>
      </aside>

      <main class="tool-main">
        <header class="tool-picker">
          <div>
            <p class="eyebrow">01 · 选择操作</p>
            <div class="operation-tabs">
              <button v-for="item in operations" :key="item[0]" :class="{ active: operation === item[0] }" @click="setOperation(item[0])">{{ item[1] }}</button>
            </div>
          </div>
        </header>

        <section class="tool-body" :class="{ 'single-column': !hasParameters }">
          <div class="input-card"><p class="eyebrow">02 · 输入</p><FileDropZone v-model="files" :accept="accept" :title="group === 'text' ? '选择文件或直接粘贴' : '拖入需要处理的文件'" hint="自动识别类型、大小和预览；原件保持只读" @error="message=$event"/></div>

          <div v-if="hasParameters" class="parameter-card">
            <p class="eyebrow">03 · 参数</p>
            <template v-if="group === 'pdf'">
              <label v-if="operation === 'extract'">页码范围<input v-model="pageRange" name="page-range" placeholder="例如 1,3-5" /></label>
              <label v-if="operation === 'reorder'">新的页面顺序<input v-model="pageRange" name="page-order" placeholder="例如 3,1,2 或 5,1-3" /></label>
              <template v-if="operation === 'watermark'">
                <label>水印文字<input v-model="watermarkText" name="watermark" maxlength="34" /></label>
                <label>透明度 {{ watermarkOpacity }}%<input v-model.number="watermarkOpacity" type="range" min="3" max="80" /></label>
                <label>水印颜色<input v-model="watermarkColor" type="color" /></label>
                <label>倾斜角度<select v-model.number="rotation"><option :value="45">45°</option><option :value="-45">-45°</option><option :value="0">不旋转</option></select></label>
              </template>
              <label v-if="operation === 'rotate'">旋转角度<select v-model.number="rotation"><option :value="90">顺时针 90°</option><option :value="180">180°</option><option :value="270">顺时针 270°</option></select></label>
              <template v-if="operation === 'page-number'">
                <label>起始页码<input v-model.number="pageNumberStart" type="number" min="0" /></label>
                <label>页码位置<select v-model="pageNumberPosition"><option value="bottom-center">底部居中</option><option value="bottom-right">右下角</option></select></label>
              </template>
              <p v-if="operation === 'split'" class="parameter-note">每一页会生成一份独立 PDF，文件名带原页码。</p>
              <p v-if="operation === 'text'" class="parameter-note">仅提取 PDF 已有的文字层；扫描件不会伪造识别结果。</p>
            </template>

            <template v-else-if="group === 'image'">
              <label>输出格式<select v-model="imageFormat"><option value="image/png">PNG</option><option value="image/jpeg">JPG</option><option value="image/webp">WebP</option></select></label>
              <label v-if="operation === 'rotate'">旋转角度<select v-model.number="rotation"><option :value="90">顺时针 90°</option><option :value="180">180°</option><option :value="270">顺时针 270°</option></select></label>
              <template v-if="operation === 'crop'">
                <div class="parameter-pair"><label>左侧起点<input v-model.number="cropLeft" type="number" min="0" max="99" /><span>%</span></label><label>顶部起点<input v-model.number="cropTop" type="number" min="0" max="99" /><span>%</span></label></div>
                <div class="parameter-pair"><label>裁剪宽度<input v-model.number="cropWidth" type="number" min="1" max="100" /><span>%</span></label><label>裁剪高度<input v-model.number="cropHeight" type="number" min="1" max="100" /><span>%</span></label></div>
              </template>
              <label>最大宽度<input v-model.number="maxWidth" type="number" min="100" max="7680" /></label>
              <label>质量 {{ quality }}%<input v-model.number="quality" type="range" min="20" max="100" /></label>
            </template>

            <template v-else-if="group === 'text'">
              <label>处理方式<select v-model="textMode"><option value="json">格式化 JSON</option><option value="trim">清理空行与尾随空格</option><option value="markdown">清理 Markdown 空行</option></select></label>
              <label>文本内容<textarea v-model="textInput" name="text-input" placeholder="粘贴需要处理的内容…"></textarea></label>
            </template>

            <template v-else>
              <label v-if="operation === 'rename-report'">命名开头<input v-model="renamePrefix" name="rename-prefix" /></label>
              <p class="parameter-note">只生成预览或报告，不移动、删除或重命名原文件。</p>
            </template>
          </div>
        </section>

        <footer class="execution-bar">
          <div class="output-summary">
            <p class="eyebrow">{{ hasParameters ? '04' : '03' }} · 输出</p>
            <strong>{{ outputHint }}</strong>
            <small aria-live="polite">{{ message }}</small>
          </div>
          <div class="execution-actions">
            <label>配方名称<input v-model="recipeTitle" name="recipe-title" placeholder="例如：证件照压缩" /></label>
            <label v-if="usesOutputName">输出名称<input v-model="outputName" name="output-name" /></label>
            <button class="save-recipe" @click="saveCurrentRecipe">保存配方</button>
            <button class="run-tool" :disabled="!canRun" @click="run">{{ running ? '正在处理…' : '生成新输出' }}</button>
          </div>
        </footer>
      </main>
    </section>
  </div>
</template>
