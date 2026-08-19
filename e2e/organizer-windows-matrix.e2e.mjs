import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { chmod, mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, isAbsolute, join, parse, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'

const fixtureRoots = new Set()
const lockProcesses = new Set()
const permissionPaths = new Set()
const fixturePrefixes = ['knitspace-e2e-windows-', 'Knitspace-E2E-OneDrive-']

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

function comparablePath(path) {
  const absolute = resolve(path)
  return process.platform === 'win32' ? absolute.toLowerCase() : absolute
}

async function createFixture(base, prefix = 'knitspace-e2e-windows-') {
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

function planItem(candidate, targetRelativeDir, targetBaseName) {
  return {
    fileId: candidate.fileId,
    category: 'Windows 文件系统矩阵',
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

const exclusiveLockScript = `
$path = [Environment]::GetEnvironmentVariable('KNITSPACE_E2E_LOCK_PATH')
$stream = [System.IO.File]::Open(
  $path,
  [System.IO.FileMode]::Open,
  [System.IO.FileAccess]::Read,
  [System.IO.FileShare]::None
)
[Console]::Out.WriteLine('READY')
[Console]::Out.Flush()
[Console]::In.ReadLine() | Out-Null
$stream.Dispose()
`

async function startExclusiveLock(path) {
  const child = spawn('powershell.exe', [
    '-NoLogo',
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    exclusiveLockScript,
  ], {
    env: { ...process.env, KNITSPACE_E2E_LOCK_PATH: path },
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  })
  lockProcesses.add(child)
  child.stdout.setEncoding('utf8')
  child.stderr.setEncoding('utf8')
  let stdout = ''
  let stderr = ''
  await new Promise((resolveReady, rejectReady) => {
    const timer = setTimeout(() => rejectReady(new Error(`Timed out acquiring the exclusive test lock. ${stderr}`)), 10_000)
    const finish = (callback) => {
      clearTimeout(timer)
      callback()
    }
    child.once('error', (error) => finish(() => rejectReady(error)))
    child.once('exit', (code) => {
      if (!stdout.includes('READY')) finish(() => rejectReady(new Error(`Lock helper exited with ${code}. ${stderr}`)))
    })
    child.stderr.on('data', (chunk) => { stderr = `${stderr}${chunk}`.slice(-2_000) })
    child.stdout.on('data', (chunk) => {
      stdout += chunk
      if (stdout.includes('READY')) finish(resolveReady)
    })
  })
  return child
}

async function releaseExclusiveLock(child) {
  if (!child || child.exitCode !== null) {
    lockProcesses.delete(child)
    return
  }
  child.stdin.write('\n')
  child.stdin.end()
  await Promise.race([
    once(child, 'exit'),
    new Promise((_, rejectWait) => setTimeout(() => rejectWait(new Error('Lock helper did not exit.')), 5_000)),
  ]).catch(async (error) => {
    child.kill('SIGKILL')
    if (child.exitCode === null) await once(child, 'exit')
    throw error
  }).finally(() => lockProcesses.delete(child))
}

describe('Knitspace organizer Windows filesystem matrix', () => {
  before(async function () {
    if (process.platform !== 'win32') this.skip()
    await waitForRuntime()
  })

  after(async () => {
    for (const child of [...lockProcesses]) {
      try {
        await releaseExclusiveLock(child)
      } catch {
        // The exact child process has already been terminated above.
      }
    }
    for (const path of permissionPaths) {
      if (await pathExists(path)) await chmod(path, 0o666)
    }
    for (const root of fixtureRoots) {
      await rm(assertSafeFixtureRoot(root), {
        recursive: true,
        force: true,
        maxRetries: 3,
        retryDelay: 100,
      })
    }
  })

  it('moves and undoes a read-only file without losing its attribute', async () => {
    const root = await createFixture(tmpdir())
    const sourceRoot = join(root, 'source')
    const archiveRoot = join(root, 'archive')
    const sourceFile = join(sourceRoot, '只读资料.txt')
    const targetFile = join(archiveRoot, '只读文件', '只读归档.txt')
    const body = '只读属性不等于不可整理，但执行和撤销都不能改写正文。'
    await mkdir(sourceRoot)
    await mkdir(archiveRoot)
    await writeFile(sourceFile, body, 'utf8')
    permissionPaths.add(sourceFile)
    permissionPaths.add(targetFile)
    await chmod(sourceFile, 0o444)
    assert.equal((await stat(sourceFile)).mode & 0o200, 0)

    const scanResult = await scan(sourceRoot, archiveRoot)
    const report = await execute(scanResult, [
      planItem(scanResult.candidates[0], '只读文件', '只读归档'),
    ])
    assert.equal(report.movedCount, 1)
    assert.equal(await readFile(targetFile, 'utf8'), body)
    assert.equal((await stat(targetFile)).mode & 0o200, 0)

    const undo = await invoke('undo_smart_organizer', { receiptId: report.receiptId })
    assert.equal(undo.restoredCount, 1)
    assert.equal(await readFile(sourceFile, 'utf8'), body)
    assert.equal((await stat(sourceFile)).mode & 0o200, 0)
    assert.equal(await pathExists(targetFile), false)
    await chmod(sourceFile, 0o666)
  })

  it('rejects an exclusively locked source without creating a receipt or target', async () => {
    const root = await createFixture(tmpdir())
    const sourceRoot = join(root, 'source')
    const archiveRoot = join(root, 'archive')
    const sourceFile = join(sourceRoot, '占用中的资料.txt')
    const targetFile = join(archiveRoot, '锁定文件', '占用归档.txt')
    const body = '这个文件会由独立 PowerShell 进程使用 FileShare.None 锁定。'
    await mkdir(sourceRoot)
    await mkdir(archiveRoot)
    await writeFile(sourceFile, body, 'utf8')
    const scanResult = await scan(sourceRoot, archiveRoot)
    const receiptsBefore = await receiptIds()
    const lock = await startExclusiveLock(sourceFile)
    try {
      const error = await rejectionText(() => execute(scanResult, [
        planItem(scanResult.candidates[0], '锁定文件', '占用归档'),
      ]))
      assert.match(error, /读取|占用/)
      assert.equal(await pathExists(targetFile), false)
      assert.deepEqual(await receiptIds(), receiptsBefore)
    } finally {
      await releaseExclusiveLock(lock)
    }
    assert.equal(await readFile(sourceFile, 'utf8'), body)
  })

  it('round-trips Chinese paths beyond the legacy Windows MAX_PATH boundary', async () => {
    const root = await createFixture(tmpdir())
    const sourceRoot = join(root, 'source')
    const archiveRoot = join(root, 'archive')
    const sourceBaseName = '长'.repeat(220)
    const targetBaseName = '归'.repeat(220)
    const sourceFile = join(sourceRoot, `${sourceBaseName}.txt`)
    const targetFile = join(archiveRoot, '中文长路径', `${targetBaseName}.txt`)
    const body = 'UTF-16 组件长度合法时，不应按 UTF-8 字节数误拒绝中文文件名。'
    assert.ok(sourceFile.length > 260)
    assert.ok(targetFile.length > 260)
    await mkdir(sourceRoot)
    await mkdir(archiveRoot)
    await writeFile(sourceFile, body, 'utf8')

    const scanResult = await scan(sourceRoot, archiveRoot)
    assert.equal(scanResult.candidates[0].name, `${sourceBaseName}.txt`)
    const report = await execute(scanResult, [
      planItem(scanResult.candidates[0], '中文长路径', targetBaseName),
    ])
    assert.equal(await readFile(targetFile, 'utf8'), body)
    const undo = await invoke('undo_smart_organizer', { receiptId: report.receiptId })
    assert.equal(undo.restoredCount, 1)
    assert.equal(await readFile(sourceFile, 'utf8'), body)
    assert.equal(await pathExists(dirname(targetFile)), false)
  })

  it('round-trips an explicitly selected OneDrive directory', async function () {
    const configuredRoot = process.env.KNITSPACE_E2E_ONEDRIVE_ROOT?.trim()
    if (!configuredRoot) this.skip()
    assert.equal(isAbsolute(configuredRoot), true)
    const oneDriveRoot = resolve(configuredRoot)
    assert.notEqual(oneDriveRoot, parse(oneDriveRoot).root)
    const metadata = await stat(oneDriveRoot)
    assert.equal(metadata.isDirectory(), true)
    const root = await createFixture(oneDriveRoot, 'Knitspace-E2E-OneDrive-')
    assert.equal(comparablePath(dirname(root)), comparablePath(oneDriveRoot))
    const sourceRoot = join(root, 'source')
    const archiveRoot = join(root, 'archive')
    const sourceFile = join(sourceRoot, 'OneDrive 本地文件.txt')
    const targetFile = join(archiveRoot, '同步资料', 'OneDrive 归档.txt')
    const body = '该用例只在显式指定的 OneDrive 根目录内创建并删除临时子目录。'
    await mkdir(sourceRoot)
    await mkdir(archiveRoot)
    await writeFile(sourceFile, body, 'utf8')

    const scanResult = await scan(sourceRoot, archiveRoot)
    const report = await execute(scanResult, [
      planItem(scanResult.candidates[0], '同步资料', 'OneDrive 归档'),
    ])
    assert.equal(await readFile(targetFile, 'utf8'), body)
    await invoke('undo_smart_organizer', { receiptId: report.receiptId })
    assert.equal(await readFile(sourceFile, 'utf8'), body)
    assert.equal(await pathExists(targetFile), false)
  })
})
