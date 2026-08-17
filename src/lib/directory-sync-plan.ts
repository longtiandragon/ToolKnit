import type { DirectoryCompareItem, DirectoryCompareReport } from './file-health-native'

export type DirectorySyncDirection = 'left-to-right' | 'right-to-left'
export type DirectorySyncPlanAction = 'copy-missing' | 'keep-target' | 'conflict' | 'review' | 'same'

export interface DirectorySyncPlanItem {
  relativePath: string
  action: DirectorySyncPlanAction
  source?: 'left' | 'right'
  target?: 'left' | 'right'
  sourceBytes?: number
  targetBytes?: number
  detail: string
}

export interface DirectorySyncPlan {
  direction: DirectorySyncDirection
  sourceRoot: string
  targetRoot: string
  copyCount: number
  copyBytes: number
  keepTargetCount: number
  conflictCount: number
  reviewCount: number
  sameCount: number
  partial: boolean
  warnings: string[]
  items: DirectorySyncPlanItem[]
}

function sideForDirection(direction: DirectorySyncDirection) {
  return direction === 'left-to-right'
    ? { source: 'left' as const, target: 'right' as const, sourceRoot: 'leftRoot' as const, targetRoot: 'rightRoot' as const, missingStatus: 'removed' as const, targetOnlyStatus: 'added' as const }
    : { source: 'right' as const, target: 'left' as const, sourceRoot: 'rightRoot' as const, targetRoot: 'leftRoot' as const, missingStatus: 'added' as const, targetOnlyStatus: 'removed' as const }
}

function sizeForSide(item: DirectoryCompareItem, side: 'left' | 'right') {
  return side === 'left' ? item.leftSize : item.rightSize
}

function isSafeRelativePath(value: string) {
  if (!value || /^[\\/]|^[a-z]:/i.test(value)) return false
  return !value.split(/[\\/]/).some(segment => !segment || segment === '.' || segment === '..')
}

/**
 * Produces a deliberately non-destructive, one-way directory sync preview.
 * Only files missing from the target become copy candidates. Existing target
 * files are never replaced or deleted; changed and unverified entries always
 * require manual review before a future sync runner could handle them.
 */
export function buildDirectorySyncPreview(report: DirectoryCompareReport, direction: DirectorySyncDirection): DirectorySyncPlan {
  const sides = sideForDirection(direction)
  const items: DirectorySyncPlanItem[] = []
  let copyCount = 0
  let copyBytes = 0
  let keepTargetCount = 0
  let conflictCount = 0
  let reviewCount = 0
  let sameCount = 0

  for (const item of report.items) {
    const sourceBytes = sizeForSide(item, sides.source)
    const targetBytes = sizeForSide(item, sides.target)
    const base = {
      relativePath: item.relativePath,
      source: sides.source,
      target: sides.target,
      sourceBytes,
      targetBytes,
    }

    if (!isSafeRelativePath(item.relativePath)) {
      reviewCount += 1
      items.push({ ...base, action: 'review', detail: '路径不适合纳入自动操作预览，请人工复核。' })
      continue
    }

    if (item.status === 'same') {
      sameCount += 1
      items.push({ ...base, action: 'same', detail: '两侧内容已一致，无需处理。' })
      continue
    }

    if (item.status === sides.missingStatus && typeof sourceBytes === 'number') {
      copyCount += 1
      copyBytes += sourceBytes
      items.push({ ...base, action: 'copy-missing', detail: '目标缺少该文件；仅列为补齐候选，不会自动复制。' })
      continue
    }

    if (item.status === sides.targetOnlyStatus) {
      keepTargetCount += 1
      items.push({ ...base, action: 'keep-target', detail: '该文件只存在于目标目录；预览会保留它，不删除也不移动。' })
      continue
    }

    if (item.status === 'changed') {
      conflictCount += 1
      items.push({ ...base, action: 'conflict', detail: '两侧文件内容不同；为避免覆盖，必须人工决定。' })
      continue
    }

    reviewCount += 1
    items.push({ ...base, action: 'review', detail: '未能确认两侧内容；不会列为复制或覆盖候选。' })
  }

  const directionLabel = direction === 'left-to-right' ? '左侧补齐到右侧' : '右侧补齐到左侧'
  const warnings = [
    `当前为“${directionLabel}”的只读预览：不会复制、覆盖、删除或修改任何文件。`,
    '仅把目标缺少的文件列为候选；目标独有文件会保留，内容不同或未校验文件必须人工复核。',
  ]
  if (report.truncated) warnings.push('原始目录对比触及安全上限，以下计划仅覆盖已展示的项目，不能作为完整同步清单。')

  return {
    direction,
    sourceRoot: report[sides.sourceRoot],
    targetRoot: report[sides.targetRoot],
    copyCount,
    copyBytes,
    keepTargetCount,
    conflictCount,
    reviewCount,
    sameCount,
    partial: report.truncated,
    warnings,
    items,
  }
}
