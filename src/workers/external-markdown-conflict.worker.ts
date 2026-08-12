/// <reference lib="webworker" />
import { externalMarkdownConflictPreview } from '@/lib/external-markdown-conflict'

type Request = { id: number; base: string; draft: string; disk: string }

self.onmessage = ({ data }: MessageEvent<Request>) => {
  try {
    self.postMessage({ id: data.id, preview: externalMarkdownConflictPreview(data.base, data.draft, data.disk) })
  } catch (error) {
    self.postMessage({ id: data.id, error: error instanceof Error ? error.message : '无法建立冲突差异。' })
  }
}
