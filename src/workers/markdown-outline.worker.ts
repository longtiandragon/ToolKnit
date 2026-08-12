/// <reference lib="webworker" />
import { extractMarkdownOutline, type MarkdownOutlineItem } from '@/lib/markdown-outline'

type OutlineRequest = { id: number; source: string }
type OutlineResponse = { id: number; items?: MarkdownOutlineItem[]; error?: string }

const workerScope = globalThis as unknown as {
  onmessage: ((event: MessageEvent<OutlineRequest>) => void) | null
  postMessage(message: OutlineResponse): void
}

// This is intentionally separate from the full preview worker. Building an
// outline for a 5 MB note should not load Markdown-It, KaTeX or Mermaid, and
// must stay available while the reader view is intentionally deferred.
workerScope.onmessage = ({ data }) => {
  try {
    workerScope.postMessage({ id: data.id, items: extractMarkdownOutline(data.source) })
  } catch (error) {
    workerScope.postMessage({ id: data.id, error: error instanceof Error ? error.message : '无法建立 Markdown 大纲。' })
  }
}
