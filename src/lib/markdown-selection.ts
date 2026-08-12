export function markdownSelectionTitle(source: string, fallback = '未命名内容', maxLength = 36) {
  const firstVisibleLine = source
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean)
    ?.replace(/^#{1,6}\s+/, '')
    .replace(/^[-*+]\s+/, '')
    .replace(/^>\s?/, '')
    .replace(/^[`*_~]+|[`*_~]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim()

  if (!firstVisibleLine) return fallback
  if (firstVisibleLine.length <= maxLength) return firstVisibleLine
  return `${firstVisibleLine.slice(0, Math.max(1, maxLength - 1)).trimEnd()}…`
}
