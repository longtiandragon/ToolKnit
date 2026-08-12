import { copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { assertSafeExportTarget, findSensitiveContent, isPublicReleaseCandidate, normalizePublicPath } from './public-core-policy.mjs'

const root = resolve(import.meta.dirname, '..')
const outputArgument = process.argv.find((argument) => argument.startsWith('--output='))?.slice('--output='.length)

if (!outputArgument) throw new Error('Usage: pnpm export:public -- --output=F:\\KnitspacePublic')
const output = assertSafeExportTarget(root, outputArgument)
if (existsSync(output)) throw new Error('Public export output already exists; choose a new target path.')

const workspaceFiles = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { cwd: root, encoding: 'utf8' })
  .split(/\r?\n/)
  .filter(isPublicReleaseCandidate)

if (!workspaceFiles.includes('package.json') || !workspaceFiles.some((path) => path.startsWith('src/'))) {
  throw new Error('Public snapshot is incomplete: package.json or src/ is missing.')
}

const unsafe = []
for (const path of workspaceFiles) {
  const source = resolve(root, path)
  const info = lstatSync(source)
  if (info.isSymbolicLink()) throw new Error(`Refusing to export symbolic link: ${path}`)
  if (info.size <= 2_000_000) {
    const kinds = findSensitiveContent(readFileSync(source, 'utf8'))
    if (kinds.length) unsafe.push(`${normalizePublicPath(path)} (${kinds.join(', ')})`)
  }
}
if (unsafe.length) throw new Error(`Public snapshot contains sensitive content:\n${unsafe.join('\n')}`)

mkdirSync(output, { recursive: false })
for (const path of workspaceFiles) {
  const destination = resolve(output, path)
  mkdirSync(dirname(destination), { recursive: true })
  copyFileSync(resolve(root, path), destination)
}

const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()
writeFileSync(resolve(output, 'PUBLIC_SNAPSHOT.json'), `${JSON.stringify({
  product: 'Knitspace Core',
  generatedAt: new Date().toISOString(),
  sourceCommit,
  fileCount: workspaceFiles.length,
  historyIncluded: false,
}, null, 2)}\n`)

console.log(`Exported ${workspaceFiles.length} files to ${output}. No .git history was copied.`)
