/*
 * Drives the photo organizer's preview and confirmation states in Vite.
 * Native ExifTool scanning and filesystem moves are verified separately in
 * the Tauri shell; this fixture never touches the user's files.
 *
 * Requires `pnpm dev` to be running:
 *   node scripts/photo-organizer-drive.mjs
 */
import { chromium } from 'playwright-core'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const BASE = 'http://127.0.0.1:1421/#'
const OUT = join(process.env.TEMP || '.', 'photo-organizer-flow')

mkdirSync(OUT, { recursive: true })

const checks = []
function check(label, passed, detail = '') {
  checks.push({ label, passed, detail })
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`)
}

async function run() {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true })
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  context.setDefaultTimeout(15000)
  const page = await context.newPage()
  const errors = []
  const ignorable = /favicon\.ico/
  page.on('console', message => {
    if (message.type() === 'error' && !ignorable.test(message.text()) && !/Failed to load resource/.test(message.text())) errors.push(message.text())
  })
  page.on('pageerror', error => errors.push(String(error)))
  page.on('response', response => {
    if (response.status() >= 400 && !ignorable.test(response.url())) errors.push(`HTTP ${response.status()} ${response.url()}`)
  })

  let step = 0
  const shot = async label => {
    step += 1
    await page.screenshot({ path: join(OUT, `${String(step).padStart(2, '0')}-${label}.png`), fullPage: true })
  }

  await page.goto(`${BASE}/tools?mode=photo-organizer&qa=preview`, { waitUntil: 'networkidle' })
  await page.getByRole('heading', { name: '按拍摄日期整理照片' }).waitFor()
  await shot('preview')

  check('existing tools route opens the organizer', await page.getByText('本机处理 · 可回滚').isVisible())
  check('all four plan outcomes are visible',
    await page.getByText('可移动', { exact: true }).count() >= 1
      && await page.getByText('目标冲突', { exact: true }).count() >= 1
      && await page.getByText('缺少日期', { exact: true }).count() >= 1
      && await page.getByText('已整理', { exact: true }).count() >= 1)
  check('both movable photos start selected', await page.locator('input[type="checkbox"]:checked').count() === 2)

  await page.getByRole('button', { name: '冲突 1' }).click()
  check('conflict filter narrows the preview', await page.getByText('IMG_0999.jpg', { exact: true }).isVisible())
  check('movable rows are hidden by the conflict filter', await page.getByText('旅行/IMG_1024.jpg', { exact: true }).count() === 0)
  await shot('conflict-filter')

  await page.getByRole('button', { name: '全部 5' }).click()
  await page.getByLabel('选择 旅行/IMG_1024.jpg').uncheck()
  check('individual selection updates the execution count', await page.getByRole('button', { name: '确认移动 1 张' }).isVisible())

  await page.getByRole('button', { name: '确认移动 1 张' }).click()
  const dialog = page.getByRole('alertdialog', { name: '移动选中的 1 张照片？' })
  check('destructive move requires a confirmation dialog', await dialog.isVisible())
  check('confirmation states rollback and no-overwrite guarantees', (await dialog.textContent())?.includes('绝不覆盖同名目标') && (await dialog.textContent())?.includes('失败或取消会回滚'))
  await dialog.getByRole('button', { name: '取消' }).click()
  check('cancelling confirmation performs no browser-side execution', await dialog.count() === 0 && await page.getByRole('button', { name: '确认移动 1 张' }).isVisible())
  await shot('confirmation-cancelled')

  check('persisted rollback receipt is discoverable', await page.getByRole('button', { name: '撤销整理' }).isVisible())

  await page.setViewportSize({ width: 900, height: 680 })
  await page.waitForTimeout(150)
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  check('organizer fits the 900px minimum window', overflow <= 0, `overflow=${overflow}px`)
  check('execution controls stay reachable at 900px', await page.getByRole('button', { name: '确认移动 1 张' }).isVisible())
  await shot('compact-900')

  check('no console errors during the interaction', errors.length === 0, errors.join(' | '))
  await browser.close()

  const failed = checks.filter(item => !item.passed)
  console.log(`\n${checks.length - failed.length}/${checks.length} checks passed. Screenshots: ${OUT}`)
  if (failed.length) process.exitCode = 1
}

run().catch(error => {
  console.error(error)
  process.exitCode = 1
})
