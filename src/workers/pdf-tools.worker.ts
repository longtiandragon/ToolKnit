/// <reference lib="webworker" />
import { PDFDocument, StandardFonts, degrees, rgb } from 'pdf-lib'
import * as pdfjs from 'pdfjs-dist'
import type { PDFDocumentLoadingTask, PDFDocumentProxy } from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.mjs?url'
import { assertPdfImageFits, cleanOutputName, parsePageIndexes, pdfImageOutputName, pdfImageScaleForDpi, type PdfImageFormat } from '@/lib/file-tools'
import { calculatePdfCropBox } from '@/lib/pdf-crop'
import type { PdfTaskOutput, PdfTaskRequest } from '@/lib/pdf-worker'
import { parseRedactionTerms, redactionRectangle, type PdfTextItemForRedaction } from '@/lib/pdf-redaction'

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

/** pdf.js needs temporary canvases while painting mesh shadings, isolated
 *  tiling patterns, soft masks, transparency groups and annotation
 *  appearances. Its default factory is DOMCanvasFactory, which calls
 *  `document.createElement` — and a worker has no `document`, so rendering any
 *  such page failed with "Cannot read properties of undefined (reading
 *  'createElement')". pdf.js instantiates the factory itself, so this is a
 *  class implementing the same interface over OffscreenCanvas. */
class OffscreenCanvasFactory {
  create(width: number, height: number) {
    const canvas = new OffscreenCanvas(width, height)
    const context = canvas.getContext('2d')
    if (!context) throw new Error('无法建立 PDF 渲染画布。')
    return { canvas, context }
  }

  reset(canvasAndContext: { canvas: OffscreenCanvas }, width: number, height: number) {
    canvasAndContext.canvas.width = width
    canvasAndContext.canvas.height = height
  }

  destroy(canvasAndContext: { canvas: OffscreenCanvas }) {
    canvasAndContext.canvas.width = 0
    canvasAndContext.canvas.height = 0
  }
}

async function renderPageToCanvas(page: pdfjs.PDFPageProxy, scale: number) {
  if (typeof OffscreenCanvas === 'undefined' || typeof OffscreenCanvas.prototype.convertToBlob !== 'function') {
    throw new Error('当前环境不支持离屏画布，无法重建 PDF 页面。请使用桌面版或新版 Chrome/Edge。')
  }
  const viewport = page.getViewport({ scale })
  const canvas = new OffscreenCanvas(viewport.width, viewport.height)
  const context = canvas.getContext('2d')
  if (!context) throw new Error('无法建立 PDF 渲染画布。')
  await page.render({ canvas: null, canvasContext: context as unknown as CanvasRenderingContext2D, viewport, background: '#ffffff' }).promise
  return { canvas, context, viewport }
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

  if (request.operation === 'compress') {
    for (let index = 0; index < files.length; index += 1) {
      const source = await PDFDocument.load(files[index].data)
      const data = toBuffer(await source.save({ useObjectStreams: true, addDefaultPage: false, objectsPerTick: 20, updateFieldAppearances: false }))
      await publish(taskId, ++outputSequence, { name: `${cleanOutputName(files[index].name)}-optimized.pdf`, data, mime: 'application/pdf' })
      postProgress(taskId, 10 + 84 * (index + 1) / files.length, `正在优化 ${index + 1}/${files.length} 份 PDF…`)
    }
    return
  }

  if (request.operation === 'redact') {
    const terms = parseRedactionTerms(request.redactTerms ?? '')
    if (!terms.length) throw new Error('请输入至少一个要永久脱敏的文本。多个内容可用逗号或换行分隔。')
    const scale = 1.5
    for (let fileIndex = 0; fileIndex < files.length; fileIndex += 1) {
      const file = files[fileIndex]
      const loading = pdfjs.getDocument({ data: file.data, disableFontFace: true })
      const document = await loading.promise
      try {
        let matchCount = 0
        for (let pageIndex = 1; pageIndex <= document.numPages; pageIndex += 1) {
          const page = await document.getPage(pageIndex)
          const content = await page.getTextContent()
          const items = content.items.map((item) => ({
            str: 'str' in item ? item.str : '',
            transform: 'transform' in item ? [...item.transform] : undefined,
            width: 'width' in item ? item.width : undefined,
          }))
          const pageMatches = items.filter((item) => redactionRectangle(item, [1, 0, 0, -1, 0, 0], 1, terms))
          matchCount += pageMatches.length
          page.cleanup()
        }
        if (!matchCount) throw new Error(`“${file.name}”未找到要脱敏的文本；为避免误生成空结果，未导出文件。`)

        const output = await PDFDocument.create()
        for (let pageIndex = 1; pageIndex <= document.numPages; pageIndex += 1) {
          const page = await document.getPage(pageIndex)
          const { canvas, context, viewport } = await renderPageToCanvas(page, scale)
          const content = await page.getTextContent()
          const pageMatches = content.items
            .map((item) => ({
              str: 'str' in item ? item.str : '',
              transform: 'transform' in item ? [...item.transform] : undefined,
              width: 'width' in item ? item.width : undefined,
            }))
            .map((item) => redactionRectangle(item, viewport.transform, viewport.scale, terms))
            .filter((rectangle): rectangle is NonNullable<typeof rectangle> => Boolean(rectangle))
          context.fillStyle = '#000000'
          for (const rectangle of pageMatches) context.fillRect(rectangle.x, rectangle.y, rectangle.width, rectangle.height)
          const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.92 })
          const image = await output.embedJpg(await blob.arrayBuffer())
          const outputPage = output.addPage([viewport.width / scale, viewport.height / scale])
          outputPage.drawImage(image, { x: 0, y: 0, width: viewport.width / scale, height: viewport.height / scale })
          canvas.width = 0
          canvas.height = 0
          page.cleanup()
          postProgress(taskId, 8 + 86 * (fileIndex + (pageIndex / document.numPages)) / files.length, `正在永久脱敏“${file.name}”第 ${pageIndex}/${document.numPages} 页…`)
        }
        const data = toBuffer(await output.save({ useObjectStreams: true, addDefaultPage: false, objectsPerTick: 20 }))
        await publish(taskId, ++outputSequence, { name: `${cleanOutputName(file.name)}-redacted.pdf`, data, mime: 'application/pdf' })
      } finally {
        document.cleanup()
        await loading.destroy()
      }
    }
    return
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

  if (request.operation === 'pdf-to-image' || request.operation === 'ocr') {
    // Rendering runs inside this worker on an OffscreenCanvas. pdf.js usually
    // paints text through the browser's FontFace API, which only exists where
    // `document` does — so we ask it to rasterize fonts itself, the same path
    // it uses in Node. The canvas never leaves this worker: each page is
    // encoded to a blob and handed out through the same save acknowledgement
    // flow as split PDFs, so memory stays bounded to one page at a time.
    if (typeof OffscreenCanvas === 'undefined' || typeof OffscreenCanvas.prototype.convertToBlob !== 'function') {
      throw new Error('当前环境不支持离屏画布，无法把 PDF 渲染成图片。请使用 Knitspace 桌面版或新版 Chrome/Edge。')
    }
    const format: PdfImageFormat = request.operation === 'ocr' ? 'png' : request.imageFormat === 'jpeg' || request.imageFormat === 'webp' ? request.imageFormat : 'png'
    const mime = format === 'png' ? 'image/png' : format === 'jpeg' ? 'image/jpeg' : 'image/webp'
    const scale = pdfImageScaleForDpi(request.imageDpi ?? 150)
    const quality = Math.max(0, Math.min(1, Math.round(request.imageQuality ?? 90) / 100))
    const documents: { file: (typeof files)[number]; document: PDFDocumentProxy; loading: PDFDocumentLoadingTask }[] = []
    try {
      for (const file of files) {
        try {
          const loading = pdfjs.getDocument({ data: file.data, disableFontFace: true, CanvasFactory: OffscreenCanvasFactory })
          documents.push({ file, document: await loading.promise, loading })
        } catch (error) {
          if ((error as { name?: string })?.name === 'PasswordException') throw new Error(`“${file.name}”受密码保护，请先移除密码再转换。`)
          throw new Error(`“${file.name}”无法读取：${error instanceof Error && error.message ? error.message : '文件可能已损坏。'}`)
        }
      }
      const pageIndexes = documents.map(({ document }) => request.pageRange.trim()
        ? parsePageIndexes(request.pageRange, document.numPages)
        : Array.from({ length: document.numPages }, (_, index) => index))
      const totalPages = pageIndexes.reduce((sum, indexes) => sum + indexes.length, 0)
      if (!totalPages) throw new Error('PDF 没有可以导出的页面。')
      let completed = 0
      for (let fileIndex = 0; fileIndex < documents.length; fileIndex += 1) {
        const { file, document } = documents[fileIndex]
        for (const index of pageIndexes[fileIndex]) {
          const page = await document.getPage(index + 1)
          const viewport = page.getViewport({ scale })
          const { width, height } = assertPdfImageFits(viewport.width, viewport.height, index + 1, document.numPages)
          const canvas = new OffscreenCanvas(width, height)
          const context = canvas.getContext('2d')
          if (!context) throw new Error('无法建立 PDF 渲染画布。')
          // pdf.js's types still ask for the DOM canvas context, but the
          // renderer only uses the shared 2D drawing API; the offscreen
          // context from this worker implements all of it. `canvas` must be
          // null for the context parameter to be honored.
          await page.render({ canvas: null, canvasContext: context as unknown as CanvasRenderingContext2D, viewport, background: '#ffffff' }).promise
          const blob = await canvas.convertToBlob(format === 'png' ? { type: mime } : { type: mime, quality })
          await publish(taskId, ++outputSequence, {
            name: pdfImageOutputName(file.name, index, document.numPages, format),
            data: await blob.arrayBuffer(),
            mime,
            pageWidth: viewport.width / scale,
            pageHeight: viewport.height / scale,
            pageIndex: index,
            pageCount: document.numPages,
          })
          page.cleanup()
          completed += 1
          postProgress(taskId, 10 + 84 * completed / totalPages, `正在渲染“${file.name}”第 ${index + 1}/${document.numPages} 页…`)
        }
      }
    } finally {
      for (const { document, loading } of documents) {
        document.cleanup()
        try { await loading.destroy() } catch { /* 文档已经销毁时无需处理。 */ }
      }
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

  if (request.operation === 'crop') {
    const left = request.cropLeft ?? 0
    const top = request.cropTop ?? 0
    const width = request.cropWidth ?? 100
    const height = request.cropHeight ?? 100
    for (let index = 0; index < files.length; index += 1) {
      const source = await PDFDocument.load(files[index].data)
      source.getPages().forEach((page) => {
        const { width: pageWidth, height: pageHeight } = page.getSize()
        const box = calculatePdfCropBox(pageWidth, pageHeight, left, top, width, height)
        page.setCropBox(box.x, box.y, box.width, box.height)
      })
      postProgress(taskId, 12 + 72 * (index + 1) / files.length, `正在裁剪 ${index + 1}/${files.length} 份 PDF…`)
      await publishPdf(`${cleanOutputName(files[index].name)}-cropped.pdf`, source)
    }
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
