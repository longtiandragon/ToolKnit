/*
 * Drives the scan correction step in the OCR workspace.
 *
 * A screenshot of /ocr only ever shows the picker's opening state. Everything
 * this feature is about — dragging a corner, nudging it from the keyboard,
 * auto-detecting the edges, running the warp and falling back to the original —
 * only exists mid-flow, so this uses the page instead of photographing it.
 *
 * Uses the Chrome already installed on the machine; no browser download.
 * Requires `pnpm dev` to be running.
 *
 *   node scripts/scan-correct-drive.mjs
 *
 * Browser-only. The recognition handoff itself needs the Tauri shell and is
 * verified separately on the desktop build.
 */
import { chromium } from 'playwright-core'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const BASE = 'http://127.0.0.1:1421/#'
const OUT = join(process.env.TEMP || '.', 'scan-correct-flow')

mkdirSync(OUT, { recursive: true })

const checks = []
function check(label, passed, detail = '') {
  checks.push({ label, passed, detail })
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`)
}

async function run() {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true })
  const context = await browser.newContext({ viewport: { width: 1600, height: 950 } })
  // A stuck selector should report which step failed, not hang the run.
  context.setDefaultTimeout(15000)
  const page = await context.newPage()
  const consoleErrors = []
  // Chrome always asks for /favicon.ico and index.html declares none, so that
  // 404 is background noise rather than a fault in this flow.
  const ignorable = /favicon\.ico/
  page.on('console', message => {
    if (message.type() !== 'error') return
    if (ignorable.test(message.text()) || message.location()?.url?.match(ignorable)) return
    consoleErrors.push(message.text())
  })
  page.on('pageerror', error => consoleErrors.push(String(error)))
  // A bare "failed to load resource" says nothing; keep the URL so the check
  // can be acted on.
  page.on('response', response => {
    if (response.status() >= 400 && !ignorable.test(response.url())) {
      consoleErrors.push(`HTTP ${response.status()} ${response.url()}`)
    }
  })

  let step = 0
  const shot = async (label) => {
    step += 1
    await page.screenshot({ path: join(OUT, `${String(step).padStart(2, '0')}-${label}.png`) })
  }

  await page.goto(`${BASE}/ocr?qa=preview`, { waitUntil: 'networkidle' })
  await page.waitForSelector('text=离线文字识别')
  await shot('loaded')

  // --- open the picker -----------------------------------------------------
  const correctButton = page.getByRole('button', { name: '矫正倾斜' })
  check('correction entry point is offered', await correctButton.isEnabled())
  await correctButton.click()
  await page.waitForSelector('text=框选页面范围')

  const handles = page.locator('button[aria-label*="角，水平"]')
  check('four corner handles are rendered', await handles.count() === 4, `count=${await handles.count()}`)
  await shot('picker-open')

  const readout = page.locator('p.font-mono[role="status"]')
  const before = await readout.textContent()

  // --- drag a corner -------------------------------------------------------
  const topLeft = handles.first()
  const box = await topLeft.boundingBox()
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2 + 90, box.y + box.height / 2 + 60, { steps: 12 })
  await page.mouse.up()
  const afterDrag = await readout.textContent()
  check('dragging a corner moves it', afterDrag !== before, afterDrag?.trim().slice(0, 40))
  await shot('corner-dragged')

  // --- keyboard nudge ------------------------------------------------------
  await topLeft.focus()
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('ArrowRight')
  const afterKeys = await readout.textContent()
  check('arrow keys nudge the focused corner', afterKeys !== afterDrag, afterKeys?.trim().slice(0, 40))

  await page.keyboard.down('Shift')
  await page.keyboard.press('ArrowDown')
  await page.keyboard.up('Shift')
  check('shift accelerates the nudge', (await readout.textContent()) !== afterKeys)

  // --- auto detect ---------------------------------------------------------
  await page.getByRole('button', { name: '自动找边缘' }).click()
  await page.waitForTimeout(200)
  const status = await page.locator('p[role="status"], p[role="alert"]').first().textContent()
  check('auto detect reports an outcome instead of failing silently', Boolean(status?.trim()), status?.trim().slice(0, 46))
  await shot('auto-detected')

  // --- reset ---------------------------------------------------------------
  await page.getByRole('button', { name: '整张图片' }).click()
  check('reset restores the full frame', (await readout.textContent())?.includes('0%'))

  // --- apply the warp ------------------------------------------------------
  await handles.first().focus()
  for (let index = 0; index < 6; index += 1) await page.keyboard.press('ArrowRight')
  await page.getByRole('button', { name: '应用矫正' }).click()
  const applied = await page.waitForSelector('text=已矫正', { timeout: 15000 }).then(() => true).catch(() => false)
  if (!applied) {
    const reason = await page.locator('p[role="alert"]').first().textContent().catch(() => '')
    check('warp completed', false, reason?.trim() || 'no error surfaced')
    await shot('warp-failed')
    await browser.close()
    process.exitCode = 1
    return
  }
  const previewSrc = await page.locator('img[alt*="矫正后的待识别图片"]').getAttribute('src')
  check('warp produced a new in-memory image', Boolean(previewSrc?.startsWith('blob:')), previewSrc?.slice(0, 24))
  check('picker closed after applying', await page.locator('text=框选页面范围').count() === 0)
  await shot('corrected')

  // --- fall back to the original ------------------------------------------
  await page.getByRole('button', { name: '用回原图' }).click()
  await page.waitForTimeout(150)
  check('falling back to the original clears the corrected state', await page.locator('text=已矫正').count() === 0)
  await shot('reverted')

  // --- escape cancels ------------------------------------------------------
  await page.getByRole('button', { name: '矫正倾斜' }).click()
  await page.waitForSelector('text=框选页面范围')
  await handles.first().focus()
  await page.keyboard.press('Escape')
  await page.waitForTimeout(150)
  check('escape leaves the picker', await page.locator('text=框选页面范围').count() === 0)
  await shot('escaped')

  // --- smallest supported window ------------------------------------------
  // Tauri pins the window to 900x680; the picker has to survive that.
  await page.setViewportSize({ width: 900, height: 680 })
  await page.getByRole('button', { name: '矫正倾斜' }).click()
  await page.waitForSelector('text=框选页面范围')
  await page.waitForTimeout(150)
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  check('picker fits the 900px minimum window', overflow <= 0, `overflow=${overflow}px`)
  check('picker controls stay reachable when compact', await page.getByRole('button', { name: '应用矫正' }).isVisible())
  await shot('compact-900')

  check('no console errors during the flow', consoleErrors.length === 0)
  for (const entry of consoleErrors) console.log(`      ${entry}`)

  await browser.close()

  const failed = checks.filter(entry => !entry.passed)
  console.log(`\n${checks.length - failed.length}/${checks.length} checks passed. Screenshots: ${OUT}`)
  if (failed.length) process.exitCode = 1
}

run().catch(error => {
  console.error(error)
  process.exitCode = 1
})
