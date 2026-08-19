import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const toolbox = readFileSync(new URL('../views/ToolboxView.vue', import.meta.url), 'utf8')

/**
 * A source-shape check, not a render test: the toolbox board is the one page
 * where every arrangement action is reachable three ways — pointer drag, right
 * click and keyboard — and it is easy to add a fourth surface that quietly
 * covers only the first. These assertions pin the contract rather than the
 * handler names, which is what the previous version of this file got wrong.
 */
describe('toolbox context menu surface', () => {
  it('opens a menu from the pointer on blocks, tools and pinned entries', () => {
    expect(toolbox).toContain("openMenu($event, { kind: 'block', block })")
    expect(toolbox).toContain("openMenu($event, { kind: 'tool', tool, block })")
    expect(toolbox).toContain("openMenu($event, { kind: 'favorite', tool: item.tool })")
  })

  it('answers the standard keyboard context-menu shortcut everywhere it answers the pointer', () => {
    expect(toolbox).toContain('isContextMenuShortcut(event)')
    for (const handler of ['blockKeydown($event, block)', 'toolKeydown($event, block, tool)', 'favoriteKeydown($event, item.tool)']) {
      expect(toolbox).toContain(`@keydown="${handler}"`)
    }
    // Every keydown entry point routes through the shared shortcut check first.
    for (const handler of ['function blockKeydown', 'function toolKeydown', 'function favoriteKeydown']) {
      const body = toolbox.slice(toolbox.indexOf(handler), toolbox.indexOf(handler) + 260)
      expect(body).toContain('openMenuFromKeyboard(event')
    }
  })

  it('tells the user the menu exists', () => {
    expect(toolbox.match(/右键或 Shift\+F10 查看更多操作/g)?.length).toBeGreaterThanOrEqual(3)
  })

  it('uses the shared desktop menu behavior', () => {
    expect(toolbox).toContain('class="menu-panel w-64"')
    expect(toolbox).toContain('role="menu"')
    expect(toolbox).toContain('clampMenuPosition(')
    expect(toolbox).toContain('nextMenuItemIndex(')
    // Escape closes and returns focus to whatever opened the menu.
    expect(toolbox).toContain("if (event.key === 'Escape') { event.preventDefault(); closeMenu(true); return }")
    // A page-owned menu must step aside for a global one.
    expect(toolbox).toContain("new CustomEvent('knitspace:close-context-menus')")
  })

  it('exposes the tool actions the flat grid had, plus ordering', () => {
    for (const action of ['open', 'favorite', 'copy', 'owner', 'tool-top', 'tool-up', 'tool-down']) {
      expect(toolbox).toContain(`runMenuAction('${action}')`)
    }
  })

  it('exposes block arrangement, which has no other pointer-free entry point', () => {
    for (const action of ['expand', 'block-top', 'block-up', 'block-down', 'hide', 'category']) {
      expect(toolbox).toContain(`runMenuAction('${action}')`)
    }
  })

  it('offers a way back from hiding a block', () => {
    // Both an undo on the toast and a persistent 已隐藏 strip: a hidden block
    // with neither is a tool the user can no longer find on this page.
    expect(toolbox).toContain('setBlockHidden(block, false)')
    expect(toolbox).toContain('已隐藏 {{ hiddenBlocks.length }} 个')
    expect(toolbox).toContain('resetLayout')
  })
})
