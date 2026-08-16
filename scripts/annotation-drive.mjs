/*
 * Drives the running dev server through the new annotation tools: imports a
 * checkerboard image, draws a mosaic region, a freehand pen stroke and a text
 * label, then exports the card and verifies the pixels — the mosaic region
 * must contain blended colours (real pixelation), and the pen/text colour
 * must appear on the canvas.
 *
 * Requires `vite` to already be serving on :1421.
 *
 *   node scripts/annotation-drive.mjs
 */
import { chromium } from 'playwright-core'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { deflateSync, inflateSync } from 'node:zlib'

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const BASE = 'http://127.0.0.1:1421/#'
const OUT = join(process.env.TEMP || '.', 'annotation-drive')
mkdirSync(OUT, { recursive: true })

let crcTable
function crc32(buffer) {
  if (!crcTable) {
    crcTable = new Int32Array(256)
    for (let n = 0; n < 256; n += 1) { let c = n; for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcTable[n] = c }
  }
  let c = -1
  for (let i = 0; i < buffer.length; i += 1) c = crcTable[(c ^ buffer[i]) & 0xff] ^ (c >>> 8)
  return (c ^ -1) >>> 0
}
function pngChunk(type, data) {
  const length = Buffer.alloc(4); length.writeUInt32BE(data.length)
  const typeBytes = Buffer.from(type, 'ascii')
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])))
  return Buffer.concat([length, typeBytes, data, crc])
}
function checkerPng(width, height, cell) {
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 6
  const rows = []
  for (let y = 0; y < height; y += 1) {
    const row = Buffer.alloc(1 + width * 4)
    for (let x = 0; x < width; x += 1) {
      const dark = (Math.floor(x / cell) + Math.floor(y / cell)) % 2 === 0
      row[1 + x * 4] = dark ? 220 : 255
      row[2 + x * 4] = dark ? 60 : 255
      row[3 + x * 4] = dark ? 40 : 255
      row[4 + x * 4] = 255
    }
    rows.push(row)
  }
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), pngChunk('IHDR', ihdr), pngChunk('IDAT', deflateSync(Buffer.concat(rows))), pngChunk('IEND', Buffer.alloc(0))])
}

function decode(file) {
  const data = readFileSync(file)
  let offset = 8
  let width = 0; let height = 0
  const idat = []
  while (offset < data.length) {
    const length = data.readUInt32BE(offset)
    const type = data.subarray(offset + 4, offset + 8).toString('ascii')
    const body = data.subarray(offset + 8, offset + 8 + length)
    if (type === 'IHDR') { width = body.readUInt32BE(0); height = body.readUInt32BE(4) }
    if (type === 'IDAT') idat.push(body)
    offset += 12 + length
  }
  const raw = inflateSync(Buffer.concat(idat))
  const stride = width * 4
  const pixels = new Uint8Array(stride * height)
  let prev = new Uint8Array(stride)
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)]
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1))
    const row = new Uint8Array(stride)
    for (let i = 0; i < stride; i += 1) {
      const a = i >= 4 ? row[i - 4] : 0
      const b = prev[i]
      const c = i >= 4 ? prev[i - 4] : 0
      let v = line[i]
      if (filter === 1) v = (v + a) & 0xff
      else if (filter === 2) v = (v + b) & 0xff
      else if (filter === 3) v = (v + ((a + b) >> 1)) & 0xff
      else if (filter === 4) { const p = a + b - c; const pa = Math.abs(p - a); const pb = Math.abs(p - b); const pc = Math.abs(p - c); v = (v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 0xff }
      row[i] = v
    }
    pixels.set(row, y * stride)
    prev = row
  }
  return { width, height, stride, pixels }
}

async function run() {
  const fixture = join(OUT, 'checker.png')
  writeFileSync(fixture, checkerPng(240, 240, 8))
  const browser = await chromium.launch({ executablePath: CHROME, headless: true })
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true })
  const page = await context.newPage()
  const downloads = []
  page.on('download', async (download) => {
    const name = download.suggestedFilename()
    const path = join(OUT, name)
    await download.saveAs(path)
    downloads.push({ name, path })
  })

  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' })
  if (!(await page.getByText('图片打码').count())) throw new Error('toolbox card 图片打码 missing on home')
  console.log('home toolbox: 图片打码 card present')

  await page.goto(`${BASE}/visual?annotation=mosaic`, { waitUntil: 'networkidle' })
  await page.setInputFiles('input[type=file]', fixture)
  await page.locator('.annotation-canvas').waitFor({ state: 'visible', timeout: 20000 })
  await page.waitForTimeout(600)
  const mosaicButton = page.locator('button:has-text("打码")')
  if ((await mosaicButton.getAttribute('aria-pressed')) !== 'true') throw new Error('deep link did not arm the mosaic tool')
  console.log('deep link /visual?annotation=mosaic: 打码 tool armed')
  let box = await page.locator('.annotation-canvas').boundingBox()
  if (!box) throw new Error('annotation canvas not found')
  if (box.width < 300) throw new Error(`canvas too small: ${box.width}px`)
  console.log(`canvas visible in the three-column layout: ${Math.round(box.width)}×${Math.round(box.height)}`)
  const px = (rx) => box.x + box.width * rx
  const py = (ry) => box.y + box.height * ry

  // ── Box: one-shot tools return to selection so the placed shape can move. ─
  await page.locator('input[aria-label="标注颜色"]').fill('#00c853')
  await page.locator('button:has-text("方框")').click()
  await page.mouse.move(px(0.4), py(0.4))
  await page.mouse.down()
  await page.mouse.move(px(0.6), py(0.6), { steps: 5 })
  await page.mouse.up()
  await page.waitForTimeout(250)
  if ((await page.locator('button:has-text("选择")').getAttribute('aria-pressed')) !== 'true') throw new Error('drawing did not return to the selection tool')
  // Drag the placed box towards the bottom-right in selection mode.
  await page.mouse.move(px(0.5), py(0.5))
  await page.mouse.down()
  await page.mouse.move(px(0.75), py(0.75), { steps: 10 })
  await page.mouse.up()
  await page.waitForTimeout(250)
  console.log('box placed, returned to selection, and dragged immediately')

  // ── Ctrl+wheel zoom transforms the complete composition, then the
  // percentage control resets it without moving annotations off the image. ─
  await page.keyboard.down('Control')
  await page.mouse.wheel(0, -500)
  await page.keyboard.up('Control')
  await page.waitForTimeout(300)
  const zoomControl = page.locator('button:has-text("%")').first()
  const zoomText = await zoomControl.textContent()
  if (!zoomText || zoomText.trim() === '100%') throw new Error('ctrl+wheel did not zoom the complete composition')
  console.log(`ctrl+wheel zoom engaged (${zoomText.trim()})`)
  await zoomControl.click()
  await page.waitForTimeout(300)
  if ((await zoomControl.textContent())?.trim() !== '100%') throw new Error('percentage control did not reset the zoom')

  // ── Fullscreen toggle ───────────────────────────────────────────────────
  await page.locator('button:has-text("全屏画布")').click()
  await page.waitForTimeout(400)
  box = await page.locator('.annotation-canvas').boundingBox()
  if (!box || box.width < 1200 || box.height < 780) throw new Error(`fullscreen canvas too small: ${box?.width}×${box?.height}`)
  console.log(`fullscreen canvas fills the window: ${Math.round(box.width)}×${Math.round(box.height)}`)
  await page.locator('button:has-text("退出全屏")').last().click()
  await page.waitForTimeout(400)

  // ── Mosaic: the earlier box intentionally consumed the one-shot tool. ──
  await page.locator('button:has-text("打码")').click()
  await page.mouse.move(px(0.32), py(0.32))
  await page.mouse.down()
  await page.mouse.move(px(0.66), py(0.62), { steps: 6 })
  await page.mouse.up()
  await page.waitForTimeout(300)

  // ── Pen: a freehand squiggle in the upper-left ─────────────────────────
  await page.locator('input[aria-label="标注颜色"]').fill('#ffbf69')
  await page.locator('button:has-text("涂色")').click()
  await page.mouse.move(px(0.16), py(0.14))
  await page.mouse.down()
  for (const [rx, ry] of [[0.2, 0.1], [0.24, 0.16], [0.28, 0.1], [0.32, 0.15]]) {
    await page.mouse.move(px(rx), py(ry), { steps: 3 })
  }
  await page.mouse.up()
  await page.waitForTimeout(300)

  // ── Text: one click places it, a double click opens the editor ─────────
  await page.locator('button:has-text("文字")').click()
  await page.mouse.click(px(0.5), py(0.78))
  await page.waitForTimeout(300)
  await page.mouse.dblclick(px(0.5), py(0.78))
  await page.waitForTimeout(400)
  const editor = page.locator('input[aria-label="标注文字"]')
  if (!(await editor.count())) throw new Error('double click did not open the text editor')
  await editor.fill('已编辑文字')
  await page.keyboard.press('Enter')
  await page.waitForTimeout(300)
  if (await page.locator('input[aria-label="标注文字"]').count()) throw new Error('text editor did not close after Enter')
  console.log('text placed, double-clicked into the editor and updated')

  await page.getByRole('button', { name: '导出', exact: true }).click()
  const deadline = Date.now() + 15000
  while (downloads.length < 1 && Date.now() < deadline) await page.waitForTimeout(250)
  if (!downloads.length) throw new Error('no export produced')
  await page.screenshot({ path: join(OUT, 'composed.png') })
  await browser.close()

  // ── Verify pixels ───────────────────────────────────────────────────────
  const { width, height, stride, pixels } = decode(downloads[0].path)
  console.log(`${downloads[0].name}  ${width}×${height}`)
  if (!/^image-card-\d+\.png$/.test(downloads[0].name)) throw new Error(`unexpected name ${downloads[0].name}`)
  let blended = 0
  let marker = 0
  let greenMoved = 0
  let greenCenter = 0
  for (let y = 0; y < height; y += 2) {
    for (let x = 0; x < width; x += 2) {
      const base = y * stride + x * 4
      const r = pixels[base]; const g = pixels[base + 1]; const b = pixels[base + 2]
      const inMosaic = x >= width * 0.3 && x <= width * 0.7 && y >= height * 0.3 && y <= height * 0.7
      const pureRed = Math.abs(r - 220) < 30 && Math.abs(g - 60) < 30 && Math.abs(b - 40) < 30
      const pureWhite = r > 230 && g > 230 && b > 230
      if (inMosaic && !pureRed && !pureWhite) blended += 1
      if (Math.abs(r - 255) < 30 && Math.abs(g - 191) < 30 && Math.abs(b - 105) < 30) marker += 1
      const green = Math.abs(r - 0) < 30 && Math.abs(g - 200) < 40 && Math.abs(b - 83) < 40
      if (green && x >= width * 0.62 && y >= height * 0.62) greenMoved += 1
      if (green && x >= width * 0.35 && x <= width * 0.6 && y >= height * 0.35 && y <= height * 0.6) greenCenter += 1
    }
  }
  console.log(`  mosaic-region blended pixels: ${blended}`)
  console.log(`  pen/text marker pixels: ${marker}`)
  console.log(`  dragged box pixels in bottom-right: ${greenMoved} (centre leftovers: ${greenCenter})`)
  if (blended < 200) throw new Error('mosaic region shows no pixelation blends')
  if (marker < 30) throw new Error('pen/text colour not found on export')
  if (greenMoved < 100) throw new Error('box did not move: no green border in the bottom-right')
  if (greenCenter > 10) throw new Error('box was not dragged away from the centre')
  console.log('OK: mosaic pixelates for real, pen and text render, a placed box drags immediately, zoom/fullscreen/text editing all work')
}

run().catch((error) => {
  console.error('flow failed:', error.message)
  process.exit(1)
})
