import { highlightCode } from '@/lib/code-highlight'
import { renderMarkdownBlocksCached, renderMarkdownCached } from '@/lib/markdown'
import katex from 'katex'

type RenderRequest = { type: 'render'; id: number; source: string; progressive?: boolean }
type HighlightRequest = { type: 'highlight'; id: number; source: string; language: string }
type MathRequest = { type: 'math'; id: number; source: string; displayMode: boolean }
type PreviewRequest = RenderRequest | HighlightRequest | MathRequest
type RenderResponse = { type: 'render' | 'highlight' | 'math'; id: number; html?: string; htmlBlocks?: string[]; error?: string }

// Markdown-it, KaTeX and syntax highlighting are all string transformations.
// Keeping them in a dedicated worker means a long preview cannot block typing,
// scrolling or context-menu input on the desktop UI thread.
const workerScope = globalThis as unknown as {
  onmessage: ((event: MessageEvent<PreviewRequest>) => void) | null
  postMessage(message: RenderResponse): void
}

workerScope.onmessage = ({ data }) => {
  try {
    if (data.type === 'render' && data.progressive) {
      const htmlBlocks = renderMarkdownBlocksCached(data.source, true)
      if (htmlBlocks) {
        workerScope.postMessage({ type: 'render', id: data.id, htmlBlocks })
        return
      }
    }
    const html = data.type === 'render'
      ? renderMarkdownCached(data.source, true)
      : data.type === 'highlight'
        ? highlightCode(data.source, data.language)
        : katex.renderToString(data.source, { displayMode: data.displayMode, throwOnError: false })
    workerScope.postMessage({ type: data.type, id: data.id, html })
  } catch (error) {
    workerScope.postMessage({ type: data.type, id: data.id, error: error instanceof Error ? error.message : 'Markdown 预览渲染失败。' })
  }
}
