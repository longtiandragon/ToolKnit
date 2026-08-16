export interface PdfTextItemForRedaction {
  str?: string
  transform?: number[]
  width?: number
}

export interface RedactionRectangle {
  x: number
  y: number
  width: number
  height: number
}

export function parseRedactionTerms(value: string) {
  return [...new Set(value
    .split(/[，,\n\r;；]+/)
    .map((term) => term.trim())
    .filter(Boolean))].slice(0, 100)
}

export function matchesRedactionTerm(text: string, terms: string[]) {
  const normalized = text.trim().toLocaleLowerCase()
  return normalized.length > 0 && terms.some((term) => normalized.includes(term.toLocaleLowerCase()))
}

/** Convert a pdf.js text item into a conservative canvas rectangle. */
export function redactionRectangle(
  item: PdfTextItemForRedaction,
  viewportTransform: number[],
  viewportScale: number,
  terms: string[],
  padding = 2,
): RedactionRectangle | undefined {
  if (!item.str || !item.transform || item.transform.length < 6 || !matchesRedactionTerm(item.str, terms)) return undefined
  const [a, b, c, d, e, f] = item.transform
  const x = viewportTransform[0] * e + viewportTransform[2] * f + viewportTransform[4]
  const baseline = viewportTransform[1] * e + viewportTransform[3] * f + viewportTransform[5]
  const height = Math.max(Math.hypot(viewportTransform[1] * a + viewportTransform[3] * c, viewportTransform[1] * b + viewportTransform[3] * d), 8 * viewportScale)
  const width = Math.max(Math.abs(item.width ?? (a || d)) * viewportScale, height / 2)
  return {
    x: x - padding,
    y: baseline - height - padding,
    width: width + padding * 2,
    height: height + padding * 2,
  }
}
