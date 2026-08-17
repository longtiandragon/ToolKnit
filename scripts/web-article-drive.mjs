/*
 * Drives the offline HTML-source → article → Markdown → note workflow.
 * Requires `pnpm dev`; the browser context is temporary and never fetches the
 * sample URL or writes to the desktop Vault.
 */
import { chromium } from 'playwright-core'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const BASE = 'http://127.0.0.1:1421/#'
const OUT = join(process.env.TEMP || '.', 'web-article-flow')
const SAMPLE = `<!doctype html><html><head>
  <title>站点后备标题</title>
  <meta property="og:title" content="离线提取测试文章">
  <meta property="og:site_name" content="Knitspace QA">
  <meta name="author" content="测试作者">
</head><body>
  <nav>${'<a href="/category">导航栏目</a>'.repeat(25)}</nav>
  <div class="cookie-consent">接受 Cookie 后继续</div>
  <article><h1>离线提取测试文章</h1>
    <p>第一段正文用于确认模板导航不会混入 Markdown 提取结果。</p>
    <p>第二段正文用于确认用户可以在保存之前直接修订内容。</p>
    <aside>相关文章推荐</aside>
  </article>
  <section class="comments">这里是评论区噪声</section>
</body></html>`

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

  await page.goto(`${BASE}/quick`, { waitUntil: 'networkidle' })
  await page.getByLabel('粘贴文字或代码').fill(SAMPLE)
  await page.getByText('识别为网页源码').waitFor()
  check('complete HTML is smart-detected', await page.getByRole('button', { name: /提取网页正文/ }).isVisible())
  await shot('html-detected')

  await page.getByRole('button', { name: /提取网页正文/ }).click()
  await page.getByLabel('提取后的 Markdown').waitFor()
  const markdown = await page.getByLabel('提取后的 Markdown').inputValue()
  check('article title and paragraphs are extracted', markdown.includes('# 离线提取测试文章') && markdown.includes('第一段正文') && markdown.includes('第二段正文'))
  check('navigation, cookie, recommendations and comments are removed', !/导航栏目|Cookie|相关文章推荐|评论区噪声/.test(markdown))
  check('metadata is shown without a network request', await page.getByText('Knitspace QA', { exact: true }).isVisible() && await page.getByText('测试作者', { exact: true }).isVisible())
  check('extraction confidence is explicit', await page.getByText(/高置信度正文|正文候选|低置信度回退/).isVisible())
  await shot('article-preview')

  const sourceUrl = page.getByPlaceholder('https://example.com/article')
  await sourceUrl.fill('file:///private/article.html')
  check('unsafe source URL is rejected visibly', await page.getByText('只接受 HTTP 或 HTTPS 地址').isVisible())
  await sourceUrl.fill('https://example.com/article')
  check('valid source URL clears the warning', await page.getByText('只接受 HTTP 或 HTTPS 地址').count() === 0)

  await page.getByLabel('笔记标题').fill('人工确认后的网页笔记')
  await page.getByLabel('提取后的 Markdown').fill(`${markdown}\n\n人工补充内容。`)
  await page.getByRole('button', { name: '存为笔记' }).click()
  await page.waitForURL(/#\/documents\?/)
  check('confirmed Markdown is saved through the existing note workflow', await page.getByText('人工确认后的网页笔记', { exact: true }).first().isVisible())

  await page.goto(`${BASE}/quick`, { waitUntil: 'networkidle' })
  await page.getByLabel('粘贴文字或代码').fill(SAMPLE)
  await page.setViewportSize({ width: 900, height: 680 })
  await page.getByRole('button', { name: /提取网页正文/ }).click()
  await page.getByLabel('提取后的 Markdown').waitFor()
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  check('workflow fits the 900px minimum window', overflow <= 0, `overflow=${overflow}px`)
  check('preview actions remain reachable at 900px', await page.getByRole('button', { name: '存为笔记' }).isVisible())
  await shot('compact-900')

  check('no console errors during the workflow', errors.length === 0, errors.join(' | '))
  await browser.close()
  const failed = checks.filter(item => !item.passed)
  console.log(`\n${checks.length - failed.length}/${checks.length} checks passed. Screenshots: ${OUT}`)
  if (failed.length) process.exitCode = 1
}

run().catch(error => {
  console.error(error)
  process.exitCode = 1
})
