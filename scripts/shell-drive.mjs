/*
 * Drives the app shell: the command palette, its feature map, the task centre
 * and the workspace context menu. None of these are a route, so route
 * screenshots never reach them.
 *
 *   node scripts/shell-drive.mjs [dark|light]
 */
import { chromium } from 'playwright-core'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const BASE = 'http://127.0.0.1:1421/#'
const OUT = join(process.env.TEMP || '.', 'shell-flow')

mkdirSync(OUT, { recursive: true })

async function run() {
  const theme = process.argv[2] === 'light' ? 'light' : 'dark'
  const browser = await chromium.launch({ executablePath: CHROME, headless: true })
  const context = await browser.newContext({ viewport: { width: 1600, height: 950 } })
  await context.addInitScript((value) => window.localStorage.setItem('knitspace:theme', value), theme)
  const page = await context.newPage()
  const shots = []
  const shot = async (label) => {
    const file = join(OUT, `${theme}-${String(shots.length + 1).padStart(2, '0')}-${label}.png`)
    await page.screenshot({ path: file })
    shots.push(file)
    console.log('  captured', label)
  }

  console.log(`theme: ${theme}`)

  await page.goto(`${BASE}/today`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(1200)

  await page.keyboard.press('Control+k')
  await page.waitForTimeout(800)
  await shot('command-recent')

  await page.locator('button:has-text("浏览全部功能")').first().click()
  await page.waitForTimeout(700)
  await shot('command-feature-map')

  await page.locator('button:has-text("返回最近")').first().click()
  await page.waitForTimeout(400)
  await page.locator('input[name="tool-search"]').fill('pdf')
  await page.waitForTimeout(900)
  await shot('command-search')

  // A result's own context menu, over the palette.
  const row = page.locator('[data-command-result]').nth(1)
  const box = await row.boundingBox()
  if (box) await page.mouse.click(box.x + 120, box.y + 16, { button: 'right' })
  await page.waitForTimeout(500)
  await shot('command-result-menu')

  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')
  await page.waitForTimeout(500)

  await page.locator('button:has-text("本地就绪"), button:has-text("个任务")').first().click()
  await page.waitForTimeout(600)
  await shot('task-centre')
  await page.locator('button[aria-label="关闭任务中心"]').click()
  await page.waitForTimeout(300)

  // Right-click empty workspace: the space's own quick menu.
  await page.mouse.click(1200, 800, { button: 'right' })
  await page.waitForTimeout(500)
  await shot('workspace-menu')

  await browser.close()

  const html = `<html><body style="margin:0;background:#111;font:11px sans-serif">
    <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:4px;padding:4px">${shots
      .map((file) => `<figure style="margin:0"><img src="file:///${file.replace(/\\/g, '/')}" style="width:100%;display:block"><figcaption style="color:#6cf;padding:2px">${file.split(/[\\/]/).pop()}</figcaption></figure>`)
      .join('')}</div></body></html>`
  writeFileSync(join(OUT, `sheet-${theme}.html`), html)
  console.log(`\n${shots.length} states captured → ${OUT}`)
}

run().catch((error) => {
  console.error('flow failed:', error.message)
  process.exit(1)
})
