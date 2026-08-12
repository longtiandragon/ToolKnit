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
