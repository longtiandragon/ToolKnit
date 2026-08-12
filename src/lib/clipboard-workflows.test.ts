import { describe, expect, it } from 'vitest'
import { workspaceCommandCatalog } from './workspace-navigation'
import { clipboardEntryActions, clipboardFilterFromQuery, clipboardFilterOptions, clipboardRouteAction, toggleClipboardSelection } from './clipboard-workflows'

describe('clipboard workflows', () => {
  it('normalizes five stable filters and two side-effect intents', () => {
    expect(clipboardFilterOptions.map(option => option.id)).toEqual(['all', 'snippets', 'text', 'code', 'image'])
    expect(clipboardFilterFromQuery('code')).toBe('code')
    expect(clipboardFilterFromQuery(['code'])).toBe('all')
    expect(clipboardRouteAction('capture')).toBe('capture')
    expect(clipboardRouteAction('create-snippet')).toBe('create-snippet')
    expect(clipboardRouteAction('clear')).toBeUndefined()
  })

  it('keeps entry actions discoverable from global navigation', () => {
    const routes = new Set(workspaceCommandCatalog().map(item => item.to))
    expect(clipboardEntryActions.every(action => routes.has(action.to))).toBe(true)
  })

  it('toggles selection immutably', () => {
    const selected = new Set(['a'])
    expect([...toggleClipboardSelection(selected, 'b')]).toEqual(['a', 'b'])
    expect([...toggleClipboardSelection(selected, 'a')]).toEqual([])
    expect([...selected]).toEqual(['a'])
  })
})

