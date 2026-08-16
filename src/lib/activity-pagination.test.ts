import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const store = readFileSync(new URL('../stores/workbench.ts', import.meta.url), 'utf8')
const native = readFileSync(new URL('./native.ts', import.meta.url), 'utf8')
const history = readFileSync(new URL('../views/HistoryView.vue', import.meta.url), 'utf8')
const vault = readFileSync(new URL('../../src-tauri/src/vault.rs', import.meta.url), 'utf8')

describe('desktop activity pagination contract', () => {
  it('hydrates a bounded first page and retains the native cursor separately', () => {
    expect(store).toContain('let nativeActivityEvents = await listDesktopActivityEvents(81)')
    expect(store).toContain('activityHistoryCursor = initialActivityEvents.at(-1)')
    expect(store).toContain('activities.value = timelineActivities(initialActivityEvents, 80)')
  })

  it('uses every ordering field in the native keyset cursor', () => {
    expect(native).toContain('beforeStartsAt: before?.startsAt')
    expect(native).toContain('beforeUpdatedAt: before?.updatedAt')
    expect(native).toContain('beforeId: before?.id')
    expect(vault).toContain('OR (starts_epoch = ?1 AND updated_at = ?2 AND id < ?3)')
  })

  it('keeps loading controls inside the existing history panel', () => {
    expect(store).toContain('listDesktopActivityEvents(81, cursor)')
    expect(store).toContain('.slice(0, MAX_TIMELINE_ACTIVITIES)')
    expect(history).toContain('store.activitiesHasMore || store.activitiesLoadingMore')
    expect(history).toContain('载入较早日志')
  })

  it('exposes activity actions to both pointer and keyboard users', () => {
    expect(history).toContain('@contextmenu.stop="openActivityContext($event, item)"')
    expect(history).toContain('handleActivityKeydown($event, item)')
    expect(history).toContain('role="menu"')
    expect(history).toContain('复制标题与详情')
    expect(history).toContain('只看此类日志')
    expect(history).toContain('activityContextMenu?.activity.id === item.id]')
  })
})
