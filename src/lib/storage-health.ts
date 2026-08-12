export type StorageSpaceLevel = 'unknown' | 'ready' | 'low' | 'critical'

export interface StorageSpaceSnapshot {
  availableBytes?: number
  totalBytes?: number
}

const MEBIBYTE = 1024 ** 2
const GIBIBYTE = 1024 ** 3

/**
 * Absolute limits protect SQLite/WAL and small backups; proportional limits
 * keep the warning meaningful on very large volumes. The function is pure so
 * Settings and Lab always agree about the same native snapshot.
 */
export function storageSpaceLevel(snapshot?: StorageSpaceSnapshot): StorageSpaceLevel {
  const available = Number(snapshot?.availableBytes)
  const total = Number(snapshot?.totalBytes)
  if (!Number.isFinite(available) || !Number.isFinite(total) || available < 0 || total <= 0 || available > total) return 'unknown'
  const ratio = available / total
  if (available < 512 * MEBIBYTE || ratio < 0.005) return 'critical'
  if (available < 2 * GIBIBYTE || ratio < 0.02) return 'low'
  return 'ready'
}

export function storageSpacePercent(snapshot?: StorageSpaceSnapshot) {
  const available = Number(snapshot?.availableBytes)
  const total = Number(snapshot?.totalBytes)
  if (!Number.isFinite(available) || !Number.isFinite(total) || total <= 0) return 0
  return Math.max(0, Math.min(100, available / total * 100))
}

