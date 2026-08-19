import assert from 'node:assert/strict'
import { readFile, rm, stat } from 'node:fs/promises'
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
    { timeout: 30_000, timeoutMsg: 'The Tauri process was not restarted after the crash.' },
  )
}

function assertSafeCrashRoot(root) {
  const absolute = resolve(root)
  const temporaryDirectory = resolve(tmpdir())
  const normalize = (value) => process.platform === 'win32' ? value.toLowerCase() : value
  assert.equal(normalize(dirname(absolute)), normalize(temporaryDirectory))
  assert.ok(basename(absolute).startsWith(fixturePrefix))
  return absolute
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

async function waitForRecovery(sourceFile, targetFile) {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    if (await pathExists(sourceFile) && !(await pathExists(targetFile))) return
    await new Promise((resolveWait) => setTimeout(resolveWait, 100))
  }
  assert.fail('Startup recovery did not restore the source and remove the moved target.')
}

describe('Knitspace organizer startup recovery', () => {
  let manifest

  before(async () => {
    manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
    assertSafeCrashRoot(manifest.root)
    await waitForRuntime()
  })

  after(async () => {
    if (manifest?.root) {
      await rm(assertSafeCrashRoot(manifest.root), { recursive: true, force: true })
    }
    await rm(manifestPath, { force: true })
  })

  it('recovers the pending receipt once at the next application startup', async () => {
    await waitForRecovery(manifest.sourceFile, manifest.targetFile)
    assert.equal(await readFile(manifest.sourceFile, 'utf8'), manifest.body)
    assert.equal(await pathExists(manifest.targetFile), false)
    assert.equal(await pathExists(manifest.targetDirectory), false)
    const receiptIdsAfter = (await invoke('list_smart_organizer_receipts'))
      .map((receipt) => receipt.receiptId)
      .sort()
    assert.deepEqual(receiptIdsAfter, manifest.receiptIdsBefore)
  })
})
