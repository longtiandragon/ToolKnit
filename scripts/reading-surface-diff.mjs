/*
 * Records the computed style of every element on the Markdown reading surface,
 * so a refactor of that surface can be proven to change only what it meant to.
 *
 * The reading surface is the one part of the product that renders content the
 * app does not own, and it is spread over five stylesheets with rules that
 * override each other by load order. Moving those rules or renaming their
 * tokens cannot be checked by looking: a paragraph that lost its colour still
 * looks like a paragraph. So this opens a document containing every block type
 * the renderer can emit, walks the rendered tree, and writes down the resolved
 * colour, ground, border, type and spacing of each node — for both themes and
 * all four paper tones, plus the editor pane and the teleported menus.
 *
 *   node scripts/reading-surface-diff.mjs --save before
 *   ...refactor...
 *   node scripts/reading-surface-diff.mjs --save after
 *   node scripts/reading-surface-diff.mjs --compare before after
 *
 * Needs `npm run dev` on 1421.
 */
import { chromium } from 'playwright-core'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const BASE = 'http://127.0.0.1:1421/#'
const OUT = join(process.env.TEMP || '.', 'reading-surface')
const TONES = ['warm', 'neutral', 'mist', 'night']

mkdirSync(OUT, { recursive: true })

/* Every block type the Markdown renderer can produce, in one document: the
   point is coverage, not prose. Mermaid and KaTeX are included because their
   figures are the only parts of the reading surface that deliberately keep a
   light ground in both themes. */
const SAMPLE = `---
title: 阅读面取样
tags: [排版, 回归]
status: 校对中
---

# 一级标题带下划线

正文段落，含 **粗体**、*斜体*、\`行内代码\` 与 [外部链接](https://example.com)，以及 [[并查集]] 这样的双链。

## 二级标题

### 三级标题

#### 四级标题

- 无序列表项
- 第二项
  - 嵌套项

1. 有序列表
2. 第二条

- [ ] 未完成任务
- [x] 已完成任务

> 引用块用来验证左侧竖线与底色。
> 第二行。

| 表头 A | 表头 B |
| --- | --- |
| 单元格 | 单元格 |

\`\`\`ts
const shortestPath = (graph: Graph): number => graph.edges.length
\`\`\`

$$
\\sum_{i=1}^{n} i = \\frac{n(n+1)}{2}
$$

\`\`\`mermaid
graph LR
  A[起点] --> B[终点]
\`\`\`

![占位图片](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==)

---

最后一段。
`

/** Serialised in the page: a stable key plus the values a theme can change. */
const MEASURE = `(root) => {
  const rows = {}
  if (!root) return rows
  const key = (node) => {
    const parts = []
    for (let cursor = node; cursor && cursor !== document.body; cursor = cursor.parentElement) {
      const siblings = [...(cursor.parentElement?.children ?? [])].filter((s) => s.tagName === cursor.tagName)
      const index = siblings.length > 1 ? '[' + (siblings.indexOf(cursor) + 1) + ']' : ''
      parts.unshift(cursor.tagName.toLowerCase() + (cursor.className && typeof cursor.className === 'string'
        ? '.' + cursor.className.trim().split(/\\s+/).join('.') : '') + index)
      if (cursor.classList.contains('markdown-preview') || cursor.classList.contains('app-shell')) break
    }
    return parts.join(' > ')
  }
  const nodes = [root, ...root.querySelectorAll('*')]
  for (const node of nodes) {
    if (node.tagName === 'SCRIPT' || node.tagName === 'STYLE') continue
    const style = getComputedStyle(node)
    const before = getComputedStyle(node, '::before')
    rows[key(node)] = [
      style.color, style.backgroundColor, style.backgroundImage.slice(0, 60),
      style.borderTopColor, style.borderLeftColor, style.borderWidth, style.borderStyle,
      style.fontSize, style.fontWeight, style.lineHeight, style.letterSpacing,
      style.fontFamily.split(',')[0], style.margin, style.padding, style.textDecorationColor,
      style.accentColor, style.opacity, style.outlineColor,
      before.content === 'none' ? '' : before.backgroundColor + '|' + before.borderTopColor,
    ].join(' ~ ')
  }
  return rows
}`

/* The general audit skips anything that looks like content — that exclusion is
   what lets a Mermaid figure keep its light ground in a dark theme — so the
   document itself is never contrast-checked there. It has to be checked here
   instead, and on every paper, because the paper is a setting: a ratio that
   holds on 清白 says nothing about 夜墨. */
const CONTRAST = `(root) => {
  if (!root) return []
  const parse = (value) => {
    const parts = String(value).match(/-?[\\d.]+/g)
    if (!parts) return undefined
    if (/^color|oklab|oklch|lab|lch/.test(String(value))) {
      const probe = document.createElement('span')
      probe.style.color = value
      document.body.append(probe)
      const resolved = getComputedStyle(probe).color
      probe.remove()
      if (resolved !== value) return parse(resolved)
      return undefined
    }
    const [r, g, b, a] = parts.map(Number)
    return { r, g, b, a: a === undefined ? 1 : a }
  }
  const over = (top, base) => ({
    r: top.r * top.a + base.r * (1 - top.a),
    g: top.g * top.a + base.g * (1 - top.a),
    b: top.b * top.a + base.b * (1 - top.a),
    a: 1,
  })
  const luminance = ({ r, g, b }) => {
    const channel = (value) => {
      const v = value / 255
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
    }
    return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
  }
  const contrast = (a, b) => {
    const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m)
    return (x + 0.05) / (y + 0.05)
  }
  const backdrop = (element) => {
    let ground = { r: 255, g: 255, b: 255, a: 1 }
    const stack = []
    for (let node = element.parentElement; node; node = node.parentElement) {
      const colour = parse(getComputedStyle(node).backgroundColor)
      if (colour && colour.a > 0) stack.push(colour)
      if (colour && colour.a === 1) break
    }
    for (const colour of stack.reverse()) ground = over(colour, ground)
    return ground
  }
  const findings = []
  for (const element of [root, ...root.querySelectorAll('*')]) {
    if (![...element.childNodes].some((node) => node.nodeType === 3 && node.textContent.trim())) continue
    // checkVisibility also rules out the children of a hidden ancestor — the
    // Mermaid source block is one, and its light-on-light ink is only
    // "unreadable" while nothing renders it.
    if (element.checkVisibility && !element.checkVisibility({ contentVisibilityAuto: true, opacityProperty: true, visibilityProperty: true })) continue
    const style = getComputedStyle(element)
    if (style.visibility === 'hidden' || style.display === 'none' || style.opacity === '0') continue
    const fg = parse(style.color)
    if (!fg || fg.a === 0) continue
    const own = parse(style.backgroundColor)
    const behind = backdrop(element)
    const surface = own && own.a > 0 ? over(own, behind) : behind
    const size = Number.parseFloat(style.fontSize)
    const weight = Number(style.fontWeight) || 400
    const need = size >= 18.66 || (size >= 14 && weight >= 700) ? 3 : 4.5
    const ratio = contrast(over(fg, surface), surface)
    if (ratio >= need) continue
    const path = []
    for (let node = element; node && node !== document.body; node = node.parentElement) {
      path.unshift(node.tagName.toLowerCase() + (node.className && typeof node.className === 'string'
        ? '.' + node.className.trim().split(/\\s+/).join('.') : ''))
    }
    findings.push(\`\${path.slice(-3).join('>')} \` +
      \`\${ratio.toFixed(2)}:1 (need \${need}) \${style.color} on rgb(\${Math.round(surface.r)},\${Math.round(surface.g)},\${Math.round(surface.b)}) \` +
      \`\${size}px 「\${(element.textContent || '').trim().slice(0, 18)}」\`)
  }
  return findings
}`

const contrastFindings = []

async function checkContrast(page, root, scope) {
  const findings = await page.evaluate(`(${CONTRAST})(document.querySelector(${JSON.stringify(root)}))`)
  for (const finding of findings) {
    contrastFindings.push(`${scope}  ${finding}`)
    console.log(`      ! ${finding}`)
  }
}

async function measure(page, root) {
  const rows = await page.evaluate(`(${MEASURE})(document.querySelector(${JSON.stringify(root)}))`)
  const count = Object.keys(rows).length
  console.log(`  ${count ? String(count).padStart(4) : '   -'}  ${root}`)
  return rows
}

async function setTone(page, tone) {
  await page.evaluate((value) => {
    const shell = document.querySelector('.app-shell')
    for (const name of ['warm', 'neutral', 'mist', 'night']) shell.classList.remove(`reading-paper--${name}`)
    shell.classList.add(`reading-paper--${value}`)
  }, tone)
  // Headings carry `transition: color`, so a measurement taken immediately
  // after the switch records a colour part-way between the two papers — which
  // reads as a contrast failure that does not exist a fifth of a second later.
  await page.waitForTimeout(400)
}

async function collect(theme) {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true })
  const context = await browser.newContext({ viewport: { width: 1500, height: 950 } })
  await context.addInitScript((value) => window.localStorage.setItem('knitspace:theme', value), theme)
  const page = await context.newPage()
  const result = {}

  await page.goto(`${BASE}/documents?kind=note`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(1000)

  // The blank-document preview only exists in preview mode, before anything
  // has been typed, so it has to be measured first.
  await page.locator('button:has-text("新建笔记")').first().click()
  await page.waitForTimeout(800)
  await page.locator('button:has-text("预览")').first().click()
  await page.waitForTimeout(700)
  result[`${theme}/blank`] = await measure(page, '.blank-document-preview')

  await page.locator('button:has-text("编辑")').first().click()
  await page.waitForTimeout(600)
  await page.locator('.cm-content').click()
  await page.keyboard.press('Control+a')
  await page.keyboard.press('Delete')
  await page.keyboard.insertText(SAMPLE)
  await page.waitForTimeout(2500)

  // Split mode renders the source pane and the preview side by side.
  await page.locator('button:has-text("分屏")').first().click()
  await page.waitForTimeout(2500)
  result[`${theme}/editor`] = await measure(page, '.markdown-editor-source-pane')

  await page.locator('button:has-text("预览")').first().click()
  // Mermaid loads its own chunk on first use; KaTeX renders synchronously.
  await page.waitForTimeout(4000)

  for (const tone of TONES) {
    await setTone(page, tone)
    result[`${theme}/paper/${tone}`] = await measure(page, '.markdown-preview')
    await checkContrast(page, '.markdown-preview', `${theme}/${tone}`)
    await page.screenshot({ path: join(OUT, `${theme}-${tone}.png`), fullPage: false })
  }
  await setTone(page, 'warm')

  // Chrome around the document: the frontmatter strip, the outline, and the
  // three menus MarkdownContent teleports to the body.
  const frontmatter = page.locator('button[aria-controls="markdown-frontmatter-details"]')
  if (await frontmatter.count()) {
    await frontmatter.click()
    await page.waitForTimeout(400)
    result[`${theme}/frontmatter`] = await measure(page, '.markdown-frontmatter')
  }
  const outline = page.locator('.markdown-outline')
  if (await outline.count()) result[`${theme}/outline`] = await measure(page, '.markdown-outline')

  const menus = [
    ['diagram', '.markdown-mermaid', 'section[aria-label="Mermaid 图表操作"]'],
    ['link', '.markdown-content a[href^="https"]', 'section[aria-label$="链接操作"]'],
    ['image', '.markdown-content img', 'section[aria-label="Markdown 图片操作"]'],
  ]
  for (const [label, target, menu] of menus) {
    const element = page.locator(target).first()
    if (!(await element.count())) { console.log(`  ${label}: no target`); continue }
    await element.scrollIntoViewIfNeeded()
    await element.click({ button: 'right' })
    await page.waitForTimeout(500)
    if (await page.locator(menu).count()) {
      result[`${theme}/menu/${label}`] = await measure(page, menu)
      await page.screenshot({ path: join(OUT, `${theme}-menu-${label}.png`) })
    } else console.log(`  ${label}: menu did not open`)
    await page.keyboard.press('Escape')
    await page.waitForTimeout(200)
  }

  // The viewer is a full-screen overlay opened by clicking a picture.
  const picture = page.locator('.markdown-content img[role="button"]').first()
  if (await picture.count()) {
    await picture.click()
    await page.waitForTimeout(500)
    result[`${theme}/viewer`] = await measure(page, '.markdown-image-viewer')
    await page.screenshot({ path: join(OUT, `${theme}-viewer.png`) })
    await page.keyboard.press('Escape')
  } else console.log('     -  image viewer (no zoomable image)')

  await browser.close()
  return result
}

function flatten(snapshot) {
  const flat = new Map()
  for (const [scope, rows] of Object.entries(snapshot)) {
    for (const [key, value] of Object.entries(rows)) flat.set(`${scope} :: ${key}`, value)
  }
  return flat
}

const FIELDS = ['color', 'background', 'background-image', 'border-top-color', 'border-left-color',
  'border-width', 'border-style', 'font-size', 'font-weight', 'line-height', 'letter-spacing',
  'font-family', 'margin', 'padding', 'underline', 'accent-color', 'opacity', 'outline-color', '::before']

function compare(left, right) {
  const a = flatten(JSON.parse(readFileSync(join(OUT, `${left}.json`), 'utf8')))
  const b = flatten(JSON.parse(readFileSync(join(OUT, `${right}.json`), 'utf8')))
  let changed = 0
  let missing = 0
  for (const [key, before] of a) {
    if (!b.has(key)) { console.log(`GONE     ${key}`); missing += 1; continue }
    const after = b.get(key)
    if (after === before) continue
    const oldValues = before.split(' ~ ')
    const newValues = after.split(' ~ ')
    const parts = FIELDS.map((name, index) => oldValues[index] === newValues[index]
      ? null : `${name}: ${oldValues[index]} → ${newValues[index]}`).filter(Boolean)
    console.log(`CHANGED  ${key}\n         ${parts.join('\n         ')}`)
    changed += 1
  }
  for (const key of b.keys()) if (!a.has(key)) { console.log(`NEW      ${key}`); missing += 1 }
  console.log(`\n${a.size} elements measured · ${changed} changed · ${missing} appeared/disappeared`)
  return changed + missing
}

/*
 * The standalone HTML export renders the same Markdown through the same
 * renderer, but wraps it in its own stylesheet (`markdown-export-document.ts`)
 * — a light page that never follows the interface theme, because it is a file
 * someone keeps. The two therefore share class names and nothing else, and the
 * only way to know a change to one did not break the other is to produce it.
 */
async function exportShot() {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true })
  const context = await browser.newContext({ viewport: { width: 1000, height: 1400 } })
  const page = await context.newPage()
  await page.goto(`${BASE}/documents?kind=note`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(1000)

  const html = await page.evaluate(async (source) => {
    const module = await import('/src/lib/markdown-export.ts')
    return module.exportMarkdownHtml({ title: '阅读面取样', source, documentId: 'probe' })
  }, SAMPLE)

  const file = join(OUT, 'export.html')
  writeFileSync(file, html)
  await page.goto(`file:///${file.replace(/\\/g, '/')}`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(800)
  await page.screenshot({ path: join(OUT, 'export.png'), fullPage: true })
  console.log(`export: ${(html.length / 1024).toFixed(1)} KB → ${file}`)
  for (const marker of ['code-frame', 'markdown-mermaid', 'task-list', 'math-block', 'export-note']) {
    console.log(`  ${html.includes(marker) ? '✓' : '✗'} ${marker}`)
  }
  await browser.close()
}

/*
 * The reading surface at a window narrower than the layout's 1050px floor.
 * The body keeps its minimum and scrolls, but media queries answer to the
 * viewport, so the image viewer really does reach its narrow form — and the
 * preview padding really does have to give way before the measure does.
 */
async function narrow() {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true })
  for (const [width, height] of [[1050, 700], [860, 640]]) {
    for (const theme of ['dark', 'light']) {
      const context = await browser.newContext({ viewport: { width, height } })
      await context.addInitScript((value) => window.localStorage.setItem('knitspace:theme', value), theme)
      const page = await context.newPage()
      await page.goto(`${BASE}/documents?kind=note`, { waitUntil: 'networkidle' })
      await page.waitForTimeout(900)
      await page.locator('button:has-text("新建笔记")').first().click()
      await page.waitForTimeout(700)
      await page.locator('button:has-text("编辑")').first().click()
      await page.waitForTimeout(600)
      await page.locator('.cm-content').click()
      // Frontmatter is only frontmatter at offset zero, so the draft has to be
      // emptied first or the YAML renders as a setext heading in the body.
      await page.keyboard.press('Control+a')
      await page.keyboard.press('Delete')
      await page.keyboard.insertText(SAMPLE)
      await page.waitForTimeout(2000)
      await page.locator('button:has-text("预览")').first().click()
      await page.waitForTimeout(2500)
      await page.screenshot({ path: join(OUT, `narrow-${width}-${theme}-preview.png`) })
      const picture = page.locator('.markdown-content img[role="button"]').first()
      if (await picture.count()) {
        await picture.click()
        await page.waitForTimeout(600)
        await page.screenshot({ path: join(OUT, `narrow-${width}-${theme}-viewer.png`) })
      }
      console.log(`  ${width}×${height} ${theme}`)
      await context.close()
    }
  }
  await browser.close()
  console.log(`narrow shots → ${OUT}`)
}

async function main() {
  if (process.argv.includes('--export')) return exportShot()
  if (process.argv.includes('--narrow')) return narrow()
  const compareIndex = process.argv.indexOf('--compare')
  if (compareIndex > -1) {
    process.exitCode = compare(process.argv[compareIndex + 1], process.argv[compareIndex + 2]) ? 1 : 0
    return
  }
  const saveIndex = process.argv.indexOf('--save')
  const name = saveIndex > -1 ? process.argv[saveIndex + 1] : 'snapshot'
  const snapshot = {}
  for (const theme of ['dark', 'light']) {
    console.log(`collecting ${theme}`)
    Object.assign(snapshot, await collect(theme))
  }
  const file = join(OUT, `${name}.json`)
  writeFileSync(file, JSON.stringify(snapshot, null, 1))
  const count = Object.values(snapshot).reduce((sum, rows) => sum + Object.keys(rows).length, 0)
  console.log(`\n${Object.keys(snapshot).length} scopes, ${count} elements → ${file}`)
  console.log(`contrast: ${contrastFindings.length ? `${contrastFindings.length} below AA` : 'every paper clears AA'}`)
  if (!count) { console.error('measured nothing — the surface never rendered'); process.exitCode = 1 }
  if (contrastFindings.length) process.exitCode = 1
}

main().catch((error) => {
  console.error('failed:', error.message)
  process.exit(1)
})
