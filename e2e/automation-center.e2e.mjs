import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const recipeTitle = `E2E 文本清理 ${Date.now()}`
let recipeId
let fixtureRoot

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
  await $('[data-testid="app-shell"], .app-shell').waitForDisplayed({ timeout: 30_000 })
}

async function openRoute(hash, testId) {
  await browser.execute((nextHash) => { window.location.hash = nextHash }, hash)
  await $(`[data-testid="${testId}"]`).waitForDisplayed({ timeout: 30_000 })
}

async function directorySnapshot(root) {
  const entries = []
  async function visit(directory, prefix = '') {
    const names = (await readdir(directory)).sort()
    for (const name of names) {
      const path = join(directory, name)
      const metadata = await stat(path)
      const relative = prefix ? `${prefix}/${name}` : name
      if (metadata.isDirectory()) await visit(path, relative)
      else entries.push({ relative, size: metadata.size, body: await readFile(path, 'utf8') })
    }
  }
  await visit(root)
  return entries
}

describe('Knitspace native automation smoke test', () => {
  before(async () => {
    await waitForRuntime()
    await invoke('replace_default_automation_recipes', { recipes: [] })
  })

  after(async () => {
    try {
      await invoke('replace_default_automation_recipes', { recipes: [] })
    } finally {
      if (fixtureRoot) await rm(fixtureRoot, { recursive: true, force: true })
    }
  })

  it('starts the real Tauri binary with the test bridge', async () => {
    assert.deepEqual(await browser.tauri.listWindows(), ['main'])
    assert.deepEqual(await invoke('list_default_automation_recipes'), [])
  })

  it('saves a recipe through the UI and reads it back through native IPC', async () => {
    await openRoute('#/tools?mode=pipeline', 'text-pipeline')
    await $('[data-testid="recipe-form-toggle"]').click()
    await $('[data-testid="recipe-title"]').setValue(recipeTitle)
    await $('[data-testid="save-recipe"]').click()

    await browser.waitUntil(async () => {
      const records = await invoke('list_default_automation_recipes')
      return records.some((record) => record.title === recipeTitle)
    }, { timeoutMsg: 'Recipe was not persisted by the native command.' })

    const records = await invoke('list_default_automation_recipes')
    const saved = records.find((record) => record.title === recipeTitle)
    assert.ok(saved)
    assert.equal(saved.kind, 'text-pipeline')
    assert.equal(saved.definition.scope, 'text')
    assert.equal(saved.definition.steps.length, 1)
    assert.doesNotMatch(JSON.stringify(saved), /[A-Za-z]:[\\/]/)
    recipeId = saved.id

    await openRoute('#/tools?mode=automation', 'automation-center')
    const item = await $(`[data-automation-id="${recipeId}"]`)
    await item.waitForDisplayed()
    assert.match(await item.getText(), new RegExp(recipeTitle))
  })

  it('keeps the native recipe after a fresh WebDriver session', async () => {
    await browser.reloadSession()
    await waitForRuntime()
    const records = await invoke('list_default_automation_recipes')
    assert.ok(records.some((record) => record.id === recipeId && record.title === recipeTitle))
    await openRoute('#/tools?mode=automation', 'automation-center')
    await $(`[data-automation-id="${recipeId}"]`).waitForDisplayed()
  })

  it('scans and previews organizer input without changing either directory', async () => {
    fixtureRoot = await mkdtemp(join(tmpdir(), 'knitspace-e2e-'))
    const sourceRoot = join(fixtureRoot, 'source')
    const archiveRoot = join(fixtureRoot, 'archive')
    await mkdir(sourceRoot)
    await mkdir(archiveRoot)
    await writeFile(join(sourceRoot, '课程资料.txt'), 'Knitspace 原生 E2E：扫描只能读取，不能修改。', 'utf8')

    const sourceBefore = await directorySnapshot(sourceRoot)
    const archiveBefore = await directorySnapshot(archiveRoot)
    const scan = await invoke('scan_smart_organizer', {
      request: { sourceRoot, archiveRoot },
    })
    assert.equal(scan.scannedCount, 1)
    assert.equal(scan.candidates.length, 1)

    const excerpts = await invoke('read_smart_organizer_excerpts', {
      request: { scanId: scan.scanId, fileIds: [scan.candidates[0].fileId] },
    })
    assert.equal(excerpts.length, 1)
    assert.match(excerpts[0].excerpt, /扫描只能读取/)
    assert.deepEqual(await directorySnapshot(sourceRoot), sourceBefore)
    assert.deepEqual(await directorySnapshot(archiveRoot), archiveBefore)
  })
})
