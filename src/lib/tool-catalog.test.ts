import { describe, expect, it } from 'vitest'
import { browseCommandTools, searchTools, toolCatalog, toolCatalogOwnerLocation, toolWorkflows } from './tool-catalog'
import { toolCategories } from './toolbox-nav'

describe('tool catalog', () => {
  it('keeps every tool id and route usable', () => {
    expect(toolCatalog.length).toBeGreaterThanOrEqual(20)
    expect(toolCatalog.every((tool) => tool.id && tool.title && tool.to.path.startsWith('/'))).toBe(true)
  })

  it('searches titles and aliases', () => {
    expect(searchTools('合并')[0]?.id).toBe('pdf-merge')
    expect(searchTools('去重')[0]?.id).toBe('organize-dedupe-report')
    expect(searchTools('webp')[0]?.id).toBe('pdf-pdf-to-image')
    expect(searchTools('密码')[0]?.id).toBe('pdf-protect')
    expect(searchTools('表单字段')[0]?.id).toBe('pdf-text')
    expect(searchTools('pdf 转图片')[0]?.id).toBe('pdf-pdf-to-image')
    expect(searchTools('pdf to image')[0]?.id).toBe('pdf-pdf-to-image')
    expect(searchTools('邮箱')[0]?.to.query?.mode).toBe('extract-contacts')
    expect(searchTools('字数')[0]?.to.query?.mode).toBe('statistics')
    expect(searchTools('二维码')[0]?.to.query?.tool).toBe('qrcode')
    expect(searchTools('日期间隔')[0]?.to.query?.tool).toBe('datecalc')
    expect(searchTools('ulid')[0]?.id).toBe('developer-uuid')
    expect(searchTools('random')[0]?.id).toBe('developer-uuid')
    expect(searchTools('CORS')[0]?.id).toBe('developer-headers')
    expect(searchTools('剪贴板')[0]?.id).toBe('clipboard-history')
    expect(searchTools('任务记录')[0]?.id).toBe('job-history')
    expect(searchTools('裁剪视频')[0]?.id).toBe('media-clip')
    expect(searchTools('16khz')[0]?.id).toBe('media-speech-wav')
    expect(searchTools('视频静音')[0]?.id).toBe('media-mute-video')
    expect(searchTools('加入字幕')[0]?.id).toBe('media-desk')
    expect(searchTools('移除字幕')[0]?.id).toBe('media-desk')
    expect(searchTools('移除音轨')[0]?.id).toBe('media-desk')
    expect(searchTools('音量标准化')[0]?.id).toBe('media-desk')
    expect(searchTools('静音检测')[0]?.id).toBe('media-desk')
    expect(searchTools('黑场检测')[0]?.id).toBe('media-desk')
    expect(searchTools('GPS')[0]?.id).toBe('image-metadata')
    expect(searchTools('XMP')[0]?.id).toBe('image-metadata')
    expect(searchTools('照片日期整理')[0]?.to.query?.mode).toBe('photo-organizer')
    expect(searchTools('whisper')[0]?.id).toBe('local-transcription')
    expect(searchTools('把 PDF 转成图片')[0]?.id).toBe('pdf-pdf-to-image')
    expect(searchTools('多张图片拼成一张长图')[0]?.id).toBe('image-concat')
  })

  it('keeps every common workflow linked to real catalog tools', () => {
    const ids = new Set(toolCatalog.map((tool) => tool.id))
    expect(toolWorkflows.length).toBeGreaterThanOrEqual(5)
    expect(toolWorkflows.every((workflow) => workflow.toolIds.length >= 2 && workflow.toolIds.every((id) => ids.has(id)))).toBe(true)
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

    expect(toolCatalogOwnerLocation(developer)).toEqual({ path: '/c/dev' })
    expect(toolCatalogOwnerLocation(qrCode)).toEqual({ path: '/c/express' })
    expect(toolCatalogOwnerLocation(codeImage)).toEqual({ path: '/create' })
    expect(toolCatalogOwnerLocation(library)).toEqual({ path: '/knowledge' })
  })

  /* `toolCatalogOwnerLocation` carries its own copy of the group-to-category
     map, because `toolbox-nav` reads this module and the cycle would cost more
     than the duplication. This is what keeps the copy honest: every category
     it can name has to be a category the toolbox actually renders. */
  it('sends every utility tool to a category page the toolbox really has', () => {
    const known = new Set(toolCategories.map((category) => category.id))
    const utilities = toolCatalog.filter((tool) => toolCatalogOwnerLocation(tool).path.startsWith('/c/'))

    expect(utilities.length).toBeGreaterThan(20)
    for (const tool of utilities) {
      expect(known).toContain(toolCatalogOwnerLocation(tool).path.slice(3))
    }
  })
})
