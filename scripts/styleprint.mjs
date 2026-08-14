/*
 * A computed-style fingerprint of every element on every route, in both
 * themes: 15k elements, 24 properties each. For refactors that are supposed to
 * change nothing — renaming a token, deleting an alias layer, reordering a
 * sheet — this is the difference between "it should be identical" and "it is".
 *
 * It earned its place immediately. Deleting the alias layer moved four motion
 * tokens into `theme.css`, one of which — `--ease-out` — is a name UnoCSS also
 * publishes from its own theme. The alias layer had been outweighing Uno's
 * copy only by accident of specificity, so the move silently handed every
 * legacy transition in the product to Uno's curve. Nothing about the app
 * looked wrong in a screenshot; the fingerprint said 206 of 15372 elements had
 * changed, all of them in one field.
 *
 *   npm run build && npm run preview -- --port 4173
 *   node scripts/styleprint.mjs before --base=http://127.0.0.1:4173
 *   ...change...
 *   node scripts/styleprint.mjs after  --base=http://127.0.0.1:4173
 *   node scripts/styleprint.mjs --compare before after
 *
 * Measure the *built* app, not the dev server: Vite's CSS hot update
 * re-appends the changed sheet's <style> tag, so after a few edits the dev
 * page no longer has the stylesheet order the build produces.
 */
import { chromium } from 'playwright-core'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const BASE = (process.argv.find((arg) => arg.startsWith('--base='))?.slice(7) ?? 'http://127.0.0.1:1421') + '/#'
const OUT = join(process.env.TEMP || '.', 'styleprint')
mkdirSync(OUT, { recursive: true })

const ROUTES = [
  '/', '/today', '/quick', '/knowledge', '/relations', '/library', '/tools',
  '/media', '/subtitles', '/ocr', '/private-tools', '/history',
  '/clipboard', '/developer-tools', '/code-image', '/visual', '/create', '/ai',
  '/documents', '/words', '/review', '/lab', '/settings',
]

const COLLECT = `() => {
  const rows = {}
  const path = (node) => {
    const parts = []
    for (let cursor = node; cursor && cursor !== document.documentElement; cursor = cursor.parentElement) {
      const siblings = [...(cursor.parentElement?.children ?? [])].filter((s) => s.tagName === cursor.tagName)
      parts.unshift(cursor.tagName.toLowerCase() +
        (cursor.className && typeof cursor.className === 'string' ? '.' + cursor.className.trim().split(/\\s+/).join('.') : '') +
        (siblings.length > 1 ? '[' + (siblings.indexOf(cursor) + 1) + ']' : ''))
    }
    return parts.join('>')
  }
  let index = 0
  for (const node of document.querySelectorAll('body *')) {
    const style = getComputedStyle(node)
    rows[index++ + ' ' + path(node).slice(-160)] = [
      style.color, style.backgroundColor, style.backgroundImage.slice(0, 80),
      style.borderTopColor, style.borderRightColor, style.borderBottomColor, style.borderLeftColor,
      style.borderWidth, style.borderStyle, style.borderRadius, style.boxShadow.slice(0, 80),
      style.outlineColor, style.fontFamily.split(',')[0], style.fontSize, style.fontWeight,
      style.lineHeight, style.letterSpacing, style.opacity, style.zIndex,
      style.transitionDuration, style.transitionTimingFunction, style.accentColor, style.fill, style.stroke,
    ].join(' ~ ')
  }
  return rows
}`

async function collect(name) {
  const snapshot = {}
  const browser = await chromium.launch({ executablePath: CHROME, headless: true })
  for (const theme of ['dark', 'light']) {
    const context = await browser.newContext({ viewport: { width: 1600, height: 950 } })
    await context.addInitScript((value) => window.localStorage.setItem('knitspace:theme', value), theme)
    const page = await context.newPage()
    for (const route of ROUTES) {
      await page.goto(`${BASE}${route}`, { waitUntil: 'networkidle' })
      await page.waitForTimeout(900)
      const rows = await page.evaluate(`(${COLLECT})()`)
      snapshot[`${theme}${route}`] = rows
      process.stdout.write(`\r${theme} ${route} — ${Object.keys(rows).length} elements          `)
    }
    await context.close()
  }
  await browser.close()
  const total = Object.values(snapshot).reduce((sum, rows) => sum + Object.keys(rows).length, 0)
  writeFileSync(join(OUT, `${name}.json`), JSON.stringify(snapshot))
  console.log(`\n${Object.keys(snapshot).length} route/theme pairs, ${total} elements → ${name}.json`)
  if (!total) process.exitCode = 1
}

const FIELDS = ['color', 'background', 'background-image', 'border-top', 'border-right', 'border-bottom',
  'border-left', 'border-width', 'border-style', 'radius', 'shadow', 'outline', 'font-family', 'font-size',
  'font-weight', 'line-height', 'letter-spacing', 'opacity', 'z-index', 'duration', 'easing', 'accent', 'fill', 'stroke']

function compare(left, right) {
  const a = JSON.parse(readFileSync(join(OUT, `${left}.json`), 'utf8'))
  const b = JSON.parse(readFileSync(join(OUT, `${right}.json`), 'utf8'))
  let changed = 0
  let shape = 0
  let total = 0
  for (const scope of Object.keys(a)) {
    const before = a[scope]
    const after = b[scope] ?? {}
    for (const [key, oldValue] of Object.entries(before)) {
      total += 1
      const newValue = after[key]
      if (newValue === undefined) { shape += 1; continue }
      if (newValue === oldValue) continue
      const oldParts = oldValue.split(' ~ ')
      const newParts = newValue.split(' ~ ')
      const diff = FIELDS.map((name, index) => oldParts[index] === newParts[index] ? null : `${name}: ${oldParts[index]} → ${newParts[index]}`).filter(Boolean)
      console.log(`CHANGED ${scope} :: ${key}\n        ${diff.join('\n        ')}`)
      changed += 1
      if (changed > 60) { console.log('… stopping after 60'); return 1 }
    }
  }
  console.log(`\n${total} elements compared · ${changed} changed · ${shape} appeared/disappeared`)
  return changed
}

const compareIndex = process.argv.indexOf('--compare')
if (compareIndex > -1) process.exitCode = compare(process.argv[compareIndex + 1], process.argv[compareIndex + 2]) ? 1 : 0
else await collect(process.argv[2] ?? 'snapshot')
