import { parseQuestionImport } from '@/lib/question-import'

self.onmessage = (event: MessageEvent<{ requestId: number; source: string }>) => {
  const { requestId, source } = event.data
  self.postMessage({ requestId, result: parseQuestionImport(source) })
}
