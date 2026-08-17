import { describe, expect, it } from 'vitest'
import { buildDirectorySyncPreview } from './directory-sync-plan'
import type { DirectoryCompareReport } from './file-health-native'

function report(items: DirectoryCompareReport['items'], truncated = false): DirectoryCompareReport {
  return {
    leftRoot: 'C:/left',
    rightRoot: 'C:/right',
    scannedLeftFiles: 3,
    scannedRightFiles: 3,
    totalLeftBytes: 30,
    totalRightBytes: 30,
    hashedBytes: 20,
    sameCount: items.filter(item => item.status === 'same').length,
    addedCount: items.filter(item => item.status === 'added').length,
    removedCount: items.filter(item => item.status === 'removed').length,
    changedCount: items.filter(item => item.status === 'changed').length,
    unverifiedCount: items.filter(item => item.status === 'unverified').length,
    truncated,
    warnings: [],
    items,
  }
}

const fixture = report([
  { relativePath: 'only-left.txt', name: 'only-left.txt', status: 'removed', leftSize: 12, detail: 'right missing' },
  { relativePath: 'only-right.txt', name: 'only-right.txt', status: 'added', rightSize: 18, detail: 'right added' },
  { relativePath: 'changed.txt', name: 'changed.txt', status: 'changed', leftSize: 4, rightSize: 5, detail: 'changed' },
  { relativePath: 'unknown.txt', name: 'unknown.txt', status: 'unverified', leftSize: 6, rightSize: 6, detail: 'unknown' },
  { relativePath: 'same.txt', name: 'same.txt', status: 'same', leftSize: 3, rightSize: 3, detail: 'same' },
])

describe('directory sync preview', () => {
  it('only proposes filling files missing from the target when syncing left to right', () => {
    const plan = buildDirectorySyncPreview(fixture, 'left-to-right')

    expect(plan.sourceRoot).toBe('C:/left')
    expect(plan.targetRoot).toBe('C:/right')
    expect(plan.copyCount).toBe(1)
    expect(plan.copyBytes).toBe(12)
    expect(plan.keepTargetCount).toBe(1)
    expect(plan.conflictCount).toBe(1)
    expect(plan.reviewCount).toBe(1)
    expect(plan.items.find(item => item.relativePath === 'only-left.txt')).toMatchObject({ action: 'copy-missing', source: 'left', target: 'right', sourceBytes: 12 })
    expect(plan.items.find(item => item.relativePath === 'only-right.txt')).toMatchObject({ action: 'keep-target' })
    expect(plan.items.find(item => item.relativePath === 'changed.txt')).toMatchObject({ action: 'conflict' })
    expect(plan.warnings.join('\n')).toContain('不会复制、覆盖、删除')
  })

  it('reverses only the missing-file candidate when syncing right to left', () => {
    const plan = buildDirectorySyncPreview(fixture, 'right-to-left')

    expect(plan.sourceRoot).toBe('C:/right')
    expect(plan.targetRoot).toBe('C:/left')
    expect(plan.copyCount).toBe(1)
    expect(plan.copyBytes).toBe(18)
    expect(plan.items.find(item => item.relativePath === 'only-right.txt')).toMatchObject({ action: 'copy-missing', source: 'right', target: 'left', sourceBytes: 18 })
    expect(plan.items.find(item => item.relativePath === 'only-left.txt')).toMatchObject({ action: 'keep-target' })
  })

  it('never treats unsafe paths or truncated comparisons as automatic copy candidates', () => {
    const unsafe = report([
      { relativePath: '../outside.txt', name: 'outside.txt', status: 'removed', leftSize: 8, detail: 'unsafe' },
    ], true)
    const plan = buildDirectorySyncPreview(unsafe, 'left-to-right')

    expect(plan.copyCount).toBe(0)
    expect(plan.reviewCount).toBe(1)
    expect(plan.partial).toBe(true)
    expect(plan.items[0]).toMatchObject({ action: 'review' })
    expect(plan.warnings.join('\n')).toContain('安全上限')
  })
})
