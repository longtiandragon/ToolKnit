import { describe, expect, it } from 'vitest'
import { automaticBackupTimestamp, latestBackupRecord, manualBackupTimestamp } from './backup-status'

describe('backup status semantics', () => {
  it('keeps manual and automatic backup timestamps distinct', () => {
    const settings = {
      lastManualBackupAt: '2026-08-11T10:00:00.000Z',
      lastAutomaticBackupAt: '2026-08-12T02:00:00.000Z',
    }
    expect(manualBackupTimestamp(settings)).toBe(settings.lastManualBackupAt)
    expect(automaticBackupTimestamp(settings)).toBe(settings.lastAutomaticBackupAt)
    expect(latestBackupRecord(settings)).toEqual({ kind: 'automatic', at: settings.lastAutomaticBackupAt })
  })

  it('uses native automatic-backup metadata when it is newer', () => {
    expect(latestBackupRecord(
      { lastAutomaticBackupAt: '2026-08-10T02:00:00.000Z' },
      '2026-08-12T02:00:00.000Z',
    )).toEqual({ kind: 'automatic', at: '2026-08-12T02:00:00.000Z' })
  })

  it('keeps an old mixed timestamp visible without mislabelling it as manual', () => {
    expect(latestBackupRecord({ lastBackupAt: '2026-08-09T02:00:00.000Z' })).toEqual({
      kind: 'legacy',
      at: '2026-08-09T02:00:00.000Z',
    })
  })

  it('ignores malformed timestamps', () => {
    expect(latestBackupRecord({ lastBackupAt: 'yesterday', lastAutomaticBackupAt: 'broken' })).toBeUndefined()
  })
})
