import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const probes = [
  ['Windows user-home path', 'C:' + '\\' + 'Users' + '\\'],
  ['Windows user-home path', 'C:/Users/'],
  ['macOS user-home path', '/Users/'],
  ['private key block', ['-----BEGIN', 'PRIVATE', 'KEY-----'].join(' ')],
]
const findings = []

for (const [kind, needle] of probes) {
  const commits = execFileSync('git', ['log', '--all', '--format=%h', `-S${needle}`], { cwd: root, encoding: 'utf8' })
    .split(/\r?\n/)
    .filter(Boolean)
  for (const commit of commits) findings.push(`${commit} (${kind})`)
}

const uniqueFindings = [...new Set(findings)]
if (uniqueFindings.length) {
  throw new Error(`Existing Git history is not safe to publish (${uniqueFindings.length} finding(s)). Use export:public and initialize a new repository.\n${uniqueFindings.join('\n')}`)
}

console.log('Git history guard passed: no personal home path or private-key marker was found.')
