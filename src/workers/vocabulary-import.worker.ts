import { parseVocabularyImport } from '@/lib/vocabulary-import'

self.onmessage = (event: MessageEvent<{ requestId: number; source: string }>) => {
  const { requestId, source } = event.data
  self.postMessage({ requestId, result: parseVocabularyImport(source) })
}
