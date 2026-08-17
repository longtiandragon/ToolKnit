import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { assertReleaseVersion, normalizeReleaseTag, readCargoPackageVersion } from './check-release-version.mjs'

const temporaryRoots = []

function createVersionFixture({ packageVersion = '1.2.3', cargoVersion = '1.2.3', tauriVersion = '1.2.3' } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'knitspace-release-version-'))
  temporaryRoots.push(root)
  mkdirSync(join(root, 'src-tauri'))
  writeFileSync(join(root, 'package.json'), JSON.stringify({ version: packageVersion }))
  writeFileSync(join(root, 'src-tauri', 'Cargo.toml'), `[package]\nname = "knitspace"\nversion = "${cargoVersion}"\n\n[dependencies]\nversion = "99.0.0"\n`)
  writeFileSync(join(root, 'src-tauri', 'tauri.conf.json'), JSON.stringify({ version: tauriVersion }))
  writeFileSync(join(root, 'vite.config.ts'), '__APP_VERSION__: JSON.stringify(packageVersion)')
  return root
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('release version guard', () => {
  it('reads only the Cargo package version', () => {
    expect(readCargoPackageVersion('[package]\nversion = "2.0.1"\n\n[dependencies]\nversion = "9"\n')).toBe('2.0.1')
  })

  it('accepts matching files and release tag', () => {
    expect(assertReleaseVersion({ root: createVersionFixture(), tag: 'v1.2.3' })).toBe('1.2.3')
  })

  it('rejects a mismatched source or tag', () => {
    expect(() => assertReleaseVersion({ root: createVersionFixture({ cargoVersion: '1.2.4' }) })).toThrow(/cargo: 1\.2\.4/)
    expect(() => assertReleaseVersion({ root: createVersionFixture(), tag: 'v1.2.4' })).toThrow(/releaseTag: 1\.2\.4/)
  })

  it('rejects tags outside the v-semver release namespace', () => {
    expect(() => normalizeReleaseTag('release-1.2.3')).toThrow(/v<semver>/)
  })
})
