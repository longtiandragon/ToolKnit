export interface BackupTimestamps {
  /** Legacy versions used this field for both manual and automatic work. */
  lastBackupAt?: string
  lastManualBackupAt?: string
  lastAutomaticBackupAt?: string
}

export type BackupRecordKind = 'automatic' | 'manual' | 'legacy'

export interface BackupRecord {
  kind: BackupRecordKind
  at: string
}

function validTimestamp(value?: string) {
  return value && Number.isFinite(Date.parse(value)) ? value : undefined
}

export function manualBackupTimestamp(settings: BackupTimestamps) {
  return validTimestamp(settings.lastManualBackupAt)
}

export function automaticBackupTimestamp(settings: BackupTimestamps, nativeTimestamp?: string) {
  const candidates = [validTimestamp(settings.lastAutomaticBackupAt), validTimestamp(nativeTimestamp)].filter(Boolean) as string[]
  return candidates.sort((left, right) => Date.parse(right) - Date.parse(left))[0]
}

/** Keeps legacy data visible without falsely calling a mixed old timestamp a
 * manual export. New versions record manual and automatic work separately. */
export function latestBackupRecord(settings: BackupTimestamps, nativeAutomaticTimestamp?: string): BackupRecord | undefined {
  const records: BackupRecord[] = []
  const automatic = automaticBackupTimestamp(settings, nativeAutomaticTimestamp)
  const manual = manualBackupTimestamp(settings)
  const legacy = !manual ? validTimestamp(settings.lastBackupAt) : undefined
  if (automatic) records.push({ kind: 'automatic', at: automatic })
  if (manual) records.push({ kind: 'manual', at: manual })
  if (legacy) records.push({ kind: 'legacy', at: legacy })
  return records.sort((left, right) => Date.parse(right.at) - Date.parse(left.at))[0]
}
