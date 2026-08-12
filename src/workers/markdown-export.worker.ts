import { renderMarkdown } from '@/lib/markdown'

type ExportRenderRequest = { id: number; source: string }
type ExportRenderResponse = { id: number; html?: string; error?: string }

const workerScope = globalThis as unknown as {
  onmessage: ((event: MessageEvent<ExportRenderRequest>) => void) | null
  postMessage(message: ExportRenderResponse): void
}

workerScope.onmessage = ({ data }) => {
  try {
    workerScope.postMessage({ id: data.id, html: renderMarkdown(data.source) })
  } catch (error) {
    workerScope.postMessage({ id: data.id, error: error instanceof Error ? error.message : 'Markdown 导出渲染失败。' })
  }
}
