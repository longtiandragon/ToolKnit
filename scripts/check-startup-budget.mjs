import { gzipSync } from 'node:zlib'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

export const STARTUP_BUDGETS = {
  script: { raw: 230 * 1024, gzip: 75 * 1024 },
  style: { raw: 460 * 1024, gzip: 90 * 1024 },
  totalGzip: 165 * 1024,
}

function attributes(tag) {
  return new Map([...tag.matchAll(/([\w:-]+)\s*=\s*["']([^"']*)["']/g)].map(match => [match[1].toLowerCase(), match[2]]))
}

export function collectStartupAssetPaths(html) {
  const scripts = [...html.matchAll(/<script\b[^>]*>/gi)]
    .map(match => attributes(match[0]).get('src'))
    .filter(Boolean)
  const styles = [...html.matchAll(/<link\b[^>]*>/gi)]
    .map(match => attributes(match[0]))
    .filter(attrs => attrs.get('rel')?.toLowerCase().split(/\s+/).includes('stylesheet'))
    .map(attrs => attrs.get('href'))
    .filter(Boolean)
  return { scripts, styles }
}

export function evaluateStartupBudget(measurements, budgets = STARTUP_BUDGETS) {
  const violations = []
  for (const item of measurements) {
    const budget = budgets[item.kind]
    if (item.raw > budget.raw) violations.push(`${item.path} raw ${item.raw} > ${budget.raw}`)
    if (item.gzip > budget.gzip) violations.push(`${item.path} gzip ${item.gzip} > ${budget.gzip}`)
  }
  const totalGzip = measurements.reduce((sum, item) => sum + item.gzip, 0)
  if (totalGzip > budgets.totalGzip) violations.push(`startup gzip ${totalGzip} > ${budgets.totalGzip}`)
  return { totalGzip, violations }
}

function localAssetPath(distDirectory, assetUrl) {
  const relative = assetUrl.replace(/^\/+/, '').split(/[?#]/, 1)[0]
  const resolved = path.resolve(distDirectory, relative)
  const root = `${path.resolve(distDirectory)}${path.sep}`
  if (!resolved.startsWith(root)) throw new Error(`Startup asset escapes dist: ${assetUrl}`)
  return resolved
}

function kilobytes(bytes) { return `${(bytes / 1024).toFixed(2)} kB` }

export async function inspectStartupBudget(distDirectory = path.resolve('dist')) {
  const html = await readFile(path.join(distDirectory, 'index.html'), 'utf8')
  const assets = collectStartupAssetPaths(html)
  if (!assets.scripts.length || !assets.styles.length) throw new Error('Production index.html must reference startup JS and CSS assets.')
  const measurements = []
  for (const [kind, urls] of [['script', assets.scripts], ['style', assets.styles]]) {
    for (const assetUrl of urls) {
      const content = await readFile(localAssetPath(distDirectory, assetUrl))
      measurements.push({ kind, path: assetUrl, raw: content.byteLength, gzip: gzipSync(content).byteLength })
    }
  }
  return { measurements, ...evaluateStartupBudget(measurements) }
}

async function main() {
  const result = await inspectStartupBudget()
  for (const item of result.measurements) console.log(`${item.kind.padEnd(6)} ${item.path}: ${kilobytes(item.raw)} raw, ${kilobytes(item.gzip)} gzip`)
  console.log(`Startup total: ${kilobytes(result.totalGzip)} gzip`)
  if (result.violations.length) {
    console.error('Startup budget failed:')
    for (const violation of result.violations) console.error(`- ${violation}`)
    process.exitCode = 1
  } else console.log('Startup budget passed.')
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) await main()
