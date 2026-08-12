<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useWorkbenchStore } from '@/stores/workbench'
import { useUiStore } from '@/stores/ui'
import type { FileReference, ToolRecipe } from '@/types'
import type { PdfTaskOperation } from '@/lib/pdf-worker'
import { buildRenamePreview, cleanOutputName, transformText, type TextTransformMode } from '@/lib/file-tools'
import { chooseOutputDirectory, exportOutput } from '@/lib/output'
import { isDesktop, revealDesktopFile, saveOutputAs } from '@/lib/native'
import { clampMenuPosition, isContextMenuShortcut, nextMenuItemIndex } from '@/lib/desktop-menu'
import AppIcon from '@/components/AppIcon.vue'
import PageHeader from '@/components/PageHeader.vue'
import FileDropZone from '@/components/FileDropZone.vue'

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
const cancelling = ref(false)
const activeJobId = ref('')
const message = ref('选择工具和文件后，会先显示本次任务的输入与输出。')
const outputName = ref('knitspace-output')
const pageRange = ref('1')
const rotation = ref(90)
const watermarkText = ref('CONFIDENTIAL')
const watermarkOpacity = ref(18)
// A watermark should read as a mark, not as brand colour. The old default was
// left over from the previous palette's green.
const watermarkColor = ref('#8a8f98')
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
const textMode = ref<TextTransformMode>('json')
const renamePrefix = ref('整理文件')
const renameSuffix = ref('')
const renameStart = ref(1)
const renameDigits = ref(3)
const renameSeparator = ref('-')
const renameKeepOriginal = ref(false)
const recipeTitle = ref('')
const activeRecipeId = ref<string>()
const recentOutputs = ref<FileReference[]>([])
const resultMenu = ref<{ output: FileReference; x: number; y: number }>()
const resultMenuElement = ref<HTMLElement>()
const TASK_CANCELLED_MESSAGE = '任务已停止。已完成的输出会保留。'
let cancellationRequested = false
let resultMenuTrigger: HTMLElement | undefined

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

/** What each operation actually does to your files, in one line.
 *  The page used to introduce itself as "文件处理中心" no matter which of the
 *  fourteen operations you arrived on, so the heading never told you where you
 *  were or what was about to happen. */
const operationNotes: Record<string, string> = {
  merge: '按你排列的顺序把多份 PDF 合成一份',
  split: '把每一页导出成独立的 PDF 文件',
  rotate: '批量旋转页面方向,不重新编码内容',
  extract: '按页码范围导出成新的 PDF',
  reorder: '按你指定的页序重新组织后导出',
  watermark: '在每页叠加文字水印,可调透明度与角度',
  'page-number': '按起始数字和位置批量添加页码',
  'images-to-pdf': '把多张图片按顺序合成一份 PDF',
  'extract-text': '导出 PDF 里已有的文字层,不做 OCR',
  convert: '在 PNG、JPG 与 WebP 之间转换',
  resize: '限制最大宽度并调整压缩质量',
  crop: '按选区裁剪并批量导出',
  transform: '格式化、清理或重排文本内容',
  'rename-report': '预览批量重命名结果,先看再改',
  'dedupe-report': '按内容哈希找出重复文件并生成报告',
}

const activeOperationLabel = computed(() => operations.value.find((item) => item[0] === operation.value)?.[1] ?? '文件处理')
const activeOperationNote = computed(() => operationNotes[operation.value] ?? '选择输入后生成新文件,原件保持不变')
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
const renamePreview = computed(() => buildRenamePreview(files.value.map((file) => file.name), {
  prefix: renamePrefix.value,
  suffix: renameSuffix.value,
  start: renameStart.value,
  digits: renameDigits.value,
  separator: renameSeparator.value,
  keepOriginalName: renameKeepOriginal.value
}).slice(0, 5))
const textPreview = computed(() => {
  if (group.value !== 'text' || !textInput.value.trim()) return undefined
  try {
    const result = transformText(textInput.value, textMode.value)
    return { content: result.content.slice(0, 1800), truncated: result.content.length > 1800, error: false }
  } catch (error) {
    return { content: error instanceof Error ? error.message : '暂时无法生成预览。', truncated: false, error: true }
  }
})
const visibleRecentOutputs = computed(() => recentOutputs.value.slice(0, 12))
const inputFileLimit = computed(() => group.value === 'text' ? 8 * 1024 * 1024 : group.value === 'image' || operation.value === 'images-to-pdf' ? 32 * 1024 * 1024 : 96 * 1024 * 1024)
const inputTotalLimit = computed(() => group.value === 'text' ? 32 * 1024 * 1024 : group.value === 'image' || operation.value === 'images-to-pdf' ? 96 * 1024 * 1024 : 192 * 1024 * 1024)

function formatSize(value?: number) {
  if (value === undefined) return '大小由系统管理'
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  return `${(value / (1024 * 1024)).toFixed(1)} MB`
}

function clearFiles() {
  if (running.value) return
  files.value = []
  if (input.value) input.value.value = ''
}

function setGroup(next: ToolGroup) {
  if (running.value) return
  group.value = next
  operation.value = operationMap[next][0][0]
  activeRecipeId.value = undefined
  clearFiles()
  message.value = '已切换工具。请选择本次输入。'
}

function setOperation(next: string) {
  if (running.value) return
  operation.value = next
  clearFiles()
  message.value = '已切换操作。请重新选择符合要求的输入。'
}

function choose(event: Event) {
  if (running.value) return
  files.value = Array.from((event.target as HTMLInputElement).files ?? [])
  message.value = files.value.length ? `已选择 ${files.value.length} 个输入文件。原件不会被修改。` : '未选择文件。'
}

function dropFiles(event: DragEvent) {
  if (running.value) return
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
    pageNumberPosition: pageNumberPosition.value, textMode: textMode.value, renamePrefix: renamePrefix.value,
    renameSuffix: renameSuffix.value, renameStart: renameStart.value, renameDigits: renameDigits.value,
    renameSeparator: renameSeparator.value, renameKeepOriginal: renameKeepOriginal.value ? 1 : 0
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
  const supportedTextModes: TextTransformMode[] = ['json', 'trim', 'markdown', 'dedupe-lines', 'sort-lines', 'extract-contacts', 'statistics']
  textMode.value = supportedTextModes.includes(params.textMode as TextTransformMode) ? params.textMode as TextTransformMode : textMode.value
  renamePrefix.value = String(params.renamePrefix ?? renamePrefix.value)
  renameSuffix.value = String(params.renameSuffix ?? renameSuffix.value)
  renameStart.value = Math.max(0, Number(params.renameStart ?? renameStart.value))
  renameDigits.value = Math.max(1, Math.min(8, Number(params.renameDigits ?? renameDigits.value)))
  renameSeparator.value = String(params.renameSeparator ?? renameSeparator.value)
  renameKeepOriginal.value = Number(params.renameKeepOriginal ?? (renameKeepOriginal.value ? 1 : 0)) === 1
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
  const supportedTextModes: TextTransformMode[] = ['json', 'trim', 'markdown', 'dedupe-lines', 'sort-lines', 'extract-contacts', 'statistics']
  if (typeof query.mode === 'string' && supportedTextModes.includes(query.mode as TextTransformMode)) textMode.value = query.mode as TextTransformMode
  activeRecipeId.value = undefined
  clearFiles()
  const stagedFiles = store.consumeIntakeFiles()
  const stagedText = store.consumeIntakeText()
  if (stagedFiles.length) files.value = stagedFiles
  if (requestedGroup === 'text' && stagedText.trim()) textInput.value = stagedText
  message.value = typeof query.group === 'string' ? `已打开“${operations.value.find(([id]) => id === operation.value)?.[1]}”。请选择输入。` : '选择工具和文件后，会先显示本次任务的输入与输出。'
  if (stagedFiles.length || (requestedGroup === 'text' && stagedText.trim())) message.value = `已从快速处理带入 ${stagedFiles.length || 1} 个输入，可以直接核对参数。`
}, { immediate: true })

watch(files, async (nextFiles) => {
  if (group.value !== 'text' || textInput.value.trim() || !nextFiles[0]) return
  try {
    textInput.value = await nextFiles[0].text()
    message.value = `已读取“${nextFiles[0].name}”，可以先查看处理结果再导出。`
  } catch {
    message.value = `无法读取“${nextFiles[0].name}”的文本内容。`
  }
})

function bytes(data: Uint8Array) {
  return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer
}

function throwIfCancelled() {
  if (cancellationRequested) throw new Error(TASK_CANCELLED_MESSAGE)
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

async function runPdf(onProgress?: (progress: number, detail: string) => void, onOutput?: (output: FileReference) => void) {
  if (operation.value === 'images-to-pdf') {
    const images = files.value.filter((file) => file.type.startsWith('image/'))
    if (!images.length) throw new Error('请选择至少一张图片。')
    throwIfCancelled()
    onProgress?.(5, '正在按需载入 PDF 引擎…')
    const { PDFDocument } = await import('pdf-lib')
    throwIfCancelled()
    const output = await PDFDocument.create()
    for (let index = 0; index < images.length; index += 1) {
      throwIfCancelled()
      const file = images[index]
      const image = await imageToPng(file)
      throwIfCancelled()
      const embedded = await output.embedPng(image.data)
      const page = output.addPage([image.width, image.height])
      page.drawImage(embedded, { x: 0, y: 0, width: image.width, height: image.height })
      onProgress?.(12 + 76 * (index + 1) / images.length, `正在写入第 ${index + 1}/${images.length} 张图片…`)
    }
    const name = `${outputName.value || 'knitspace'}-images.pdf`
    onProgress?.(94, '正在导出 PDF…')
    throwIfCancelled()
    const saved = await save(name, bytes(await output.save()), 'application/pdf')
    onOutput?.(saved)
    return [saved]
  }

  const pdfs = files.value.filter((file) => file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf'))
  if (!pdfs.length) throw new Error('请选择至少一份 PDF。')
  const inputs: { name: string; data: ArrayBuffer }[] = []
  for (let index = 0; index < pdfs.length; index += 1) {
    throwIfCancelled()
    onProgress?.(4 + 7 * (index + 1) / pdfs.length, `正在准备 ${index + 1}/${pdfs.length} 份 PDF…`)
    inputs.push({ name: pdfs[index].name, data: await pdfs[index].arrayBuffer() })
  }
  const watermarkTextValue = watermarkText.value.trim()
  if (operation.value === 'watermark' && !watermarkTextValue) throw new Error('请输入水印文字。')
  const watermark = operation.value === 'watermark'
    ? { data: await makeWatermarkPng(watermarkTextValue, watermarkColor.value), opacity: watermarkOpacity.value }
    : undefined
  throwIfCancelled()
  onProgress?.(12, '正在交给后台 PDF 引擎处理…')
  const { runPdfTask } = await import('@/lib/pdf-worker')
  throwIfCancelled()
  const outputs: FileReference[] = []
  await runPdfTask({
    operation: operation.value as PdfTaskOperation,
    files: inputs,
    outputName: outputName.value,
    pageRange: pageRange.value,
    rotation: rotation.value,
    pageNumberStart: pageNumberStart.value,
    pageNumberPosition: pageNumberPosition.value,
    watermark
  }, {
    onProgress,
    onOutput: async (output) => {
      throwIfCancelled()
      const saved = await save(output.name, output.data, output.mime)
      outputs.push(saved)
      onOutput?.(saved)
      throwIfCancelled()
    }
  })
  return outputs
}

async function runImage(onOutput?: (output: FileReference) => void) {
  const inputs = files.value.filter((file) => file.type.startsWith('image/'))
  if (!inputs.length) throw new Error('请选择至少一张图片。')
  const extension = imageFormat.value === 'image/jpeg' ? 'jpg' : imageFormat.value.split('/')[1]
  const outputs: FileReference[] = []
  for (const file of inputs) {
    throwIfCancelled()
    const blob = await imageToBlob(file)
    throwIfCancelled()
    const name = `${cleanOutputName(file.name)}-knitspace.${extension}`
    const saved = await save(name, blob, imageFormat.value)
    outputs.push(saved)
    onOutput?.(saved)
  }
  return outputs
}

async function runText(onOutput?: (output: FileReference) => void) {
  throwIfCancelled()
  const raw = textInput.value || (files.value[0] ? await files.value[0].text() : '')
  throwIfCancelled()
  const result = transformText(raw, textMode.value)
  const name = `${outputName.value || 'knitspace'}-clean.${result.extension}`
  const saved = await save(name, result.content, `text/${result.extension};charset=utf-8`)
  onOutput?.(saved)
  return [saved]
}

async function runOrganize(onOutput?: (output: FileReference) => void) {
  if (!files.value.length) throw new Error('请选择至少一个文件。')
  if (operation.value === 'rename-report') {
    throwIfCancelled()
    const lines = buildRenamePreview(files.value.map((file) => file.name), {
      prefix: renamePrefix.value, suffix: renameSuffix.value, start: renameStart.value,
      digits: renameDigits.value, separator: renameSeparator.value, keepOriginalName: renameKeepOriginal.value
    })
    const name = `${outputName.value || 'knitspace'}-rename-preview.txt`
    const saved = await save(name, lines.join('\n'), 'text/plain;charset=utf-8')
    onOutput?.(saved)
    return [saved]
  }
  const map = new Map<string, string[]>()
  for (const file of files.value) {
    throwIfCancelled()
    const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await file.arrayBuffer()))).map((value) => value.toString(16).padStart(2, '0')).join('')
    throwIfCancelled()
    map.set(digest, [...(map.get(digest) ?? []), file.name])
  }
  const duplicates = [...map.values()].filter((items) => items.length > 1)
    const name = `${outputName.value || 'knitspace'}-dedupe-report.txt`
  const saved = await save(name, duplicates.length ? duplicates.map((items) => items.join('  =  ')).join('\n') : '未发现重复文件。', 'text/plain;charset=utf-8')
  onOutput?.(saved)
  return [saved]
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
  cancellationRequested = false
  cancelling.value = false
  running.value = true
  recentOutputs.value = []
  const kind = group.value as 'pdf' | 'image' | 'text' | 'archive'
  const label = `${groups.find((item) => item[0] === group.value)?.[1]} · ${operations.value.find((item) => item[0] === operation.value)?.[1]}`
  const toolId = `${group.value}:${operation.value}`
  const inputs: FileReference[] = files.value.map((file) => ({ name:file.name, size:file.size, mime:file.type, path:(file as File & { path?:string }).path }))
  const job = store.addJob(kind, label, files.value.map((file) => file.name), { toolId, route:'/tools', parameters:recipeParameters(), inputs, retryable:true })
  activeJobId.value = job.id
  store.updateJob(job.id, { status: 'running', progress: 15, detail: '正在准备输入文件…' })
  let currentProgress = 15
  const completedOutputs: FileReference[] = []
  try {
    let lastProgress = 15
    let lastProgressAt = 0
    const reportProgress = (progress: number, detail: string) => {
      if (cancellationRequested) return
      const next = Math.max(16, Math.min(97, Math.round(16 + progress * .81)))
      const now = performance.now()
      message.value = detail
      if (next >= lastProgress + 2 || now - lastProgressAt >= 650) {
        lastProgress = Math.max(lastProgress, next)
        currentProgress = lastProgress
        lastProgressAt = now
        store.updateJob(job.id, { status: 'running', progress: lastProgress, detail })
      }
    }
    const rememberOutput = (output: FileReference) => {
      completedOutputs.push(output)
      // This panel holds only metadata. Generated PDF/image bytes stay in the
      // chosen output directory instead of accumulating in the Vue view.
      recentOutputs.value = [...completedOutputs]
    }
    const outputs = group.value === 'pdf' ? await runPdf(reportProgress, rememberOutput) : group.value === 'image' ? await runImage(rememberOutput) : group.value === 'text' ? await runText(rememberOutput) : await runOrganize(rememberOutput)
    const outputNames = outputs.map((item) => item.name)
    recentOutputs.value = outputs
    store.updateJob(job.id, { status: 'succeeded', progress: 100, outputNames, outputs, detail: '已生成新输出，原文件未修改。' })
    if (activeRecipeId.value) store.touchRecipe(activeRecipeId.value)
    message.value = `任务完成：已生成 ${outputNames.length} 个输出文件。`
    ui.toast('任务已完成', `${label} · ${outputNames.length} 个输出`, 'success', '查看历史', () => location.hash = '#/history')
  } catch (error) {
    const detail = error instanceof Error ? error.message : '工具执行失败。'
    const cancelled = cancellationRequested
    const outputNames = completedOutputs.map((output) => output.name)
    recentOutputs.value = completedOutputs
    store.updateJob(job.id, { status: cancelled ? 'cancelled' : 'failed', progress: cancelled ? currentProgress : 100, errorCode: cancelled ? 'TOOL_CANCELLED' : 'TOOL_EXECUTION_FAILED', detail: cancelled ? TASK_CANCELLED_MESSAGE : detail, ...(cancelled && outputNames.length ? { outputs: completedOutputs, outputNames } : {}) })
    message.value = cancelled ? `${TASK_CANCELLED_MESSAGE}${outputNames.length ? ` 已记录 ${outputNames.length} 个已完成输出。` : ''}` : detail
    ui.toast(cancelled ? '任务已停止' : '处理失败', cancelled ? (outputNames.length ? `${outputNames.length} 个已完成输出已保留，可在历史中查看。` : '没有生成不完整输出，原文件始终不变。') : detail, cancelled ? 'warning' : 'error')
  } finally {
    running.value = false
    cancelling.value = false
    cancellationRequested = false
    activeJobId.value = ''
  }
}

async function cancelRun() {
  if (!running.value || cancelling.value) return
  cancelling.value = true
  cancellationRequested = true
  message.value = group.value === 'pdf' ? '正在停止 PDF 引擎并释放处理内存…' : '将在当前文件处理完成后停止，已完成输出会保留。'
  if (activeJobId.value) store.updateJob(activeJobId.value, { status: 'running', detail: message.value, errorCode: 'TOOL_CANCEL_REQUESTED' })
  if (group.value !== 'pdf') return
  try {
    const { cancelPdfTask } = await import('@/lib/pdf-worker')
    cancelPdfTask()
  } catch {
    // The cooperative flag above still stops work at the next safe boundary.
  }
}

function closeResultMenu(restoreFocus = false) {
  resultMenu.value = undefined
  if (restoreFocus) void nextTick(() => resultMenuTrigger?.focus({ preventScroll: true }))
}
function resultMenuHeight(output: FileReference) { return output.path ? 192 : 120 }
function showResultMenu(output: FileReference, x: number, y: number, trigger: HTMLElement) {
  resultMenuTrigger = trigger
  resultMenu.value = { output, ...clampMenuPosition(x, y, { menuWidth: 224, menuHeight: resultMenuHeight(output), margin: 12 }) }
  void nextTick(() => resultMenuElement.value?.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')?.focus())
}
function openResultMenu(event: MouseEvent, output: FileReference) {
  showResultMenu(output, event.clientX, event.clientY, event.currentTarget as HTMLElement)
}
function openResultMenuFromKeyboard(event: KeyboardEvent, output: FileReference) {
  if (!isContextMenuShortcut(event)) return
  event.preventDefault()
  const trigger = event.currentTarget as HTMLElement
  const bounds = trigger.getBoundingClientRect()
  showResultMenu(output, bounds.right - 16, bounds.top + 20, trigger)
}
function handleResultMenuKeydown(event: KeyboardEvent) {
  const items = [...(resultMenuElement.value?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? [])]
  if (event.key === 'Escape') { event.preventDefault(); closeResultMenu(true); return }
  const next = nextMenuItemIndex(event.key, items.indexOf(document.activeElement as HTMLButtonElement), items.length)
  if (next === undefined) return
  event.preventDefault()
  items[next]?.focus()
}
async function revealResult(output: FileReference) {
  if (!output.path) return
  try { await revealDesktopFile(output.path) }
  catch (error) { ui.toast('无法打开输出位置', error instanceof Error ? error.message : '输出文件可能已移动。', 'error') }
}
async function saveResultAs(output: FileReference) {
  if (!output.path) return
  try {
    const saved = await saveOutputAs(output.path, output.name)
    if (saved) ui.toast('已另存输出', saved, 'success')
  } catch (error) { ui.toast('另存失败', error instanceof Error ? error.message : '无法复制当前输出。', 'error') }
}
async function copyResultPath(output: FileReference) {
  if (!output.path) return
  try { await navigator.clipboard.writeText(output.path); ui.toast('输出路径已复制', output.path, 'success') }
  catch (error) { ui.toast('复制路径失败', error instanceof Error ? error.message : '系统剪贴板暂时不可用。', 'error') }
}
function removeResult(output: FileReference) {
  recentOutputs.value = recentOutputs.value.filter((item) => item !== output)
  closeResultMenu(true)
}
async function runRevealResult() { const output = resultMenu.value?.output; closeResultMenu(); if (output) await revealResult(output) }
async function runSaveResultAs() { const output = resultMenu.value?.output; closeResultMenu(); if (output) await saveResultAs(output) }
async function runCopyResultPath() { const output = resultMenu.value?.output; closeResultMenu(); if (output) await copyResultPath(output) }
function closeResultMenuOnOutsideClick() { closeResultMenu() }

onMounted(() => window.addEventListener('click', closeResultMenuOnOutsideClick))
onBeforeUnmount(() => {
  window.removeEventListener('click', closeResultMenuOnOutsideClick)
  if (!running.value || group.value !== 'pdf') return
  cancellationRequested = true
  void import('@/lib/pdf-worker').then(({ cancelPdfTask }) => cancelPdfTask()).catch(() => undefined)
})
</script>

<template>
  <div class="tool-center page-enter mx-auto w-full max-w-320 px-8 py-6">
    <PageHeader :title="activeOperationLabel" :subtitle="activeOperationNote">
      <template #actions>
        <span class="row gap-1.5 h-9 px-3 rounded-sm bg-surface-2 border border-line text-[12px] text-fg-2">
          {{ files.length ? `已选 ${files.length} 个文件` : '尚未选择输入' }}
        </span>
      </template>
    </PageHeader>

    <section class="tool-shell">
      <aside class="tool-nav" :inert="running || undefined" :aria-disabled="running" aria-label="工具分类">
        <button v-for="item in groups" :key="item[0]" :disabled="running" :class="{ active: group === item[0] }" @click="setGroup(item[0])">
          <b><AppIcon :name="item[1]" :size="18" /> {{ item[2] }}</b><span>{{ item[3] }}</span>
        </button>
      </aside>

      <main class="tool-main">
        <header class="tool-picker" :inert="running || undefined" :aria-disabled="running">
          <div>
            <p class="eyebrow">01 · 选择操作</p>
            <div class="operation-tabs">
              <button v-for="item in operations" :key="item[0]" :disabled="running" :class="{ active: operation === item[0] }" @click="setOperation(item[0])">{{ item[1] }}</button>
            </div>
          </div>
        </header>

        <section class="tool-body" :class="{ 'single-column': !hasParameters }" :inert="running || undefined" :aria-busy="running">
          <div class="input-card"><p class="eyebrow">02 · 输入</p><FileDropZone v-model="files" :disabled="running" :accept="accept" :max-file-bytes="inputFileLimit" :max-total-bytes="inputTotalLimit" :title="group === 'text' ? '选择文件或直接粘贴' : '拖入需要处理的文件'" :hint="`自动识别类型与大小；本次内存上限 ${formatSize(inputTotalLimit)}`" @error="message=$event"/></div>

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
              <label>处理方式<select v-model="textMode">
                <option value="json">格式化 JSON</option>
                <option value="trim">清理空行与尾随空格</option>
                <option value="markdown">清理 Markdown 空行</option>
                <option value="dedupe-lines">删除重复行</option>
                <option value="sort-lines">自然排序每一行</option>
                <option value="extract-contacts">提取链接与邮箱</option>
                <option value="statistics">统计字数与段落</option>
              </select></label>
              <label>文本内容<textarea v-model="textInput" name="text-input" placeholder="粘贴需要处理的内容…"></textarea></label>
              <div v-if="textPreview" class="transform-preview" :class="{ error: textPreview.error }" aria-live="polite"><b>{{ textPreview.error ? '需要检查' : '即时结果预览' }}</b><pre>{{ textPreview.content }}</pre><small v-if="textPreview.truncated">预览仅显示前 1800 个字符，导出内容保持完整。</small></div>
            </template>

            <template v-else>
              <template v-if="operation === 'rename-report'">
                <div class="parameter-pair"><label>名称前缀<input v-model="renamePrefix" name="rename-prefix" /></label><label>名称后缀<input v-model="renameSuffix" name="rename-suffix" placeholder="可选" /></label></div>
                <div class="parameter-pair"><label>起始编号<input v-model.number="renameStart" type="number" min="0" /></label><label>编号位数<input v-model.number="renameDigits" type="number" min="1" max="8" /></label></div>
                <div class="parameter-pair"><label>分隔符<input v-model="renameSeparator" maxlength="3" placeholder="-" /></label><label class="check-label"><input v-model="renameKeepOriginal" type="checkbox" />保留原文件名</label></div>
                <div v-if="renamePreview.length" class="rename-preview" aria-live="polite"><b>实时预览</b><code v-for="line in renamePreview" :key="line">{{ line }}</code><small v-if="files.length > renamePreview.length">另有 {{ files.length - renamePreview.length }} 个文件</small></div>
              </template>
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
            <button class="save-recipe" :disabled="running" @click="saveCurrentRecipe">保存配方</button>
            <button v-if="running" class="cancel-run" :disabled="cancelling" @click="cancelRun">{{ cancelling ? '正在停止…' : '停止任务' }}</button>
            <button v-else class="run-tool" :disabled="!canRun" @click="run">生成新输出</button>
          </div>
        </footer>
      </main>
    </section>
    <section v-if="recentOutputs.length" class="tool-output-result panel" aria-label="本次处理结果">
      <header><div><p class="eyebrow">最近产物</p><h3>本次生成</h3><small>{{ recentOutputs.length }} 个输出 · 右键或 Shift+F10 可进行桌面操作</small></div><RouterLink class="quiet-button" to="/history">查看处理历史</RouterLink></header>
      <div class="tool-output-result__list">
        <button v-for="output in visibleRecentOutputs" :key="`${output.path ?? output.name}:${output.size ?? 0}`" v-memo="[output.name, output.path, output.size]" class="tool-output-result__row" :class="{ 'tool-output-result__row--browser': !output.path }" :title="output.path ? '左键打开所在位置；右键查看更多操作' : '浏览器下载已开始；右键可移除此记录'" :aria-label="`${output.name}，${formatSize(output.size)}；右键或 Shift 加 F10 打开操作`" aria-haspopup="menu" :aria-expanded="resultMenu?.output === output" @click="revealResult(output)" @contextmenu.prevent.stop="openResultMenu($event, output)" @keydown="openResultMenuFromKeyboard($event, output)"><span><AppIcon name="file-text" :size="17" /></span><b>{{ output.name }}</b><small>{{ formatSize(output.size) }}</small><i>{{ output.path ? '打开位置' : '已下载' }}</i></button>
      </div>
      <p v-if="recentOutputs.length > visibleRecentOutputs.length" class="tool-output-result__more">另外 {{ recentOutputs.length - visibleRecentOutputs.length }} 个输出已记录在处理历史中。</p>
    </section>
    <Teleport to="body"><section v-if="resultMenu" ref="resultMenuElement" class="tool-output-context-menu" role="menu" :aria-label="`${resultMenu.output.name} 操作`" :style="{ left: `${resultMenu.x}px`, top: `${resultMenu.y}px` }" @click.stop @contextmenu.prevent @keydown.stop="handleResultMenuKeydown"><p>{{ resultMenu.output.name }}</p><button v-if="resultMenu.output.path" role="menuitem" @click="runRevealResult">打开文件位置</button><button v-if="resultMenu.output.path" role="menuitem" @click="runSaveResultAs">另存为…</button><button v-if="resultMenu.output.path" role="menuitem" @click="runCopyResultPath">复制输出路径</button><button role="menuitem" class="danger" @click="removeResult(resultMenu.output)">从本次结果移除</button></section></Teleport>
  </div>
</template>
