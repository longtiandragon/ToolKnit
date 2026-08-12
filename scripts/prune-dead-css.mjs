/*
 * Removes rules from the legacy stylesheets whose selectors no longer match
 * anything in the templates.
 *
 * Those six layers accumulated across four redesigns and are now roughly half
 * dead: the flattened heroes alone left behind decorative rings, floating stat
 * cards and gradient grounds that nothing renders. Deleting by eye is not
 * practical at this size, so this builds an inventory of every class the
 * templates can produce and drops rules that reference none of them.
 *
 * It is deliberately timid. A rule survives unless *every* class token in its
 * selector is provably unused, and anything that is not plainly class-based —
 * element selectors, `:root`, at-rules, attribute selectors — is left alone.
 * Classes assembled at runtime are covered by also harvesting string literals
 * and template-literal fragments from script code.
 *
 *   node scripts/prune-dead-css.mjs [--apply]
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const SHEETS = [
  'src/styles.css',
  'src/styles.refined.css',
  'src/styles.rebuild.css',
  'src/styles.workspace.css',
  'src/styles.knitspace.css',
  'src/styles.import-dialog.css',
  'src/styles.polish.css',
]

/** Selectors that must never be pruned regardless of class analysis. */
const ALWAYS_KEEP =
  /(^|[\s,>+~])(html|body|:root|\*|::selection|::-webkit|::placeholder|:focus-visible)|@|\[data-|\[aria-|\[role/

function sourceFiles() {
  const found = []
  ;(function walk(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (/\.(vue|ts|mjs)$/.test(full)) found.push(full)
    }
  })('src')
  return found
}

/**
 * Every token that could end up in a `class` attribute. Harvested broadly:
 * static attributes, `:class` expressions, and any string or template-literal
 * chunk in script code, since class names are also assembled there.
 */
function usedClassTokens() {
  const used = new Set()
  const add = (text) => {
    for (const token of String(text).split(/[^A-Za-z0-9_-]+/)) {
      if (token) used.add(token)
    }
  }

  for (const file of sourceFiles()) {
    const source = readFileSync(file, 'utf8')
    // Static and bound class attributes.
    for (const match of source.matchAll(/\bclass\s*=\s*"([^"]*)"/g)) add(match[1])
    for (const match of source.matchAll(/:class\s*=\s*"([^"]*)"/g)) add(match[1])
    // Quoted strings and template chunks anywhere — cheap and deliberately
    // over-inclusive, because a false "used" only costs dead bytes while a
    // false "unused" breaks the page.
    for (const match of source.matchAll(/'([^'\n]{1,120})'|"([^"\n]{1,120})"|`([^`]{0,400})`/g)) {
      add(match[1] ?? match[2] ?? match[3] ?? '')
    }
  }

  // UnoCSS shortcut names are class names too.
  add(readFileSync('uno.config.ts', 'utf8'))
  return used
}

const used = usedClassTokens()

/** Class tokens a selector depends on; empty means "not class-based". */
function selectorClasses(selector) {
  return [...selector.matchAll(/\.(-?[A-Za-z_][A-Za-z0-9_-]*)/g)].map((m) => m[1])
}

function isDead(selector) {
  if (ALWAYS_KEEP.test(selector)) return false
  // A comma group dies only if every branch dies.
  return selector.split(',').every((branch) => {
    const classes = selectorClasses(branch)
    if (!classes.length) return false
    return classes.every((name) => !used.has(name))
  })
}

const apply = process.argv.includes('--apply')
let removedRules = 0
let removedBytes = 0
const samples = []

for (const file of SHEETS) {
  const original = readFileSync(file, 'utf8')
  let fileRules = 0

  const out = original.replace(/([^{}]*)\{([^{}]*)\}/g, (whole, selector) => {
    const trimmed = selector.trim()
    if (!trimmed || trimmed.startsWith('/*')) return whole
    // Leave the inside of at-rules alone; the wrapper braces make the naive
    // block split unreliable there.
    if (trimmed.includes('@')) return whole
    if (!isDead(trimmed)) return whole
    fileRules += 1
    removedBytes += whole.length
    if (samples.length < 12) samples.push(trimmed.replace(/\s+/g, ' ').slice(0, 90))
    // Keep any leading whitespace/newline so the file stays readable.
    return whole.match(/^\s*/)[0]
  })

  removedRules += fileRules
  console.log(`${file.padEnd(30)} dead rules ${String(fileRules).padStart(5)}`)
  if (apply && out !== original) writeFileSync(file, out)
}

console.log(`\n${apply ? 'removed' : 'would remove'}: ${removedRules} rules, ${(removedBytes / 1024).toFixed(1)} KB`)
console.log(`class tokens considered live: ${used.size}`)
console.log('\nsample of pruned selectors:')
for (const sample of samples) console.log('  ', sample)
