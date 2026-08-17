import { createHash } from 'node:crypto'
import { createReadStream, existsSync, statSync, writeFileSync } from 'node:fs'
import { basename, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export async function sha256File(path) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex')
}

export async function writeReleaseChecksums({ files, output }) {
  if (!files.length) throw new Error('No release artifacts were provided.')

  const entries = files.map((path) => ({ path: resolve(path), name: basename(path) }))
    .sort((left, right) => left.name.localeCompare(right.name, 'en'))
  const names = new Set()

  for (const entry of entries) {
    if (!existsSync(entry.path) || !statSync(entry.path).isFile()) throw new Error(`Release artifact is not a file: ${entry.path}`)
    if (/\r|\n/.test(entry.name)) throw new Error('Release artifact names cannot contain newlines.')
    if (names.has(entry.name)) throw new Error(`Duplicate release artifact filename: ${entry.name}`)
    names.add(entry.name)
  }

  const lines = []
  for (const entry of entries) lines.push(`${await sha256File(entry.path)}  ${entry.name}`)
  writeFileSync(resolve(output), `${lines.join('\n')}\n`, 'utf8')
  return lines
}

function parseArguments(arguments_) {
  const separator = arguments_.indexOf('--')
  const args = separator === -1 ? [...arguments_] : [...arguments_.slice(0, separator), ...arguments_.slice(separator + 1)]
  const outputIndex = args.indexOf('--output')
  if (outputIndex === -1 || !args[outputIndex + 1]) throw new Error('Usage: --output <SHA256SUMS.txt> <artifact...>')
  const output = args[outputIndex + 1]
  args.splice(outputIndex, 2)
  return { output, files: args }
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href
if (isMain) {
  const result = await writeReleaseChecksums(parseArguments(process.argv.slice(2)))
  console.log(`Wrote ${result.length} release checksum(s).`)
}
