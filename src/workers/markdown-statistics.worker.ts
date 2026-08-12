import { analyzeMarkdownStatistics } from '@/lib/markdown-statistics'

type StatisticsRequest = { id: number; source: string }
type StatisticsResponse = { id: number; statistics?: ReturnType<typeof analyzeMarkdownStatistics>; error?: string }

const workerScope = globalThis as unknown as {
  onmessage: ((event: MessageEvent<StatisticsRequest>) => void) | null
  postMessage(message: StatisticsResponse): void
}

workerScope.onmessage = ({ data }) => {
  try {
    workerScope.postMessage({ id: data.id, statistics: analyzeMarkdownStatistics(data.source) })
  } catch (error) {
    workerScope.postMessage({ id: data.id, error: error instanceof Error ? error.message : '无法统计 Markdown。' })
  }
}
