export interface CodeLayout {
  fontSize: number
  lineCount: number
  linesPerPage: number
  /** What the automatic rule would pick, so the toolbar can name the default
   * even while a manual count is in force. */
  automaticLinesPerPage: number
  longestLine: number
  pageLineCounts: number[]
  pages: string[]
}

export interface CodeCapturePageEstimate {
  index: number
  /** Height in CSS pixels for the code body only, excluding the card chrome. */
  bodyHeight: number
}

/** Returns the exact source represented by the requested preview pages.
 * Invalid and duplicate indexes are ignored so keyboard/context-menu actions
 * cannot accidentally add blank pages or repeat source text. */
export function joinCodePages(pages: readonly string[], indexes: readonly number[]) {
  const seen = new Set<number>()
  return indexes
    .filter((index) => Number.isInteger(index) && index >= 0 && index < pages.length && !seen.has(index) && seen.add(index))
    .map((index) => pages[index])
    .join('\n')
}

/** A manual page height stays inside what the card and the PNG can carry: too
 * few lines makes hundreds of near-empty pages, too many makes one image the
 * capture step has to split again. */
export const MIN_CODE_LINES_PER_PAGE = 5
export const MAX_CODE_LINES_PER_PAGE = 200

/** Returns a usable manual page height, or 0 for "let the layout decide". */
export function normalizeCodeLinesPerPage(value: unknown) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return 0
  return Math.min(MAX_CODE_LINES_PER_PAGE, Math.max(MIN_CODE_LINES_PER_PAGE, Math.round(value)))
}

const CODE_CAPTURE_WIDTH = 720
const CODE_CAPTURE_HORIZONTAL_PADDING = 60
const CODE_CAPTURE_LINE_NUMBER_WIDTH = 59
const CODE_CAPTURE_VERTICAL_PADDING = 58
const CODE_CAPTURE_MIN_BODY_HEIGHT = 170
const CODE_CAPTURE_CARD_CHROME_HEIGHT = 86

function unicodeCodePointLength(value: string) {
  let length = 0
  for (const _character of value) length++
  return length
}

/**
 * Estimates capture height before we mount an off-screen export card. The
 * deliberately conservative character width keeps a multi-megabyte snippet
 * from briefly creating hundreds of hidden DOM nodes just to learn it is too
 * tall for a single PNG.
 */
export function estimateCodeCapturePageBodyHeight(source: string, fontSize: number, showLineNumbers: boolean, wrapLongLines: boolean) {
  const usableWidth = CODE_CAPTURE_WIDTH - CODE_CAPTURE_HORIZONTAL_PADDING - (showLineNumbers ? CODE_CAPTURE_LINE_NUMBER_WIDTH : 0)
  const charactersPerVisualLine = Math.max(12, Math.floor(usableWidth / Math.max(1, fontSize * .62)))
  const visualLines = source.split('\n').reduce((total, line) => {
    const lineLength = unicodeCodePointLength(line)
    return total + (wrapLongLines ? Math.max(1, Math.ceil(lineLength / charactersPerVisualLine)) : 1)
  }, 0)
  return Math.max(CODE_CAPTURE_MIN_BODY_HEIGHT, Math.ceil(CODE_CAPTURE_VERTICAL_PADDING + visualLines * fontSize * 1.72))
}

/**
 * Divides selected pages into PNG-safe continuous groups while preserving the
 * original order. A single unusually tall page remains alone and is checked
 * against the exact DOM height at capture time.
 */
export function groupCodeCapturePages(pages: CodeCapturePageEstimate[], maximumHeight: number) {
  const safeBodyHeight = Math.max(1, maximumHeight - CODE_CAPTURE_CARD_CHROME_HEIGHT)
  const groups: number[][] = []
  let group: number[] = []
  let groupHeight = 0
  for (const page of pages) {
    if (group.length && groupHeight + page.bodyHeight > safeBodyHeight) {
      groups.push(group)
      group = []
      groupHeight = 0
    }
    group.push(page.index)
    groupHeight += page.bodyHeight
  }
  if (group.length) groups.push(group)
  return groups
}

export function codeLongImageFileNames(total: number) {
  const count = Math.max(1, Math.floor(total))
  return Array.from({ length: count }, (_, index) => count === 1
    ? 'code-long.png'
    : `code-long-${String(index + 1).padStart(2, '0')}.png`)
}

/**
 * The image preview uses a stable, readable column width. Keep the layout
 * calculation isolated so large snippets can run in a Worker instead of
 * repeatedly scanning every line in Vue's render path.
 */
export function calculateCodeLayout(code: string, linesPerPageOverride = 0): CodeLayout {
  const lines = code.split('\n')
  let longestLine = 1
  for (const line of lines) {
    // Count code points without allocating a temporary array for every line.
    // This preserves Emoji/CJK correctness while keeping multi-megabyte code
    // layout cheap enough for repeated Worker requests.
    longestLine = Math.max(longestLine, unicodeCodePointLength(line))
  }

  const fontSize = Math.max(14, Math.min(20, Math.floor(700 / (longestLine * .58))))
  const automaticLinesPerPage = Math.max(20, Math.min(38, Math.round(38 - Math.max(0, longestLine - 76) / 10)))
  const linesPerPage = normalizeCodeLinesPerPage(linesPerPageOverride) || automaticLinesPerPage
  const pages: string[] = []
  const pageLineCounts: number[] = []

  for (let start = 0; start < lines.length; start += linesPerPage) {
    const pageLines = lines.slice(start, start + linesPerPage)
    pages.push(pageLines.join('\n'))
    pageLineCounts.push(pageLines.length)
  }

  return {
    fontSize,
    lineCount: code ? lines.length : 0,
    linesPerPage,
    automaticLinesPerPage,
    longestLine,
    pageLineCounts,
    pages: pages.length ? pages : [''],
  }
}
