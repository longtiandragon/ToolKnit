/*
 * Screenshots a set of routes in one theme, for the rewrites whose interesting
 * states need the Tauri shell (FFmpeg, Windows OCR, native pickers) and so
 * cannot be driven from a browser.
 *
 * ROUTES ARE PASSED WITHOUT A LEADING SLASH — Git Bash rewrites a bare
 * `/media` into a Windows path before node ever sees it.
 *
 *   node scripts/route-shots.mjs dark media ocr
 */
import { chromium } from 'playwright-core'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const BASE = 'http://127.0.0.1:1421/#'
const OUT = join(process.env.TEMP || '.', 'route-shots')

mkdirSync(OUT, { recursive: true })

const [themeArg, ...routes] = process.argv.slice(2)
const theme = themeArg === 'light' ? 'light' : 'dark'

const browser = await chromium.launch({ executablePath: CHROME, headless: true })
const context = await browser.newContext({ viewport: { width: 1600, height: 950 } })
await context.addInitScript((value) => window.localStorage.setItem('knitspace:theme', value), theme)
const page = await context.newPage()

for (const route of routes) {
  await page.goto(`${BASE}/${route.replace(/^\//, '')}`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(1300)
  const name = route.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'home'
  const file = join(OUT, `${theme}-${name}.png`)
  await page.screenshot({ path: file })
  console.log('captured', file)
}

await browser.close()
