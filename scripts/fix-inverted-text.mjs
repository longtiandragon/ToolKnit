/*
 * Repairs text that the colour codemod inverted.
 *
 * The legacy design placed dark evergreen slabs inside a light page — heroes,
 * the title bar, primary buttons — and wrote light text on them. Classified by
 * lightness alone, that text looked like a surface, so it became
 * `color: var(--surface)`. Against a dark theme the surface token *is* dark,
 * and the text disappeared into its own background.
 *
 * The rule's own background says which repair is right:
 *   - filled with the accent  → `--accent-fg`, the colour meant to sit on it
 *   - anything else           → `--fg`, ordinary body text
 *
 *   node scripts/fix-inverted-text.mjs [--dry]
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const STYLESHEETS = [
  'src/styles.css',
  'src/styles.refined.css',
  'src/styles.rebuild.css',
  'src/styles.workspace.css',
  'src/styles.knitspace.css',
  'src/styles.polish.css',
]

const INVERTED = /((?:-webkit-text-fill-)?color\s*:\s*)var\(--surface(?:-[23])?\)/g
/** Backgrounds that keep light text correct. */
const FILLED = /background(?:-color|-image)?\s*:[^;}]*var\(--(accent|danger|success|warn)\b/

const dry = process.argv.includes('--dry')
let fixed = 0
let onAccent = 0

function repair(css) {
  return css.replace(/([^{}]*)\{([^{}]*)\}/g, (whole, selector, body) => {
    if (!INVERTED.test(body)) return whole
    INVERTED.lastIndex = 0
    const replacement = FILLED.test(body) ? 'var(--accent-fg)' : 'var(--fg)'
    const next = body.replace(INVERTED, (_, head) => {
      fixed += 1
      if (replacement === 'var(--accent-fg)') onAccent += 1
      return head + replacement
    })
    return `${selector}{${next}}`
  })
}

function vueFiles() {
  const found = []
  ;(function walk(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (full.endsWith('.vue')) found.push(full)
    }
  })('src')
  return found
}

for (const file of STYLESHEETS) {
  const original = readFileSync(file, 'utf8')
  const out = repair(original)
  if (!dry && out !== original) writeFileSync(file, out)
}

for (const file of vueFiles()) {
  const original = readFileSync(file, 'utf8')
  if (!original.includes('<style')) continue
  const out = original.replace(
    /(<style[^>]*>)([\s\S]*?)(<\/style>)/g,
    (_, open, css, close) => `${open}${repair(css)}${close}`,
  )
  if (!dry && out !== original) writeFileSync(file, out)
}

console.log(
  `${dry ? 'dry run' : 'rewritten'}: ${fixed} inverted colours repaired ` +
    `(${onAccent} on filled backgrounds → --accent-fg, ${fixed - onAccent} → --fg)`,
)
