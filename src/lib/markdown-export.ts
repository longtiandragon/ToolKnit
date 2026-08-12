import { decodeMermaidSource, renderMermaidSource } from '@/lib/mermaid-renderer'
import { readDesktopVaultMarkdownImage, readExternalMarkdownImage } from '@/lib/native'
import { standaloneMarkdownHtml } from '@/lib/markdown-export-document'

export type MarkdownExportStage = 'render' | 'images' | 'diagrams' | 'assemble'
export type MarkdownExportProgress = { stage: MarkdownExportStage; completed: number; total: number; detail: string }

const MAX_EXPORT_IMAGES = 120
const MAX_EXPORT_DIAGRAMS = 60
let exportRequestId = 0

function isRelativeLocalImage(source: string) {
  const value = source.trim()
  return Boolean(value) && !value.startsWith('/') && !value.startsWith('\\') && !value.startsWith('//') && !/^[a-z][a-z\d+.-]*:/i.test(value)
}

export function renderMarkdownInWorker(source: string) {
  return new Promise<string>((resolve, reject) => {
    const worker = new Worker(new URL('../workers/markdown-export.worker.ts', import.meta.url), { type: 'module' })
    const id = ++exportRequestId
    const cleanup = () => worker.terminate()
    worker.onmessage = ({ data }: MessageEvent<{ id: number; html?: string; error?: string }>) => {
      if (data.id !== id) return
      cleanup()
      if (data.error) reject(new Error(data.error))
      else resolve(data.html ?? '')
    }
    worker.onerror = (event) => { cleanup(); reject(new Error(event.message || 'Markdown 导出 Worker 无法运行。')) }
    worker.postMessage({ id, source })
  })
}

async function embedRelativeImages(root: HTMLElement, documentId: string, externalMarkdownPath: string, progress?: (value: MarkdownExportProgress) => void) {
  const images = [...root.querySelectorAll<HTMLImageElement>('img[src]')].filter(image => isRelativeLocalImage(image.getAttribute('src') ?? ''))
  if (images.length > MAX_EXPORT_IMAGES) throw new Error(`文档包含 ${images.length} 张本地图片，超过单次导出上限 ${MAX_EXPORT_IMAGES}；请拆分文档后导出。`)
  for (let index = 0; index < images.length; index += 1) {
    const image = images[index]!
    const source = image.getAttribute('src') ?? ''
    progress?.({ stage: 'images', completed: index, total: images.length, detail: `正在嵌入图片 ${index + 1} / ${images.length}` })
    image.src = externalMarkdownPath
      ? await readExternalMarkdownImage(externalMarkdownPath, source)
      : await readDesktopVaultMarkdownImage(documentId, source)
    image.removeAttribute('loading')
  }
  progress?.({ stage: 'images', completed: images.length, total: images.length, detail: images.length ? `已嵌入 ${images.length} 张本地图片` : '没有需要嵌入的本地图片' })
}

async function renderDiagrams(root: HTMLElement, progress?: (value: MarkdownExportProgress) => void) {
  const diagrams = [...root.querySelectorAll<HTMLElement>('.markdown-mermaid[data-mermaid-source]')]
  if (diagrams.length > MAX_EXPORT_DIAGRAMS) throw new Error(`文档包含 ${diagrams.length} 个 Mermaid 图表，超过单次导出上限 ${MAX_EXPORT_DIAGRAMS}；请拆分文档后导出。`)
  for (let index = 0; index < diagrams.length; index += 1) {
    const diagram = diagrams[index]!
    progress?.({ stage: 'diagrams', completed: index, total: diagrams.length, detail: `正在绘制图表 ${index + 1} / ${diagrams.length}` })
    const source = decodeMermaidSource(diagram.dataset.mermaidSource)
    const canvas = diagram.querySelector<HTMLElement>('.markdown-mermaid__canvas')
    if (source && canvas) canvas.innerHTML = await renderMermaidSource(source)
    diagram.removeAttribute('tabindex')
    diagram.removeAttribute('aria-busy')
    diagram.removeAttribute('data-mermaid-state')
    diagram.removeAttribute('data-mermaid-source')
  }
  progress?.({ stage: 'diagrams', completed: diagrams.length, total: diagrams.length, detail: diagrams.length ? `已绘制 ${diagrams.length} 个 Mermaid 图表` : '没有需要绘制的 Mermaid 图表' })
}

export async function exportMarkdownHtml(input: { title: string; source: string; documentId: string; externalMarkdownPath?: string; onProgress?: (value: MarkdownExportProgress) => void }) {
  input.onProgress?.({ stage: 'render', completed: 0, total: 1, detail: '正在后台排版 Markdown、代码与公式' })
  const rendered = await renderMarkdownInWorker(input.source)
  input.onProgress?.({ stage: 'render', completed: 1, total: 1, detail: 'Markdown 排版完成' })
  const parsed = new DOMParser().parseFromString(`<main id="knitspace-export-root">${rendered}</main>`, 'text/html')
  const root = parsed.querySelector<HTMLElement>('#knitspace-export-root')
  if (!root) throw new Error('无法建立导出文档。')
  await embedRelativeImages(root, input.documentId, input.externalMarkdownPath ?? '', input.onProgress)
  await renderDiagrams(root, input.onProgress)
  input.onProgress?.({ stage: 'assemble', completed: 0, total: 1, detail: '正在生成独立 HTML 文件' })
  const html = standaloneMarkdownHtml(input.title, root.innerHTML)
  input.onProgress?.({ stage: 'assemble', completed: 1, total: 1, detail: '独立 HTML 已生成' })
  return html
}
