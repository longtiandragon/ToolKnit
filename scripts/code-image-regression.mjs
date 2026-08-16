import { chromium } from 'playwright-core'

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const BASE = process.env.KNITSPACE_BASE_URL || 'http://127.0.0.1:1421/#/code-image'
const source = [
  'const title: string = "Knitspace"',
  '',
  'const count: number = 2',
  'export { title }',
].join('\n')

const browser = await chromium.launch({ executablePath: CHROME, headless: true })
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, permissions: ['clipboard-read', 'clipboard-write'] })
  const page = await context.newPage()
  await page.goto(BASE, { waitUntil: 'networkidle' })
  const editor = page.locator('.cm-content')
  await editor.click()
  await editor.evaluate((element, plainText) => {
    const data = new DataTransfer()
    data.setData('text/plain', plainText)
    data.setData('text/html', '<pre><code>// injected by rich conversion\n\nwrong</code></pre>')
    element.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data }))
  }, source)
  await page.waitForTimeout(500)

  const languageText = await page.locator('select[aria-label="代码语言"] option:checked').textContent()
  if (!languageText?.includes('TypeScript')) throw new Error(`wrong language: ${languageText}`)

  await page.getByRole('button', { name: '复制代码' }).click()
  const copied = await page.evaluate(() => navigator.clipboard.readText())
  if (copied.replace(/\r\n/g, '\n') !== source) throw new Error(`copy roundtrip changed source:\n${JSON.stringify(copied)}`)

  const backgrounds = {}
  for (const [label, className] of [['午夜', 'codesnap-midnight'], ['深林', 'codesnap-forest'], ['纸页', 'codesnap-paper']]) {
    await page.getByRole('button', { name: label, exact: true }).click()
    const card = page.locator(`.codesnap-stage .${className}`)
    await card.waitFor()
    backgrounds[label] = await card.evaluate((element) => getComputedStyle(element).backgroundColor)
  }
  if (new Set(Object.values(backgrounds)).size !== 3) throw new Error(`themes share the same card background: ${JSON.stringify(backgrounds)}`)

  console.log(JSON.stringify({ source, copied, languageText, backgrounds }, null, 2))
} finally {
  await browser.close()
}
