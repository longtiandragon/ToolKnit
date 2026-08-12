/*
 * Rewrites the hard-coded colours in the legacy stylesheets as design tokens.
 *
 * Those layers were authored against a single light theme: 2051 literal
 * colours, 505 distinct. Nothing in them can follow a theme switch, so the
 * dark theme would stop at the edge of any view that has not been rebuilt
 * yet. Rather than leave the app half-dark during the migration, each literal
 * is classified by lightness, saturation and hue, then replaced with the token
 * that plays the same role in the new system.
 *
 * This is a heuristic over generated-looking CSS that is scheduled for
 * deletion, not a hand-audited mapping. Selectors that carry *content* colour
 * — syntax highlighting, exported code-image themes, canvas swatches — are
 * skipped, because those pixels end up in files the user shares and must not
 * move with the UI theme.
 *
 *   node scripts/tokenize-legacy-colors.mjs [--dry]
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const FILES = [
  'src/styles.css',
  'src/styles.refined.css',
  'src/styles.rebuild.css',
  'src/styles.workspace.css',
  'src/styles.knitspace.css',
  'src/styles.import-dialog.css',
  'src/styles.polish.css',
]

/** Selectors whose colours are content, not chrome. */
const CONTENT_SELECTOR =
  /(hljs|theme-paper|theme-forest|theme-|code-export|codesnap|code-snap|card-preview|preview-images|swatch|palette|katex|markmap|mermaid)/i

/** Declarations where a colour swap would break meaning rather than restyle. */
const CONTENT_PROPERTY = /(^|;)\s*(-webkit-text-fill-color)\s*:/

function toRgb(literal) {
  const hex = literal.match(/^#([0-9a-f]{3,8})$/i)
  if (hex) {
    let h = hex[1]
    if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join('')
    const a = h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1
    return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16), a }
  }
  const fn = literal.match(/^rgba?\(([^)]+)\)$/i)
  if (!fn) return undefined
  const parts = fn[1].split(/[\s,/]+/).filter(Boolean)
  if (parts.length < 3) return undefined
  const [r, g, b] = parts.slice(0, 3).map((v) => (v.endsWith('%') ? (parseFloat(v) / 100) * 255 : parseFloat(v)))
  const rawAlpha = parts[3]
  const a = rawAlpha === undefined ? 1 : rawAlpha.endsWith('%') ? parseFloat(rawAlpha) / 100 : parseFloat(rawAlpha)
  if ([r, g, b, a].some((v) => Number.isNaN(v))) return undefined
  return { r, g, b, a }
}

function toHsl({ r, g, b }) {
  const [rn, gn, bn] = [r / 255, g / 255, b / 255]
  const max = Math.max(rn, gn, bn)
  const min = Math.min(rn, gn, bn)
  const l = (max + min) / 2
  const d = max - min
  if (!d) return { h: 0, s: 0, l }
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h
  if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6
  else if (max === gn) h = ((bn - rn) / d + 2) / 6
  else h = ((rn - gn) / d + 4) / 6
  return { h: h * 360, s, l }
}

/** Which semantic role does this colour play in the old light theme? */
function tokenFor(literal) {
  const rgb = toRgb(literal)
  if (!rgb) return undefined
  const { a } = rgb
  const { h, s, l } = toHsl(rgb)

  // Fully transparent stays transparent; near-transparent tints are hairlines.
  if (a === 0) return undefined

  const warm = h >= 20 && h < 55
  const red = h < 20 || h >= 335
  const green = h >= 90 && h < 175
  const blue = h >= 175 && h < 265

  // Saturated colour: the role is carried by the hue.
  if (s > 0.22 && l > 0.12 && l < 0.86) {
    if (red) return a < 0.35 ? 'var(--danger-soft)' : 'var(--danger)'
    if (warm) return a < 0.35 ? 'var(--warn-soft)' : 'var(--warn)'
    // The old accent was green; the new one is blue. Both map to --accent so
    // the product ends up with one action colour instead of two.
    if (green || blue) return a < 0.35 ? 'var(--accent-soft)' : 'var(--accent)'
  }

  // Translucent neutrals were used almost exclusively for dividers.
  if (a < 0.85) {
    if (l > 0.7) return 'var(--surface-2)'
    return a < 0.18 ? 'var(--line)' : 'var(--line-strong)'
  }

  // Opaque neutrals, ordered from the page ground up to the darkest ink.
  if (l >= 0.97) return 'var(--surface)'
  if (l >= 0.9) return 'var(--surface-2)'
  if (l >= 0.82) return 'var(--surface-3)'
  if (l >= 0.62) return 'var(--line-strong)'
  if (l >= 0.45) return 'var(--fg-3)'
  if (l >= 0.28) return 'var(--fg-2)'
  return 'var(--fg)'
}

const COLOR = /#[0-9a-fA-F]{3,8}\b|\brgba?\([^)]*\)/g

const dry = process.argv.includes('--dry')
let totalSwapped = 0
let totalSkipped = 0

/** Roughly a third of the legacy CSS lives in SFC `<style>` blocks. */
function vueStyleFiles() {
  const found = []
  ;(function walk(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (full.endsWith('.vue') && readFileSync(full, 'utf8').includes('<style')) found.push(full)
    }
  })('src')
  return found
}

function tokeniseCss(css, counters) {
  return css.replace(/([^{}]*)\{([^{}]*)\}/g, (whole, selector, body) => {
    if (!selector.trim() || selector.includes('@')) return whole
    // `:root` blocks are where the tokens themselves live.
    if (/(^|[\s,]):root\b/.test(selector)) return whole
    if (CONTENT_SELECTOR.test(selector)) {
      counters.skipped += (body.match(COLOR) || []).length
      return whole
    }

    const next = body.replace(COLOR, (literal, offset) => {
      const decl = body.slice(Math.max(0, offset - 60), offset)
      if (CONTENT_PROPERTY.test(decl)) {
        counters.skipped += 1
        return literal
      }
      const token = tokenFor(literal)
      if (!token) {
        counters.skipped += 1
        return literal
      }
      counters.swapped += 1
      return token
    })

    return next === body ? whole : `${selector}{${next}}`
  })
}

function processFile(file, extract) {
  const original = readFileSync(file, 'utf8')
  const counters = { swapped: 0, skipped: 0 }
  const out = extract(original, counters)

  totalSwapped += counters.swapped
  totalSkipped += counters.skipped
  if (counters.swapped) {
    console.log(`${file.padEnd(38)} → token ${String(counters.swapped).padStart(5)}   kept ${String(counters.skipped).padStart(4)}`)
  }
  if (!dry && out !== original) writeFileSync(file, out)
}

for (const file of FILES) {
  processFile(file, (source, counters) => tokeniseCss(source, counters))
}

for (const file of vueStyleFiles()) {
  processFile(file, (source, counters) =>
    // Only the contents of `<style>` blocks; template and script are untouched.
    source.replace(/(<style[^>]*>)([\s\S]*?)(<\/style>)/g, (_, open, css, close) =>
      `${open}${tokeniseCss(css, counters)}${close}`,
    ),
  )
}

console.log(`\n${dry ? 'dry run' : 'rewritten'}: ${totalSwapped} literals tokenised, ${totalSkipped} left as content colour`)
