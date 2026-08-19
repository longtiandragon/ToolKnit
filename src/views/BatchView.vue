<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useWorkbenchStore } from '@/stores/workbench'
import { useUiStore } from '@/stores/ui'
import type { FileReference, ToolRecipe } from '@/types'
import type { PdfTaskOperation } from '@/lib/pdf-worker'
import { buildRenamePreview, cleanOutputName, transformText, type TextTransformMode } from '@/lib/file-tools'
import { saveToolRecipe, touchToolRecipe } from '@/lib/automation-recipes'
import { chooseOutputDirectory, exportOutput } from '@/lib/output'
import { isDesktop } from '@/lib/native'
import { decryptDesktopPdf, optimizeDesktopPdf, protectDesktopPdf } from '@/lib/pdf-native'
import { readDesktopOcrFont, recognizeDesktopImageBytes } from '@/lib/ocr-native'
import AppIcon from '@/components/AppIcon.vue'
import PageHeader from '@/components/PageHeader.vue'
import FileDropZone from '@/components/FileDropZone.vue'
import ToolLayout from '@/components/ToolLayout.vue'
import FieldRow from '@/components/FieldRow.vue'
import ProgressTrack from '@/components/ProgressTrack.vue'
import OutputList from '@/components/OutputList.vue'
import ToolPipelineView from '@/components/ToolPipelineView.vue'
import ArchiveView from '@/views/ArchiveView.vue'
import FileHealthView from '@/views/FileHealthView.vue'
import PhotoOrganizerView from '@/views/PhotoOrganizerView.vue'
import SmartOrganizerView from '@/views/SmartOrganizerView.vue'
import FilePipelineView from '@/views/FilePipelineView.vue'
import ProjectUtilityView from '@/views/ProjectUtilityView.vue'
import AutomationCenterView from '@/views/AutomationCenterView.vue'

type ToolGroup = 'pdf' | 'image' | 'text' | 'organize'
type ToolOption = [id: string, label: string]

const store = useWorkbenchStore()
const ui = useUiStore()
const route = useRoute()
const router = useRouter()
const pipelineMode = computed(() => route.query.mode === 'pipeline')
const automationMode = computed(() => route.query.mode === 'automation')
const archiveMode = computed(() => route.query.mode === 'archive')
const fileHealthMode = computed(() => route.query.mode === 'file-health')
const photoOrganizerMode = computed(() => route.query.mode === 'photo-organizer')
const smartOrganizerMode = computed(() => route.query.mode === 'smart-organizer')
const filePipelineMode = computed(() => route.query.mode === 'file-pipeline')
const projectUtilityMode = computed(() => route.query.mode === 'delivery-pack' || route.query.mode === 'folder-snapshot')
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
const signatureText = ref('')
const signaturePosition = ref<'bottom-left' | 'bottom-center' | 'bottom-right'>('bottom-right')
const signatureScale = ref(100)
const bookmarkJson = ref('')
const pageNumberStart = ref(1)
const pageNumberPosition = ref<'bottom-center' | 'bottom-right'>('bottom-center')
const redactTerms = ref('')
const pdfTextMode = ref<'text' | 'form' | 'fill'>('text')
const pdfFormValues = ref('')
const pdfPassword = ref('')
const pdfAllowPrinting = ref(false)
const pdfAllowCopying = ref(false)
const pdfAllowModification = ref(false)
const imageFormat = ref<'image/png' | 'image/jpeg' | 'image/webp'>('image/png')
const pdfImageDpi = ref(150)
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
// Progress is rendered in the work area now, not just written into the job
// record, so the view needs its own copy of it.
const progress = ref(0)
// The recipe name field used to sit permanently in the execution bar, asking
// every user to name something they had not decided to save. It appears on
// request instead.
const recipeFormOpen = ref(false)
const TASK_CANCELLED_MESSAGE = '任务已停止。已完成的输出会保留。'
let cancellationRequested = false

const groups: [ToolGroup, string, string, string][] = [
  ['pdf', 'file-pdf', 'PDF', '合并、拆页、旋转、提取页面'],
  ['text', 'file-text', '文本', 'JSON 格式化与文本清理'],
  ['organize', 'sort', '整理', '命名预览与哈希去重报告']
]

const operationMap: Record<ToolGroup, ToolOption[]> = {
  pdf: [['merge', '合并 PDF'], ['split', '按页拆分'], ['compare', '比较 PDF'], ['rotate', '旋转 PDF'], ['extract', '提取指定页'], ['reorder', '重排页面'], ['crop', '裁剪页面'], ['watermark', '添加水印'], ['signature', '放置签名'], ['page-number', '添加页码'], ['compress', '优化 PDF'], ['protect', '密码保护 PDF'], ['decrypt', '移除 PDF 密码'], ['redact', '永久脱敏'], ['ocr', 'OCR PDF'], ['images-to-pdf', '图片转 PDF'], ['pdf-to-image', 'PDF 转图片'], ['text', '提取文本'], ['attachments', '提取附件'], ['bookmarks', '导出书签'], ['edit-bookmarks', '编辑书签'], ['metadata', '导出元数据']],
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
  compare: '按页比较两份 PDF 的文字层和页面尺寸，生成只读差异报告',
  rotate: '批量旋转页面方向,不重新编码内容',
  extract: '按页码范围导出成新的 PDF',
  reorder: '按你指定的页序重新组织后导出',
  crop: '调整 PDF 页面可见区域，不栅格化文字和矢量内容',
  watermark: '在每页叠加文字水印,可调透明度与角度',
  signature: '把签名文字绘制成手写风格图层并放在每页底部；不是数字证书签名',
  'page-number': '按起始数字和位置批量添加页码',
  'images-to-pdf': '把多张图片按顺序合成一份 PDF',
  'pdf-to-image': '把每一页渲染成图片,可选格式、分辨率与页码范围',
  compress: '桌面版调用本机 qpdf 重写对象流；浏览器使用 PDF 引擎优化结构，不改变页面内容',
  protect: '使用本机 qpdf 生成 256 位 AES 加密副本，并按选择限制打印、复制和修改',
  decrypt: '使用本机 qpdf 验证密码并移除 PDF 加密，原文件不会被覆盖',
  redact: '按文本匹配覆盖并栅格化页面，输出后无法恢复原文字层',
  ocr: '把扫描页面识别为本机文字，并生成可搜索的 PDF 副本',
  text: '导出 PDF 文字层，或查看 AcroForm 表单字段',
  attachments: '提取 PDF 内嵌附件；每个附件会写成独立新文件',
  bookmarks: '导出 PDF 书签树为 JSON；只读，不改动原 PDF',
  'edit-bookmarks': '按受控 JSON 替换 PDF 书签树，可跳转到页码或安全网页链接',
  convert: '在 PNG、JPG 与 WebP 之间转换',
  resize: '限制最大宽度并调整压缩质量',
  'image-crop': '按选区裁剪并批量导出',
  transform: '格式化、清理或重排文本内容',
  'rename-report': '预览批量重命名结果,先看再改',
  'dedupe-report': '按内容哈希找出重复文件并生成报告',
}

const activeOperationLabel = computed(() => operations.value.find((item) => item[0] === operation.value)?.[1] ?? '文件处理')
const activeOperationNote = computed(() => operationNotes[group.value === 'image' && operation.value === 'crop' ? 'image-crop' : operation.value] ?? '选择输入后生成新文件,原件保持不变')
const accept = computed(() => group.value === 'pdf' && operation.value !== 'images-to-pdf'
  ? '.pdf,application/pdf'
  : group.value === 'pdf'
    ? 'image/*'
    : group.value === 'image'
      ? 'image/*'
      : group.value === 'text'
        ? '.txt,.md,.json,.js,.ts,.py,.java,.csv,text/*,application/json'
        : '*/*')
const hasParameters = computed(() => group.value !== 'pdf' || ['extract', 'reorder', 'crop', 'watermark', 'signature', 'edit-bookmarks', 'page-number', 'rotate', 'split', 'compare', 'text', 'pdf-to-image', 'compress', 'protect', 'decrypt', 'redact', 'ocr'].includes(operation.value))
const usesOutputName = computed(() => group.value === 'text' || group.value === 'organize' || (group.value === 'pdf' && ['merge', 'images-to-pdf'].includes(operation.value)))
const canRun = computed(() => !running.value
  && (files.value.length > 0 || (group.value === 'text' && textInput.value.trim().length > 0))
  && (!(group.value === 'pdf' && operation.value === 'compare') || files.value.length === 2)
  && (!(group.value === 'pdf' && ['protect', 'decrypt'].includes(operation.value)) || (isDesktop() && pdfPassword.value.length > 0))
  && (!(group.value === 'pdf' && operation.value === 'protect') || pdfPassword.value.length >= 8)
  && !(group.value === 'pdf' && operation.value === 'redact' && !redactTerms.value.trim())
  && !(group.value === 'pdf' && operation.value === 'signature' && !signatureText.value.trim())
  && !(group.value === 'pdf' && operation.value === 'edit-bookmarks' && !bookmarkJson.value.trim())
  && !(group.value === 'pdf' && operation.value === 'ocr' && !isDesktop()))
const outputHint = computed(() => {
  if (!files.value.length && !(group.value === 'text' && textInput.value.trim())) return '等待输入内容'
  if (group.value === 'pdf' && operation.value === 'split') return `将把 ${files.value.length} 份 PDF 拆成独立页面`
  if (group.value === 'pdf' && operation.value === 'compare') return files.value.length === 2 ? '将按页生成文字层与尺寸差异报告；扫描页会标记为未验证' : '请选择恰好两份 PDF 进行比较'
  if (group.value === 'pdf' && operation.value === 'redact') return '匹配到的页面会变成不可搜索的图片，并永久覆盖敏感文字'
  if (group.value === 'pdf' && operation.value === 'compress') return isDesktop() ? '使用本机 qpdf 重写对象流和压缩流；原文件不会被覆盖' : '仅重写 PDF 结构；图片型 PDF 体积可能变化不大'
  if (group.value === 'pdf' && operation.value === 'protect') return isDesktop() ? '使用本机 qpdf 生成新的 256 位 AES 加密 PDF；密码不会写入任务历史' : 'PDF 密码保护需要 Windows 桌面版与本机 qpdf'
  if (group.value === 'pdf' && operation.value === 'decrypt') return isDesktop() ? '使用本机 qpdf 校验密码并生成新的无密码 PDF；原文件不会被覆盖' : '移除 PDF 密码需要 Windows 桌面版与本机 qpdf'
  if (group.value === 'pdf' && operation.value === 'ocr') return isDesktop() ? '使用 Windows 本机 OCR，原文件不会上传；输出会保留页面图片并附加文字层' : 'OCR PDF 需要 Windows 桌面版与本机 OCR 语言包'
  if (group.value === 'pdf' && operation.value === 'attachments') return '提取 PDF 内嵌附件为独立文件；单份 PDF 最多 128 个、单个 16 MB、总计 64 MB'
  if (group.value === 'pdf' && operation.value === 'bookmarks') return '导出书签标题、层级、链接和目标存在性；超深或超大书签树会被安全截断'
  if (group.value === 'pdf' && operation.value === 'metadata') return '导出标题、作者、创建工具、权限、指纹和页面尺寸；只读且会限制字段与页数'
  if (group.value === 'pdf' && operation.value === 'signature') return '将手写风格签名绘制到每页底部，生成新副本；不会产生数字证书签名'
  if (group.value === 'pdf' && operation.value === 'edit-bookmarks') return '按 JSON 替换书签树；只允许页码跳转和 http(s) 链接，原 PDF 不会被覆盖'
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
  // Results belong to the tool that produced them. Leaving them on screen
  // after a switch made the JSON formatter claim it had just written two
  // watermarked PDFs.
  recentOutputs.value = []
  if (input.value) input.value.value = ''
}

/** Rotation is shared by three operations that mean different things by it.
 *  A watermark tilts; a page turns. Carrying 90° into the watermark panel
 *  left its angle picker showing no selection at all, because 90 is not one
 *  of the angles a watermark offers. */
function defaultRotationFor(next: string) {
  return next === 'watermark' ? 45 : 90
}

/** Every tool used to propose the same file name, `knitspace-output`, so a
 *  folder of results told you nothing about which tool made what. */
const outputNames: Record<string, string> = {
  merge: '合并结果',
  'images-to-pdf': '图片合集',
  transform: '文本处理结果',
  'rename-report': '重命名预览',
  'dedupe-report': '重复文件报告',
}
function defaultOutputNameFor(next: string) {
  return outputNames[next] ?? 'knitspace-output'
}

function setGroup(next: ToolGroup) {
  if (running.value) return
  group.value = next
  operation.value = operationMap[next][0][0]
  rotation.value = defaultRotationFor(operation.value)
  outputName.value = defaultOutputNameFor(operation.value)
  activeRecipeId.value = undefined
  pdfPassword.value = ''
  clearFiles()
  message.value = `已切换到${groups.find((item) => item[0] === next)?.[2] ?? ''}工具，选择输入后即可开始。`
}

function setOperation(next: string) {
  if (running.value) return
  operation.value = next
  rotation.value = defaultRotationFor(next)
  outputName.value = defaultOutputNameFor(next)
  // Extract/reorder start with "1" because they describe one selection; a
  // page-to-image export means the whole document unless a range is given.
  if (next === 'pdf-to-image' || next === 'ocr') pageRange.value = ''
  pdfPassword.value = ''
  clearFiles()
  message.value = `已切换到「${operations.value.find((item) => item[0] === next)?.[1] ?? '新操作'}」，请重新选择输入。`
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
    imageFormat: imageFormat.value, pdfImageDpi: pdfImageDpi.value, cropLeft: cropLeft.value, cropTop: cropTop.value,
    cropWidth: cropWidth.value, cropHeight: cropHeight.value, maxWidth: maxWidth.value,
    quality: quality.value, watermarkText: watermarkText.value, watermarkOpacity: watermarkOpacity.value,
    watermarkColor: watermarkColor.value, signatureText: signatureText.value, signaturePosition: signaturePosition.value, signatureScale: signatureScale.value, bookmarkJson: bookmarkJson.value, pageNumberStart: pageNumberStart.value,
    pageNumberPosition: pageNumberPosition.value, redactTerms: redactTerms.value, textMode: textMode.value, renamePrefix: renamePrefix.value,
    renameSuffix: renameSuffix.value, renameStart: renameStart.value, renameDigits: renameDigits.value,
    renameSeparator: renameSeparator.value, renameKeepOriginal: renameKeepOriginal.value ? 1 : 0,
    pdfTextMode: pdfTextMode.value,
    pdfFormValues: pdfFormValues.value,
    pdfAllowPrinting: pdfAllowPrinting.value ? 1 : 0,
    pdfAllowCopying: pdfAllowCopying.value ? 1 : 0,
    pdfAllowModification: pdfAllowModification.value ? 1 : 0,
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
  pdfImageDpi.value = Math.max(72, Math.min(300, Number(params.pdfImageDpi ?? pdfImageDpi.value)))
  cropLeft.value = Number(params.cropLeft ?? cropLeft.value)
  cropTop.value = Number(params.cropTop ?? cropTop.value)
  cropWidth.value = Number(params.cropWidth ?? cropWidth.value)
  cropHeight.value = Number(params.cropHeight ?? cropHeight.value)
  maxWidth.value = Number(params.maxWidth ?? maxWidth.value)
  quality.value = Number(params.quality ?? quality.value)
  watermarkText.value = String(params.watermarkText ?? watermarkText.value)
  watermarkOpacity.value = Number(params.watermarkOpacity ?? watermarkOpacity.value)
  watermarkColor.value = String(params.watermarkColor ?? watermarkColor.value)
  signatureText.value = String(params.signatureText ?? signatureText.value)
  signaturePosition.value = params.signaturePosition === 'bottom-left' || params.signaturePosition === 'bottom-center' ? params.signaturePosition : 'bottom-right'
  signatureScale.value = Math.max(50, Math.min(180, Number(params.signatureScale ?? signatureScale.value)))
  bookmarkJson.value = String(params.bookmarkJson ?? bookmarkJson.value)
  pageNumberStart.value = Number(params.pageNumberStart ?? pageNumberStart.value)
  pageNumberPosition.value = params.pageNumberPosition === 'bottom-right' ? 'bottom-right' : 'bottom-center'
  redactTerms.value = String(params.redactTerms ?? redactTerms.value)
  pdfTextMode.value = params.pdfTextMode === 'form' || params.pdfTextMode === 'fill' ? params.pdfTextMode : 'text'
  pdfFormValues.value = String(params.pdfFormValues ?? pdfFormValues.value)
  pdfAllowPrinting.value = Number(params.pdfAllowPrinting ?? (pdfAllowPrinting.value ? 1 : 0)) === 1
  pdfAllowCopying.value = Number(params.pdfAllowCopying ?? (pdfAllowCopying.value ? 1 : 0)) === 1
  pdfAllowModification.value = Number(params.pdfAllowModification ?? (pdfAllowModification.value ? 1 : 0)) === 1
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
  pdfPassword.value = ''
  message.value = `已载入配方“${recipe.title}”。请选择本次输入文件。`
}

async function saveCurrentRecipe() {
  const groupLabel = groups.find((item) => item[0] === group.value)?.[1] ?? '工具'
  const operationLabel = operations.value.find((item) => item[0] === operation.value)?.[1] ?? '操作'
  const title = recipeTitle.value.trim() || `${groupLabel} · ${operationLabel}`
  try {
    const recipe = await saveToolRecipe(store, { title, group: group.value, operation: operation.value, parameters: recipeParameters() })
    recipeTitle.value = recipe.title
    activeRecipeId.value = recipe.id
    message.value = `已保存配方“${recipe.title}”。配方不会保存文件路径或内容。`
    ui.toast('工具配方已保存', recipe.title, 'success')
  } catch (error) {
    ui.toast('配方未保存', error instanceof Error ? error.message : '无法写入自动化配方库。', 'error')
  }
}

/** The first run asks where outputs go; after that the directory lived only
 *  in Settings. Keep the answer in sight beside the run button, because
 *  “where did that go” should never require leaving the tool. */
async function pickOutputDirectory() {
  const directory = await chooseOutputDirectory()
  if (!directory) return
  store.updateSettings({ outputDirectory: directory })
  ui.toast('默认输出目录已更新', directory, 'success')
}

watch(() => route.query, (query) => {
  if (typeof query.mode === 'string' && ['pipeline', 'automation', 'archive', 'file-health', 'photo-organizer', 'smart-organizer', 'file-pipeline', 'delivery-pack', 'folder-snapshot'].includes(query.mode)) return
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
  pdfPassword.value = ''
  rotation.value = defaultRotationFor(requestedOperation)
  outputName.value = defaultOutputNameFor(requestedOperation)
  if (requestedOperation === 'pdf-to-image' || requestedOperation === 'ocr') pageRange.value = ''
  if (requestedOperation === 'text') pdfTextMode.value = query.mode === 'form' || query.mode === 'fill' ? query.mode : 'text'
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

async function makeSignaturePng(text: string) {
  const canvas = document.createElement('canvas')
  canvas.width = 1600
  canvas.height = 360
  const context = canvas.getContext('2d')
  if (!context) throw new Error('浏览器不支持签名绘制。')
  context.clearRect(0, 0, canvas.width, canvas.height)
  context.fillStyle = '#1f2937'
  context.font = 'italic 142px "Segoe Script", "Bradley Hand", "Comic Sans MS", cursive'
  context.textAlign = 'center'
  context.textBaseline = 'middle'
  context.fillText(text.trim().slice(0, 80), canvas.width / 2, canvas.height / 2 - 14)
  context.strokeStyle = '#1f2937'
  context.lineWidth = 8
  context.beginPath()
  context.moveTo(260, 270)
  context.quadraticCurveTo(800, 318, 1340, 264)
  context.stroke()
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
  if (!blob) throw new Error('无法生成签名图层。')
  return blob.arrayBuffer()
}

function boundedFormText(value: string | undefined) {
  return value === undefined ? undefined : value.slice(0, 4000)
}

async function inspectPdfForm(input: { name: string; data: ArrayBuffer }) {
  const { PDFButton, PDFCheckBox, PDFDocument, PDFDropdown, PDFOptionList, PDFRadioGroup, PDFSignature, PDFTextField } = await import('pdf-lib')
  const document = await PDFDocument.load(input.data)
  const fields = document.getForm().getFields()
  const truncated = fields.length > 512
  const summaries = fields.slice(0, 512).map((field) => {
    const summary: { name: string; kind: string; value?: string | string[] | boolean; options?: string[] } = {
      name: field.getName().slice(0, 400),
      kind: field.constructor.name,
    }
    if (field instanceof PDFTextField) {
      summary.kind = 'text'
      summary.value = boundedFormText(field.getText())
    } else if (field instanceof PDFCheckBox) {
      summary.kind = 'checkbox'
      summary.value = field.isChecked()
    } else if (field instanceof PDFDropdown) {
      summary.kind = 'dropdown'
      summary.value = field.getSelected().map((value) => boundedFormText(value) ?? '')
      summary.options = field.getOptions().slice(0, 128).map((value) => boundedFormText(value) ?? '')
    } else if (field instanceof PDFOptionList) {
      summary.kind = 'option-list'
      summary.value = field.getSelected().map((value) => boundedFormText(value) ?? '')
      summary.options = field.getOptions().slice(0, 128).map((value) => boundedFormText(value) ?? '')
    } else if (field instanceof PDFRadioGroup) {
      summary.kind = 'radio'
      summary.value = boundedFormText(field.getSelected())
      summary.options = field.getOptions().slice(0, 128).map((value) => boundedFormText(value) ?? '')
    } else if (field instanceof PDFSignature) {
      summary.kind = 'signature'
    } else if (field instanceof PDFButton) {
      summary.kind = 'button'
    }
    return summary
  })
  return { version: 1, fileName: input.name, fieldCount: fields.length, truncated, fields: summaries }
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
  if (operation.value === 'compare' && pdfs.length !== 2) throw new Error('页面级差异报告需要恰好两份 PDF。')
  const inputs: { name: string; data: ArrayBuffer }[] = []
  for (let index = 0; index < pdfs.length; index += 1) {
    throwIfCancelled()
    onProgress?.(4 + 7 * (index + 1) / pdfs.length, `正在准备 ${index + 1}/${pdfs.length} 份 PDF…`)
    inputs.push({ name: pdfs[index].name, data: await pdfs[index].arrayBuffer() })
  }
  if (operation.value === 'text' && pdfTextMode.value === 'form') {
    const outputs: FileReference[] = []
    for (let index = 0; index < inputs.length; index += 1) {
      throwIfCancelled()
      onProgress?.(12 + 80 * index / inputs.length, `正在读取 ${index + 1}/${inputs.length} 份 PDF 的表单字段…`)
      const report = await inspectPdfForm(inputs[index])
      throwIfCancelled()
      const saved = await save(`${cleanOutputName(inputs[index].name)}-form-fields.json`, JSON.stringify(report, null, 2), 'application/json;charset=utf-8')
      outputs.push(saved)
      onOutput?.(saved)
      onProgress?.(12 + 80 * (index + 1) / inputs.length, `已读取 ${index + 1}/${inputs.length} 份 PDF 的表单字段。`)
    }
    return outputs
  }
  if (operation.value === 'text' && pdfTextMode.value === 'fill') {
    const outputs: FileReference[] = []
    for (let index = 0; index < inputs.length; index += 1) {
      throwIfCancelled()
      onProgress?.(12 + 80 * index / inputs.length, `正在填写 ${index + 1}/${inputs.length} 份 PDF 表单…`)
      const { fillPdfForm } = await import('@/lib/pdf-form')
      const filled = await fillPdfForm(inputs[index].data, pdfFormValues.value)
      throwIfCancelled()
      const saved = await save(`${cleanOutputName(inputs[index].name)}-filled.pdf`, filled, 'application/pdf')
      outputs.push(saved)
      onOutput?.(saved)
      onProgress?.(12 + 80 * (index + 1) / inputs.length, `已填写 ${index + 1}/${inputs.length} 份 PDF 表单。`)
    }
    return outputs
  }
  if (operation.value === 'signature') {
    const text = signatureText.value.trim()
    if (!text) throw new Error('请输入签名文字。')
    onProgress?.(12, '正在生成签名图层…')
    const { PDFDocument } = await import('pdf-lib')
    const signatureBytes = await makeSignaturePng(text)
    const outputs: FileReference[] = []
    for (let index = 0; index < inputs.length; index += 1) {
      throwIfCancelled()
      const document = await PDFDocument.load(inputs[index].data)
      const image = await document.embedPng(signatureBytes)
      for (const page of document.getPages()) {
        const { width, height } = page.getSize()
        const baseWidth = Math.min(180, Math.max(96, width * 0.3))
        const imageWidth = baseWidth * Math.max(0.5, Math.min(1.8, signatureScale.value / 100))
        const imageHeight = imageWidth * image.height / image.width
        const margin = Math.max(18, Math.min(48, width * 0.04))
        const x = signaturePosition.value === 'bottom-left'
          ? margin
          : signaturePosition.value === 'bottom-center'
            ? (width - imageWidth) / 2
            : width - imageWidth - margin
        page.drawImage(image, { x, y: margin, width: imageWidth, height: imageHeight, opacity: 0.92 })
      }
      throwIfCancelled()
      const saved = await save(`${cleanOutputName(inputs[index].name)}-signed.pdf`, bytes(await document.save({ useObjectStreams: true })), 'application/pdf')
      outputs.push(saved)
      onOutput?.(saved)
      onProgress?.(12 + 82 * (index + 1) / inputs.length, `已放置 ${index + 1}/${inputs.length} 份 PDF 的签名。`)
    }
    return outputs
  }
  if (operation.value === 'edit-bookmarks') {
    const source = bookmarkJson.value.trim()
    if (!source) throw new Error('请输入书签 JSON。')
    onProgress?.(12, '正在读取书签结构…')
    const { PDFDocument } = await import('pdf-lib')
    const { applyPdfBookmarkDocument } = await import('@/lib/pdf-bookmarks')
    const outputs: FileReference[] = []
    for (let index = 0; index < inputs.length; index += 1) {
      throwIfCancelled()
      const document = await PDFDocument.load(inputs[index].data)
      applyPdfBookmarkDocument(document, source)
      throwIfCancelled()
      const saved = await save(`${cleanOutputName(inputs[index].name)}-bookmarked.pdf`, bytes(await document.save({ useObjectStreams: true })), 'application/pdf')
      outputs.push(saved)
      onOutput?.(saved)
      onProgress?.(12 + 82 * (index + 1) / inputs.length, `已更新 ${index + 1}/${inputs.length} 份 PDF 的书签。`)
    }
    return outputs
  }
  const watermarkTextValue = watermarkText.value.trim()
  if (operation.value === 'watermark' && !watermarkTextValue) throw new Error('请输入水印文字。')
  const watermark = operation.value === 'watermark'
    ? { data: await makeWatermarkPng(watermarkTextValue, watermarkColor.value), opacity: watermarkOpacity.value }
    : undefined
  throwIfCancelled()

  if (operation.value === 'protect' || operation.value === 'decrypt') {
    if (!isDesktop()) throw new Error(`${operation.value === 'protect' ? 'PDF 加密' : 'PDF 解密'}需要 Windows 桌面版与本机 qpdf。`)
    if (!pdfPassword.value) throw new Error('请输入 PDF 密码；密码不会写入任务历史。')
    if (operation.value === 'protect' && pdfPassword.value.length < 8) throw new Error('PDF 打开密码至少需要 8 个字符。')
    const outputs: FileReference[] = []
    for (let index = 0; index < inputs.length; index += 1) {
      throwIfCancelled()
      onProgress?.(12 + 80 * index / inputs.length, `正在用本机 qpdf 处理 ${index + 1}/${inputs.length} 份 PDF…`)
      const secured = operation.value === 'protect'
        ? await protectDesktopPdf(inputs[index].data, {
          password: pdfPassword.value,
          allowPrinting: pdfAllowPrinting.value,
          allowCopying: pdfAllowCopying.value,
          allowModification: pdfAllowModification.value,
        })
        : await decryptDesktopPdf(inputs[index].data, pdfPassword.value)
      throwIfCancelled()
      const suffix = operation.value === 'protect' ? 'protected' : 'decrypted'
      const saved = await save(`${cleanOutputName(inputs[index].name)}-${suffix}.pdf`, secured, 'application/pdf')
      outputs.push(saved)
      onOutput?.(saved)
      onProgress?.(12 + 80 * (index + 1) / inputs.length, `已完成 ${index + 1}/${inputs.length} 份 PDF。`)
    }
    pdfPassword.value = ''
    return outputs
  }

  if (operation.value === 'ocr') {
    if (!isDesktop()) throw new Error('OCR PDF 需要 Windows 桌面版。')
    onProgress?.(12, '正在准备本机 OCR 与中文字体…')
    const [{ PDFDocument, rgb }, fontkitModule] = await Promise.all([
      import('pdf-lib'),
      import('@pdf-lib/fontkit'),
    ])
    const fontBytes = new Uint8Array(await readDesktopOcrFont())
    const output = await PDFDocument.create()
    const fontkit = fontkitModule.default
    output.registerFontkit({
      create(data: Uint8Array) {
        const created = fontkit.create(data) as ReturnType<typeof fontkit.create> & { fonts?: ReturnType<typeof fontkit.create>[] }
        return created.fonts?.[0] ?? created
      },
    } as Parameters<typeof output.registerFontkit>[0])
    const font = await output.embedFont(fontBytes)
    let recognizedPages = 0
    const { runPdfTask } = await import('@/lib/pdf-worker')
    await runPdfTask({
      operation: 'ocr',
      files: inputs,
      outputName: outputName.value,
      pageRange: pageRange.value,
      rotation: rotation.value,
      pageNumberStart: pageNumberStart.value,
      pageNumberPosition: pageNumberPosition.value,
    }, {
      onProgress,
      onOutput: async (pageOutput) => {
        throwIfCancelled()
        if (pageOutput.mime !== 'image/png') throw new Error('OCR 页面渲染结果格式无效。')
        const image = await output.embedPng(pageOutput.data)
        const width = pageOutput.pageWidth ?? image.width
        const height = pageOutput.pageHeight ?? image.height
        const page = output.addPage([width, height])
        page.drawImage(image, { x: 0, y: 0, width, height })
        const recognition = await recognizeDesktopImageBytes(pageOutput.data)
        const text = recognition.text.trim()
        if (text) {
          recognizedPages += 1
          page.drawText(text.slice(0, 200_000), {
            x: 1,
            y: 1,
            size: 1,
            font,
            color: rgb(1, 1, 1),
            opacity: 0.01,
            maxWidth: Math.max(1, width - 2),
            lineHeight: 1.2,
          })
        }
        onProgress?.(Math.min(96, 18 + (pageOutput.pageIndex ?? 0) / Math.max(1, pageOutput.pageCount ?? 1) * 70), `正在识别第 ${(pageOutput.pageIndex ?? 0) + 1}/${pageOutput.pageCount ?? '?'} 页…`)
        throwIfCancelled()
      },
    })
    onProgress?.(97, recognizedPages ? `已识别 ${recognizedPages} 页，正在写入可搜索文字层…` : '没有识别到文字，仍保留页面图片。')
    const name = `${cleanOutputName(pdfs[0].name)}-ocr.pdf`
    const saved = await save(name, bytes(await output.save({ useObjectStreams: true, addDefaultPage: false, objectsPerTick: 20 })), 'application/pdf')
    onOutput?.(saved)
    return [saved]
  }

  if (operation.value === 'compress' && isDesktop()) {
    const outputs: FileReference[] = []
    for (let index = 0; index < inputs.length; index += 1) {
      throwIfCancelled()
      onProgress?.(12 + 80 * index / inputs.length, `正在用本机 qpdf 优化 ${index + 1}/${inputs.length} 份 PDF…`)
      const optimized = await optimizeDesktopPdf(inputs[index].data)
      throwIfCancelled()
      const saved = await save(`${cleanOutputName(inputs[index].name)}-optimized.pdf`, optimized, 'application/pdf')
      outputs.push(saved)
      onOutput?.(saved)
      onProgress?.(12 + 80 * (index + 1) / inputs.length, `已完成 ${index + 1}/${inputs.length} 份 PDF 优化。`)
    }
    return outputs
  }

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
    ...(operation.value === 'crop' ? { cropLeft: cropLeft.value, cropTop: cropTop.value, cropWidth: cropWidth.value, cropHeight: cropHeight.value } : {}),
    watermark,
    ...(operation.value === 'redact' ? { redactTerms: redactTerms.value } : {}),
    ...(operation.value === 'pdf-to-image'
      ? { imageFormat: imageFormat.value.split('/')[1] as 'png' | 'jpeg' | 'webp', imageDpi: pdfImageDpi.value, imageQuality: quality.value }
      : {})
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
  progress.value = 15
  recentOutputs.value = []
  const kind = group.value as 'pdf' | 'image' | 'text' | 'archive'
  const label = `${groups.find((item) => item[0] === group.value)?.[2]} · ${operations.value.find((item) => item[0] === operation.value)?.[1]}`
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
    const reportProgress = (value: number, detail: string) => {
      if (cancellationRequested) return
      const next = Math.max(16, Math.min(97, Math.round(16 + value * .81)))
      const now = performance.now()
      message.value = detail
      // The bar advances on every report so it stays smooth; the job record is
      // only rewritten on a real step, which is what history wants to show.
      progress.value = Math.max(progress.value, next)
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
    if (activeRecipeId.value) void touchToolRecipe(store, activeRecipeId.value)
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
    if (group.value === 'pdf' && ['protect', 'decrypt'].includes(operation.value)) pdfPassword.value = ''
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

function removeResult(output: FileReference) {
  recentOutputs.value = recentOutputs.value.filter((item) => item !== output)
}

onBeforeUnmount(() => {
  if (!running.value || group.value !== 'pdf') return
  cancellationRequested = true
  void import('@/lib/pdf-worker').then(({ cancelPdfTask }) => cancelPdfTask()).catch(() => undefined)
})
</script>

<template>
  <AutomationCenterView v-if="automationMode" />
  <ToolPipelineView v-else-if="pipelineMode" />
  <ArchiveView v-else-if="archiveMode" />
  <FileHealthView v-else-if="fileHealthMode" />
  <PhotoOrganizerView v-else-if="photoOrganizerMode" />
  <SmartOrganizerView v-else-if="smartOrganizerMode" />
  <FilePipelineView v-else-if="filePipelineMode" />
  <ProjectUtilityView v-else-if="projectUtilityMode" :mode="route.query.mode as 'delivery-pack' | 'folder-snapshot'" />
  <div v-else class="page-enter page-shell px-8 py-6">
    <PageHeader :title="activeOperationLabel" :subtitle="activeOperationNote">
      <template #actions>
        <span
          class="row gap-1.5 h-9 px-3 rounded-sm text-[12px] tabular-nums"
          :class="files.length ? 'bg-accent-soft text-accent' : 'bg-surface-2 text-fg-3'"
        >
          <AppIcon name="inbox" :size="14" />
          {{ files.length ? `${files.length} 个输入` : '尚未选择输入' }}
        </span>
      </template>

      <!--
        The tool picker. This was a 200px sidebar of three categories plus a
        row of tabs, occupying a column of the page permanently — duplicating
        the category rail that is already on screen. It is one strip now:
        which family, then which operation.
      -->
      <template #lead>
        <div class="row gap-3 flex-wrap" role="group" aria-label="选择工具">
          <div class="row gap-0.5 p-0.5 rounded-sm bg-surface-2 border border-line shrink-0">
            <button
              v-for="item in groups"
              :key="item[0]"
              :disabled="running"
              :title="item[3]"
              :aria-pressed="group === item[0]"
              class="row gap-1.5 h-7 px-2.5 rounded-[4px] text-[12px] transition-colors disabled:opacity-45"
              :class="group === item[0] ? 'bg-surface text-fg font-medium shadow-sm' : 'text-fg-3 hover:not-disabled:text-fg'"
              @click="setGroup(item[0])"
            >
              <AppIcon :name="item[1]" :size="14" />{{ item[2] }}
            </button>
          </div>

          <div class="row gap-1 flex-wrap min-w-0">
            <button
              v-for="item in operations"
              :key="item[0]"
              :disabled="running"
              :aria-pressed="operation === item[0]"
              class="h-7 px-2.5 rounded-full text-[12px] transition-colors disabled:opacity-45"
              :class="operation === item[0]
                ? 'bg-accent-solid text-accent-fg font-medium'
                : 'text-fg-2 hover:not-disabled:bg-surface-2 hover:not-disabled:text-fg'"
              @click="setOperation(item[0])"
            >
              {{ item[1] }}
            </button>
          </div>
        </div>
      </template>
    </PageHeader>

    <ToolLayout>
      <!-- ── Work area ──────────────────────────────────────────────────────
           Ordered by what you need to see next: the result of the job you
           just ran, then the job in flight, then the input you are staging.
      -->
      <OutputList v-if="recentOutputs.length && !running" :outputs="recentOutputs" @remove="removeResult" />

      <ProgressTrack
        v-if="running"
        :label="activeOperationLabel"
        :value="progress"
        :detail="message"
        :done="recentOutputs.map((output) => output.name)"
        :stopping="cancelling"
        @cancel="cancelRun"
      />

      <template v-else>
        <!-- Text tools have no files to stage; the content itself is the
             work surface, and its result updates as you type. -->
        <template v-if="group === 'text'">
          <section class="panel overflow-hidden stack flex-1 min-h-52">
            <header class="row-between gap-2 px-3 h-10 border-b border-line shrink-0">
              <p class="text-[12px] font-medium text-fg-2">输入文本</p>
              <span class="text-[11px] text-fg-3 tabular-nums">{{ textInput.length }} 字符</span>
            </header>
            <textarea
              v-model="textInput"
              name="text-input"
              class="w-full flex-1 min-h-52 px-3 py-2.5 border-0 rounded-none bg-transparent text-[13px] font-mono leading-relaxed resize-none focus:outline-none"
              placeholder="粘贴需要处理的内容，结果会随输入实时更新…"
            />
          </section>

          <section v-if="textPreview" class="panel overflow-hidden" aria-live="polite">
            <header
              class="row gap-1.5 px-3 h-10 border-b text-[12px] font-medium"
              :class="textPreview.error ? 'border-line bg-danger-soft text-danger' : 'border-line text-fg-2'"
            >
              <AppIcon :name="textPreview.error ? 'warning' : 'check'" :size="14" />
              {{ textPreview.error ? '这段内容还不能处理' : '结果预览' }}
            </header>
            <pre
              class="m-0 px-3 py-2.5 max-h-96 overflow-auto text-[12px] font-mono leading-relaxed whitespace-pre-wrap break-words"
              :class="textPreview.error ? 'text-danger' : 'text-fg-2'"
            >{{ textPreview.content }}</pre>
            <p v-if="textPreview.truncated" class="px-3 py-2 border-t border-line text-[11px] text-fg-3">
              预览只显示前 1800 个字符，导出的内容是完整的。
            </p>
          </section>

          <FileDropZone
            v-if="!textInput.trim()"
            v-model="files"
            :accept="accept"
            :max-file-bytes="inputFileLimit"
            :max-total-bytes="inputTotalLimit"
            title="或者载入一个文本文件"
            hint="载入后内容会填进上方输入框，原文件不会被改动"
            @error="ui.toast($event, '', 'error')"
          />
        </template>

        <FileDropZone
          v-else
          v-model="files"
          class="flex-1"
          :accept="accept"
          :max-file-bytes="inputFileLimit"
          :max-total-bytes="inputTotalLimit"
          :title="group === 'pdf' && operation === 'images-to-pdf' ? '拖入要合成的图片' : '拖入要处理的文件'"
          :max-files="group === 'pdf' && operation === 'compare' ? 2 : 100"
          :hint="operation === 'compare' ? '需要恰好两份 PDF；只读比较文字层和页面尺寸，原件保持不变' : `本次最多载入 ${formatSize(inputTotalLimit)}；处理后生成新文件，原件保持不变`"
          @error="ui.toast($event, '', 'error')"
        />

        <!-- A rename report is a preview of an answer, so it belongs beside
             the files it describes rather than in the settings column. -->
        <section v-if="operation === 'rename-report' && renamePreview.length" class="panel overflow-hidden" aria-live="polite">
          <header class="row-between gap-2 px-3 h-10 border-b border-line">
            <p class="text-[12px] font-medium text-fg-2">重命名预览</p>
            <span class="text-[11px] text-fg-3">不会改动磁盘上的文件</span>
          </header>
          <ul class="stack gap-0.5 p-1.5">
            <li v-for="line in renamePreview" :key="line" class="px-2 py-1 rounded-sm font-mono text-[12px] text-fg-2 hover:bg-surface-2">
              {{ line }}
            </li>
          </ul>
          <p v-if="files.length > renamePreview.length" class="px-4 py-2 border-t border-line text-[11px] text-fg-3">
            另有 {{ files.length - renamePreview.length }} 个文件会按同样规则命名。
          </p>
        </section>
      </template>

      <!-- ── Settings column ────────────────────────────────────────────── -->
      <template #aside>
        <section v-if="hasParameters" class="panel p-4 stack gap-4">
          <p class="eyebrow">参数</p>

          <template v-if="group === 'pdf'">
            <FieldRow v-if="operation === 'extract'" label="页码范围" hint="逗号分隔，连续页用短横线">
              <input v-model="pageRange" name="page-range" class="field w-full" placeholder="1,3-5" />
            </FieldRow>

            <FieldRow v-if="operation === 'reorder'" label="新的页面顺序" hint="按写下的先后重排，未列出的页会被丢弃">
              <input v-model="pageRange" name="page-order" class="field w-full" placeholder="3,1,2" />
            </FieldRow>

            <template v-if="operation === 'crop'">
              <div class="grid grid-cols-2 gap-3">
                <FieldRow label="左侧起点"><input v-model.number="cropLeft" type="number" min="0" max="99" class="field w-full" /></FieldRow>
                <FieldRow label="顶部起点"><input v-model.number="cropTop" type="number" min="0" max="99" class="field w-full" /></FieldRow>
                <FieldRow label="裁剪宽度"><input v-model.number="cropWidth" type="number" min="1" max="100" class="field w-full" /></FieldRow>
                <FieldRow label="裁剪高度"><input v-model.number="cropHeight" type="number" min="1" max="100" class="field w-full" /></FieldRow>
              </div>
              <p class="text-[11px] text-fg-3 leading-snug">四个值都是相对每页的百分比；只调整可见裁剪框，不会把页面转成图片。</p>
            </template>

            <template v-if="operation === 'watermark'">
              <FieldRow label="水印文字">
                <input v-model="watermarkText" name="watermark" maxlength="34" class="field w-full" />
              </FieldRow>
              <FieldRow label="透明度">
                <template #value>{{ watermarkOpacity }}%</template>
                <input v-model.number="watermarkOpacity" type="range" min="3" max="80" class="w-full accent-accent" />
              </FieldRow>
              <FieldRow label="倾斜角度">
                <select v-model.number="rotation" class="field w-full">
                  <option :value="45">斜向上 45°</option>
                  <option :value="-45">斜向下 45°</option>
                  <option :value="0">水平不旋转</option>
                </select>
              </FieldRow>
              <FieldRow label="水印颜色" hint="浅灰通常最不干扰阅读">
                <div class="row gap-2">
                  <input v-model="watermarkColor" type="color" aria-label="水印颜色" />
                  <code class="row h-8 px-2 rounded-sm bg-well border border-line text-[12px] text-fg-3 uppercase">{{ watermarkColor }}</code>
                </div>
              </FieldRow>
            </template>

            <template v-if="operation === 'signature'">
              <FieldRow label="签名文字" hint="会以手写风格绘制；最多 80 个字符">
                <input v-model="signatureText" name="signature-text" maxlength="80" class="field w-full" placeholder="例如：张三" />
              </FieldRow>
              <FieldRow label="签名位置">
                <select v-model="signaturePosition" class="field w-full">
                  <option value="bottom-left">左下角</option>
                  <option value="bottom-center">底部居中</option>
                  <option value="bottom-right">右下角</option>
                </select>
              </FieldRow>
              <FieldRow label="签名大小">
                <template #value>{{ signatureScale }}%</template>
                <input v-model.number="signatureScale" type="range" min="50" max="180" class="w-full accent-accent" />
              </FieldRow>
              <p class="text-[11px] text-warn leading-relaxed">这是可视签名图层，不是 PKI 数字签名；不会验证身份，也不会锁定 PDF。</p>
            </template>

            <template v-if="operation === 'edit-bookmarks'">
              <FieldRow label="书签 JSON" hint="page 从 1 开始；items 可嵌套，url 仅允许 http(s)">
                <textarea
                  v-model="bookmarkJson"
                  name="bookmark-json"
                  rows="12"
                  class="field w-full min-h-56 resize-y font-mono text-[11px] leading-relaxed"
                  spellcheck="false"
                  placeholder="{\n  &quot;items&quot;: [\n    { &quot;title&quot;: &quot;第一章&quot;, &quot;page&quot;: 1, &quot;items&quot;: [] },\n    { &quot;title&quot;: &quot;项目主页&quot;, &quot;url&quot;: &quot;https://example.com&quot; }\n  ]\n}"
                />
              </FieldRow>
              <p class="text-[11px] text-warn leading-relaxed">执行后会替换原有书签并生成新 PDF；不会执行脚本、文件链接或任意 PDF Action。输入空 items 可以清除书签。</p>
            </template>

            <FieldRow v-if="operation === 'rotate'" label="旋转角度">
              <select v-model.number="rotation" class="field w-full">
                <option :value="90">顺时针 90°</option>
                <option :value="180">旋转 180°</option>
                <option :value="270">逆时针 90°</option>
              </select>
            </FieldRow>

            <template v-if="operation === 'page-number'">
              <FieldRow label="起始页码" hint="第一页从这个数字开始编">
                <input v-model.number="pageNumberStart" type="number" min="0" class="field w-full" />
              </FieldRow>
              <FieldRow label="页码位置">
                <select v-model="pageNumberPosition" class="field w-full">
                  <option value="bottom-center">底部居中</option>
                  <option value="bottom-right">右下角</option>
                </select>
              </FieldRow>
            </template>

            <template v-if="operation === 'redact'">
              <FieldRow label="要隐藏的文本" hint="支持逗号或换行分隔；按 PDF 文字层匹配">
                <textarea v-model="redactTerms" name="redact-terms" class="field min-h-24 w-full resize-y" placeholder="姓名，手机号\n邮箱地址" />
              </FieldRow>
              <p class="text-[11px] text-warn leading-relaxed">脱敏后页面会重建为图片，匹配文字不可搜索、复制或恢复。扫描件或拆分文字可能需要先用更短的关键词试跑。</p>
            </template>

            <p v-if="operation === 'compress'" class="text-[12px] text-fg-3 leading-snug">
              {{ isDesktop() ? '桌面版会调用本机 qpdf：只重写对象流和压缩流，不降低图片分辨率或删除文字；未安装 qpdf 时会明确提示。' : '这是无损结构优化：不会降低图片分辨率或删除文字。图片型 PDF 若仍很大，下一步可用图片质量工具重建。' }}
            </p>

            <template v-if="operation === 'protect' || operation === 'decrypt'">
              <FieldRow :label="operation === 'protect' ? '打开密码' : '现有密码'" :hint="operation === 'protect' ? '至少 8 个字符；只在本次任务内使用' : '只在本次任务内使用，不会保存到历史'">
                <input v-model="pdfPassword" type="password" autocomplete="new-password" minlength="8" maxlength="256" class="field w-full" :placeholder="operation === 'protect' ? '输入新的 PDF 密码' : '输入当前 PDF 密码'" />
              </FieldRow>
              <template v-if="operation === 'protect'">
                <p class="eyebrow pt-1">打开后的权限</p>
                <label class="row gap-2 text-[12px] text-fg-2"><input v-model="pdfAllowPrinting" type="checkbox" class="accent-accent" />允许打印</label>
                <label class="row gap-2 text-[12px] text-fg-2"><input v-model="pdfAllowCopying" type="checkbox" class="accent-accent" />允许复制文字和图片</label>
                <label class="row gap-2 text-[12px] text-fg-2"><input v-model="pdfAllowModification" type="checkbox" class="accent-accent" />允许修改、批注和页面整理</label>
                <p class="text-[11px] text-warn leading-relaxed">PDF 权限是阅读器约束，不是 DRM；不同阅读器可能不完全执行。256 位 AES 加密与打开密码仍然有效。</p>
              </template>
              <p v-else class="text-[11px] text-warn leading-relaxed">只处理你有权打开和修改的文件。移除密码会使输出副本不再受原 PDF 加密保护。</p>
            </template>

            <p v-if="operation === 'ocr'" class="text-[11px] text-fg-3 leading-relaxed">
              页面会先在本机渲染，再交给 Windows 已安装的 OCR 语言包识别。生成的 PDF 仍以页面图片为底，并附加可搜索文字；没有语言包时不会上传或生成远程结果。
            </p>

            <template v-if="operation === 'pdf-to-image'">
              <FieldRow label="输出格式">
                <select v-model="imageFormat" class="field w-full">
                  <option value="image/png">PNG · 无损，文字与线条最清晰</option>
                  <option value="image/jpeg">JPG · 扫描件与照片，体积小</option>
                  <option value="image/webp">WebP · 体积最小</option>
                </select>
              </FieldRow>
              <FieldRow label="分辨率" hint="按 PDF 原始尺寸换算，越高越清晰、文件越大">
                <select v-model.number="pdfImageDpi" class="field w-full">
                  <option :value="72">72 DPI · 屏幕</option>
                  <option :value="96">96 DPI · 网页</option>
                  <option :value="150">150 DPI · 日常够用</option>
                  <option :value="200">200 DPI · 较高清晰度</option>
                  <option :value="300">300 DPI · 打印级别</option>
                </select>
              </FieldRow>
              <FieldRow v-if="imageFormat !== 'image/png'" label="质量">
                <template #value>{{ quality }}%</template>
                <input v-model.number="quality" type="range" min="20" max="100" class="w-full accent-accent" />
              </FieldRow>
              <FieldRow label="页码范围" hint="留空导出全部页">
                <input v-model="pageRange" name="pdf-image-page-range" class="field w-full" placeholder="全部页，或 1,3-5" />
              </FieldRow>
            </template>

            <p v-if="operation === 'split'" class="text-[12px] text-fg-3 leading-snug">
              每一页会生成一份独立 PDF，文件名带上原来的页码。这个操作没有需要设置的参数。
            </p>
            <p v-if="operation === 'compare'" class="text-[12px] text-fg-3 leading-snug">
              需要按顺序选择两份 PDF。报告比较每页文字层和页面尺寸；扫描件没有文字层时会标为“未验证”，不会修改或覆盖原文件。
            </p>
            <div v-if="operation === 'text'" class="text-[12px] text-fg-3 leading-snug">
              <span class="block mb-2">选择要读取的内容；两种模式都只读原 PDF，不会填写或提交表单。</span>
              <select v-model="pdfTextMode" class="field w-full">
                <option value="text">文字层 → TXT</option>
                <option value="form">AcroForm 字段 → JSON</option>
                <option value="fill">填写 AcroForm → PDF</option>
              </select>
              <span v-if="pdfTextMode === 'fill'" class="block mt-2">填写模式只接受字段名 JSON；字段名必须与 PDF 完全一致，输出为新 PDF，不覆盖原文件。</span>
              <textarea v-if="pdfTextMode === 'fill'" v-model="pdfFormValues" rows="6" class="field w-full mt-2 font-mono text-[11px]" spellcheck="false" placeholder="{\n  &quot;姓名&quot;: &quot;张三&quot;,\n  &quot;同意条款&quot;: true,\n  &quot;城市&quot;: &quot;上海&quot;\n}" aria-label="AcroForm 字段 JSON" />
              <span v-else class="block mt-2">文字层模式不会 OCR；扫描件请改用 OCR。表单模式会保留字段名、类型、当前值和选项。</span>
            </div>
          </template>

          <template v-else-if="group === 'image'">
            <FieldRow label="输出格式">
              <select v-model="imageFormat" class="field w-full">
                <option value="image/png">PNG · 无损，体积大</option>
                <option value="image/jpeg">JPG · 照片首选</option>
                <option value="image/webp">WebP · 体积最小</option>
              </select>
            </FieldRow>
            <FieldRow v-if="operation === 'rotate'" label="旋转角度">
              <select v-model.number="rotation" class="field w-full">
                <option :value="90">顺时针 90°</option>
                <option :value="180">旋转 180°</option>
                <option :value="270">逆时针 90°</option>
              </select>
            </FieldRow>
            <template v-if="operation === 'crop'">
              <div class="grid grid-cols-2 gap-3">
                <FieldRow label="左侧起点"><input v-model.number="cropLeft" type="number" min="0" max="99" class="field w-full" /></FieldRow>
                <FieldRow label="顶部起点"><input v-model.number="cropTop" type="number" min="0" max="99" class="field w-full" /></FieldRow>
                <FieldRow label="裁剪宽度"><input v-model.number="cropWidth" type="number" min="1" max="100" class="field w-full" /></FieldRow>
                <FieldRow label="裁剪高度"><input v-model.number="cropHeight" type="number" min="1" max="100" class="field w-full" /></FieldRow>
              </div>
              <p class="text-[11px] text-fg-3 leading-snug">四个值都是相对原图的百分比。</p>
            </template>
            <FieldRow label="最大宽度" hint="比这窄的图片不会被放大">
              <input v-model.number="maxWidth" type="number" min="100" max="7680" class="field w-full" />
            </FieldRow>
            <FieldRow label="质量">
              <template #value>{{ quality }}%</template>
              <input v-model.number="quality" type="range" min="20" max="100" class="w-full accent-accent" />
            </FieldRow>
          </template>

          <template v-else-if="group === 'text'">
            <FieldRow label="处理方式">
              <select v-model="textMode" class="field w-full">
                <option value="json">格式化 JSON</option>
                <option value="trim">清理空行与尾随空格</option>
                <option value="markdown">清理 Markdown 空行</option>
                <option value="dedupe-lines">删除重复行</option>
                <option value="sort-lines">自然排序每一行</option>
                <option value="extract-contacts">提取链接与邮箱</option>
                <option value="statistics">统计字数与段落</option>
              </select>
            </FieldRow>
          </template>

          <template v-else>
            <template v-if="operation === 'rename-report'">
              <div class="grid grid-cols-2 gap-3">
                <FieldRow label="名称前缀"><input v-model="renamePrefix" name="rename-prefix" class="field w-full" /></FieldRow>
                <FieldRow label="名称后缀"><input v-model="renameSuffix" name="rename-suffix" class="field w-full" placeholder="可选" /></FieldRow>
                <FieldRow label="起始编号"><input v-model.number="renameStart" type="number" min="0" class="field w-full" /></FieldRow>
                <FieldRow label="编号位数"><input v-model.number="renameDigits" type="number" min="1" max="8" class="field w-full" /></FieldRow>
              </div>
              <FieldRow label="分隔符"><input v-model="renameSeparator" maxlength="3" class="field w-full" placeholder="-" /></FieldRow>
              <label class="row gap-2 text-[12px] text-fg-2 cursor-pointer">
                <input v-model="renameKeepOriginal" type="checkbox" class="accent-accent" />保留原文件名
              </label>
            </template>
            <p class="text-[12px] text-fg-3 leading-snug">
              只生成一份报告文件，不会移动、删除或重命名任何原文件。
            </p>
          </template>
        </section>

        <!-- The action panel. Sticky, so the button you came here to press is
             never below the fold no matter how long the file list gets. -->
        <section class="panel p-4 stack gap-3">
          <FieldRow v-if="usesOutputName" label="输出文件名" hint="扩展名会自动补上">
            <input v-model="outputName" name="output-name" class="field w-full" />
          </FieldRow>

          <button class="btn-primary btn-lg w-full" :disabled="!canRun || running" @click="run">
            {{ running ? '正在处理…' : '生成新输出' }}
          </button>

          <p class="text-[12px] text-fg-3 text-center leading-snug" aria-live="polite">
            {{ running ? message : outputHint }}
          </p>

          <!-- Desktop only: outputs land in this folder, and it is one click
               away instead of living only in the Settings page. -->
          <button
            v-if="isDesktop()"
            type="button"
            class="row-between gap-2 w-full border-t border-line pt-3 text-left"
            :disabled="running"
            @click="pickOutputDirectory"
          >
            <span class="stack gap-0.5 min-w-0">
              <span class="text-[12px] font-medium text-fg">输出目录</span>
              <span class="text-[11px] text-fg-3 truncate" :title="store.settings.outputDirectory">
                {{ store.settings.outputDirectory || '尚未设置，点击选择' }}
              </span>
            </span>
            <span class="row gap-1 shrink-0 text-[11px] text-fg-3">
              <AppIcon name="folder" :size="14" />更改
            </span>
          </button>
        </section>

        <section class="panel px-4 py-3 stack gap-3">
          <button
            class="row-between gap-2 w-full text-left"
            :aria-expanded="recipeFormOpen"
            @click="recipeFormOpen = !recipeFormOpen"
          >
            <span class="stack gap-0.5">
              <span class="text-[13px] font-medium text-fg">保存为配方</span>
              <span class="text-[11px] text-fg-3">下次直接调出这套参数</span>
            </span>
            <AppIcon
              name="chevron"
              :size="16"
              class="text-fg-3 shrink-0 transition-transform"
              :class="recipeFormOpen ? 'rotate-180' : ''"
            />
          </button>

          <template v-if="recipeFormOpen">
            <input
              v-model="recipeTitle"
              name="recipe-title"
              class="field w-full"
              :placeholder="`${activeOperationLabel} · 我的预设`"
            />
            <button class="btn-default btn-sm w-full" :disabled="running" @click="saveCurrentRecipe">保存配方</button>
            <p class="text-[11px] text-fg-3 leading-snug">配方只记下参数，不会保存文件内容或路径。</p>
          </template>
        </section>
      </template>
    </ToolLayout>
  </div>
</template>
