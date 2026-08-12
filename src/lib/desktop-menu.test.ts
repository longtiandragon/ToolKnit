import { describe, expect, it } from 'vitest'
import { clampMenuPosition, editorClipboardShortcut, isContextMenuShortcut, nestedMenuIntent, nextMenuItemIndex, preferredMenuItemIndex } from './desktop-menu'

describe('desktop menu helpers', () => {
  it('recognizes platform context-menu shortcuts without treating ordinary F10 as a menu request', () => {
    expect(isContextMenuShortcut({ key: 'ContextMenu', shiftKey: false })).toBe(true)
    expect(isContextMenuShortcut({ key: 'F10', shiftKey: true })).toBe(true)
    expect(isContextMenuShortcut({ key: 'F10', shiftKey: false })).toBe(false)
  })

  it('matches Typora clipboard shortcuts without taking over ordinary copy and paste', () => {
    expect(editorClipboardShortcut({ key: 'C', ctrlKey: true, metaKey: false, shiftKey: true, altKey: false })).toBe('copy-markdown')
    expect(editorClipboardShortcut({ key: 'v', ctrlKey: true, metaKey: false, shiftKey: true, altKey: false })).toBe('paste-plain')
    expect(editorClipboardShortcut({ key: 'v', ctrlKey: true, metaKey: false, shiftKey: false, altKey: false })).toBeUndefined()
    expect(editorClipboardShortcut({ key: 'v', ctrlKey: true, metaKey: false, shiftKey: true, altKey: true })).toBeUndefined()
  })

  it('keeps menus inside a desktop viewport with a visible edge margin', () => {
    expect(clampMenuPosition(1240, 810, { menuWidth: 220, menuHeight: 160, viewportWidth: 1256, viewportHeight: 859, margin: 12 })).toEqual({ x: 1024, y: 687 })
    expect(clampMenuPosition(-20, -10, { menuWidth: 220, menuHeight: 160, viewportWidth: 1256, viewportHeight: 859, margin: 12 })).toEqual({ x: 12, y: 12 })
  })

  it('reserves the full height of a four-action document menu near a desktop edge', () => {
    expect(clampMenuPosition(1240, 820, { menuWidth: 244, menuHeight: 216, viewportWidth: 1256, viewportHeight: 859, margin: 12 })).toEqual({ x: 1000, y: 631 })
  })

  it('cycles menu focus and supports Home/End', () => {
    expect(nextMenuItemIndex('ArrowDown', 2, 3)).toBe(0)
    expect(nextMenuItemIndex('ArrowUp', 0, 3)).toBe(2)
    expect(nextMenuItemIndex('Home', 2, 3)).toBe(0)
    expect(nextMenuItemIndex('End', 0, 3)).toBe(2)
    expect(nextMenuItemIndex('Enter', 0, 3)).toBeUndefined()
  })

  it('keeps nested menu dismissal at the current desktop level', () => {
    expect(nestedMenuIntent('ArrowRight', 'root', true)).toBe('open-submenu')
    expect(nestedMenuIntent('ArrowRight', 'root', false)).toBeUndefined()
    expect(nestedMenuIntent('ArrowLeft', 'submenu')).toBe('close-submenu')
    expect(nestedMenuIntent('Escape', 'submenu')).toBe('close-submenu')
    expect(nestedMenuIntent('Escape', 'root')).toBe('close-menu')
  })

  it('focuses a semantic context action before generic menu commands', () => {
    expect(preferredMenuItemIndex([false, false, true, false])).toBe(2)
    expect(preferredMenuItemIndex([false, false])).toBe(0)
    expect(preferredMenuItemIndex([])).toBeUndefined()
  })
})
