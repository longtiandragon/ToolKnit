/*
 * How crowded is each route — measured, rather than argued about.
 *
 * "Too many features, and if it looks messy nobody wants to use it" is a real
 * complaint and a useless instruction, because every page's author thinks
 * their page is the necessary one. This counts, at the size the desktop window
 * actually opens at (1240×820, not the 1600 a browser test defaults to):
 *
 *   controls   interactive elements visible without scrolling
 *   panels     boxes big enough to compete for attention
 *   words      characters of copy that explain the interface rather than
 *              being the content
 *   firstWork  how far down the page the work surface starts
 *
 * It does not say what to cut. It says where to look, and the two worst
 * offenders both turned out to be showing the same list twice on one screen.
 *
 *   node scripts/audit-density.mjs [dark|light] [--shots]
 */
import { chromium } from 'playwright-core'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const BASE = 'http://127.0.0.1:1421/#'
const OUT = join(process.env.TEMP || '.', 'density')
mkdirSync(OUT, { recursive: true })

const ROUTES = ['/', '/today', '/quick', '/knowledge', '/relations', '/library', '/tools',
  '/tool-space', '/history', '/clipboard', '/developer-tools', '/code-image', '/visual',
  '/create', '/ai', '/documents', '/words', '/review', '/lab', '/settings']

const COLLECT = `() => {
  const viewport = { w: innerWidth, h: innerHeight }
  const visible = (node) => {
    const r = node.getBoundingClientRect()
    const s = getComputedStyle(node)
    return r.width > 0 && r.height > 0 && r.top < viewport.h && r.bottom > 0 &&
      s.visibility !== 'hidden' && s.display !== 'none' && Number.parseFloat(s.opacity) > 0.05
  }
  const workspace = document.querySelector('.workspace-content') || document.body
  const nodes = [...workspace.querySelectorAll('*')].filter(visible)

  const controls = nodes.filter((n) => n.matches('button, a[href], input, select, textarea, [role="button"], [role="tab"], [role="switch"]'))
  const panels = nodes.filter((n) => {
    const s = getComputedStyle(n)
    const r = n.getBoundingClientRect()
    return r.width > 180 && r.height > 60 &&
      (s.backgroundColor !== 'rgba(0, 0, 0, 0)' || Number.parseFloat(s.borderTopWidth) > 0) &&
      !n.closest('.markdown-content')
  })
  // Copy that describes the interface: hints, descriptions, captions — the
  // sentences a returning user has already read.
  const explain = nodes.filter((n) => n.matches('small, p, figcaption, [class*="hint"], [class*="description"]') &&
    [...n.childNodes].some((c) => c.nodeType === 3 && c.textContent.trim()) &&
    !n.closest('.markdown-content'))
  const words = explain.reduce((sum, n) => sum + (n.textContent || '').trim().length, 0)

  // The first thing that is a work surface rather than a description of one.
  const work = nodes.find((n) => n.matches('textarea, .cm-editor, table, [role="list"], [role="tree"], [role="grid"], .markdown-preview-wrap, canvas') ||
    (n.matches('[class*="drop"], [class*="empty"]') && n.getBoundingClientRect().height > 120))
  return {
    viewport,
    controls: controls.length,
    panels: panels.length,
    words,
    explainNodes: explain.length,
    firstWork: work ? Math.round(work.getBoundingClientRect().top) : null,
    topCopy: explain.slice(0, 3).map((n) => (n.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 46)),
  }
}`

const theme = process.argv.includes('light') ? 'light' : 'dark'
const shoot = process.argv.includes('--shots')
const browser = await chromium.launch({ executablePath: CHROME, headless: true })
const context = await browser.newContext({ viewport: { width: 1240, height: 820 } })
await context.addInitScript((value) => window.localStorage.setItem('knitspace:theme', value), theme)
const page = await context.newPage()

const rows = []
for (const route of ROUTES) {
  await page.goto(`${BASE}${route}`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(900)
  const data = await page.evaluate(`(${COLLECT})()`)
  rows.push({ route, ...data })
  if (shoot) await page.screenshot({ path: join(OUT, `${theme}-${route.replace(/[^a-z-]/gi, '') || 'home'}.png`) })
}
await browser.close()

rows.sort((a, b) => (b.controls + b.words / 10) - (a.controls + a.words / 10))
console.log('route            控件  面板  说明字数  首个工作面 y')
for (const row of rows) {
  console.log(`${row.route.padEnd(18)}${String(row.controls).padStart(3)}${String(row.panels).padStart(6)}${String(row.words).padStart(9)}${String(row.firstWork ?? '—').padStart(12)}`)
}
console.log(`\n${rows.length} routes at ${rows[0].viewport.w}×${rows[0].viewport.h}`)
console.log('\n最啰嗦的三条路由的开场白:')
for (const row of rows.slice(0, 3)) console.log(`  ${row.route}: ${row.topCopy.join(' / ')}`)
