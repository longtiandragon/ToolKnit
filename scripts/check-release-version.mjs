import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const defaultRoot = resolve(import.meta.dirname, '..')

export function readCargoPackageVersion(source) {
  const lines = source.split(/\r?\n/)
  const packageStart = lines.findIndex((line) => line.trim() === '[package]')
  const packageEnd = lines.findIndex((line, index) => index > packageStart && /^\s*\[/.test(line))
  const packageLines = packageStart === -1
    ? []
    : lines.slice(packageStart + 1, packageEnd === -1 ? lines.length : packageEnd)
  const packageBlock = packageLines.join('\n')
  const version = packageBlock.match(/^version\s*=\s*"([^"]+)"\s*$/m)?.[1]
  if (!version) throw new Error('src-tauri/Cargo.toml has no [package] version.')
  return version
}

export function normalizeReleaseTag(tag) {
  if (!tag) return undefined
  if (!/^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(tag)) {
    throw new Error(`Release tag must use v<semver>, received: ${tag}`)
  }
  return tag.slice(1)
}

export function readReleaseVersions(root = defaultRoot) {
  const packageJson = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'))
  const tauriConfig = JSON.parse(readFileSync(resolve(root, 'src-tauri/tauri.conf.json'), 'utf8'))
  const cargoToml = readFileSync(resolve(root, 'src-tauri/Cargo.toml'), 'utf8')
  const viteConfig = readFileSync(resolve(root, 'vite.config.ts'), 'utf8')

  if (!/JSON\.stringify\(packageVersion\)/.test(viteConfig)) {
    throw new Error('vite.config.ts must derive __APP_VERSION__ from package.json.')
  }

  return {
    packageJson: packageJson.version,
    cargo: readCargoPackageVersion(cargoToml),
    tauri: tauriConfig.version,
  }
}

export function assertReleaseVersion({ root = defaultRoot, tag } = {}) {
  const versions = readReleaseVersions(root)
  const expected = versions.packageJson
  const mismatches = Object.entries(versions).filter(([, version]) => version !== expected)
  const tagVersion = normalizeReleaseTag(tag)
  if (tagVersion && tagVersion !== expected) mismatches.push(['releaseTag', tagVersion])

  if (mismatches.length) {
    const details = Object.entries({ ...versions, ...(tagVersion ? { releaseTag: tagVersion } : {}) })
      .map(([source, version]) => `${source}: ${String(version)}`)
      .join('\n')
    throw new Error(`Release versions do not match:\n${details}`)
  }

  return expected
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href
if (isMain) {
  const version = assertReleaseVersion({ tag: process.env.RELEASE_TAG })
  console.log(`Release version guard passed: ${version}${process.env.RELEASE_TAG ? ` (${process.env.RELEASE_TAG})` : ''}.`)
}
