export type MenuNavigationKey = 'ArrowDown' | 'ArrowUp' | 'Home' | 'End'
export type NestedMenuLevel = 'root' | 'submenu'
export type NestedMenuIntent = 'open-submenu' | 'close-submenu' | 'close-menu'
export type EditorClipboardShortcut = 'copy-markdown' | 'paste-plain'

export function preferredMenuItemIndex(priorities: readonly boolean[]) {
  if (!priorities.length) return undefined
  const preferred = priorities.findIndex(Boolean)
  return preferred >= 0 ? preferred : 0
}

export interface MenuBounds {
  menuWidth: number
  menuHeight: number
  viewportWidth?: number
  viewportHeight?: number
  margin?: number
}

export function isContextMenuShortcut(event: Pick<KeyboardEvent, 'key' | 'shiftKey'>) {
  return event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')
}

/** Typora-compatible explicit clipboard shortcuts used by the Markdown source
 * editor. Ordinary Ctrl+V keeps supported rich structure; Shift keeps the
 * predictable plain-text escape hatch. */
export function editorClipboardShortcut(event: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey'>): EditorClipboardShortcut | undefined {
  if (!(event.ctrlKey || event.metaKey) || !event.shiftKey || event.altKey) return undefined
  if (event.key.toLowerCase() === 'c') return 'copy-markdown'
  if (event.key.toLowerCase() === 'v') return 'paste-plain'
  return undefined
}

export function clampMenuPosition(x: number, y: number, {
  menuWidth,
  menuHeight,
  viewportWidth = window.innerWidth,
  viewportHeight = window.innerHeight,
  margin = 10,
}: MenuBounds) {
  return {
    x: Math.max(margin, Math.min(x, Math.max(margin, viewportWidth - menuWidth - margin))),
    y: Math.max(margin, Math.min(y, Math.max(margin, viewportHeight - menuHeight - margin))),
  }
}

export function nextMenuItemIndex(key: string, activeIndex: number, count: number) {
  if (!count || !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(key)) return undefined
  if (key === 'Home') return 0
  if (key === 'End') return count - 1
  if (key === 'ArrowDown') return activeIndex < 0 ? 0 : (activeIndex + 1) % count
  return activeIndex < 0 ? count - 1 : (activeIndex - 1 + count) % count
}

/** Desktop-style nested menus keep Escape local to the current level and use
 * horizontal arrows to cross the parent/submenu boundary. */
export function nestedMenuIntent(key: string, level: NestedMenuLevel, hasSubmenu = false): NestedMenuIntent | undefined {
  if (key === 'Escape') return level === 'submenu' ? 'close-submenu' : 'close-menu'
  if (key === 'ArrowLeft' && level === 'submenu') return 'close-submenu'
  if (key === 'ArrowRight' && level === 'root' && hasSubmenu) return 'open-submenu'
  return undefined
}
