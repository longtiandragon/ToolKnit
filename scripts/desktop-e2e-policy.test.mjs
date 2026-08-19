import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { describe, it } from 'vitest'

const root = new URL('../', import.meta.url)
const read = (path) => readFileSync(new URL(path, root), 'utf8')
const packageJson = JSON.parse(read('package.json'))
const cargoManifest = read('src-tauri/Cargo.toml')
const rustEntry = read('src-tauri/src/lib.rs')
const smartOrganizerSource = read('src-tauri/src/smart_organizer.rs')
const e2eConfig = read('src-tauri/tauri.e2e.conf.json')
const webdriverConfig = read('wdio.e2e.conf.mjs')
const viteConfig = read('vite.config.ts')
const desktopSpec = read('e2e/automation-center.e2e.mjs')
const organizerExecutionSpec = read('e2e/organizer-execution.e2e.mjs')
const organizerWindowsMatrixSpec = read('e2e/organizer-windows-matrix.e2e.mjs')
const crashPrepareSpec = read('e2e/organizer-crash-prepare.e2e.mjs')
const crashRecoverySpec = read('e2e/organizer-crash-recovery.e2e.mjs')
const productionTauriSurface = [
  read('src-tauri/tauri.conf.json'),
  read('src-tauri/tauri.public.conf.json'),
  read('src/main.ts'),
  ...readdirSync(new URL('src-tauri/capabilities/', root), { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => read(`src-tauri/capabilities/${entry.name}`)),
].join('\n')

describe('desktop E2E isolation policy', () => {
  it('enables the native test bridge only through an optional Rust feature', () => {
    assert.match(cargoManifest, /tauri-plugin-wdio = \{[^\n]+optional = true \}/)
    assert.match(cargoManifest, /tauri-plugin-wdio-webdriver = \{[^\n]+optional = true \}/)
    assert.match(cargoManifest, /e2e = \["dep:tauri-plugin-wdio", "dep:tauri-plugin-wdio-webdriver"\]/)
    assert.match(rustEntry, /#\[cfg\(feature = "e2e"\)\][\s\S]+tauri_plugin_wdio_webdriver::init\(\)[\s\S]+tauri_plugin_wdio::init\(\)/)
    assert.doesNotMatch(productionTauriSurface, /wdio/i)
  })

  it('uses an isolated application identity, Vault and capability set', () => {
    assert.match(e2eConfig, /"identifier": "io\.github\.longtiandragon\.toolknit\.e2e"/)
    assert.match(e2eConfig, /"withGlobalTauri": true/)
    assert.match(e2eConfig, /"wdio:default"/)
    assert.match(e2eConfig, /"wdio-webdriver:default"/)
    assert.match(e2eConfig, /"active": false/)
    assert.match(rustEntry, /#\[cfg\(feature = "e2e"\)\][\s\S]+KnitspaceE2EVault/)
  })

  it('keeps the browser bridge out of normal and Public Core frontend builds', () => {
    assert.match(viteConfig, /mode === 'e2e'/)
    assert.match(read('src/e2e.ts'), /@wdio\/tauri-plugin/)
    assert.doesNotMatch(read('src/main.ts'), /@wdio\/tauri-plugin/)
    assert.equal(packageJson.scripts['desktop:e2e:build'], 'tauri build --debug --no-bundle --config src-tauri/tauri.e2e.conf.json --features e2e')
    assert.match(packageJson.scripts['check:rust:clippy:e2e'], /--features e2e/)
    for (const script of ['desktop:dev', 'desktop:package:debug', 'desktop:package', 'desktop:package:public']) {
      assert.doesNotMatch(packageJson.scripts[script], /(?:--features\s+e2e|tauri\.e2e\.conf)/)
    }
  })

  it('keeps deterministic organizer failure hooks inside the E2E Rust feature', () => {
    assert.match(smartOrganizerSource, /#\[cfg\(feature = "e2e"\)\]\s+const E2E_FAIL_BEFORE_OPERATION_CATEGORY/)
    assert.match(smartOrganizerSource, /#\[cfg\(feature = "e2e"\)\]\s+const E2E_ABORT_AFTER_OPERATION_CATEGORY/)
    assert.match(smartOrganizerSource, /#\[cfg\(feature = "e2e"\)\]\s+pub e2e_process_id: u32/)
    assert.match(smartOrganizerSource, /#\[cfg\(feature = "e2e"\)\]\s+e2e_category: String/)
    assert.match(smartOrganizerSource, /#\[cfg\(feature = "e2e"\)\]\s+if item\.e2e_category == E2E_FAIL_BEFORE_OPERATION_CATEGORY/)
    assert.match(smartOrganizerSource, /#\[cfg\(feature = "e2e"\)\]\s+if item\.e2e_category == E2E_ABORT_AFTER_OPERATION_CATEGORY/)
  })

  it('runs crash preparation and recovery in ordered, isolated workers', () => {
    const expectedSpecs = [
      './e2e/automation-center.e2e.mjs',
      './e2e/organizer-execution.e2e.mjs',
      './e2e/organizer-windows-matrix.e2e.mjs',
      './e2e/organizer-crash-prepare.e2e.mjs',
      './e2e/organizer-crash-recovery.e2e.mjs',
    ]
    let previousIndex = -1
    for (const spec of expectedSpecs) {
      const index = webdriverConfig.indexOf(`'${spec}'`)
      assert.ok(index > previousIndex, `${spec} must be listed after the prior desktop spec.`)
      previousIndex = index
    }
    assert.match(webdriverConfig, /maxInstances:\s*1/)
    assert.match(webdriverConfig, /onWorkerEnd:[\s\S]+terminatePreparedCrash/)
    assert.match(webdriverConfig, /process\.kill\(processId, 'SIGKILL'\)/)
  })

  it('covers native persistence, scan isolation, execution safety, and startup recovery', () => {
    for (const evidence of [
      'replace_default_automation_recipes',
      'list_default_automation_recipes',
      'browser.reloadSession()',
      'scan_smart_organizer',
      'read_smart_organizer_excerpts',
      'directorySnapshot(sourceRoot)',
      'directorySnapshot(archiveRoot)',
    ]) assert.match(desktopSpec, new RegExp(evidence.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))

    for (const evidence of [
      'execute_smart_organizer',
      'undo_smart_organizer',
      'list_smart_organizer_receipts',
      '已回滚本次已完成的变更',
      'scanResult.sameVolume, false',
      'removedCopyCount, 1',
    ]) assert.match(organizerExecutionSpec, new RegExp(evidence.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))

    for (const evidence of [
      'chmod(sourceFile, 0o444)',
      '[System.IO.FileShare]::None',
      "'长'.repeat(220)",
      'sourceFile.length > 260',
      'KNITSPACE_E2E_ONEDRIVE_ROOT',
      'Knitspace-E2E-OneDrive-',
    ]) assert.match(organizerWindowsMatrixSpec, new RegExp(evidence.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
    assert.doesNotMatch(organizerWindowsMatrixSpec, /process\.env\.(?:OneDrive|OneDriveConsumer|OneDriveCommercial)/)

    assert.match(crashPrepareSpec, /__knitspace_e2e_abort_after_operation__/)
    assert.match(crashPrepareSpec, /waitForPostMoveState/)
    assert.match(crashRecoverySpec, /waitForRecovery/)
    assert.match(crashRecoverySpec, /receiptIdsAfter, manifest\.receiptIdsBefore/)
  })
})
