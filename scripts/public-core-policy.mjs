import { isAbsolute, relative, resolve, sep } from 'node:path'

export const forbiddenPublicPath = /(?:^|\/)(?:\.env(?!\.(?:example|sample|template)$)(?:$|\.)|\.toolknit(?:$|\/)|toolknitvault(?:$|\/)|knitspacevault(?:$|\/)|personal-pack(?:$|\/)|private-pack(?:$|\/)|personal-data(?:$|\/)|private-data(?:$|\/)|models(?:$|\/)|engines(?:$|\/)|[^/]+\.(?:key|pem)$|[^/]+\.(?:knitspace-)?(?:private|personal)\.json$)/i

const publicDirectories = new Set(['.github', 'examples', 'public', 'scripts', 'src', 'src-tauri'])
const publicRootFiles = new Set([
  '.env.example', '.gitignore', 'LICENSE', 'NOTICE', 'PRIVACY.md', 'PUBLIC_CORE.md', 'README.md', 'SECURITY.md',
  'THIRD_PARTY_NOTICES.md', 'design-qa.md', 'index.html', 'package.json', 'pnpm-lock.yaml',
  'tsconfig.app.json', 'tsconfig.json', 'tsconfig.node.json', 'vite.config.ts',
])

const sensitiveContentRules = [
  {
    kind: 'absolute user-home path',
    pattern: /(?:[A-Za-z]:[\\/]+Users[\\/]+(?!<(?:user|username)>)[^\\/\s"'`]+[\\/]|\/(?:Users|home)\/(?!<(?:user|username)>)[^/\s"'`]+\/)/i,
  },
  { kind: 'private key block', pattern: /-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY-----/ },
  { kind: 'OpenAI-style API key', pattern: /\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{20,}\b/ },
  { kind: 'GitHub token', pattern: /\bgh[opusr]_[A-Za-z0-9]{20,}\b/ },
  { kind: 'Slack token', pattern: /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/ },
  { kind: 'AWS access key', pattern: /\bAKIA[A-Z0-9]{16}\b/ },
]

export function normalizePublicPath(path) {
  return path.split(sep).join('/').replace(/^\.\//, '')
}

export function isPublicReleaseCandidate(path) {
  const normalized = normalizePublicPath(path)
  if (!normalized || forbiddenPublicPath.test(normalized)) return false
  const slash = normalized.indexOf('/')
  if (slash === -1) return publicRootFiles.has(normalized)
  return publicDirectories.has(normalized.slice(0, slash))
}

export function findSensitiveContent(content) {
  if (content.includes('\0')) return []
  return sensitiveContentRules.filter(({ pattern }) => pattern.test(content)).map(({ kind }) => kind)
}

export function assertSafeExportTarget(workspaceRoot, outputPath) {
  if (!isAbsolute(outputPath)) throw new Error('Public export output must be an absolute path.')
  const root = resolve(workspaceRoot)
  const output = resolve(outputPath)
  const fromRoot = relative(root, output)
  if (!fromRoot || (!fromRoot.startsWith(`..${sep}`) && fromRoot !== '..')) {
    throw new Error('Public export output must be outside the workspace.')
  }
  return output
}
