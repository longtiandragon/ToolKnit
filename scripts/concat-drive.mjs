/*
 * Drives the running dev server through the 拼成长图 (concat) flow end to
 * end: stages three different-sized images, checks the live preview for the
 * vertical/horizontal layouts at zero, positive and negative gaps, then
 * exports the long image and verifies its pixel size.
 *
 * Requires `vite` to already be serving on :1421.
 *
 *   node scripts/concat-drive.mjs
 */
import { chromium } from 'playwright-core'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { deflateSync, inflateSync } from 'node:zlib'

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const BASE = 'http://127.0.0.1:1421/#'
const OUT = join(process.env.TEMP || '.', 'concat-drive')
const FIXTURES = join(OUT, 'fixtures')

mkdirSync(FIXTURES, { recursive: true })

let crcTable
function crc32(buffer) {
  if (!crcTable) {
    crcTable = new Int32Array(256)
    for (let n = 0; n < 256; n += 1) {
      let c = n
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      crcTable[n] = c
    }
  }
  let c = -1
  for (let i = 0; i < buffer.length; i += 1) c = crcTable[(c ^ buffer[i]) & 0xff] ^ (c >>> 8)
  return (c ^ -1) >>> 0
}
function pngChunk(type, data) {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const typeBytes = Buffer.from(type, 'ascii')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])))
  return Buffer.concat([length, typeBytes, data, crc])
}
function solidPng(width, height, [r, g, b]) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  const rows = []
  for (let y = 0; y < height; y += 1) {
    const row = Buffer.alloc(1 + width * 4)
    for (let x = 0; x < width; x += 1) {
      row[1 + x * 4] = r
      row[2 + x * 4] = g
      row[3 + x * 4] = b
      row[4 + x * 4] = 255
    }
    rows.push(row)
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(Buffer.concat(rows))),
    pngChunk('IEND', Buffer.alloc(0)),
  ])
}
function pngSize(file) {
  const data = readFileSync(file)
  if (data.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw new Error(`${file} is not a PNG`)
  return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) }
}

/** Decodes the PNG and samples single pixels. The horizontal draw mapping
 *  once swapped the frame axes, which squished images, clipped the bottom
 *  and left white space — points near the cross-axis edges are what catch
 *  that regression. */
function decodePixels(file) {
  const data = readFileSync(file)
  let offset = 8
  let width = 0; let height = 0; let colorType = 0
  const idat = []
  while (offset < data.length) {
    const length = data.readUInt32BE(offset)
    const type = data.subarray(offset + 4, offset + 8).toString('ascii')
    const body = data.subarray(offset + 8, offset + 8 + length)
    if (type === 'IHDR') { width = body.readUInt32BE(0); height = body.readUInt32BE(4); colorType = body[9] }
    if (type === 'IDAT') idat.push(body)
    offset += 12 + length
  }
  const channels = colorType === 6 ? 4 : 3
  const raw = inflateSync(Buffer.concat(idat))
  const stride = width * channels
  const pixels = new Uint8Array(stride * height)
  let prev = new Uint8Array(stride)
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)]
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1))
    const row = new Uint8Array(stride)
    for (let i = 0; i < stride; i += 1) {
      const a = i >= channels ? row[i - channels] : 0
      const b = prev[i]
      const c = i >= channels ? prev[i - channels] : 0
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
  return { width, height, channels, stride, pixels }
}

function checkPixels(file, samples) {
  const { width, height, channels, stride, pixels } = decodePixels(file)
  console.log(`  pixel check ${width}×${height}`)
  let failed = false
  for (const [x, y, label, [r, g, b]] of samples) {
    const base = y * stride + x * channels
    const actual = [pixels[base], pixels[base + 1], pixels[base + 2]]
    const ok = Math.abs(actual[0] - r) < 24 && Math.abs(actual[1] - g) < 24 && Math.abs(actual[2] - b) < 24
    console.log(`    (${x},${y}) ${label}: ${actual.join(',')} expect ~${r},${g},${b} → ${ok ? 'OK' : 'FAIL'}`)
    if (!ok) failed = true
  }
  if (failed) throw new Error('pixel check failed')
}

async function waitSummary(page, expected) {
  const deadline = Date.now() + 20000
  while (Date.now() < deadline) {
    const text = await page.locator('header:has-text("拼成长图预览")').textContent().catch(() => '')
    if (text?.includes(expected)) return
    await page.waitForTimeout(200)
  }
  throw new Error(`summary never showed ${expected}`)
}

async function run() {
  const fixtures = [
    ['red', 400, 300, [220, 60, 40]],
    ['green', 500, 200, [40, 170, 90]],
    ['blue', 300, 500, [50, 90, 210]],
  ]
  const paths = fixtures.map(([name, width, height, rgb]) => {
    const path = join(FIXTURES, `${name}.png`)
    writeFileSync(path, solidPng(width, height, rgb))
    return path
  })
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

  await page.goto(`${BASE}/visual?tool=concat`, { waitUntil: 'networkidle' })
  await page.setInputFiles('input[type=file]', paths)
  await page.waitForTimeout(400)

  console.log('flow: 上下拼接 · 间距 0 → 500 × 1000')
  await waitSummary(page, '500 × 1000 px')

  console.log('flow: 间距 +40 → 500 × 1080')
  await page.locator('input[type=range]').fill('40')
  await waitSummary(page, '500 × 1080 px')

  console.log('flow: 间距 -100 叠压 → 500 × 800')
  await page.locator('input[type=range]').fill('-100')
  await waitSummary(page, '500 × 800 px')

  console.log('flow: 左右拼接 · 间距 -100 → 1000 × 500')
  await page.locator('select').selectOption('horizontal')
  await waitSummary(page, '1000 × 500 px')
  await page.screenshot({ path: join(OUT, 'preview-horizontal-overlap.png') })

  console.log('flow: 导出长图')
  await page.locator('button:has-text("导出长图")').click()
  let deadline = Date.now() + 15000
  while (downloads.length < 1 && Date.now() < deadline) await page.waitForTimeout(250)
  if (!downloads.length) throw new Error('no download produced')
  const size = pngSize(downloads[0].path)
  console.log(`  ${downloads[0].name}  ${size.width}×${size.height}`)
  if (!/^image-wall-\d+\.png$/.test(downloads[0].name)) throw new Error(`unexpected name ${downloads[0].name}`)
  if (size.width !== 1000 || size.height !== 500) throw new Error(`unexpected size ${size.width}×${size.height}`)
  checkPixels(downloads[0].path, [
    [50, 250, 'red spans its full width from the left edge', [220, 60, 40]],
    [600, 250, 'green lands after the red-green overlap', [40, 170, 90]],
    [850, 450, 'blue reaches the bottom edge', [50, 90, 210]],
    [200, 450, 'white below the centered red band', [255, 255, 255]],
  ])
  await page.screenshot({ path: join(OUT, 'finished.png') })

  // ── Flow: uniform cells for mixed aspect ratios ────────────────────────
  console.log('flow: 统一大小 · 上下 · 无缝 → 500 × 1125')
  await page.locator('select').selectOption('vertical')
  await page.locator('input[type=range]').fill('0')
  await page.getByRole('checkbox', { name: '调整成统一大小' }).check()
  await waitSummary(page, '500 × 1125 px')

  console.log('flow: 统一大小 · 裁满格子 → 尺寸不变')
  await page.locator('select:has(option[value="cover"])').selectOption('cover')
  await waitSummary(page, '500 × 1125 px')

  console.log('flow: 导出统一大小长图')
  await page.locator('button:has-text("导出长图")').click()
  deadline = Date.now() + 15000
  while (downloads.length < 2 && Date.now() < deadline) await page.waitForTimeout(250)
  if (downloads.length < 2) throw new Error('uniform export produced no download')
  const uniformSize = pngSize(downloads[1].path)
  console.log(`  ${downloads[1].name}  ${uniformSize.width}×${uniformSize.height}`)
  if (uniformSize.width !== 500 || uniformSize.height !== 1125) throw new Error(`unexpected uniform size ${uniformSize.width}×${uniformSize.height}`)
  await page.screenshot({ path: join(OUT, 'finished-uniform.png') })

  // ── Flow: uniform cells in the horizontal direction ────────────────────
  console.log('flow: 统一大小 · 左右 · 裁满 → 2001 × 500')
  await page.locator('select:has(option[value="vertical"])').selectOption('horizontal')
  await waitSummary(page, '2001 × 500 px')
  await page.locator('button:has-text("导出长图")').click()
  deadline = Date.now() + 15000
  while (downloads.length < 3 && Date.now() < deadline) await page.waitForTimeout(250)
  if (downloads.length < 3) throw new Error('horizontal uniform export produced no download')
  const horizontalSize = pngSize(downloads[2].path)
  console.log(`  ${downloads[2].name}  ${horizontalSize.width}×${horizontalSize.height}`)
  if (horizontalSize.width !== 2001 || horizontalSize.height !== 500) throw new Error(`unexpected size ${horizontalSize.width}×${horizontalSize.height}`)
  checkPixels(downloads[2].path, [
    [300, 250, 'first cell fully covered by red', [220, 60, 40]],
    [1000, 250, 'second cell fully covered by green', [40, 170, 90]],
    [1700, 250, 'third cell fully covered by blue', [50, 90, 210]],
    [300, 490, 'no bottom clipping inside the first cell', [220, 60, 40]],
  ])
  await page.screenshot({ path: join(OUT, 'finished-uniform-horizontal.png') })

  // ── Flow: unified width with optional aspect-ratio lock ────────────────
  console.log('flow: 统一宽度 800 · 锁定纵横比 · 上下 → 800 × 2253')
  await page.locator('select:has(option[value="vertical"])').selectOption('vertical')
  await page.getByRole('checkbox', { name: '统一宽度' }).check()
  await page.locator('input[type=number]').fill('800')
  await waitSummary(page, '800 × 2253 px')

  console.log('flow: 放大超过 1.3 倍时给出变糊警告')
  if (!(await page.getByText('部分图片被放大，可能变糊').count())) throw new Error('expected upscale warning')

  console.log('flow: 统一宽度 200（全部缩小）→ 无放大警告')
  await page.locator('input[type=number]').fill('200')
  await waitSummary(page, '200 × 563 px')
  if (await page.getByText('部分图片被放大，可能变糊').count()) throw new Error('unexpected warning while downscaling')
  await page.locator('input[type=number]').fill('800')
  await waitSummary(page, '800 × 2253 px')

  console.log('flow: 取消锁定纵横比 → 全部拉伸到 800 × 600')
  await page.getByRole('checkbox', { name: '锁定纵横比' }).uncheck()
  await waitSummary(page, '800 × 1800 px')

  console.log('flow: 统一宽度 · 锁定纵横比 · 左右 → 2400 × 1333')
  await page.getByRole('checkbox', { name: '锁定纵横比' }).check() // re-lock
  await page.locator('select:has(option[value="horizontal"])').selectOption('horizontal')
  await waitSummary(page, '2400 × 1333 px')
  await page.locator('button:has-text("导出长图")').click()
  deadline = Date.now() + 15000
  while (downloads.length < 4 && Date.now() < deadline) await page.waitForTimeout(250)
  if (downloads.length < 4) throw new Error('width-mode export produced no download')
  const widthSize = pngSize(downloads[3].path)
  console.log(`  ${downloads[3].name}  ${widthSize.width}×${widthSize.height}`)
  if (widthSize.width !== 2400 || widthSize.height !== 1333) throw new Error(`unexpected size ${widthSize.width}×${widthSize.height}`)
  checkPixels(downloads[3].path, [
    [400, 700, 'red centered in its own height band', [220, 60, 40]],
    [1200, 650, 'green centered in its own height band', [40, 170, 90]],
    [2000, 400, 'blue spans the full cross axis', [50, 90, 210]],
  ])
  await page.screenshot({ path: join(OUT, 'finished-width.png') })

  await browser.close()
  console.log(`\nverified: 拼成长图 in both directions at zero/positive/negative gaps, uniform cells, and unified width with/without aspect lock (${widthSize.width}×${widthSize.height})`)
}

run().catch((error) => {
  console.error('flow failed:', error.message)
  process.exit(1)
})
