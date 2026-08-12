import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const app = readFileSync(new URL('../App.vue', import.meta.url), 'utf8')
const settings = readFileSync(new URL('../views/SettingsView.vue', import.meta.url), 'utf8')
const dashboard = readFileSync(new URL('../views/DashboardView.vue', import.meta.url), 'utf8')
const restoreDialog = readFileSync(new URL('../components/VaultRestorePreviewDialog.vue', import.meta.url), 'utf8')
const native = readFileSync(new URL('./native.ts', import.meta.url), 'utf8')
const rust = readFileSync(new URL('../../src-tauri/src/vault.rs', import.meta.url), 'utf8')

describe('desktop backup surface contract', () => {
  it('does not report an automatic archive as a manual backup', () => {
    expect(app).toContain('lastAutomaticBackupAt:backedUpAt')
    expect(app).not.toContain('createDesktopAutoBackup().then(path=>{if(path){store.updateSettings({lastBackupAt:')
    expect(settings).toContain('lastManualBackupAt: backedUpAt')
  })

  it('exposes the daily archive as a visible and context-menu action', () => {
    expect(settings).toContain('立即检查今日归档')
    expect(settings).toContain('检查今日每日归档')
    expect(settings).toContain('查看最近每日归档')
    expect(settings).toContain('今天的每日归档已经存在，没有重复打包')
  })

  it('deep-links the Today backup status to the data and backup section', () => {
    // Asserted by behaviour, not by class name: the strip used to be found via
    // its `system-strip__backup` hook, which only existed for the legacy
    // stylesheet. What has to stay true is that Today reads the real backup
    // record and that clicking it lands on the section that can act on it.
    expect(dashboard).toContain('to="/settings?section=backup"')
    expect(dashboard).toContain('latestBackupRecord(store.settings)')
    expect(dashboard).toContain('尚无备份记录')
  })

  it('inspects a full archive before offering the destructive restore', () => {
    expect(native).toContain("invoke<DesktopVaultBackupInspection>('inspect_default_vault_backup'")
    expect(settings).toContain('await inspectDesktopVaultBackup(archivePath)')
    expect(settings.indexOf('await inspectDesktopVaultBackup(archivePath)')).toBeLessThan(settings.indexOf('await restoreDesktopVaultBackup(review.archivePath)'))
    expect(restoreDialog).toContain('归档已通过只读检查')
    expect(restoreDialog).toContain('归档内容少于当前资料库')
    expect(restoreDialog).toContain('取消，保持当前资料')
    expect(restoreDialog).toContain('确认替换并重新载入')
  })

  it('bounds and rechecks archive structure without loading managed files into the renderer', () => {
    expect(rust).toContain('VAULT_ARCHIVE_MAX_ENTRIES')
    expect(rust).toContain('VAULT_ARCHIVE_MAX_UNCOMPRESSED_BYTES')
    expect(rust).toContain('pub fn inspect_backup')
    expect(rust).toContain('self.inspect_backup_path(&archive_path)?')
    expect(rust).toContain('归档需要更新版本的 Knitspace')
    expect(settings).toContain("route.query.qa !== 'vault-restore-preview'")
  })
})
