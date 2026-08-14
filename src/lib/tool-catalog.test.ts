import { describe, expect, it } from 'vitest'
import { browseCommandTools, searchTools, toolCatalog, toolCatalogOwnerLocation } from './tool-catalog'

describe('tool catalog', () => {
  it('keeps every tool id and route usable', () => {
    expect(toolCatalog.length).toBeGreaterThanOrEqual(20)
    expect(toolCatalog.every((tool) => tool.id && tool.title && tool.to.path.startsWith('/'))).toBe(true)
  })

  it('searches titles and aliases', () => {
    expect(searchTools('合并')[0]?.id).toBe('pdf-merge')
    expect(searchTools('去重')[0]?.id).toBe('organize-dedupe-report')
    expect(searchTools('webp')[0]?.id).toBe('image-convert')
    expect(searchTools('邮箱')[0]?.to.query?.mode).toBe('extract-contacts')
    expect(searchTools('字数')[0]?.to.query?.mode).toBe('statistics')
    expect(searchTools('二维码')[0]?.to.query?.tool).toBe('qrcode')
    expect(searchTools('日期间隔')[0]?.to.query?.tool).toBe('datecalc')
    expect(searchTools('剪贴板')[0]?.id).toBe('clipboard-history')
    expect(searchTools('任务记录')[0]?.id).toBe('job-history')
    expect(searchTools('裁剪视频')[0]?.id).toBe('media-clip')
    expect(searchTools('16khz')[0]?.id).toBe('media-speech-wav')
    expect(searchTools('视频静音')[0]?.id).toBe('media-mute-video')
    expect(searchTools('whisper')[0]?.id).toBe('local-transcription')
  })

  it('returns curated popular tools for an empty query', () => {
    expect(searchTools('')).toHaveLength(5)
    expect(searchTools('').every((tool) => tool.popular)).toBe(true)
  })

  it('prioritizes favorites and recent tools without duplicate command entries', () => {
    const groups = browseCommandTools(['code-image', 'missing-tool', 'pdf-merge'], ['code-image', 'image-convert', 'pdf-merge', 'developer-json'])
    expect(groups.map((group) => group.id)).toEqual(['favorites', 'recents', 'suggested'])
    expect(groups[0]?.tools.map((tool) => tool.id)).toEqual(['code-image', 'pdf-merge'])
    expect(groups[1]?.tools.map((tool) => tool.id)).toEqual(['image-convert', 'developer-json'])
    const ids = groups.flatMap((group) => group.tools.map((tool) => tool.id))
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('opens each tool in its owning space and preserves utility directory context', () => {
    const developer = toolCatalog.find((tool) => tool.id === 'developer-json')!
    const codeImage = toolCatalog.find((tool) => tool.id === 'code-image')!
    const library = toolCatalog.find((tool) => tool.id === 'library')!
    const qrCode = toolCatalog.find((tool) => tool.id === 'utility-qrcode')!

    expect(toolCatalogOwnerLocation(developer)).toEqual({ path: '/tool-space', query: { filter: 'developer', focus: 'developer-json' } })
    expect(toolCatalogOwnerLocation(qrCode)).toEqual({ path: '/tool-space', query: { filter: 'developer', focus: 'utility-qrcode' } })
    expect(toolCatalogOwnerLocation(codeImage)).toEqual({ path: '/create' })
    expect(toolCatalogOwnerLocation(library)).toEqual({ path: '/knowledge' })
  })

  it('assigns every tool-space utility to one visible category', () => {
    const categoryIds = new Set(['pdf', 'image-media', 'text-organize', 'developer'])
    const toolSpaceTools = toolCatalog.filter((tool) => toolCatalogOwnerLocation(tool).path === '/tool-space')
    const categorized = toolSpaceTools.filter((tool) => categoryIds.has(toolCatalogOwnerLocation(tool).query?.filter ?? ''))

    expect(categorized).toHaveLength(toolSpaceTools.length)
    expect(categorized.find((tool) => tool.id === 'utility-qrcode')).toBeDefined()
  })
})
