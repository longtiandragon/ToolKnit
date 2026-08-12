/**
 * Private scripts are free to shape their JSON payload, but the desktop shell
 * only turns explicit, absolute local output paths into file-manager actions.
 * That prevents a descriptive string or an HTTP URL from becoming an unsafe
 * “open location” affordance while accepting common `outputs: [path]` forms.
 */
function isAbsoluteLocalPath(value: string) {
  return /^[a-zA-Z]:[\\/]/.test(value) || value.startsWith('\\\\') || value.startsWith('/')
}

function isOutputKey(key: string) {
  return /(?:path|paths|file|files|directory|directories|output|outputs|result|results|destination|destinations|target|targets)$/i.test(key)
}

function collect(value: unknown, key: string, paths: string[]) {
  if (typeof value === 'string') {
    if (isOutputKey(key) && isAbsoluteLocalPath(value)) paths.push(value)
    return
  }
  if (Array.isArray(value)) {
    for (const entry of value) collect(entry, key, paths)
    return
  }
  if (!value || typeof value !== 'object') return
  for (const [childKey, child] of Object.entries(value as Record<string, unknown>)) collect(child, childKey, paths)
}

export function collectPrivateToolOutputPaths(payload: unknown) {
  const paths: string[] = []
  collect(payload, '', paths)
  return [...new Set(paths)]
}
