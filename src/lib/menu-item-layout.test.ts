import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * `menu-item` is `justify-between`, and that is the point of it: the label goes
 * left, a shortcut or submenu arrow goes right. But an item written as two bare
 * children — `<AppIcon/><span>label</span>` — makes the *icon* the left group
 * and the *label* the right one, so the label lands against the far edge of the
 * panel with a void between it and its own icon. Twenty-six of App.vue's menu
 * items were that shape, and the toolbox copied it from there.
 *
 * Wrapping every item's icon and label in a `.row` span would have cost about a
 * kilobyte of raw JS in a startup bundle that sits two kilobytes from its
 * budget, so the regrouping is one rule in `theme.css` instead. These tests pin
 * the rule and the two things that would silently defeat it.
 */
const styles = readFileSync(new URL('../styles/theme.css', import.meta.url), 'utf8')

function vueFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return vueFiles(path)
    return entry.name.endsWith('.vue') ? [path] : []
  })
}

const source = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const files = [...vueFiles(join(source, 'views')), ...vueFiles(join(source, 'components')), join(source, 'App.vue')]
const MENU_ITEM = /<(button|a|RouterLink)\b[^>]*class="[^"]*\bmenu-item\b[^"]*"[^>]*>(.*?)<\/\1>/gs

const items = files.flatMap((file) => {
  const text = readFileSync(file, 'utf8')
  return [...text.matchAll(MENU_ITEM)].map((match) => ({
    file: file.slice(source.length),
    inner: match[2].trim(),
    line: text.slice(0, match.index).split('\n').length,
  }))
})

describe('menu-item layout', () => {
  it('finds the menu items the rule has to cover', () => {
    expect(items.length).toBeGreaterThan(30)
    // Both shapes the rule serves are really in the product.
    expect(items.some((item) => /^<AppIcon\b/.test(item.inner))).toBe(true)
    expect(items.some((item) => /^<span class="row gap-2">/.test(item.inner))).toBe(true)
  })

  it('regroups an unwrapped icon with its own label', () => {
    expect(styles).toMatch(/\.menu-item > :where\(:first-child:not\(\.row\)\) \+ \*\s*\{\s*margin-right: auto/)
  })

  it('leaves an already-grouped label to justify-between', () => {
    // The `:not(.row)` is the whole reason DocumentsView's wrapped items — and
    // the toolbox board's — keep their shortcut on the right edge.
    expect(styles).toContain(':not(.row)')
  })

  it('stacks a title above its hint', () => {
    // `b` and `small` are inline: without this the hint runs straight on from
    // the title — 打开本地 MarkdownCtrl+O · 关联并监听磁盘文件.
    expect(styles).toMatch(/\.menu-item :where\(b\)\s*\{\s*display: block/)
    expect(styles).toMatch(/\.menu-item :where\(small\)\s*\{[^}]*display: block/)
  })

  it('keeps the rules weak enough for a utility class to override them', () => {
    // UnoCSS is imported last but its utilities are a single class. Anything
    // here above that weight would silently restyle every hint in the product.
    const rules = styles.slice(styles.indexOf('/* Context menus.'))
    const selectors = [...rules.matchAll(/^(\.menu-item[^{]*)\{/gm)].map((match) => match[1].trim())
    expect(selectors.length).toBeGreaterThanOrEqual(3)
    for (const selector of selectors) {
      // Strip the zero-weight parts, then count what still carries weight.
      const weighted = selector.replace(/:where\([^)]*\)/g, '')
      const classes = weighted.match(/\.[\w-]+/g) ?? []
      const ids = weighted.match(/#[\w-]+/g) ?? []
      expect({ selector, classes, ids }).toEqual({ selector, classes: ['.menu-item'], ids: [] })
    }
  })
})
