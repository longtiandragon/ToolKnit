/*
 * One-shot codemod that makes the stylesheet cascade readable in Chinese.
 *
 * Two systemic defects are fixed at the source instead of being papered over
 * with another override layer:
 *
 *   1. Font sizes below 12px. A Latin caption survives at 9px; a Chinese
 *      glyph at 9px is a smudge. Small sizes are remapped onto a three-step
 *      scale (11 / 12 / 13) that keeps the existing hierarchy intact.
 *   2. Monospace applied to prose. `--font-mono` has no CJK face, so every
 *      Chinese label styled as mono fell through to an arbitrary system
 *      fallback. Mono is kept only where it earns its place: code, keycaps,
 *      file paths, and tabular numbers.
 *
 * Run with `node scripts/retype-css.mjs` (add `--dry` to preview).
 */
import { readFileSync, writeFileSync } from 'node:fs'

const FILES = [
  'src/styles.css',
  'src/styles.refined.css',
  'src/styles.rebuild.css',
  'src/styles.workspace.css',
  'src/styles.knitspace.css',
  'src/styles.import-dialog.css',
]

/** Selectors whose monospace is intentional: code, keycaps, paths, numerals, glyphs. */
const MONO_IS_INTENTIONAL =
  /(^|[^a-z-])(code|pre|kbd|mono|hash|digit|numeric|number|count|timecode|token|path|shortcut|json|base64|hex|chevron|is-boolean|external-markdown-bar|ai-output-more)([^a-z-]|$)/i

/** Remap an unreadable size onto the nearest readable step, preserving order. */
function readableSize(px) {
  if (px >= 12) return px
  if (px < 9) return 11
  if (px < 11) return 12
  return 13
}

const dry = process.argv.includes('--dry')
const summary = []

for (const file of FILES) {
  const original = readFileSync(file, 'utf8')
  let resized = 0
  let unmonoed = 0

  // Walk rule blocks so the selector is known when deciding about mono.
  const out = original.replace(/([^{}]*)\{([^{}]*)\}/g, (whole, selector, body) => {
    if (!selector.trim() || selector.includes('@')) return whole
    let next = body

    // `font-size: 9px` and the size slot of the `font:` shorthand (`700 9px/1.4 …`).
    next = next.replace(
      /(font(?:-size)?\s*:[^;}]*?)(\d*\.?\d+)px/g,
      (decl, head, raw) => {
        const size = readableSize(parseFloat(raw))
        if (size === parseFloat(raw)) return decl
        resized += 1
        return `${head}${size}px`
      },
    )

    if (!MONO_IS_INTENTIONAL.test(selector)) {
      // The oldest layer names the face literally rather than through a token.
      next = next.replace(/var\(--font-mono\)|'DM Mono'(?:\s*,\s*monospace)?/g, () => {
        unmonoed += 1
        return 'var(--font-ui)'
      })
    }

    return next === body ? whole : `${selector}{${next}}`
  })

  summary.push({ file, resized, unmonoed })
  if (!dry && out !== original) writeFileSync(file, out)
}

const pad = (value, width) => String(value).padStart(width)
console.log(dry ? 'dry run — nothing written\n' : 'rewritten\n')
for (const row of summary) {
  console.log(`${row.file.padEnd(30)} sizes ${pad(row.resized, 4)}   mono→ui ${pad(row.unmonoed, 4)}`)
}
