export interface PdfComparePageSnapshot {
  text: string
  width: number
  height: number
}

export type PdfComparePageStatus = 'same' | 'changed' | 'added' | 'removed' | 'unverified'

export interface PdfComparePageResult {
  page: number
  status: PdfComparePageStatus
  left?: PdfComparePageSnapshot
  right?: PdfComparePageSnapshot
}

export const PDF_COMPARE_TEXT_LIMIT = 20_000

export function normalizePdfComparisonText(value: string) {
  return value
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, PDF_COMPARE_TEXT_LIMIT)
}

export function comparePdfPageSnapshots(left?: PdfComparePageSnapshot, right?: PdfComparePageSnapshot): PdfComparePageStatus {
  if (!left && right) return 'added'
  if (left && !right) return 'removed'
  if (!left || !right) return 'unverified'
  const dimensionsMatch = Math.abs(left.width - right.width) < 0.1 && Math.abs(left.height - right.height) < 0.1
  const leftText = normalizePdfComparisonText(left.text)
  const rightText = normalizePdfComparisonText(right.text)
  const textMatch = leftText === rightText
  if (!left.text.trim() && !right.text.trim() && dimensionsMatch) return 'unverified'
  if (textMatch && (leftText.length >= PDF_COMPARE_TEXT_LIMIT || rightText.length >= PDF_COMPARE_TEXT_LIMIT)) return 'unverified'
  return textMatch && dimensionsMatch ? 'same' : 'changed'
}

export function pdfCompareStatusLabel(status: PdfComparePageStatus) {
  return status === 'same' ? '相同' : status === 'changed' ? '已变化' : status === 'added' ? '右侧新增' : status === 'removed' ? '右侧缺失' : '未验证'
}

function previewText(value: string) {
  const normalized = normalizePdfComparisonText(value)
  if (!normalized) return '（无文字层，可能是扫描页）'
  return normalized.length > 180 ? `${normalized.slice(0, 180)}…` : normalized
}

export function buildPdfCompareReport(leftName: string, rightName: string, pages: PdfComparePageResult[]) {
  const counts = pages.reduce<Record<PdfComparePageStatus, number>>((result, page) => {
    result[page.status] += 1
    return result
  }, { same: 0, changed: 0, added: 0, removed: 0, unverified: 0 })
  const lines = [
    'PDF 页面级差异报告',
    `左侧：${leftName}`,
    `右侧：${rightName}`,
    `页面总数：${pages.length} · 相同 ${counts.same} · 变化 ${counts.changed} · 右侧新增 ${counts.added} · 右侧缺失 ${counts.removed} · 未验证 ${counts.unverified}`,
    '说明：本报告比较文字层和页面尺寸；没有文字层的扫描页只标记为“未验证”，不会声称像素级相同。',
    '',
  ]
  for (const page of pages) {
    const leftSize = page.left ? `左 ${Math.round(page.left.width)}×${Math.round(page.left.height)}` : '左无此页'
    const rightSize = page.right ? `右 ${Math.round(page.right.width)}×${Math.round(page.right.height)}` : '右无此页'
    lines.push(`第 ${page.page} 页 · ${pdfCompareStatusLabel(page.status)} · ${leftSize} · ${rightSize}`)
    if (page.status === 'changed' || page.status === 'unverified') {
      lines.push(`  左：${previewText(page.left?.text ?? '')}`)
      lines.push(`  右：${previewText(page.right?.text ?? '')}`)
    }
  }
  return lines.join('\n')
}
