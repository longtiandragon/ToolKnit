import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const knitspaceCss = readFileSync(new URL('../styles.knitspace.css', import.meta.url), 'utf8')
const viteConfig = readFileSync(new URL('../../vite.config.ts', import.meta.url), 'utf8')
const packageJson = JSON.parse(
  readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
) as { scripts: Record<string, string> }
const tauriConfig = JSON.parse(
  readFileSync(new URL('../../src-tauri/tauri.conf.json', import.meta.url), 'utf8'),
) as {
  build: { devUrl: string }
  app: { windows: Array<{ minWidth?: number; minHeight?: number }> }
}

describe('native desktop layout contract', () => {
  it('supports the configured 900 × 680 minimum window without a wider root canvas', () => {
    expect(tauriConfig.app.windows[0]).toMatchObject({ minWidth: 900, minHeight: 680 })
    expect(knitspaceCss).toMatch(/html, body, #app\s*\{\s*min-width:\s*0;/)
    expect(knitspaceCss).not.toMatch(/html, body, #app\s*\{[^}]*min-width:\s*(?:9\d\d|[1-9]\d{3,})px;/)
  })

  it('applies the compact rail after the wider Knitspace rail breakpoint', () => {
    const wideRailBreakpoint = knitspaceCss.indexOf('@media (max-width: 1180px)')
    const compactRailBreakpoint = knitspaceCss.indexOf('@media (max-width: 1050px)')

    expect(wideRailBreakpoint).toBeGreaterThan(-1)
    expect(compactRailBreakpoint).toBeGreaterThan(wideRailBreakpoint)
    expect(knitspaceCss.slice(compactRailBreakpoint, compactRailBreakpoint + 420)).toContain(
      '.rail { width: 76px; }',
    )
  })

  it('keeps the desktop development command and Vite address in one explicit contract', () => {
    const developmentUrl = new URL(tauriConfig.build.devUrl)

    expect(developmentUrl.hostname).toBe('127.0.0.1')
    expect(developmentUrl.port).toBe('1421')
    expect(viteConfig).toMatch(/server:\s*\{[^}]*port:\s*1421[^}]*strictPort:\s*true/)
    expect(packageJson.scripts['desktop:dev']).toBe('tauri dev')
    expect(packageJson.scripts['desktop:package:debug']).toContain('tauri build --debug')
  })
})
