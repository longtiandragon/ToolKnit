import { createDesktopZipArchive } from '@/lib/archive-native'
import { cleanOutputName } from '@/lib/file-tools'
import { newId } from '@/lib/id'
import { isDesktop, readDesktopInputFile, transcodeDesktopMedia, cancelDesktopMediaTranscode } from '@/lib/native'
import { exportOutput } from '@/lib/output'
import { runPdfTask } from '@/lib/pdf-worker'
import type { ArtifactPipelineAdapter } from '@/lib/tool-platform'
import type { ArtifactKind, ArtifactRef, FileReference } from '@/types'

const MAX_RUNTIME_ARTIFACTS = 500
const MAX_RUNTIME_BYTES = 1024 * 1024 * 1024
const MAX_IMAGE_PIXELS = 32_000_000

interface RuntimeValue {
  file?: File
  path?: string
}

function artifactKind(file: File): ArtifactKind {
  const name = file.name.toLocaleLowerCase('en-US')
  if (file.type.startsWith('image/')) return 'image'
  if (file.type === 'application/pdf' || name.endsWith('.pdf')) return 'pdf'
  if (file.type.startsWith('audio/') || file.type.startsWith('video/')) return 'media'
  if (/\.(zip|7z|rar|tar|tgz|gz)$/.test(name)) return 'archive'
  return 'files'
}

function filePath(file: File) {
  return (file as File & { path?: string }).path
}

function safeOutputPath(directory: string, name: string) {
  const filename = name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/[. ]+$/, '') || 'knitspace-output'
  return `${directory.replace(/[\\/]+$/, '')}\\${filename}`
}

export class ArtifactRuntimeRegistry {
  private values = new Map<string, RuntimeValue>()
  private totalBytes = 0

  registerFile(file: File, kind = artifactKind(file), path = filePath(file)): ArtifactRef {
    if (this.values.size >= MAX_RUNTIME_ARTIFACTS) throw new Error(`运行时最多保留 ${MAX_RUNTIME_ARTIFACTS} 个文件引用。`)
    if (this.totalBytes + file.size > MAX_RUNTIME_BYTES) throw new Error('文件流水线运行时数据超过 1 GB；请减少输入或分批处理。')
    const id = newId()
    this.values.set(id, { file, ...(path ? { path } : {}) })
    this.totalBytes += file.size
    return {
      id,
      kind,
      name: file.name,
      mime: file.type || undefined,
      size: file.size,
      locator: { kind: 'runtime', value: id },
    }
  }

  registerPath(path: string, name: string, kind: ArtifactKind, size?: number, mime?: string): ArtifactRef {
    if (this.values.size >= MAX_RUNTIME_ARTIFACTS) throw new Error(`运行时最多保留 ${MAX_RUNTIME_ARTIFACTS} 个文件引用。`)
    const id = newId()
    this.values.set(id, { path })
    return { id, kind, name, size, mime, locator: { kind: 'desktop-path', value: path } }
  }

  private value(ref: ArtifactRef) {
    const byId = this.values.get(ref.id)
    if (byId) return byId
    if (ref.locator?.kind === 'desktop-path') return { path: ref.locator.value }
    throw new Error(`运行时文件引用“${ref.name}”已失效。`)
  }

  async file(ref: ArtifactRef) {
    const value = this.value(ref)
    if (value.file) return value.file
    if (!value.path) throw new Error(`“${ref.name}”没有可读取的文件引用。`)
    const file = await readDesktopInputFile(value.path)
    value.file = file
    return file
  }

  async path(ref: ArtifactRef, outputDirectory: string) {
    const value = this.value(ref)
    if (value.path) return value.path
    if (!value.file || !outputDirectory) throw new Error(`“${ref.name}”缺少桌面路径；请先选择输出目录。`)
    const saved = await exportOutput(outputDirectory, ref.name, value.file, value.file.type || 'application/octet-stream')
    if (!saved.path) throw new Error(`无法为“${ref.name}”建立本机输出引用。`)
    value.path = saved.path
    return saved.path
  }

  async exportFinal(ref: ArtifactRef, outputDirectory: string): Promise<FileReference> {
    const value = this.value(ref)
    if (value.path && !value.file) return { name: ref.name, path: value.path, size: ref.size, mime: ref.mime }
    if (!value.file) throw new Error(`“${ref.name}”的最终输出不可用。`)
    return exportOutput(outputDirectory, ref.name, value.file, value.file.type || ref.mime || 'application/octet-stream')
  }

  clear() {
    this.values.clear()
    this.totalBytes = 0
  }
}

async function canvasBlob(file: File, maxWidth: number, quality: number) {
  const bitmap = await createImageBitmap(file)
  try {
    if (bitmap.width * bitmap.height > MAX_IMAGE_PIXELS) throw new Error('图片超过 3200 万像素安全上限，请先缩小后再加入流水线。')
    const scale = maxWidth > 0 && bitmap.width > maxWidth ? maxWidth / bitmap.width : 1
    const width = Math.max(1, Math.round(bitmap.width * scale))
    const height = Math.max(1, Math.round(bitmap.height * scale))
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d')
    if (!context) throw new Error('当前环境无法创建图片处理画布。')
    context.drawImage(bitmap, 0, 0, width, height)
    const sourceType = file.type === 'image/png' || file.type === 'image/webp' || file.type === 'image/jpeg' ? file.type : 'image/png'
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('图片重新编码失败。')), sourceType, quality))
    canvas.width = 0
    canvas.height = 0
    return blob
  } finally {
    bitmap.close()
  }
}

export function createFilePipelineAdapters(registry: ArtifactRuntimeRegistry, outputDirectory: () => string): Record<string, ArtifactPipelineAdapter> {
  return {
    async 'image.compress'(input, parameters) {
      const file = await registry.file(input)
      const maxWidth = Math.max(320, Math.min(7680, Number(parameters.maxWidth ?? 1920)))
      const quality = Math.max(.35, Math.min(1, Number(parameters.quality ?? 84) / 100))
      const blob = await canvasBlob(file, maxWidth, quality)
      const extension = blob.type === 'image/jpeg' ? 'jpg' : blob.type === 'image/webp' ? 'webp' : 'png'
      return registry.registerFile(new File([blob], `${cleanOutputName(file.name)}-compressed.${extension}`, { type: blob.type }), 'image')
    },
    async 'image.clean-metadata'(input) {
      const file = await registry.file(input)
      const blob = await canvasBlob(file, 0, .92)
      const extension = blob.type === 'image/jpeg' ? 'jpg' : blob.type === 'image/webp' ? 'webp' : 'png'
      return registry.registerFile(new File([blob], `${cleanOutputName(file.name)}-clean.${extension}`, { type: blob.type }), 'image')
    },
    async 'pdf.extract-pages'(input, parameters) {
      const file = await registry.file(input)
      let output: { name: string; data: ArrayBuffer; mime: string } | undefined
      await runPdfTask({
        operation: 'extract',
        files: [{ name: file.name, data: await file.arrayBuffer() }],
        outputName: `${cleanOutputName(file.name)}-pages`,
        pageRange: String(parameters.pageRange ?? '1'),
        rotation: 0,
        pageNumberStart: 1,
        pageNumberPosition: 'bottom-center',
      }, { onOutput(value) { output = value } })
      if (!output) throw new Error(`“${file.name}”没有生成 PDF 输出。`)
      return registry.registerFile(new File([output.data], output.name, { type: output.mime }), 'pdf')
    },
    async 'archive.zip'(input) {
      if (!isDesktop()) throw new Error('ZIP 流水线步骤需要桌面端。')
      const directory = outputDirectory()
      if (!directory) throw new Error('ZIP 流水线步骤需要先选择输出目录。')
      const inputPath = await registry.path(input, directory)
      const name = `${cleanOutputName(input.name)}.zip`
      const result = await createDesktopZipArchive([inputPath], safeOutputPath(directory, name))
      return registry.registerPath(result.outputPath, name, 'archive', result.archiveSize, 'application/zip')
    },
    async 'media.clean-metadata'(input, _parameters, context) {
      if (!isDesktop()) throw new Error('媒体流水线步骤需要桌面端与本机 FFmpeg。')
      const directory = outputDirectory()
      if (!directory) throw new Error('媒体流水线步骤需要先选择输出目录。')
      const inputPath = await registry.path(input, directory)
      const runId = newId()
      const abort = () => { void cancelDesktopMediaTranscode(runId) }
      context.signal?.addEventListener('abort', abort, { once: true })
      try {
        const result = await transcodeDesktopMedia({ inputPath, outputDir: directory, operation: 'clean-metadata', runId })
        return registry.registerPath(result.path, result.name, 'media', result.size, input.mime)
      } finally {
        context.signal?.removeEventListener('abort', abort)
      }
    },
  }
}
