/*
 * Drives the running dev server through the PDF-to-image flow end to end:
 * converts two scattered PDFs in one multi-select, then stages a second PDF
 * through the drop zone's “添加” button, and checks every downloaded file for
 * count, name and pixel size.
 *
 * Requires `vite` to already be serving on :1421, like the other drive
 * scripts. Browser-only: the desktop shell saves to its output directory
 * instead of downloading.
 *
 *   node scripts/pdf-image-drive.mjs
 */
import { chromium } from 'playwright-core'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { deflateSync } from 'node:zlib'
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const BASE = 'http://127.0.0.1:1421/#'
const OUT = join(process.env.TEMP || '.', 'pdf-image-drive')
const FIXTURES = join(OUT, 'fixtures')

mkdirSync(FIXTURES, { recursive: true })

/** A real multi-page PDF with vector text and filled shapes, so a blank
 *  render cannot pass the check by accident. */
async function samplePdf(name, pages) {
  const pdf = await PDFDocument.create()
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  for (let index = 0; index < pages; index += 1) {
    const page = pdf.addPage([595, 842])
    page.drawRectangle({ x: 60, y: 700 - index * 40, width: 240, height: 26, color: rgb(0.18, 0.55, 0.42) })
    page.drawText(`${name} - page ${index + 1}`, { x: 72, y: 708 - index * 40, size: 14, font })
    page.drawText(`Knitspace E2E fixture page ${index + 1}`, { x: 60, y: 620 - index * 60, size: 12, font })
  }
  const path = join(FIXTURES, `${name}.pdf`)
  writeFileSync(path, await pdf.save())
  return path
}

function pngSize(file) {
  const data = readFileSync(file)
  const signature = data.subarray(0, 8).toString('hex') === '89504e470d0a1a0a'
  if (!signature) throw new Error(`${file} is not a PNG`)
  return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) }
}

/** A minimal hand-built RGBA PNG with a checkerboard alpha channel. Putting
 *  it into a PDF gives the page a soft mask; pdf.js paints soft masks through
 *  a temporary canvas, which is exactly the path that failed in the worker
 *  with "Cannot read properties of undefined (reading 'createElement')". */
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
function alphaPng() {
  const width = 60
  const height = 60
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  const rows = []
  for (let y = 0; y < height; y += 1) {
    const row = Buffer.alloc(1 + width * 4)
    for (let x = 0; x < width; x += 1) {
      row[1 + x * 4] = 200
      row[2 + x * 4] = 60
      row[3 + x * 4] = 40
      row[4 + x * 4] = (x + y) % 2 ? 255 : 60
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
async function alphaImagePdf() {
  const pdf = await PDFDocument.create()
  const page = pdf.addPage([200, 200])
  const image = await pdf.embedPng(alphaPng())
  page.drawImage(image, { x: 20, y: 20, width: 160, height: 160 })
  const path = join(FIXTURES, 'alpha.pdf')
  writeFileSync(path, await pdf.save())
  return path
}

/** A hand-assembled PDF filled with a Type 4 (Gouraud) mesh shading. pdf.js
 *  paints every mesh through `canvasFactory.create`, unconditionally — this
 *  is the deterministic repro for the worker failure
 *  "Cannot read properties of undefined (reading 'createElement')". */
function meshPdf() {
  const shading = Buffer.alloc(25)
  shading[0] = 0
  shading.writeUInt16BE(0, 1)
  shading.writeUInt16BE(0, 3)
  shading[5] = 255; shading[6] = 0; shading[7] = 0
  shading[8] = 1
  shading.writeUInt16BE(0xffff, 9)
  shading.writeUInt16BE(0, 11)
  shading[13] = 0; shading[14] = 255; shading[15] = 0
  shading[16] = 1
  shading.writeUInt16BE(0, 17)
  shading.writeUInt16BE(0xffff, 19)
  shading[21] = 0; shading[22] = 0; shading[23] = 255
  shading[24] = 2
  const parts = [
    Buffer.from('%PDF-1.4\n', 'ascii'),
    Buffer.from('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n', 'ascii'),
    Buffer.from('2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n', 'ascii'),
    Buffer.from('3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Resources << /Shading << /S1 5 0 R >> >> /Contents 4 0 R >>\nendobj\n', 'ascii'),
    Buffer.from('4 0 obj\n<< /Length 7 >>\nstream\n/S1 sh\nendstream\nendobj\n', 'ascii'),
    Buffer.from(`5 0 obj\n<< /ShadingType 4 /ColorSpace /DeviceRGB /BitsPerCoordinate 16 /BitsPerComponent 8 /BitsPerFlag 8 /Decode [0 200 0 200 0 1 0 1 0 1] /Length ${shading.length} >>\nstream\n`, 'ascii'),
    shading,
    Buffer.from('\nendstream\nendobj\n', 'ascii'),
  ]
  let pdf = Buffer.alloc(0)
  const offsets = [0]
  for (const part of parts) {
    offsets.push(pdf.length)
    pdf = Buffer.concat([pdf, part])
  }
  const xref = pdf.length
  let tail = 'xref\n0 6\n0000000000 65535 f \n'
  for (let index = 1; index <= 5; index += 1) tail += `${String(offsets[index]).padStart(10, '0')} 00000 n \n`
  tail += `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  const path = join(FIXTURES, 'mesh.pdf')
  writeFileSync(path, Buffer.concat([pdf, Buffer.from(tail, 'ascii')]))
  return path
}

async function run() {
  const sample = await samplePdf('sample', 3)
  const extra = await samplePdf('extra', 2)
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

  const runAndWait = async (expected) => {
    downloads.length = 0
    let toastText = ''
    await page.locator('button:has-text("生成新输出")').click()
    const deadline = Date.now() + 20000
    while (downloads.length < expected && Date.now() < deadline) {
      await page.waitForTimeout(250)
      if (!toastText) {
        const texts = await page.locator('article').allInnerTexts().catch(() => [])
        if (texts.length) toastText = texts.join(' | ')
      }
    }
    if (downloads.length !== expected) {
      throw new Error(`expected ${expected} downloads, got ${downloads.length} — toast: ${toastText || '(none)'}`)
    }
  }

  // ── Flow 1: two PDFs in one multi-select, PNG at 150 DPI ───────────────
  console.log('flow: 一次多选两份 PDF → PNG 150 DPI 全部页')
  await page.goto(`${BASE}/tools?group=pdf&operation=pdf-to-image`, { waitUntil: 'networkidle' })
  await page.setInputFiles('input[type=file]', [sample, extra])
  await page.waitForTimeout(500)
  await runAndWait(5)
  const pngs = downloads.map((item) => ({ ...item, size: pngSize(item.path) }))
  for (const item of pngs) {
    console.log(`  ${item.name}  ${item.size.width}×${item.size.height}`)
    if (!/^(sample-p[123]|extra-p[12])\.png$/.test(item.name)) throw new Error(`unexpected output name ${item.name}`)
    if (Math.abs(item.size.width - 1240) > 6 || Math.abs(item.size.height - 1755) > 6) throw new Error(`unexpected size for ${item.name}`)
  }
  await page.screenshot({ path: join(OUT, 'finished-multi.png') })

  // ── Flow 2: stage one, append the other through “添加”, JPG 300 DPI ────
  console.log('flow: 先选一份，再用“添加”补第二份 → JPG 300 DPI 前两页')
  await page.goto(`${BASE}/tools?group=pdf&operation=pdf-to-image`, { waitUntil: 'networkidle' })
  await page.setInputFiles('input[type=file]', sample)
  await page.waitForTimeout(400)
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.getByRole('button', { name: '添加', exact: true }).click(),
  ])
  await chooser.setFiles(extra)
  await page.waitForTimeout(400)
  const staged = await page.getByText('2 个文件').count()
  if (staged === 0) throw new Error('“添加”没有把第二份 PDF 追加到列表')
  await page.locator('select:has(option[value="image/jpeg"])').selectOption('image/jpeg')
  await page.locator('select:has(option[value="300"])').selectOption('300')
  await page.locator('input[name=pdf-image-page-range]').fill('1-2')
  await runAndWait(4)
  for (const item of downloads) {
    const head = readFileSync(item.path).subarray(0, 3).toString('hex')
    console.log(`  ${item.name}  ${head === 'ffd8ff' ? 'JPEG' : 'NOT-JPEG'}`)
    if (!/^(sample-p[12]|extra-p[12])\.jpg$/.test(item.name)) throw new Error(`unexpected output name ${item.name}`)
    if (head !== 'ffd8ff') throw new Error(`${item.name} is not a JPEG`)
  }
  await page.screenshot({ path: join(OUT, 'finished-append.png') })

  // ── Flow 3: a page with a soft mask exercises the worker canvas factory ─
  console.log('flow: 含透明图片（软蒙版）的 PDF → PNG')
  const masked = await alphaImagePdf()
  await page.goto(`${BASE}/tools?group=pdf&operation=pdf-to-image`, { waitUntil: 'networkidle' })
  await page.locator('select:has(option[value="image/png"])').selectOption('image/png')
  await page.locator('select:has(option[value="150"])').selectOption('150')
  await page.setInputFiles('input[type=file]', masked)
  await runAndWait(1)
  const soft = pngSize(downloads[0].path)
  console.log(`  ${downloads[0].name}  ${soft.width}×${soft.height}`)
  if (!/^alpha-p1\.png$/.test(downloads[0].name)) throw new Error(`unexpected output name ${downloads[0].name}`)
  if (soft.width < 400 || soft.width > 440 || soft.height < 400 || soft.height > 440) throw new Error(`unexpected size for ${downloads[0].name}`)
  await page.screenshot({ path: join(OUT, 'finished-alpha.png') })

  // ── Flow 4: a mesh shading hits canvasFactory.create unconditionally ────
  console.log('flow: 含网格着色的 PDF → PNG（画布工厂路径）')
  const mesh = meshPdf()
  await page.goto(`${BASE}/tools?group=pdf&operation=pdf-to-image`, { waitUntil: 'networkidle' })
  await page.locator('select:has(option[value="image/png"])').selectOption('image/png')
  await page.locator('select:has(option[value="150"])').selectOption('150')
  await page.setInputFiles('input[type=file]', mesh)
  await runAndWait(1)
  const shaded = pngSize(downloads[0].path)
  console.log(`  ${downloads[0].name}  ${shaded.width}×${shaded.height}`)
  if (!/^mesh-p1\.png$/.test(downloads[0].name)) throw new Error(`unexpected output name ${downloads[0].name}`)
  if (shaded.width < 400 || shaded.width > 440) throw new Error(`unexpected size for ${downloads[0].name}`)
  await page.screenshot({ path: join(OUT, 'finished-mesh.png') })

  await browser.close()
  console.log(`\nverified: ${pngs.length + downloads.length} page images across two scattered PDFs, one masked PDF and one mesh-shaded PDF, screenshots in ${OUT}`)
}

run().catch((error) => {
  console.error('flow failed:', error.message)
  process.exit(1)
})
