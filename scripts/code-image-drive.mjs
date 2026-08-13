/*
 * Drives /code-image through the states that only exist once there is code.
 *
 * The route opens on an empty editor, so pagination, the page-selection strip,
 * the export menu and the preview context menu never appear in a plain
 * screenshot. This types enough code to force several pages.
 *
 *   node scripts/code-image-drive.mjs [dark|light]
 */
import { chromium } from 'playwright-core'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const BASE = 'http://127.0.0.1:1421/#'
const OUT = join(process.env.TEMP || '.', 'code-image-flow')

mkdirSync(OUT, { recursive: true })

/** Long enough to paginate, and with a very long line to trip line wrapping. */
const SAMPLE = [
  'export function fixedRowVirtualWindow(total, scrollTop, viewportHeight, rowHeight, overscan = 6) {',
  '  const visible = Math.ceil(viewportHeight / rowHeight) + overscan * 2',
  '  const start = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan)',
  '  const end = Math.min(total, start + visible)',
  '  return { start, end, before: start * rowHeight, after: Math.max(0, (total - end) * rowHeight) }',
  '}',
  '',
  '// A deliberately long line so the layout engine turns on wrapping and the toolbar has to say so, which is the only way to see that state.',
  '',
  ...Array.from({ length: 90 }, (_, index) => `const value${index} = compute(${index}, { retries: ${index % 4}, label: "row-${index}" })`),
].join('\n')

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

  await page.goto(`${BASE}/code-image`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(1400)
  await shot('empty')

  await page.locator('.cm-content').click()
  await page.keyboard.press('Control+a')
  await page.keyboard.press('Delete')
  await page.keyboard.insertText(SAMPLE)
  await page.waitForTimeout(2500)
  await shot('paginated')

  // A second page, so the strip has something to select.
  const secondPage = page.locator('footer button:has-text("第 2 张")')
  if (await secondPage.count()) {
    await secondPage.first().click()
    await page.waitForTimeout(900)
    await shot('page-selected')
  }

  await page.locator('button:has-text("全选")').first().click().catch(() => {})
  await page.waitForTimeout(700)
  await shot('all-selected')

  await page.locator('button[aria-haspopup="menu"]:has-text("导出")').first().click()
  await page.waitForTimeout(500)
  await shot('export-menu')
  await page.keyboard.press('Escape')
  await page.mouse.click(800, 200)
  await page.waitForTimeout(300)

  const card = page.locator('.codesnap-stage > *').first()
  const box = await card.boundingBox()
  if (box) await page.mouse.click(box.x + box.width / 2, box.y + 80, { button: 'right' })
  await page.waitForTimeout(500)
  await shot('preview-menu')
  await page.keyboard.press('Escape')

  // The paper theme is the light-on-light case the exported PNG has to survive.
  await page.locator('button:has-text("纸页")').first().click()
  await page.waitForTimeout(1200)
  await shot('paper-theme')

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
