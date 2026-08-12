/*
 * Replaces a block of a Vue SFC template with the contents of a snippet file.
 *
 * Editing these templates by hand is awkward: the blocks being replaced are
 * long single lines with nested quotes, and shell escaping mangles them. This
 * takes the file, a start marker, an end marker, and a snippet path.
 *
 *   node scripts/splice-block.mjs <file> <startMarker> <endMarker> <snippet>
 *
 * The end marker is matched on the first line at or after the start whose
 * trimmed text equals it.
 */
import { readFileSync, writeFileSync } from 'node:fs'

const [file, startMarker, endMarker, snippetPath] = process.argv.slice(2)
if (!file || !startMarker || !endMarker || !snippetPath) {
  console.error('usage: splice-block.mjs <file> <startMarker> <endMarker> <snippet>')
  process.exit(1)
}

const lines = readFileSync(file, 'utf8').split('\n')
const start = lines.findIndex((line) => line.includes(startMarker))
if (start < 0) {
  console.error(`start marker not found: ${startMarker}`)
  process.exit(1)
}
const end = lines.findIndex((line, index) => index >= start && line.trim() === endMarker)
if (end < 0) {
  console.error(`end marker not found after line ${start + 1}: ${endMarker}`)
  process.exit(1)
}

const snippet = readFileSync(snippetPath, 'utf8').replace(/\n$/, '').split('\n')
writeFileSync(file, [...lines.slice(0, start), ...snippet, ...lines.slice(end + 1)].join('\n'))
console.log(`${file}: replaced lines ${start + 1}–${end + 1} with ${snippet.length} lines`)
