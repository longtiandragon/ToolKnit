/*
 * Drives the running dev server through a real interaction so the states that
 * only exist mid-flow can be reviewed.
 *
 * Screenshotting a URL only ever shows the empty state of a tool. Everything
 * that matters about a toolbox — what it looks like with files staged, while a
 * job runs, when it finishes, when it fails — needs someone to actually use
 * it. This does that, and captures each step.
 *
 * Uses the Chrome already installed on the machine; no browser download.
 *
 *   node scripts/ux-drive.mjs [flow]
 *
 * Browser-only flows. Anything that needs the Tauri shell — FFmpeg, Windows
 * OCR, native file dialogs — cannot be reached from here.
 */
import { chromium } from 'playwright-core'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { PDFDocument, StandardFonts } from 'pdf-lib'

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const BASE = 'http://127.0.0.1:1421/#'
const OUT = join(process.env.TEMP || '.', 'ux-flow')
const FIXTURES = join(OUT, 'fixtures')

mkdirSync(FIXTURES, { recursive: true })

/** A real multi-page PDF, so page-count-dependent UI has something to say. */
async function samplePdf(name, pages = 3) {
  const pdf = await PDFDocument.create()
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  for (let index = 0; index < pages; index += 1) {
    const page = pdf.addPage([595, 842])
    page.drawText(`${name} — page ${index + 1}`, { x: 60, y: 760, size: 24, font })
    page.drawText('Knitspace UX fixture', { x: 60, y: 720, size: 12, font })
  }
  const path = join(FIXTURES, `${name}.pdf`)
  writeFileSync(path, await pdf.save())
  return path
}

async function run() {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true })
  // The theme is a stored preference read before mount, so it has to be in
  // place before the first navigation rather than toggled afterwards.
  const theme = process.argv[3] === 'light' ? 'light' : 'dark'
  const context = await browser.newContext({ viewport: { width: 1600, height: 950 } })
  await context.addInitScript(
    (value) => window.localStorage.setItem('knitspace:theme', value),
    theme,
  )
  const page = await context.newPage()
  const shots = []
  console.log(`theme: ${theme}`)

  const shot = async (label) => {
    const file = join(OUT, `${theme}-${String(shots.length + 1).padStart(2, '0')}-${label}.png`)
    await page.screenshot({ path: file })
    shots.push(file)
    console.log('  captured', label)
  }

  // ── Flow: watermark a PDF, end to end ──────────────────────────────────
  console.log('flow: PDF 添加水印')
  const [a, b] = [await samplePdf('report', 3), await samplePdf('appendix', 2)]

  await page.goto(`${BASE}/tools?group=pdf&operation=watermark`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(1200)
  await shot('empty')

  await page.setInputFiles('input[type=file]', [a, b])
  await page.waitForTimeout(900)
  await shot('files-staged')

  // Kick the job off and try to catch it mid-run before it settles.
  const runButton = page.locator('button:has-text("生成新输出")')
  await runButton.click()
  await page.waitForTimeout(220)
  await shot('running')

  await page.waitForTimeout(3500)
  await shot('finished')

  // ── Flow: a text tool with live preview ────────────────────────────────
  console.log('flow: JSON 格式化')
  await page.goto(`${BASE}/tools?group=text&operation=transform`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(900)
  await page.locator('textarea[name=text-input]').fill('{"name":"knitspace","tools":[1,2,3],"nested":{"ok":true}}')
  await page.waitForTimeout(700)
  await shot('json-valid')

  // Malformed input: the error state is the one nobody designs.
  await page.locator('textarea[name=text-input]').fill('{"name":"knitspace", oops}')
  await page.waitForTimeout(700)
  await shot('json-invalid')

  // ── Flow: a developer tool ─────────────────────────────────────────────
  console.log('flow: Base64')
  await page.goto(`${BASE}/developer-tools`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(900)
  const devInput = page.locator('textarea').first()
  await devInput.fill('Knitspace 本地工具箱')
  await page.waitForTimeout(600)
  await shot('devtools-filled')

  await browser.close()

  // A contact sheet so the whole sequence can be read at once.
  const html = `<html><body style="margin:0;background:#000;font:11px sans-serif">
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:4px;padding:4px">${shots
      .map(
        (file) =>
          `<figure style="margin:0"><img src="file:///${file.replace(/\\/g, '/')}" style="width:100%;display:block;border:1px solid #333"><figcaption style="color:#6cf;padding:2px">${file
            .split(/[\\/]/)
            .pop()}</figcaption></figure>`,
      )
      .join('')}</div></body></html>`
  writeFileSync(join(OUT, 'sheet.html'), html)
  console.log(`\n${shots.length} states captured → ${OUT}`)
}

run().catch((error) => {
  console.error('flow failed:', error.message)
  process.exit(1)
})
