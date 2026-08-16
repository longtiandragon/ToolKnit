export type FileDropCandidate = { name: string; type: string; size: number }

export function acceptsDroppedFile(file: Pick<FileDropCandidate, 'name' | 'type'>, accept = '*/*') {
  if (accept === '*/*') return true
  return accept.split(',').some((raw) => {
    const token = raw.trim()
    if (!token) return false
    if (token.startsWith('.')) return file.name.toLocaleLowerCase('en-US').endsWith(token.toLocaleLowerCase('en-US'))
    if (token.endsWith('/*')) return file.type.startsWith(token.slice(0, -1))
    return file.type === token
  })
}

export function exceedsDroppedFileLimit(file: Pick<FileDropCandidate, 'size'>, maxFileBytes?: number) {
  return Boolean(maxFileBytes && maxFileBytes > 0 && file.size > maxFileBytes)
}

export function filesWithinDropBudget<T extends Pick<FileDropCandidate, 'size'>>(
  files: T[],
  maxTotalBytes?: number,
) {
  if (!maxTotalBytes || maxTotalBytes <= 0) return { files, rejected: 0, totalBytes: files.reduce((sum, file) => sum + file.size, 0) }
  const accepted: T[] = []
  let totalBytes = 0
  let rejected = 0
  for (const file of files) {
    if (totalBytes + file.size > maxTotalBytes) {
      rejected += 1
      continue
    }
    accepted.push(file)
    totalBytes += file.size
  }
  return { files: accepted, rejected, totalBytes }
}

export function formatDropFileSize(size: number) {
  if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} KB`
  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}

export interface FileSelectionMergeLimits {
  maxFiles?: number
  maxTotalBytes?: number
}

function fileSelectionKey(file: FileDropCandidate & { lastModified?: number }) {
  return `${file.name}|${file.size}|${file.lastModified ?? 0}`
}

/** Appends a new pick or drop onto files already staged, skipping exact
 * duplicates (same name, size and modification time) and respecting the
 * aggregate limits across old and new files together. This is what makes the
 * drop zone's “添加” and “松手即可追加” true. */
export function mergeFileSelection<T extends FileDropCandidate & { lastModified?: number }>(existing: T[], candidates: T[], limits: FileSelectionMergeLimits = {}) {
  const maxFiles = Math.max(existing.length, Math.max(1, Math.trunc(limits.maxFiles ?? existing.length + candidates.length)))
  const seen = new Set(existing.map(fileSelectionKey))
  const merged = [...existing]
  let totalBytes = existing.reduce((sum, file) => sum + file.size, 0)
  let rejectedOverBudget = 0
  let rejectedOverCount = 0
  let duplicates = 0
  for (const file of candidates) {
    const key = fileSelectionKey(file)
    if (seen.has(key)) { duplicates += 1; continue }
    if (limits.maxTotalBytes && limits.maxTotalBytes > 0 && totalBytes + file.size > limits.maxTotalBytes) { rejectedOverBudget += 1; continue }
    if (merged.length >= maxFiles) { rejectedOverCount += 1; continue }
    seen.add(key)
    merged.push(file)
    totalBytes += file.size
  }
  return { files: merged, rejectedOverBudget, rejectedOverCount, duplicates, totalBytes }
}
