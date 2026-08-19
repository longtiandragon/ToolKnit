import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const root = new URL('../', import.meta.url)
const releaseWorkflow = readFileSync(new URL('.github/workflows/release.yml', root), 'utf8')
const ciWorkflow = readFileSync(new URL('.github/workflows/ci.yml', root), 'utf8')

describe('release workflow policy', () => {
  it('packages only Public Core after all release gates pass', () => {
    for (const command of [
      'pnpm check:release-version',
      'pnpm test',
      'pnpm build',
      'pnpm check:startup',
      'pnpm build:public',
      'pnpm check:public',
      'cargo check --manifest-path src-tauri/Cargo.toml',
      'cargo check --manifest-path src-tauri/Cargo.toml --features public-core',
      'cargo test --manifest-path src-tauri/Cargo.toml',
      'pnpm check:rust:clippy',
      'pnpm check:rust:clippy:public',
      'pnpm desktop:package:public',
    ]) expect(releaseWorkflow).toContain(command)

    expect(releaseWorkflow).not.toMatch(/run:\s*pnpm tauri build(?:\s|$)/)
  })

  it('checksums only the NSIS installer using portable filenames', () => {
    expect(releaseWorkflow).toContain("Get-ChildItem -LiteralPath 'src-tauri/target/release/bundle/nsis' -Filter '*.exe' -File")
    expect(releaseWorkflow).toContain('write-release-checksums.mjs')
    expect(releaseWorkflow).not.toMatch(/Get-ChildItem[^\n]+-Recurse/)
  })

  it('runs Rust quality gates and the native desktop smoke test in regular CI', () => {
    expect(ciWorkflow).toContain('cargo test --manifest-path src-tauri/Cargo.toml')
    expect(ciWorkflow).toContain('pnpm check:rust:clippy')
    expect(ciWorkflow).toContain('pnpm check:rust:clippy:public')
    expect(ciWorkflow).toContain('pnpm check:rust:clippy:e2e')
    expect(ciWorkflow).toContain('pnpm desktop:e2e')
  })
})
