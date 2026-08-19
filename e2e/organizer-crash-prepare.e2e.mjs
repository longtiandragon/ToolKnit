import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'

const manifestPath = join(tmpdir(), 'knitspace-e2e-crash-recovery-state.json')
const fixturePrefix = 'knitspace-e2e-crash-'

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

function isSafeCrashRoot(root) {
  if (typeof root !== 'string') return false
  const absolute = resolve(root)
  const temporaryDirectory = resolve(tmpdir())
  const normalize = (value) => process.platform === 'win32' ? value.toLowerCase() : value
  return normalize(dirname(absolute)) === normalize(temporaryDirectory)
    && basename(absolute).startsWith(fixturePrefix)
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

async function removeStaleFixture() {
  try {
    const stale = JSON.parse(await readFile(manifestPath, 'utf8'))
    if (isSafeCrashRoot(stale.root)) {
      await rm(resolve(stale.root), { recursive: true, force: true })
    }
  } catch (error) {
    if (error?.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error
  }
  await rm(manifestPath, { force: true })
}

async function waitForPostMoveState(sourceFile, targetFile) {
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    if (!(await pathExists(sourceFile)) && await pathExists(targetFile)) return
    await new Promise((resolveWait) => setTimeout(resolveWait, 100))
  }
  assert.fail('The E2E process terminated before leaving the expected recoverable move on disk.')
}

describe('Knitspace organizer crash setup', () => {
  it('arms an abrupt termination after a journaled move', async () => {
    await waitForRuntime()
    await removeStaleFixture()
    const root = await mkdtemp(join(tmpdir(), fixturePrefix))
    assert.ok(isSafeCrashRoot(root))
    const sourceRoot = join(root, 'source')
    const archiveRoot = join(root, 'archive')
    const sourceFile = join(sourceRoot, '崩溃恢复.txt')
    const targetFile = join(archiveRoot, '恢复验证', '崩溃后恢复.txt')
    const body = '应用异常退出后，启动边界必须把同盘移动恢复到原位置。'
    await mkdir(sourceRoot)
    await mkdir(archiveRoot)
    await writeFile(sourceFile, body, 'utf8')
    const receiptIdsBefore = (await invoke('list_smart_organizer_receipts'))
      .map((receipt) => receipt.receiptId)
      .sort()
    const scanResult = await invoke('scan_smart_organizer', {
      request: { sourceRoot, archiveRoot },
    })
    assert.equal(scanResult.sameVolume, true)
    const manifest = {
      root,
      sourceFile,
      targetFile,
      targetDirectory: dirname(targetFile),
      body,
      receiptIdsBefore,
      armed: false,
    }
    await writeFile(manifestPath, JSON.stringify(manifest), 'utf8')

    const report = await invoke('execute_smart_organizer', {
      runId: randomUUID(),
      request: {
        scanId: scanResult.scanId,
        trustLevel: 'confirmed',
        items: [{
          fileId: scanResult.candidates[0].fileId,
          category: '__knitspace_e2e_abort_after_operation__',
          targetRelativeDir: '恢复验证',
          targetBaseName: '崩溃后恢复',
          confidence: 1,
          conflictPolicy: 'block',
        }],
      },
    })
    assert.equal(report.movedCount, 1)
    assert.ok(Number.isSafeInteger(report.e2eProcessId) && report.e2eProcessId > 0)
    await waitForPostMoveState(sourceFile, targetFile)
    assert.equal(await readFile(targetFile, 'utf8'), body)
    await writeFile(manifestPath, JSON.stringify({
      ...manifest,
      armed: true,
      processId: report.e2eProcessId,
    }), 'utf8')
  })
})
