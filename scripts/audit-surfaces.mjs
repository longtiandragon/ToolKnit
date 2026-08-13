/*
 * Walks every route in both themes and reports the two failures that a
 * screenshot review keeps missing.
 *
 * 1. Invisible surfaces. A control or panel whose background is the same value
 *    as the thing behind it, with no border to give it an edge. This is what
 *    the colour-token migration produced wherever it guessed the wrong token:
 *    the button is still there, still clickable, and simply cannot be seen.
 *
 * 2. Unreadable text. Foreground against its real (composited) background,
 *    below the WCAG AA ratio for its size.
 *
 * It also checks that every custom property referenced by the stylesheets
 * actually resolves — a `--x: var(--x)` alias is a cycle, and CSS answers a
 * cycle by silently dropping the token everywhere it is used.
 *
 * Needs the dev server up. Uses the installed Chrome; no browser download.
 *
 *   node scripts/audit-surfaces.mjs [dark|light]
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

/* Runs in the page. Kept as one function so it can be handed to evaluate(). */
function collect() {
  const parse = (value) => {
    const match = value.match(/rgba?\(([^)]+)\)/)
    if (!match) return null
    const [r, g, b, a = 1] = match[1].split(/[\s,/]+/).filter(Boolean).map(Number)
    return { r, g, b, a }
  }
  /* Paint `top` over `base`; both are already flattened to opaque. */
  const over = (top, base) =>
    top.a >= 1
      ? top
      : {
          r: top.r * top.a + base.r * (1 - top.a),
          g: top.g * top.a + base.g * (1 - top.a),
          b: top.b * top.a + base.b * (1 - top.a),
          a: 1,
        }
  const luminance = ({ r, g, b }) => {
    const channel = (value) => {
      const v = value / 255
      return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
    }
    return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
  }
  const contrast = (a, b) => {
    const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m)
    return (x + 0.05) / (y + 0.05)
  }
  const distance = (a, b) => Math.abs(a.r - b.r) + Math.abs(a.g - b.g) + Math.abs(a.b - b.b)

  /* The colour actually behind an element: walk up compositing each layer.
     The nearest painting ancestor is recorded too — a contrast failure is
     only fixable if you know which box drew the ground. */
  let ground = null
  const backdrop = (element) => {
    const stack = []
    ground = null
    for (let node = element.parentElement; node; node = node.parentElement) {
      const value = parse(getComputedStyle(node).backgroundColor)
      if (!value || value.a === 0) continue
      if (!ground) ground = node
      stack.push(value)
      if (value.a >= 1) break
    }
    let base = { r: 255, g: 255, b: 255, a: 1 }
    const page = parse(getComputedStyle(document.body).backgroundColor)
    if (page && page.a >= 1) base = page
    for (let index = stack.length - 1; index >= 0; index -= 1) base = over(stack[index], base)
    return base
  }

  const label = (element) => {
    const id = element.id ? `#${element.id}` : ''
    const cls = typeof element.className === 'string' && element.className
      ? `.${element.className.trim().split(/\s+/).slice(0, 3).join('.')}`
      : ''
    return `${element.tagName.toLowerCase()}${id}${cls}`.slice(0, 70)
  }

  /* Pixels that are not the interface: an exported code image, a syntax
     theme, a colour swatch, rendered Markdown. Those choose their own
     colours on purpose — the code-image card is midnight-dark even in light
     mode, because that is what the user is exporting — so holding them to
     the UI's contrast rules would report the feature as a defect. */
  // `crop-selection` is the crop overlay: it sits on the user's own pixels, so
  // it is fixed white-on-scrim in both themes by design, not by omission.
  const CONTENT = /hljs|theme-|code-export|codesnap|card-preview|swatch|katex|markmap|mermaid|reading-|crop-selection|crop-layer/i
  const isContent = (element) => {
    for (let node = element; node; node = node.parentElement) {
      if (CONTENT.test(String(node.className || ''))) return true
    }
    return false
  }

  const findings = []
  const seen = new Set()

  for (const element of document.querySelectorAll('body *')) {
    if (isContent(element)) continue
    const rect = element.getBoundingClientRect()
    if (rect.width < 12 || rect.height < 8) continue
    const style = getComputedStyle(element)
    if (style.visibility === 'hidden' || style.display === 'none' || style.opacity === '0') continue

    const own = parse(style.backgroundColor)
    const behind = backdrop(element)
    const surface = own && own.a > 0 ? over(own, behind) : behind

    /* 1. A painted box that is the same value as its backdrop, with no edge. */
    const interactive =
      element.matches('button, a[href], label, input, select, textarea, [role="button"], [tabindex]') ||
      /button|card|panel|chip|pill|tab|tile|row/i.test(String(element.className))
    if (own && own.a > 0.05 && interactive) {
      /* A single visible edge is enough to separate a box from its ground —
         a toolbar with only a bottom rule is a deliberate, common shape — so
         all four sides count, not just the top. */
      const sides = ['Top', 'Right', 'Bottom', 'Left']
      const hasBorder = sides.some((side) => {
        const width = Number.parseFloat(style[`border${side}Width`]) || 0
        if (width <= 0) return false
        const border = parse(style[`border${side}Color`])
        return border && border.a > 0.15 && distance(over(border, surface), surface) > 14
      })
      const edge = hasBorder || (style.boxShadow !== 'none' && !style.boxShadow.includes('inset'))
      if (distance(surface, behind) <= 8 && !edge) {
        const key = `invisible:${label(element)}`
        if (!seen.has(key)) {
          seen.add(key)
          findings.push({
            kind: 'invisible',
            el: label(element),
            detail: `背景 ${style.backgroundColor} 与身后 rgb(${Math.round(behind.r)}, ${Math.round(behind.g)}, ${Math.round(behind.b)}) 几乎相同，且无边框/投影`,
            text: (element.textContent || '').trim().slice(0, 28),
          })
        }
      }
    }

    /* 2. Text that cannot be read on the surface it sits on. */
    const direct = [...element.childNodes].some(
      (node) => node.nodeType === 3 && node.textContent.trim().length > 0,
    )
    if (!direct) continue
    const fg = parse(style.color)
    if (!fg || fg.a === 0) continue
    const size = Number.parseFloat(style.fontSize)
    const weight = Number(style.fontWeight) || 400
    const large = size >= 18.66 || (size >= 14 && weight >= 700)
    const need = large ? 3 : 4.5
    const ratio = contrast(over(fg, surface), surface)
    if (ratio >= need) continue
    const key = `contrast:${label(element)}:${Math.round(ratio * 10)}`
    if (seen.has(key)) continue
    seen.add(key)
    findings.push({
      kind: 'contrast',
      el: label(element),
      on: ground ? label(ground) : 'body',
      detail: `${ratio.toFixed(2)}:1（需要 ${need}:1）· ${style.color} on rgb(${Math.round(surface.r)}, ${Math.round(surface.g)}, ${Math.round(surface.b)}) · ${size}px`,
      text: (element.textContent || '').trim().slice(0, 28),
    })
  }
  return findings
}

/* Every custom property the stylesheets declare, checked for a real value. */
function deadTokens() {
  const names = new Set()
  for (const sheet of document.styleSheets) {
    let rules
    try { rules = sheet.cssRules } catch { continue }
    const walk = (list) => {
      for (const rule of list) {
        if (rule.cssRules) { walk(rule.cssRules); continue }
        if (!rule.style) continue
        for (const name of rule.style) if (name.startsWith('--')) names.add(name)
      }
    }
    walk(rules)
  }
  const root = getComputedStyle(document.documentElement)
  return [...names].filter((name) => root.getPropertyValue(name).trim() === '').sort()
}

const theme = process.argv[2] === 'light' ? 'light' : 'dark'
const browser = await chromium.launch({ executablePath: CHROME, headless: true })
const context = await browser.newContext({ viewport: { width: 1600, height: 950 } })
await context.addInitScript((value) => window.localStorage.setItem('knitspace:theme', value), theme)
const page = await context.newPage()

const report = []
let total = 0

await page.goto(`${BASE}/`, { waitUntil: 'networkidle' })
await page.waitForTimeout(900)
const dead = await page.evaluate(deadTokens)
if (dead.length) console.log(`\n!! 解析不出值的 CSS 变量 (${dead.length}): ${dead.join(', ')}\n`)

for (const route of ROUTES) {
  await page.goto(`${BASE}${route}`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(700)
  const findings = await page.evaluate(collect)
  total += findings.length
  if (!findings.length) continue
  report.push({ route, findings })
  console.log(`${route}  —  ${findings.length}`)
  for (const item of findings.slice(0, 8)) {
    console.log(`   [${item.kind}] ${item.el}${item.on ? `  ⊂ ${item.on}` : ''}  「${item.text}」`)
    console.log(`        ${item.detail}`)
  }
  if (findings.length > 8) console.log(`   … 另外 ${findings.length - 8} 条`)
}

console.log(`\n${theme}: ${total} 处问题，分布在 ${report.length} 个路由`)
const out = join(process.env.TEMP || '.', `audit-${theme}.json`)
writeFileSync(out, JSON.stringify({ theme, dead, report }, null, 2))
console.log(`明细 → ${out}`)
await browser.close()
