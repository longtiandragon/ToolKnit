/// <reference lib="webworker" />
import { PDFDocument, StandardFonts, degrees, rgb } from 'pdf-lib'
import * as pdfjs from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.mjs?url'
import { cleanOutputName, parsePageIndexes } from '@/lib/file-tools'
import type { PdfTaskOutput, PdfTaskRequest } from '@/lib/pdf-worker'

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

type WorkerMessage =
  | { type: 'run'; taskId: string; request: PdfTaskRequest }
  | { type: 'ack'; taskId: string; outputId: string }

const acknowledgements = new Map<string, () => void>()

function toBuffer(bytes: Uint8Array) {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}

function postProgress(taskId: string, progress: number, detail: string) {
  postMessage({ type: 'progress', taskId, progress: Math.max(1, Math.min(99, Math.round(progress))), detail })
}

async function publish(taskId: string, sequence: number, output: PdfTaskOutput) {
  const outputId = `${taskId}-output-${sequence}`
  postMessage({ type: 'output', taskId, outputId, output }, [output.data])
  await new Promise<void>((resolve) => acknowledgements.set(outputId, resolve))
}

async function extractText(taskId: string, source: ArrayBuffer, name: string, progressStart: number, progressEnd: number) {
  const loading = pdfjs.getDocument({ data: source })
  const document = await loading.promise
  try {
    const pages: string[] = []
    for (let pageIndex = 1; pageIndex <= document.numPages; pageIndex += 1) {
      const page = await document.getPage(pageIndex)
      const content = await page.getTextContent()
      const line = content.items.map((item) => 'str' in item ? item.str : '').join(' ').replace(/\s+/g, ' ').trim()
      pages.push(`--- 第 ${pageIndex} 页 ---\n${line}`)
      postProgress(taskId, progressStart + (progressEnd - progressStart) * pageIndex / document.numPages, `正在读取“${name}”第 ${pageIndex}/${document.numPages} 页文字…`)
    }
    const text = pages.join('\n\n')
    if (!text.replace(/--- 第 \d+ 页 ---/g, '').trim()) throw new Error(`“${name}”没有可提取文字。它可能是扫描件，请等待 OCR 引擎接入。`)
    return text
  } finally {
    document.cleanup()
    await loading.destroy()
  }
}

async function runTask(taskId: string, request: PdfTaskRequest) {
  const files = request.files
  if (!files.length) throw new Error('请选择至少一份 PDF。')
  let outputSequence = 0
  const publishPdf = async (name: string, document: PDFDocument) => {
    const data = toBuffer(await document.save())
    await publish(taskId, ++outputSequence, { name, data, mime: 'application/pdf' })
  }

  if (request.operation === 'merge') {
    const output = await PDFDocument.create()
    for (let index = 0; index < files.length; index += 1) {
      const source = await PDFDocument.load(files[index].data)
      const pages = await output.copyPages(source, source.getPageIndices())
      pages.forEach((page) => output.addPage(page))
      postProgress(taskId, 12 + 72 * (index + 1) / files.length, `正在合并 ${index + 1}/${files.length} 份 PDF…`)
    }
    await publishPdf(`${request.outputName || 'knitspace'}-merged.pdf`, output)
    return
  }

  if (request.operation === 'split') {
    const sources = await Promise.all(files.map(async (file) => ({ file, document: await PDFDocument.load(file.data) })))
    const totalPages = sources.reduce((sum, source) => sum + source.document.getPageCount(), 0)
    let completed = 0
    for (const { file, document: source } of sources) {
      for (const index of source.getPageIndices()) {
        const output = await PDFDocument.create()
        const [page] = await output.copyPages(source, [index])
        output.addPage(page)
        await publishPdf(`${cleanOutputName(file.name)}-p${index + 1}.pdf`, output)
        completed += 1
        postProgress(taskId, 10 + 84 * completed / totalPages, `正在导出第 ${completed}/${totalPages} 个独立页面…`)
      }
    }
    return
  }

  if (request.operation === 'text') {
    for (let index = 0; index < files.length; index += 1) {
      const start = 10 + 80 * index / files.length
      const end = 10 + 80 * (index + 1) / files.length
      const text = await extractText(taskId, files[index].data, files[index].name, start, end)
      const data = toBuffer(new TextEncoder().encode(text))
      await publish(taskId, ++outputSequence, { name: `${cleanOutputName(files[index].name)}-text.txt`, data, mime: 'text/plain;charset=utf-8' })
    }
    return
  }

  if (request.operation === 'extract' || request.operation === 'reorder') {
    const source = await PDFDocument.load(files[0].data)
    const indexes = parsePageIndexes(request.pageRange, source.getPageCount())
    const output = await PDFDocument.create()
    const pages = await output.copyPages(source, indexes)
    pages.forEach((page) => output.addPage(page))
    postProgress(taskId, 82, `正在生成 ${indexes.length} 页的新 PDF…`)
    await publishPdf(`${cleanOutputName(files[0].name)}-${request.operation === 'reorder' ? 'reordered' : 'extract'}.pdf`, output)
    return
  }

  if (request.operation === 'watermark' && !request.watermark) throw new Error('水印图层未准备完成。')
  for (let index = 0; index < files.length; index += 1) {
    const source = await PDFDocument.load(files[index].data)
    if (request.operation === 'rotate') {
      source.getPages().forEach((page) => page.setRotation(degrees((page.getRotation().angle + request.rotation) % 360)))
    } else if (request.operation === 'page-number') {
      const font = await source.embedFont(StandardFonts.Helvetica)
      source.getPages().forEach((page, pageIndex) => {
        const { width } = page.getSize()
        const number = String(request.pageNumberStart + pageIndex)
        const size = 11
        const textWidth = font.widthOfTextAtSize(number, size)
        page.drawText(number, { x: request.pageNumberPosition === 'bottom-right' ? width - textWidth - 30 : (width - textWidth) / 2, y: 18, size, font, color: rgb(.32, .37, .35), opacity: .9 })
      })
    } else if (request.operation === 'watermark') {
      const image = await source.embedPng(request.watermark!.data)
      source.getPages().forEach((page) => {
        const { width, height } = page.getSize()
        const ratio = Math.min(width * .78 / image.width, height * .24 / image.height)
        const drawWidth = image.width * ratio
        const drawHeight = image.height * ratio
        page.drawImage(image, { x: (width - drawWidth) / 2, y: (height - drawHeight) / 2, width: drawWidth, height: drawHeight, opacity: Math.max(.03, Math.min(1, request.watermark!.opacity / 100)), rotate: degrees(request.rotation) })
      })
    }
    const suffix = request.operation === 'rotate' ? 'rotated' : request.operation === 'page-number' ? 'numbered' : 'watermarked'
    postProgress(taskId, 12 + 72 * (index + 1) / files.length, `正在处理 ${index + 1}/${files.length} 份 PDF…`)
    await publishPdf(`${cleanOutputName(files[index].name)}-${suffix}.pdf`, source)
  }
}

self.addEventListener('message', (event: MessageEvent<WorkerMessage>) => {
  const message = event.data
  if (message.type === 'ack') {
    const resolve = acknowledgements.get(message.outputId)
    acknowledgements.delete(message.outputId)
    resolve?.()
    return
  }
  void runTask(message.taskId, message.request)
    .then(() => postMessage({ type: 'done', taskId: message.taskId }))
    .catch((error) => postMessage({ type: 'error', taskId: message.taskId, error: error instanceof Error ? error.message : 'PDF Worker 执行失败。' }))
})
