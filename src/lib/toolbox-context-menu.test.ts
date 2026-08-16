import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const toolbox = readFileSync(new URL('../views/ToolboxView.vue', import.meta.url), 'utf8')

describe('toolbox context menu surface', () => {
  it('opens from pointer and the standard keyboard context-menu shortcut', () => {
    expect(toolbox).toContain('@contextmenu="openToolMenu($event, tool)"')
    expect(toolbox).toContain('@keydown="openToolMenuFromKeyboard($event, tool)"')
    expect(toolbox).toContain('isContextMenuShortcut(event)')
    expect(toolbox).toContain('右键或 Shift+F10 查看更多操作')
  })

  it('uses the shared desktop menu behavior and exposes useful tool actions', () => {
    expect(toolbox).toContain('class="menu-panel w-64"')
    expect(toolbox).toContain('role="menu"')
    expect(toolbox).toContain("runToolMenuAction('open')")
    expect(toolbox).toContain("runToolMenuAction('favorite')")
    expect(toolbox).toContain("runToolMenuAction('copy-description')")
    expect(toolbox).toContain("runToolMenuAction('browse-tools')")
    expect(toolbox).toContain('nextMenuItemIndex(')
  })
})
