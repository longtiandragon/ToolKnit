/*
 * Fixes the colour roles the token migration got backwards, in the legacy
 * stylesheets only.
 *
 * The migration replaced hard-coded colours with the nearest-looking token,
 * which works for text and fails for fills, because a fill's job is defined
 * by what sits *on* it. Two families came out wrong:
 *
 *   `--white` / `#fff` → `--fg`. As a page colour white meant "the top
 *   surface", not "the ink". In dark mode `background: var(--fg)` is a white
 *   slab; in light mode it is a black one. Most were masked by a later sheet
 *   redeclaring the same selector, which is why they survived review — the
 *   ones that were not masked are visible bugs, like the `/media` step badge
 *   that painted white glyphs onto a white chip.
 *
 *   `--green` / `--accent` as a background. The accent ramp is now split by
 *   role: `--accent` is ink, light enough to read on a dark plane, and
 *   `--accent-solid` is the fill that carries a white label. Legacy slabs
 *   want the fill half; the skip link measured 2.05:1 before this.
 *
 * Only values inside a `background` or `background-color` declaration are
 * touched. `color: var(--green)` is ink and is left alone — that is the whole
 * point of the split. Content surfaces are skipped: syntax highlighting and
 * the code-image export themes pick their own colours, and those pixels end
 * up in files that leave the machine.
 *
 * Inside single-file components the accent half of the rewrite additionally
 * requires the block to set a light foreground. A component's accent fills
 * are mostly 6px status dots and progress bars, which carry no label and are
 * meant to be the bright ink value; only a fill with a white label on it is
 * the bug being fixed here.
 *
 *   node scripts/repoint-fills.mjs [--dry]
 */
import { globSync, readFileSync, writeFileSync } from 'node:fs'

const dry = process.argv.includes('--dry')

const SHEETS = [
  'src/styles.css',
  'src/styles.refined.css',
  'src/styles.rebuild.css',
  'src/styles.workspace.css',
  'src/styles.knitspace.css',
]
const COMPONENTS = [...globSync('src/views/*.vue'), ...globSync('src/components/*.vue')]

/** A foreground that only reads on a dark fill. */
const LIGHT_FOREGROUND = /(^|;)\s*color\s*:[^;]*var\(--(fg|text|white|ink|accent-fg)\)/

/** Declarations under these selectors paint user content, not chrome. */
const CONTENT_SELECTOR =
  /(hljs|theme-|code-export|codesnap|card-preview|swatch|katex|markmap|mermaid|reading-)/i

const FILL_ROLE = {
  // Ink used as a ground. The ground under body text is the top surface.
  '--fg': '--surface',
  '--text': '--surface',
  '--ink': '--surface',
  '--white': '--surface',
  // Accent ink used as a ground.
  '--green': '--accent-solid',
  '--accent': '--accent-solid',
  '--green-strong': '--accent-solid-hover',
  '--accent-ink': '--accent-solid-press',
}

let total = 0

/* `labelled` restricts the accent rewrite to blocks that put light text on
   the fill; the ink rewrite always applies, since an ink-coloured ground is
   wrong whatever sits on it. */
function rewrite(css, labelled) {
  let count = 0
  /* Walk rule by rule so the selector is in hand when deciding to skip. */
  const updated = css.replace(/([^{}]*)(\{)([^{}]*)(\})/g, (rule, selector, open, body, close) => {
    if (CONTENT_SELECTOR.test(selector)) return rule
    const accentAllowed = !labelled || LIGHT_FOREGROUND.test(body)
    let next = body.replace(/(background(?:-color)?\s*:)([^;{}]*)/g, (match, property, value) => {
      const repointed = value.replace(/var\((--[\w-]+)([^)]*)\)/g, (whole, name, rest) => {
        const role = FILL_ROLE[name]
        if (!role) return whole
        if (role.startsWith('--accent') && !accentAllowed) return whole
        count += 1
        return `var(${role}${rest})`
      })
      return `${property}${repointed}`
    })

    /* The label on an accent fill is `--accent-fg`, not page ink. Page ink on
       `--accent-solid` measures 4.18:1; `--accent-fg` measures 5.08:1, and it
       stays right when the two themes swap which one is lighter. */
    if (/background(?:-color)?\s*:[^;{}]*var\(--accent-solid/.test(next)) {
      next = next.replace(
        /((?:^|;)\s*(?:-webkit-text-fill-)?color\s*:\s*)var\(--(?:fg|text|white|ink)\)/g,
        (whole, property) => {
          count += 1
          return `${property}var(--accent-fg)`
        },
      )
    }
    return `${selector}${open}${next}${close}`
  })
  return { updated, count }
}

for (const file of SHEETS) {
  const original = readFileSync(file, 'utf8')
  const { updated, count } = rewrite(original, false)
  if (!count) continue
  total += count
  if (!dry) writeFileSync(file, updated)
  console.log(`  ${file}  ${count}`)
}

for (const file of COMPONENTS) {
  const original = readFileSync(file, 'utf8')
  let count = 0
  const updated = original.replace(
    /(<style[^>]*>)([\s\S]*?)(<\/style>)/g,
    (whole, open, css, close) => {
      const result = rewrite(css, true)
      count += result.count
      return `${open}${result.updated}${close}`
    },
  )
  if (!count) continue
  total += count
  if (!dry) writeFileSync(file, updated)
  console.log(`  ${file}  ${count}`)
}

console.log(`\n${total} fill${total === 1 ? '' : 's'} repointed${dry ? ' (dry run)' : ''}`)
