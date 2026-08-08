import { describe, expect, it } from 'vitest'
import { searchTools, toolCatalog } from './tool-catalog'

describe('tool catalog', () => {
  it('keeps every tool id and route usable', () => {
    expect(toolCatalog.length).toBeGreaterThanOrEqual(20)
    expect(toolCatalog.every((tool) => tool.id && tool.title && tool.to.path.startsWith('/'))).toBe(true)
  })

  it('searches titles and aliases', () => {
    expect(searchTools('合并')[0]?.id).toBe('pdf-merge')
    expect(searchTools('去重')[0]?.id).toBe('organize-dedupe-report')
    expect(searchTools('webp')[0]?.id).toBe('image-convert')
  })

  it('returns curated popular tools for an empty query', () => {
    expect(searchTools('')).toHaveLength(5)
    expect(searchTools('').every((tool) => tool.popular)).toBe(true)
  })
})
