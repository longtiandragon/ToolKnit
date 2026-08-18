/*
 * Drives the dictionary states the browser build can actually show: the word
 * box with no dictionary installed, the entry it still creates, and the
 * settings card that offers to download one.
 *
 * The lookup itself is desktop-only (`isDesktop()` is false here), so what this
 * proves is the wiring around it — placeholder, hint, disabled states, and that
 * typing a word still produces an entry. The completion path itself is covered
 * by the Rust tests and has to be checked once by hand in `pnpm desktop:dev`.
 *
 *   node scripts/dictionary-drive.mjs [dark|light]
 */
import { chromium } from 'playwright-core'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const BASE = process.env.KNITSPACE_BASE_URL || 'http://127.0.0.1:1421/#'
const OUT = join(process.env.TEMP || '.', 'dictionary-flow')

mkdirSync(OUT, { recursive: true })

const theme = process.argv[2] === 'light' ? 'light' : 'dark'
const browser = await chromium.launch({ executablePath: CHROME, headless: true })
try {
  const context = await browser.newContext({ viewport: { width: 1500, height: 940 } })
  await context.addInitScript((value) => window.localStorage.setItem('knitspace:theme', value), theme)
  const page = await context.newPage()
  const failures = []
  page.on('pageerror', (error) => failures.push(`pageerror: ${error.message}`))
  page.on('console', (message) => {
    if (message.type() === 'error' && !message.text().includes('404')) failures.push(message.text().slice(0, 160))
  })

  await page.goto(`${BASE}/words`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(1800)

  const field = page.locator('input[aria-label="加入生词本"]')
  const placeholder = await field.getAttribute('placeholder')
  if (placeholder !== '输入单词，回车加入生词本') throw new Error(`unexpected placeholder without a dictionary: ${placeholder}`)
  if (!(await page.locator('text=还没有离线词库').count())) throw new Error('the offer to install a dictionary is missing')
  await page.screenshot({ path: join(OUT, `${theme}-01-word-box.png`) })

  // A word the dictionary cannot gloss still has to become an entry.
  const word = `probe${Date.now().toString().slice(-5)}`
  await field.fill(word)
  await field.press('Enter')
  await page.waitForTimeout(1500)
  if (!(await page.locator(`text=${word}`).first().count())) throw new Error('typing a word did not produce an entry')
  if ((await field.inputValue()) !== '') throw new Error('the box should clear once the word is in')
  await page.screenshot({ path: join(OUT, `${theme}-02-entry-created.png`) })

  await page.goto(`${BASE}/settings?section=dictionary`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(1200)
  const enable = page.getByRole('button', { name: '启用词库', exact: true })
  if (!(await enable.count())) throw new Error('the settings card has no enable button')
  if (!(await enable.isDisabled())) throw new Error('the browser build must not offer to download a dictionary')
  if (!(await page.locator('text=ECDICT').count())) throw new Error('the licence and source line is missing')
  await page.screenshot({ path: join(OUT, `${theme}-03-settings.png`) })

  if (failures.length) throw new Error(`console errors: ${failures.join(' | ')}`)
  console.log(JSON.stringify({ theme, placeholder, word, shots: 3, failures }, null, 2))
} finally {
  await browser.close()
}
