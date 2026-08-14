/*
 * The third audit. `audit-surfaces.mjs` asks whether a control can be seen;
 * this one asks whether it behaves like a control and whether the content on
 * it can be read as information.
 *
 * Six checks, all of them things a screenshot review reliably misses because
 * they only show up with real data or at a particular width:
 *
 *   clipped      text cut off with no ellipsis and no way to scroll to it
 *   figures      a column of numbers set in proportional figures, so the
 *                digits do not line up between rows
 *   disabled     a disabled control that looks exactly like an enabled one
 *   nameless     an icon-only control with no accessible name
 *   target       an interactive element below the 24px pointer target
 *   titleonly    a control whose only label is a `title` attribute, which
 *                keyboard and touch users never see
 *   void         a large painted panel with nothing in it — the band of bare
 *                ground an empty state was supposed to fill
 *
 * Needs the dev server up.
 *
 *   node scripts/audit-interaction.mjs [dark|light]
 */
import { chromium } from 'playwright-core'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const BASE = 'http://127.0.0.1:1421/#'

const ROUTES = [
  '/', '/today', '/quick', '/knowledge', '/relations', '/library', '/tools',
  '/tool-space', '/media', '/subtitles', '/ocr', '/private-tools', '/history',
  '/clipboard', '/developer-tools', '/code-image', '/visual', '/create', '/ai',
  '/documents', '/words', '/review', '/lab', '/settings',
]

function collect() {
  const findings = []
  let checked = 0

  const label = (element) => {
    const name = element.tagName.toLowerCase() +
      (element.className && typeof element.className === 'string'
        ? '.' + element.className.trim().split(/\s+/).slice(0, 3).join('.') : '')
    const text = (element.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 26)
    return text ? `${name} 「${text}」` : name
  }

  /* A control's name, the way a screen reader would find it. */
  const accessibleName = (element) => (
    element.getAttribute('aria-label') ||
    (element.getAttribute('aria-labelledby') && document.getElementById(element.getAttribute('aria-labelledby'))?.textContent) ||
    (element.textContent || '').trim() ||
    element.querySelector('img[alt]')?.getAttribute('alt') ||
    ''
  ).trim()

  const interactive = 'button, a[href], input, select, textarea, [role="button"], [role="menuitem"], [role="tab"], [role="switch"]'

  /* Screen-reader-only text is *supposed* to be a clipped 1px box, and the
     file inputs behind a styled label are supposed to be invisible. Both look
     exactly like the defects below if you only measure. */
  const hiddenFromSight = (element, style) =>
    /visually-hidden|sr-only/.test(String(element.className)) ||
    element.closest('.visually-hidden, .sr-only') ||
    style.clipPath !== 'none' ||
    element.getAttribute('aria-hidden') === 'true' ||
    Number.parseFloat(style.opacity) === 0

  for (const element of document.querySelectorAll('body *')) {
    const style = getComputedStyle(element)
    if (style.visibility === 'hidden' || style.display === 'none') continue
    const rect = element.getBoundingClientRect()
    if (!rect.width || !rect.height) continue
    if (hiddenFromSight(element, style)) continue
    checked += 1

    const own = [...element.childNodes].some((node) => node.nodeType === 3 && node.textContent.trim())

    /* 1. Text wider than its box, with nothing to reveal the rest. */
    if (own && element.scrollWidth - element.clientWidth > 2 && element.clientWidth > 0) {
      const hidden = style.overflowX === 'hidden' || style.overflowX === 'clip'
      const ellipsis = style.textOverflow === 'ellipsis'
      if (hidden && !ellipsis) {
        findings.push({ kind: 'clipped', el: label(element), detail: `${element.scrollWidth - element.clientWidth}px 被裁掉,既没有省略号也不能滚动` })
      }
    }

    /* 2. Digits that have to line up but are set proportionally. A single
       number is prose; a column of them is a table. */
    if (own) {
      const text = (element.textContent || '').trim()
      const numeric = /^[\d\s.,:%+\-/]+$/.test(text) && /\d\d/.test(text)
      const inColumn = element.closest('td, th, li, tr') || /row|cell|stat|count|size|time|date|number|num/i.test(String(element.className))
      // A monospaced face already lines its digits up; asking it for
      // `tabular-nums` on top is asking for something it cannot not do.
      const mono = /mono|consolas|cascadia|courier/i.test(style.fontFamily)
      if (numeric && inColumn && !mono && !/tabular-nums/.test(style.fontVariantNumeric)) {
        findings.push({ kind: 'figures', el: label(element), detail: `数字未用等宽字形(${style.fontVariantNumeric})` })
      }
    }

    /* 7. A large panel with nothing in it. The rewrite's recurring disease was
       a work surface that stopped short and left a band of bare ground; the
       cure is that an empty region has to say what goes there. Only leaf-ish
       regions count — a container whose children carry the content is not
       itself empty. */
    if (rect.width > 260 && rect.height > 180 && element.matches('main, section, article, aside, div')) {
      const speaks = (element.textContent || '').trim().length > 0 ||
        element.querySelector('img, svg, canvas, video, input, textarea, select, button')
      const painted = style.backgroundColor !== 'rgba(0, 0, 0, 0)' ||
        Number.parseFloat(style.borderTopWidth) > 0 || style.backgroundImage !== 'none'
      if (!speaks && painted) {
        findings.push({ kind: 'void', el: label(element), detail: `${Math.round(rect.width)}×${Math.round(rect.height)}px 的空面板,没有文字也没有图形` })
      }
    }

    if (!element.matches(interactive)) continue

    /* 3. A disabled control has to look disabled. */
    const isDisabled = element.disabled === true || element.getAttribute('aria-disabled') === 'true'
    if (isDisabled) {
      const dimmed = Number.parseFloat(style.opacity) < 0.95
      const cursor = style.cursor === 'not-allowed' || style.cursor === 'default'
      if (!dimmed && !cursor) {
        findings.push({ kind: 'disabled', el: label(element), detail: `opacity ${style.opacity}、cursor ${style.cursor},与可用状态无法区分` })
      }
    }

    /* 4. An icon with no name is a mystery button. */
    if (!accessibleName(element) && !element.matches('input, select, textarea')) {
      findings.push({ kind: 'nameless', el: label(element), detail: '没有可读名称(无文本、无 aria-label)' })
    }

    /* 5. Pointer targets. 24px is the AA floor, not a comfortable size.
       A control wrapped in its own <label> is clicked through the label, so
       that is the target that counts — which is how every toggle and every
       styled file input in this product works. Links sitting inside a
       paragraph are exempt (WCAG 2.5.8 inline exception). */
    const wrapper = element.closest('label')
    const target = wrapper && wrapper !== element ? wrapper.getBoundingClientRect() : rect
    const inSentence = element.matches('a[href]') && Boolean(element.closest('p, li, small, figcaption'))
    if ((target.width < 24 || target.height < 24) && !inSentence) {
      findings.push({ kind: 'target', el: label(element), detail: `${Math.round(target.width)}×${Math.round(target.height)}px` })
    }

    /* 6. A tooltip is not a label. */
    if (element.title && !accessibleName(element) && !element.getAttribute('aria-label')) {
      findings.push({ kind: 'titleonly', el: label(element), detail: `只有 title="${element.title.slice(0, 30)}"` })
    }
  }

  return { findings, checked }
}

const theme = process.argv[2] === 'light' ? 'light' : 'dark'
const browser = await chromium.launch({ executablePath: CHROME, headless: true })
const context = await browser.newContext({ viewport: { width: 1600, height: 950 } })
await context.addInitScript((value) => window.localStorage.setItem('knitspace:theme', value), theme)
const page = await context.newPage()

const report = {}
let total = 0
let elements = 0

for (const route of ROUTES) {
  await page.goto(`${BASE}${route}`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(1000)
  const { findings, checked } = await page.evaluate(`(${collect})()`)
  elements += checked
  if (!findings.length) continue
  report[route] = findings
  total += findings.length
  console.log(`\n${route}  —  ${findings.length}`)
  const byKind = {}
  for (const finding of findings) (byKind[finding.kind] ??= []).push(finding)
  for (const [kind, group] of Object.entries(byKind)) {
    console.log(`   [${kind}] ${group.length}`)
    for (const finding of group.slice(0, 6)) console.log(`        ${finding.el}  ·  ${finding.detail}`)
    if (group.length > 6) console.log(`        …还有 ${group.length - 6} 处`)
  }
}

await browser.close()

const file = join(process.env.TEMP || '.', `audit-interaction-${theme}.json`)
writeFileSync(file, JSON.stringify(report, null, 2))
console.log(`\n${theme}: ${total} 处,分布在 ${Object.keys(report).length} 个路由(检查了 ${elements} 个元素)`)
console.log(`明细 → ${file}`)
if (!elements) { console.error('检查了 0 个元素——页面根本没渲染'); process.exitCode = 1 }
