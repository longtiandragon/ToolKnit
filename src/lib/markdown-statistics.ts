export interface MarkdownStatistics {
  charactersWithSpaces: number
  charactersWithoutWhitespace: number
  cjkCharacters: number
  latinWords: number
  paragraphs: number
  lines: number
  headings: number
  codeLines: number
  readingMinutes: number
}

/**
 * Produces source-preserving Markdown statistics in one linear scan. The
 * desktop editor runs this in a Worker, so even a multi-megabyte note never
 * turns a word-count badge into typing latency.
 */
export function analyzeMarkdownStatistics(source: string): MarkdownStatistics {
  const normalized = source.replace(/\r\n?/g, '\n')
  const lines = normalized ? normalized.split('\n') : []
  let headings = 0
  let codeLines = 0
  let fence: '`' | '~' | undefined
  let fenceLength = 0

  for (const line of lines) {
    const marker = /^ {0,3}(`{3,}|~{3,})/.exec(line)
    if (fence) {
      if (marker && marker[1][0] === fence && marker[1].length >= fenceLength && /^ {0,3}(?:`{3,}|~{3,})[ \t]*$/.test(line)) {
        fence = undefined
        fenceLength = 0
      } else {
        codeLines += 1
      }
      continue
    }
    if (marker) {
      fence = marker[1][0] as '`' | '~'
      fenceLength = marker[1].length
      continue
    }
    if (/^ {0,3}#{1,6}(?:[ \t]+|$)/.test(line)) headings += 1
  }

  const cjkCharacters = normalized.match(/[\u3400-\u9fff\uf900-\ufaff]/g)?.length ?? 0
  const latinWords = normalized.match(/[A-Za-z0-9]+(?:['’-][A-Za-z0-9]+)*/g)?.length ?? 0
  const paragraphs = normalized.trim() ? normalized.split(/\n\s*\n/).filter((block) => block.trim()).length : 0
  const readingUnits = cjkCharacters / 300 + latinWords / 200 + codeLines / 120

  return {
    charactersWithSpaces: normalized.length,
    charactersWithoutWhitespace: normalized.replace(/\s/g, '').length,
    cjkCharacters,
    latinWords,
    paragraphs,
    lines: lines.length,
    headings,
    codeLines,
    readingMinutes: readingUnits > 0 ? Math.max(1, Math.ceil(readingUnits)) : 0,
  }
}

export function markdownStatisticsSummary(statistics: MarkdownStatistics) {
  return [
    'Knitspace Markdown 统计',
    `字符（含空格）：${statistics.charactersWithSpaces}`,
    `字符（不含空格）：${statistics.charactersWithoutWhitespace}`,
    `中文字符：${statistics.cjkCharacters}`,
    `英文/数字词：${statistics.latinWords}`,
    `段落：${statistics.paragraphs}`,
    `行数：${statistics.lines}`,
    `标题：${statistics.headings}`,
    `代码行：${statistics.codeLines}`,
    `预计阅读：${statistics.readingMinutes} 分钟`,
  ].join('\n')
}
