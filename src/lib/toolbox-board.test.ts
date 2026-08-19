import { describe, expect, it } from 'vitest'
import { toolCatalog, type ToolCatalogItem } from './tool-catalog'
import { buildToolboxBoard, moveBefore, moveByStep, toggleKey, workbenchKeyOf } from './toolbox-board'

function tool(id: string, path: string, query?: Record<string, string>): ToolCatalogItem {
  return { id, title: id, description: '', group: '整理', icon: 'toolbox', to: { path, query }, keywords: [] }
}

describe('workbenchKeyOf', () => {
  it('keys /tools by its group because BatchView hosts unrelated families there', () => {
    expect(workbenchKeyOf(tool('a', '/tools', { group: 'pdf', operation: 'merge' }))).toBe('/tools:pdf')
    expect(workbenchKeyOf(tool('b', '/tools', { group: 'text', mode: 'json' }))).toBe('/tools:text')
  })

  it('files the bare-mode /tools entries under 文件整理', () => {
    expect(workbenchKeyOf(tool('c', '/tools', { mode: 'archive' }))).toBe('/tools:organize')
    expect(workbenchKeyOf(tool('d', '/tools'))).toBe('/tools:organize')
  })

  it('keys every other destination by path alone', () => {
    expect(workbenchKeyOf(tool('e', '/developer-tools', { tool: 'jwt' }))).toBe('/developer-tools')
    expect(workbenchKeyOf(tool('f', '/visual', { annotation: 'mosaic' }))).toBe('/visual')
  })
})

describe('buildToolboxBoard', () => {
  it('places every catalogue entry in exactly one block', () => {
    const blocks = buildToolboxBoard()
    const ids = blocks.flatMap((block) => block.tools.map((item) => item.id))
    expect(ids.length).toBe(toolCatalog.length)
    expect(new Set(ids).size).toBe(toolCatalog.length)
  })

  it('collapses the four workbenches that were flattened into forty cards', () => {
    const byKey = new Map(buildToolboxBoard().map((block) => [block.key, block]))
    expect(byKey.get('/tools:pdf')?.tools.length).toBeGreaterThan(8)
    expect(byKey.get('/developer-tools')?.tools.length).toBeGreaterThan(8)
    expect(byKey.get('/visual')?.tools.length).toBeGreaterThan(5)
    // Far fewer blocks than the 64 cards the flat grid rendered.
    expect(buildToolboxBoard().length).toBeLessThan(20)
  })

  it('gives every block a label, an icon and a category token', () => {
    for (const block of buildToolboxBoard()) {
      expect(block.label).not.toBe('')
      expect(block.icon).not.toBe('')
      expect(block.accent).not.toBe('')
    }
  })

  it('marks one-tool blocks so they open instead of expanding', () => {
    const board = buildToolboxBoard()
    expect(board.find((block) => block.key === '/ocr')?.single).toBe(true)
    expect(board.find((block) => block.key === '/tools:pdf')?.single).toBe(false)
  })

  it('follows a saved block order and appends blocks the layout has never seen', () => {
    const board = buildToolboxBoard({ blockOrder: ['/ocr', '/clipboard'], hiddenBlocks: [], expandedBlocks: [], toolOrder: {} })
    expect(board[0].key).toBe('/ocr')
    expect(board[1].key).toBe('/clipboard')
    expect(board.map((block) => block.key)).toContain('/tools:pdf')
  })

  it('ignores layout keys that no longer name a workbench', () => {
    const board = buildToolboxBoard({ blockOrder: ['/gone', '/ocr'], hiddenBlocks: ['/gone'], expandedBlocks: ['/gone'], toolOrder: { '/gone': ['x'] } })
    expect(board.map((block) => block.key)).not.toContain('/gone')
    expect(board[0].key).toBe('/ocr')
  })

  it('applies a saved tool order without adding, dropping or duplicating tools', () => {
    const plain = buildToolboxBoard().find((block) => block.key === '/tools:pdf')!
    const last = plain.tools[plain.tools.length - 1].id
    const moved = buildToolboxBoard({
      blockOrder: [], hiddenBlocks: [], expandedBlocks: [],
      // A stale id and a duplicate: neither may reach the rendered list.
      toolOrder: { '/tools:pdf': [last, 'pdf-removed-tool', last] },
    }).find((block) => block.key === '/tools:pdf')!
    expect(moved.tools[0].id).toBe(last)
    expect(moved.tools.map((item) => item.id).sort()).toEqual(plain.tools.map((item) => item.id).sort())
  })

  it('carries hidden and expanded flags through to the board', () => {
    const board = buildToolboxBoard({ blockOrder: [], hiddenBlocks: ['/history'], expandedBlocks: ['/tools:pdf'], toolOrder: {} })
    expect(board.find((block) => block.key === '/history')?.hidden).toBe(true)
    expect(board.find((block) => block.key === '/tools:pdf')?.expanded).toBe(true)
  })

  it('keeps working when the public build strips a tool family', () => {
    const board = buildToolboxBoard(undefined, toolCatalog.filter((item) => item.to.path !== '/developer-tools'))
    expect(board.map((block) => block.key)).not.toContain('/developer-tools')
    expect(board.length).toBeGreaterThan(0)
  })
})

describe('reordering', () => {
  it('moves a key to where the drop target sits', () => {
    expect(moveBefore(['a', 'b', 'c', 'd'], 'd', 'b')).toEqual(['a', 'd', 'b', 'c'])
    expect(moveBefore(['a', 'b', 'c'], 'a', 'c')).toEqual(['b', 'c', 'a'])
  })

  it('leaves the list alone when a drag ends on itself or on nothing', () => {
    expect(moveBefore(['a', 'b'], 'a', 'a')).toEqual(['a', 'b'])
    expect(moveBefore(['a', 'b'], 'a', 'missing')).toEqual(['a', 'b'])
  })

  it('steps one place for the keyboard and clamps at both ends', () => {
    expect(moveByStep(['a', 'b', 'c'], 'b', -1)).toEqual(['b', 'a', 'c'])
    expect(moveByStep(['a', 'b', 'c'], 'b', 1)).toEqual(['a', 'c', 'b'])
    expect(moveByStep(['a', 'b', 'c'], 'a', -1)).toEqual(['a', 'b', 'c'])
    expect(moveByStep(['a', 'b', 'c'], 'c', 1)).toEqual(['a', 'b', 'c'])
  })

  it('toggles a key in and out of a layout list', () => {
    expect(toggleKey([], 'a')).toEqual(['a'])
    expect(toggleKey(['a', 'b'], 'a')).toEqual(['b'])
  })
})
