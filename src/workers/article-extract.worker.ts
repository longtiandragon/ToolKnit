import { extractWebArticle } from '@/lib/html-to-markdown'

self.onmessage = (event: MessageEvent<{ id: string; html: string }>) => {
  const { id, html } = event.data
  try {
    self.postMessage({ id, result: extractWebArticle(html) })
  } catch (error) {
    self.postMessage({ id, error: error instanceof Error ? error.message : '网页正文提取失败。' })
  }
}
