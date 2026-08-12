/*
 * Raises every unreadable font size in the not-yet-rebuilt views to the
 * product's floor.
 *
 * `scripts/retype-css.mjs` did this for the six global stylesheets. It never
 * looked inside single-file components, and that is where most of the small
 * type actually lives: each view carries its own `<style scoped>` block, and
 * those blocks were written against Latin mockups where 8px and 9px labels
 * still resolve into words. A Chinese glyph at 9px is a smudge — three or four
 * strokes collapse into a grey blob at any normal viewing distance.
 *
 * The floor is 11px, which is what the rebuilt components use for their
 * quietest metadata. Anything already at 11 or above is left alone, so the
 * existing hierarchy inside each block survives: sizes that were distinct
 * stay distinct unless both were below the floor, in which case they were
 * equally illegible and the distinction was not doing any work.
 *
 * Content surfaces are skipped. Syntax highlighting, exported code-image
 * themes and rendered Markdown decide their own type, and those pixels end up
 * in files that leave the machine.
 *
 *   node scripts/enforce-min-type.mjs [--dry]
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { globSync } from 'node:fs'

const FLOOR = 11

/** Declarations inside these selectors render user content, not chrome. */
const CONTENT_SELECTOR =
  /(hljs|theme-|code-export|codesnap|card-preview|swatch|katex|markmap|mermaid|markdown-preview|reading-|review-content)/i

const dry = process.argv.includes('--dry')
const files = [
  ...globSync('src/views/*.vue'),
  ...globSync('src/components/*.vue'),
  ...globSync('src/styles.*.css'),
]

let touched = 0
let bumped = 0

for (const file of files) {
  const original = readFileSync(file, 'utf8')

  // Only the style blocks of an SFC; a `.css` file is one big block.
  const rewrite = (css) =>
    css.replace(/([^{}]*)\{([^{}]*)\}/g, (rule, selector, body) => {
      if (CONTENT_SELECTOR.test(selector)) return rule
      const next = body
        // `font-size: 9px`
        .replace(/(font-size:\s*)(\d+(?:\.\d+)?)px/g, (match, prefix, size) =>
          Number(size) < FLOOR ? ((bumped += 1), `${prefix}${FLOOR}px`) : match,
        )
        // The size inside a `font:` shorthand, with or without a line-height.
        .replace(
          /(font:\s*(?:[\w-]+\s+)*?)(\d+(?:\.\d+)?)px(\/[\d.]+)?/g,
          (match, prefix, size, lineHeight) =>
            Number(size) < FLOOR
              ? ((bumped += 1), `${prefix}${FLOOR}px${lineHeight ?? ''}`)
              : match,
        )
      return `${selector}{${next}}`
    })

  const updated = file.endsWith('.css')
    ? rewrite(original)
    : original.replace(/(<style[^>]*>)([\s\S]*?)(<\/style>)/g, (_, open, css, close) => `${open}${rewrite(css)}${close}`)

  if (updated === original) continue
  touched += 1
  if (!dry) writeFileSync(file, updated)
  console.log(`  ${file}`)
}

console.log(`\n${bumped} declaration${bumped === 1 ? '' : 's'} raised to ${FLOOR}px across ${touched} file${touched === 1 ? '' : 's'}${dry ? ' (dry run)' : ''}`)
