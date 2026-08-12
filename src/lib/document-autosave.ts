export type DocumentAutoSavePolicy = {
  delayMs: number
  label: string
}

/** Auto-save waits longer than the editor's Vue projection and recovery-point
 * timers, so a pause in typing produces one durable write instead of a write
 * for every CodeMirror commit. */
export function documentAutoSavePolicy(length: number): DocumentAutoSavePolicy {
  const size = Math.max(0, Number.isFinite(length) ? length : 0)
  if (size <= 120_000) return { delayMs: 1800, label: '停笔 1.8 秒' }
  if (size <= 768 * 1024) return { delayMs: 2800, label: '停笔 2.8 秒' }
  if (size <= 1_500_000) return { delayMs: 4200, label: '停笔 4.2 秒' }
  return { delayMs: 6500, label: '大文档停笔 6.5 秒' }
}
