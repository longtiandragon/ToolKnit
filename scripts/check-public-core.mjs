import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { relative, resolve } from 'node:path'
import { findSensitiveContent, forbiddenPublicPath, isPublicReleaseCandidate, normalizePublicPath } from './public-core-policy.mjs'

const root = resolve(import.meta.dirname, '..')

function walk(directory, entries = []) {
  for (const name of readdirSync(directory)) {
    const path = resolve(directory, name)
    const info = statSync(path)
    if (info.isDirectory()) walk(path, entries)
    else entries.push(path)
  }
  return entries
}

function assertPublicPaths(paths, label) {
  const unsafe = paths.filter((path) => forbiddenPublicPath.test(normalizePublicPath(path)))
  if (unsafe.length) throw new Error(`${label} contains private material:\n${unsafe.join('\n')}`)
}

function assertPublicContent(paths, label) {
  const unsafe = []
  for (const path of paths) {
    const absolute = resolve(root, path)
    if (!existsSync(absolute) || statSync(absolute).size > 2_000_000) continue
    const kinds = findSensitiveContent(readFileSync(absolute, 'utf8'))
    if (kinds.length) unsafe.push(`${normalizePublicPath(path)} (${kinds.join(', ')})`)
  }
  if (unsafe.length) throw new Error(`${label} contains sensitive content:\n${unsafe.join('\n')}`)
}

const workspaceFiles = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { cwd: root, encoding: 'utf8' })
  .split(/\r?\n/)
  .filter(Boolean)
const releaseCandidates = workspaceFiles.filter(isPublicReleaseCandidate)
assertPublicPaths(workspaceFiles, 'Workspace')
assertPublicContent(releaseCandidates, 'Public release candidates')

const tauriConfig = JSON.parse(readFileSync(resolve(root, 'src-tauri/tauri.conf.json'), 'utf8'))
const resources = tauriConfig.bundle?.resources ?? []
const resourcePaths = Array.isArray(resources) ? resources : Object.keys(resources)
assertPublicPaths(resourcePaths, 'Tauri bundle resources')

const dist = resolve(root, 'dist')
if (existsSync(dist)) {
  const builtFiles = walk(dist).map((path) => normalizePublicPath(relative(root, path)))
  assertPublicPaths(builtFiles, 'Built frontend')
  assertPublicContent(builtFiles, 'Built frontend')
  const profilePath = resolve(dist, 'build-profile.json')
  if (!existsSync(profilePath)) throw new Error('Built frontend has no build-profile.json; run pnpm build:public before check:public.')
  const profile = JSON.parse(readFileSync(profilePath, 'utf8'))
  if (profile.profile !== 'public' || profile.personalPack !== false) {
    throw new Error('check:public requires a Public Core artifact. Run pnpm build:public first.')
  }
  const forbiddenModules = builtFiles.filter((path) => /PrivateToolsView|private-tools-native/i.test(path))
  if (forbiddenModules.length) throw new Error(`Public Core bundled Personal Pack modules:\n${forbiddenModules.join('\n')}`)
  const builtText = builtFiles
    .filter((path) => /\.(?:html|js|css|json)$/.test(path))
    .map((path) => readFileSync(resolve(root, path), 'utf8'))
    .join('\n')
  for (const marker of ['load_private_tools', 'run_private_tool', 'cancel_private_tool_run']) {
    if (builtText.includes(marker)) throw new Error(`Public Core contains Personal Pack command: ${marker}`)
  }
}

console.log(`Public Core guard passed: ${releaseCandidates.length} release files contain no personal path or high-confidence secret.`)
