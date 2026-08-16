import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const native = readFileSync(new URL('./native.ts', import.meta.url), 'utf8')
const today = readFileSync(new URL('../components/TodayFocus.vue', import.meta.url), 'utf8')
const commands = readFileSync(new URL('../../src-tauri/src/lib.rs', import.meta.url), 'utf8')

describe('desktop focus history pagination contract', () => {
  it('passes the complete stable cursor to the native focus query', () => {
    expect(native).toContain("invoke<TimelineEvent[]>('list_default_focus_events'")
    expect(native).toContain('beforeStartsAt: before?.startsAt')
    expect(native).toContain('beforeUpdatedAt: before?.updatedAt')
    expect(native).toContain('beforeId: before?.id')
    expect(commands).toContain('list_default_focus_events,')
  })

  it('hydrates one sentinel row but renders only a bounded page', () => {
    expect(today).toContain('listDesktopPersonalEvents(PERSONAL_EVENT_LIMIT + 1)')
    expect(today).toContain('focus.slice(0, PERSONAL_EVENT_LIMIT)')
    expect(today).toContain('focusHistoryHasMore.value = focus.length > PERSONAL_EVENT_LIMIT')
    expect(today).toContain('replaceFocusPage(page.slice(0, PERSONAL_EVENT_LIMIT))')
  })

  it('replaces pages and keeps both older and latest navigation discoverable', () => {
    expect(today).toContain('async function loadOlderFocusPage()')
    expect(today).toContain('async function loadLatestFocusPage(reveal = true)')
    expect(today).toContain('返回最近记录')
    expect(today).toContain('载入更早')
  })

  it('keeps right-click expanded state outside the memo cache', () => {
    expect(today).toContain('event.payload, menu?.id === event.id]')
    expect(today).toContain('item.event.payload, menu?.id === item.event.id]')
  })
})
