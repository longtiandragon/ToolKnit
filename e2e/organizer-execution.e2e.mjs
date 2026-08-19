import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, parse, resolve } from 'node:path'

const fixtureRoots = new Set()
const fixturePrefixes = [
  'knitspace-e2e-execute-',
  'knitspace-e2e-conflict-',
  'knitspace-e2e-rollback-',
  'knitspace-e2e-cross-source-',
  'knitspace-e2e-cross-archive-',
]

async function invoke(command, args = {}) {
  return browser.tauri.execute(
    ({ core }, payload) => core.invoke(payload.command, payload.args),
    { command, args },
  )
}

async function waitForRuntime() {
  await browser.waitUntil(
    () => browser.execute(() => document.documentElement.dataset.e2eRuntime === 'ready'),
    { timeout: 30_000, timeoutMsg: 'E2E runtime did not initialize.' },
  )
}

function assertSafeFixtureRoot(root) {
  const absolute = resolve(root)
  assert.notEqual(absolute, parse(absolute).root, 'A fixture root must never be a volume root.')
  assert.ok(
    fixturePrefixes.some((prefix) => basename(absolute).startsWith(prefix)),
    `Refusing to remove an unexpected fixture path: ${absolute}`,
  )
  return absolute
}

async function createFixture(base, prefix) {
  const root = await mkdtemp(join(base, prefix))
  fixtureRoots.add(assertSafeFixtureRoot(root))
  return root
}

async function pathExists(path) {
  try {
    await stat(path)
    return true
  } catch (error) {
    if (error?.code === 'ENOENT') return false
    throw error
  }
}

async function rejectionText(work) {
  let rejection
  try {
    await work()
  } catch (error) {
    rejection = error
  }
  assert.ok(rejection, 'Expected the native command to reject.')
  if (typeof rejection === 'string') return rejection
  try {
    return `${rejection?.message ?? ''} ${JSON.stringify(rejection)}`
  } catch {
    return String(rejection)
  }
}

function planItem(candidate, targetRelativeDir, targetBaseName, category = 'E2E 安全验证') {
  return {
    fileId: candidate.fileId,
    category,
    targetRelativeDir,
    targetBaseName,
    confidence: 1,
    conflictPolicy: 'block',
  }
}

async function scan(sourceRoot, archiveRoot) {
  return invoke('scan_smart_organizer', { request: { sourceRoot, archiveRoot } })
}

async function execute(scanResult, items) {
  return invoke('execute_smart_organizer', {
    runId: randomUUID(),
    request: {
      scanId: scanResult.scanId,
      trustLevel: 'confirmed',
      items,
    },
  })
}

async function receiptIds() {
  return (await invoke('list_smart_organizer_receipts'))
    .map((receipt) => receipt.receiptId)
    .sort()
}

async function volumeKey(path) {
  if (process.platform === 'win32') return parse(resolve(path)).root.toLowerCase()
  return String((await stat(path)).dev)
}

async function crossVolumeRoots() {
  const candidates = [
    tmpdir(),
    process.cwd(),
    process.env.LOCALAPPDATA,
    process.env.TEMP,
    process.env.TMP,
    process.platform === 'linux' ? '/dev/shm' : undefined,
  ].filter(Boolean)
  const unique = [...new Set(candidates.map((value) => resolve(value)))]
  for (let sourceIndex = 0; sourceIndex < unique.length; sourceIndex += 1) {
    let sourceKey
    try {
      sourceKey = await volumeKey(unique[sourceIndex])
    } catch {
      continue
    }
    for (let archiveIndex = sourceIndex + 1; archiveIndex < unique.length; archiveIndex += 1) {
      try {
        if (sourceKey === await volumeKey(unique[archiveIndex])) continue
        const sourceRoot = await createFixture(unique[sourceIndex], 'knitspace-e2e-cross-source-')
        try {
          const archiveRoot = await createFixture(unique[archiveIndex], 'knitspace-e2e-cross-archive-')
          return { sourceRoot, archiveRoot }
        } catch {
          fixtureRoots.delete(sourceRoot)
          await rm(assertSafeFixtureRoot(sourceRoot), { recursive: true, force: true })
        }
      } catch {
        // Try the next known writable base directory.
      }
    }
  }
  return null
}

describe('Knitspace organizer native execution safety', () => {
  before(async () => {
    await waitForRuntime()
  })

  after(async () => {
    for (const root of fixtureRoots) {
      await rm(assertSafeFixtureRoot(root), { recursive: true, force: true })
    }
  })

  it('moves on one volume, records a receipt, and restores the original on undo', async () => {
    const root = await createFixture(tmpdir(), 'knitspace-e2e-execute-')
    const sourceRoot = join(root, 'source')
    const archiveRoot = join(root, 'archive')
    const sourceFile = join(sourceRoot, '课程资料.txt')
    const targetFile = join(archiveRoot, '课程', '课程归档.txt')
    const body = 'Knitspace 原生 E2E：同盘移动必须可撤销。'
    await mkdir(sourceRoot)
    await mkdir(archiveRoot)
    await writeFile(sourceFile, body, 'utf8')

    const scanResult = await scan(sourceRoot, archiveRoot)
    assert.equal(scanResult.sameVolume, true)
    const report = await execute(scanResult, [
      planItem(scanResult.candidates[0], '课程', '课程归档'),
    ])

    assert.equal(report.movedCount, 1)
    assert.equal(report.copiedCount, 0)
    assert.equal(await pathExists(sourceFile), false)
    assert.equal(await readFile(targetFile, 'utf8'), body)
    const receipt = (await invoke('list_smart_organizer_receipts'))
      .find((item) => item.receiptId === report.receiptId)
    assert.deepEqual(
      { status: receipt?.status, movedCount: receipt?.movedCount, copiedCount: receipt?.copiedCount },
      { status: 'ready', movedCount: 1, copiedCount: 0 },
    )

    const undo = await invoke('undo_smart_organizer', { receiptId: report.receiptId })
    assert.equal(undo.restoredCount, 1)
    assert.equal(undo.removedCopyCount, 0)
    assert.equal(await readFile(sourceFile, 'utf8'), body)
    assert.equal(await pathExists(targetFile), false)
    assert.equal(await pathExists(dirname(targetFile)), false)
    assert.ok(!(await receiptIds()).includes(report.receiptId))
  })

  it('rejects changed input and an occupied target without overwriting either file', async () => {
    const root = await createFixture(tmpdir(), 'knitspace-e2e-conflict-')
    const sourceRoot = join(root, 'source')
    const archiveRoot = join(root, 'archive')
    await mkdir(sourceRoot)
    await mkdir(archiveRoot)

    const changedSource = join(sourceRoot, '变化检测.txt')
    const changedTarget = join(archiveRoot, '安全', '变化检测归档.txt')
    await writeFile(changedSource, '扫描时内容', 'utf8')
    const changedScan = await scan(sourceRoot, archiveRoot)
    const changedBody = '扫描完成后内容已经发生明显变化，必须拒绝执行。'
    await writeFile(changedSource, changedBody, 'utf8')
    const receiptsBeforeChange = await receiptIds()
    const changedError = await rejectionText(() => execute(changedScan, [
      planItem(changedScan.candidates[0], '安全', '变化检测归档'),
    ]))
    assert.match(changedError, /变化/)
    assert.equal(await readFile(changedSource, 'utf8'), changedBody)
    assert.equal(await pathExists(changedTarget), false)
    assert.deepEqual(await receiptIds(), receiptsBeforeChange)

    const occupiedSource = join(sourceRoot, '占用检测.txt')
    const occupiedTarget = join(archiveRoot, '安全', '占用检测归档.txt')
    const occupiedBody = '来源文件必须保留。'
    const sentinel = '已经存在的目标文件绝不能被覆盖。'
    await writeFile(occupiedSource, occupiedBody, 'utf8')
    const occupiedScan = await scan(sourceRoot, archiveRoot)
    const candidate = occupiedScan.candidates.find((item) => item.name === '占用检测.txt')
    assert.ok(candidate)
    await mkdir(dirname(occupiedTarget), { recursive: true })
    await writeFile(occupiedTarget, sentinel, 'utf8')
    const receiptsBeforeConflict = await receiptIds()
    const conflictError = await rejectionText(() => execute(occupiedScan, [
      planItem(candidate, '安全', '占用检测归档'),
    ]))
    assert.match(conflictError, /不会覆盖/)
    assert.equal(await readFile(occupiedSource, 'utf8'), occupiedBody)
    assert.equal(await readFile(occupiedTarget, 'utf8'), sentinel)
    assert.deepEqual(await receiptIds(), receiptsBeforeConflict)
  })

  it('rolls back earlier moves when a later native operation fails', async () => {
    const root = await createFixture(tmpdir(), 'knitspace-e2e-rollback-')
    const sourceRoot = join(root, 'source')
    const archiveRoot = join(root, 'archive')
    const firstSource = join(sourceRoot, '第一项.txt')
    const secondSource = join(sourceRoot, '第二项.txt')
    const firstTarget = join(archiveRoot, '回滚', '第一项归档.txt')
    const secondTarget = join(archiveRoot, '回滚', '第二项归档.txt')
    const firstBody = '第一项会先移动，然后必须被反向恢复。'
    const secondBody = '第二项触发测试专用失败。内容长度不同。'
    await mkdir(sourceRoot)
    await mkdir(archiveRoot)
    await writeFile(firstSource, firstBody, 'utf8')
    await writeFile(secondSource, secondBody, 'utf8')
    const scanResult = await scan(sourceRoot, archiveRoot)
    const first = scanResult.candidates.find((item) => item.name === '第一项.txt')
    const second = scanResult.candidates.find((item) => item.name === '第二项.txt')
    assert.ok(first && second)
    const receiptsBefore = await receiptIds()

    const error = await rejectionText(() => execute(scanResult, [
      planItem(first, '回滚', '第一项归档'),
      planItem(second, '回滚', '第二项归档', '__knitspace_e2e_fail_before_operation__'),
    ]))

    assert.match(error, /已回滚本次已完成的变更/)
    assert.equal(await readFile(firstSource, 'utf8'), firstBody)
    assert.equal(await readFile(secondSource, 'utf8'), secondBody)
    assert.equal(await pathExists(firstTarget), false)
    assert.equal(await pathExists(secondTarget), false)
    assert.equal(await pathExists(dirname(firstTarget)), false)
    assert.deepEqual(await receiptIds(), receiptsBefore)
  })

  it('copies across volumes, keeps the original, and removes only the copy on undo', async function () {
    const roots = await crossVolumeRoots()
    if (!roots) {
      if (process.platform === 'win32') {
        assert.fail('Windows desktop E2E requires two writable volumes for the cross-volume safety case.')
      }
      this.skip()
    }
    const { sourceRoot, archiveRoot } = roots
    const sourceFile = join(sourceRoot, '跨盘原件.txt')
    const targetFile = join(archiveRoot, '跨盘', '跨盘归档.txt')
    const body = '跨盘整理只能复制并保留原件。'
    await writeFile(sourceFile, body, 'utf8')

    const scanResult = await scan(sourceRoot, archiveRoot)
    assert.equal(scanResult.sameVolume, false)
    const report = await execute(scanResult, [
      planItem(scanResult.candidates[0], '跨盘', '跨盘归档'),
    ])
    assert.equal(report.movedCount, 0)
    assert.equal(report.copiedCount, 1)
    assert.equal(await readFile(sourceFile, 'utf8'), body)
    assert.equal(await readFile(targetFile, 'utf8'), body)

    const undo = await invoke('undo_smart_organizer', { receiptId: report.receiptId })
    assert.equal(undo.restoredCount, 0)
    assert.equal(undo.removedCopyCount, 1)
    assert.equal(await readFile(sourceFile, 'utf8'), body)
    assert.equal(await pathExists(targetFile), false)
    assert.ok(!(await receiptIds()).includes(report.receiptId))
  })
})
