/*
 * Drives /subtitles through the states that only exist once a timeline is in.
 *
 *   node scripts/subtitle-drive.mjs [dark|light]
 */
import { chromium } from 'playwright-core'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const BASE = 'http://127.0.0.1:1421/#'
const OUT = join(process.env.TEMP || '.', 'subtitle-flow')

mkdirSync(OUT, { recursive: true })

/** Enough cues to fill the viewport and exercise the windowed list. */
const SRT = Array.from({ length: 40 }, (_, index) => {
  const start = index * 3
  const end = start + 2
  const stamp = (seconds) => `00:${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')},000`
  return `${index + 1}\n${stamp(start)} --> ${stamp(end)}\n第 ${index + 1} 句：这里是一段用来检查换行与两行截断的中文字幕正文。\n`
}).join('\n')

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

  await page.goto(`${BASE}/subtitles`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(1200)
  await shot('empty')

  await page.locator('[data-subtitle-workflow="paste"]').first().click()
  await page.waitForTimeout(600)
  await shot('paste-mode')

  await page.locator('textarea[aria-label="字幕源码"]').fill(SRT)
  await page.waitForTimeout(500)
  await page.locator('button:has-text("解析并载入")').click()
  await page.waitForTimeout(1200)
  await shot('timeline')

  // Selecting a cue opens the inspector in the right column.
  await page.locator('[role="option"]').nth(2).click()
  await page.waitForTimeout(700)
  await shot('cue-selected')

  await page.locator('input[aria-label="搜索字幕正文"]').fill('第 7 句')
  await page.waitForTimeout(700)
  await shot('search')
  await page.locator('input[aria-label="搜索字幕正文"]').fill('')
  await page.waitForTimeout(500)

  // The cue context menu.
  const row = page.locator('[role="option"]').nth(1)
  const box = await row.boundingBox()
  if (box) await page.mouse.click(box.x + 200, box.y + 20, { button: 'right' })
  await page.waitForTimeout(500)
  await shot('cue-menu')
  await page.keyboard.press('Escape')
  await page.mouse.click(900, 120)
  await page.waitForTimeout(300)

  // Transcription takes over the same right column.
  await page.locator('[data-subtitle-workflow="transcribe"]').first().click()
  await page.waitForTimeout(800)
  await shot('transcription')

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
