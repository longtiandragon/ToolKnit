export function scrollProgress(scrollTop: number, scrollHeight: number, clientHeight: number) {
  const scrollRange = Math.max(0, scrollHeight - clientHeight)
  if (!scrollRange) return 0
  return Math.min(1, Math.max(0, scrollTop / scrollRange))
}

export function scrollOffset(progress: number, scrollHeight: number, clientHeight: number) {
  const scrollRange = Math.max(0, scrollHeight - clientHeight)
  const normalized = Number.isFinite(progress) ? Math.min(1, Math.max(0, progress)) : 0
  return scrollRange * normalized
}
