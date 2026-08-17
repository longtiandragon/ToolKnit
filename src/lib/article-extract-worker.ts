import type { WebArticleExtraction } from './html-to-markdown'

const ARTICLE_EXTRACTION_TIMEOUT_MS = 15_000

export function extractWebArticleAsync(html: string, signal?: AbortSignal) {
  return new Promise<WebArticleExtraction>((resolve, reject) => {
    const worker = new Worker(new URL('../workers/article-extract.worker.ts', import.meta.url), { type: 'module' })
    const id = crypto.randomUUID()
    const timer = window.setTimeout(() => {
      worker.terminate()
      reject(new Error('网页源码较复杂，正文提取已在 15 秒后停止。'))
    }, ARTICLE_EXTRACTION_TIMEOUT_MS)
    const finish = () => {
      window.clearTimeout(timer)
      signal?.removeEventListener('abort', abort)
      worker.terminate()
    }
    const abort = () => {
      finish()
      reject(new DOMException('网页正文提取已取消。', 'AbortError'))
    }
    worker.onmessage = (event: MessageEvent<{ id: string; result?: WebArticleExtraction; error?: string }>) => {
      if (event.data.id !== id) return
      finish()
      if (event.data.result) resolve(event.data.result)
      else reject(new Error(event.data.error || '网页正文提取失败。'))
    }
    worker.onerror = () => {
      finish()
      reject(new Error('网页正文提取 Worker 异常退出。'))
    }
    if (signal?.aborted) { abort(); return }
    signal?.addEventListener('abort', abort, { once: true })
    worker.postMessage({ id, html })
  })
}
