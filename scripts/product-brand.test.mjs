import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const root = new URL('../', import.meta.url)
const packageJson = JSON.parse(readFileSync(new URL('package.json', root), 'utf8'))
const tauriConfig = JSON.parse(readFileSync(new URL('src-tauri/tauri.conf.json', root), 'utf8'))
const cargoToml = readFileSync(new URL('src-tauri/Cargo.toml', root), 'utf8')
const rustMain = readFileSync(new URL('src-tauri/src/main.rs', root), 'utf8')

describe('Knitspace product identity', () => {
  it('uses Knitspace for user-visible and build artifact names', () => {
    expect(packageJson.name).toBe('knitspace')
    expect(tauriConfig.productName).toBe('Knitspace')
    expect(tauriConfig.app.windows[0].title).toBe('Knitspace')
    expect(cargoToml).toMatch(/^name = "knitspace"$/m)
    expect(cargoToml).toMatch(/^name = "knitspace_lib"$/m)
    expect(rustMain).toContain('knitspace_lib::run()')
  })

  it('keeps the legacy desktop identifier for in-place upgrades', () => {
    expect(tauriConfig.identifier).toBe('io.github.longtiandragon.toolknit')
  })
})
