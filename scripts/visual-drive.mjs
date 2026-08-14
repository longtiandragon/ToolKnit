/*
 * Drives /visual through the states that only exist after you use it.
 *
 * A screenshot of the route shows one empty canvas. The six modes, the crop
 * overlay, the annotation toolbar, the stitch order list and the project
 * popover only appear once images are in, so this puts them in through the
 * page's own file input rather than mocking the store.
 *
 *   node scripts/visual-drive.mjs [dark|light]
 */
import { chromium } from 'playwright-core'
import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const BASE = 'http://127.0.0.1:1421/#'
const OUT = join(process.env.TEMP || '.', 'visual-flow')
const FIXTURES = join(OUT, 'fixtures')

mkdirSync(FIXTURES, { recursive: true })

/** A real PNG, so natural size, aspect ratio and re-encoding all behave. */
function samplePng(name, width, height, tint) {
  const raw = Buffer.alloc((width * 3 + 1) * height)
  let cursor = 0
  for (let y = 0; y < height; y += 1) {
    raw[cursor] = 0
    cursor += 1
    for (let x = 0; x < width; x += 1) {
      const band = Math.floor((x / width) * 4) % 2 === Math.floor((y / height) * 4) % 2
      raw[cursor] = band ? tint[0] : 255 - tint[0]
      raw[cursor + 1] = band ? tint[1] : 255 - tint[1]
      raw[cursor + 2] = band ? tint[2] : 255 - tint[2]
      cursor += 3
    }
  }
  const chunk = (type, body) => {
    const length = Buffer.alloc(4)
    length.writeUInt32BE(body.length)
    const payload = Buffer.concat([Buffer.from(type, 'ascii'), body])
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(payload) >>> 0)
    return Buffer.concat([length, payload, crc])
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header[8] = 8
  header[9] = 2
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
  const path = join(FIXTURES, `${name}.png`)
  writeFileSync(path, png)
  return path
}

const CRC_TABLE = Array.from({ length: 256 }, (_, index) => {
  let value = index
  for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
  return value >>> 0
})
function crc32(buffer) {
  let crc = 0xffffffff
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  return crc ^ 0xffffffff
}

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

  const wide = samplePng('wide-shot', 900, 560, [42, 96, 180])
  const tall = samplePng('tall-shot', 620, 900, [180, 74, 42])
  const square = samplePng('square-shot', 700, 700, [56, 150, 96])

  console.log(`theme: ${theme}`)

  await page.goto(`${BASE}/visual`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(1000)
  await shot('compose-empty')

  // A blank canvas is the compose entry point that needs no file at all.
  await page.locator('button:has-text("横向")').first().click().catch(() => {})
  await page.waitForTimeout(900)
  await shot('compose-blank-canvas')

  // Real files, through the page's own input.
  await page.goto(`${BASE}/visual`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(700)
  await page.setInputFiles('input[type=file]', [wide, tall, square])
  await page.waitForTimeout(1100)
  await shot('compose-images')

  await page.locator('button[aria-pressed]:has-text("四宫格")').click()
  await page.locator('input[placeholder*="本周记录"]').fill('三张对比图')
  await page.locator('input[placeholder*="品牌"]').fill('knitspace · 本地生成')
  await page.waitForTimeout(700)
  await shot('compose-titled')

  await page.locator('button[title*="拖出一个方框"]').click()
  await page.waitForTimeout(300)
  const canvas = page.locator('.annotation-canvas')
  const box = await canvas.boundingBox()
  if (box) {
    await page.mouse.move(box.x + box.width * 0.25, box.y + box.height * 0.3)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width * 0.55, box.y + box.height * 0.6, { steps: 12 })
    await page.mouse.up()
  }
  await page.waitForTimeout(600)
  await shot('compose-annotated')

  await page.locator('button:has-text("图层")').first().click().catch(() => {})
  await page.waitForTimeout(500)
  await shot('compose-layers')

  await page.locator('button[aria-haspopup="dialog"]').click()
  await page.waitForTimeout(600)
  await shot('compose-project-panel')
  await page.keyboard.press('Escape')
  await page.locator('button[aria-label="关闭画布项目"]').click().catch(() => {})
  await page.waitForTimeout(400)

  for (const [mode, label] of [['convert', '格式转换'], ['resize', '压缩缩放'], ['crop', '裁剪图片'], ['rotate', '旋转图片'], ['stitch', '滚动长图']]) {
    await page.locator(`button:has-text("${label}")`).first().click()
    await page.waitForTimeout(1400)
    await shot(mode)
  }

  // The rotate controls live in the canvas header now; prove they still act.
  await page.locator('button:has-text("旋转图片")').first().click()
  await page.waitForTimeout(900)
  await page.locator('button[aria-label="向右旋转 90 度"]').click()
  await page.waitForTimeout(1200)
  await shot('rotate-applied')

  // Right-click the preview: the menu is teleported now, so it must not clip.
  await page.locator('button:has-text("裁剪图片")').first().click()
  await page.waitForTimeout(1200)
  const viewport = page.locator('[role="region"][aria-haspopup="menu"]')
  const viewportBox = await viewport.boundingBox()
  if (viewportBox) {
    await page.mouse.click(viewportBox.x + viewportBox.width - 40, viewportBox.y + viewportBox.height - 40, { button: 'right' })
  }
  await page.waitForTimeout(500)
  await shot('crop-context-menu')

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
