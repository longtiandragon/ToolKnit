/*
 * Removes rules whose selector list is entirely made of dead class names.
 *
 * When a view is rewritten in utilities, the sheets keep styling class names
 * nothing renders any more — for `/visual` that was 347 rules. Deleting them
 * by hand across six minified stylesheets is not realistic, and deleting them
 * with a regex is worse: an earlier attempt matched `.foo[^{]*\{[^}]*\}`,
 * which happily ate the closing brace of the surrounding `@media` block and
 * left two sheets unparseable from that byte on, so every rule after it
 * silently stopped applying.
 *
 * This walks the brace structure instead, recurses into at-rules, and refuses
 * to write a file whose braces do not balance afterwards.
 *
 *   node scripts/prune-selectors.mjs '\.visual-' src/styles.knitspace.css …
 */
import { readFileSync, writeFileSync } from 'node:fs'

const [pattern, ...files] = process.argv.slice(2)
if (!pattern || !files.length) {
  console.error("usage: node scripts/prune-selectors.mjs '<selector regex>' <file…>")
  process.exit(1)
}
const dead = new RegExp(pattern)

/** True when every selector in the list is one this pattern owns. */
function selectorIsDead(selectorText) {
  const parts = selectorText.split(',').map((part) => part.trim()).filter(Boolean)
  return parts.length > 0 && parts.every((part) => dead.test(part))
}

function prune(css) {
  let out = ''
  let index = 0
  let removed = 0
  while (index < css.length) {
    const open = css.indexOf('{', index)
    if (open < 0) {
      out += css.slice(index)
      break
    }
    // Find the matching close for this block.
    let depth = 1
    let cursor = open + 1
    while (cursor < css.length && depth > 0) {
      if (css[cursor] === '{') depth += 1
      else if (css[cursor] === '}') depth -= 1
      cursor += 1
    }
    const prelude = css.slice(index, open)
    const body = css.slice(open + 1, cursor - 1)
    if (/@(media|supports|layer|container|scope)/.test(prelude)) {
      // Recurse: an at-rule's own braces must survive whatever happens inside.
      const inner = prune(body)
      removed += inner.removed
      out += inner.body.trim() ? `${prelude}{${inner.body}}` : ''
      if (!inner.body.trim()) removed += 0
    } else if (selectorIsDead(prelude)) {
      removed += 1
    } else {
      out += css.slice(index, cursor)
    }
    index = cursor
  }
  return { body: out, removed }
}

let total = 0
for (const file of files) {
  const before = readFileSync(file, 'utf8')
  const { body, removed } = prune(before)
  let depth = 0
  for (const character of body) {
    if (character === '{') depth += 1
    else if (character === '}') depth -= 1
  }
  if (depth !== 0) {
    console.error(`${file}: refusing to write — braces unbalanced by ${depth}`)
    process.exitCode = 1
    continue
  }
  if (removed) writeFileSync(file, body)
  total += removed
  console.log(`${file}: removed ${removed} rules`)
}
console.log(`${total} rules removed in total`)
