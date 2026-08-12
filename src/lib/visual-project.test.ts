import { describe, expect, it } from 'vitest'
import { discoverVisualProjects, normalizeVisualProjectAnnotations, visualProjectRoute, visualProjectSignature } from './visual-project'

describe('visual project state', () => {
  it('normalizes stored annotations before handing them to Konva', () => {
    const annotations = normalizeVisualProjectAnnotations([
      { id: 1, kind: 'box', x: -2, y: 0.2, width: 9, height: 0.3, rotation: 450, text: '', color: '#24765f' },
      { id: 2, kind: 'unknown', x: 0, y: 0 },
      { id: 3, kind: 'text', x: 0.4, y: 0.5, text: 'a'.repeat(120), color: 'red' },
    ])
    expect(annotations).toHaveLength(2)
    expect(annotations[0]).toMatchObject({ x: 0, width: 1, rotation: 90, color: '#24765f' })
    expect(annotations[1]?.text).toHaveLength(80)
    expect(annotations[1]?.color).toBe('#ffbf69')
  })

  it('tracks editable metadata without reading image bytes', () => {
    const file = new File(['pixel'], 'source.png', { type: 'image/png', lastModified: 42 })
    const initial = visualProjectSignature({ title: '画布', canvasTitle: '', layout: 'single', background: '#172321', watermark: '', annotations: [], images: [file] })
    const changed = visualProjectSignature({ title: '画布', canvasTitle: '', layout: 'single', background: '#172321', watermark: '', annotations: [{ id: 1, kind: 'text', x: .2, y: .2, text: '重点', color: '#ffbf69' }], images: [file] })
    expect(changed).not.toBe(initial)
  })

  it('discovers recent projects by title and familiar canvas aliases', () => {
    const projects = [
      { id: 'older', title: '英语图片', imageCount: 1, annotationCount: 2, updatedAt: '2026-08-01T10:00:00Z' },
      { id: 'newer', title: '算法长图', imageCount: 2, annotationCount: 4, updatedAt: '2026-08-09T10:00:00Z' },
    ]
    expect(discoverVisualProjects(projects, '', 1).map((item) => item.id)).toEqual(['newer'])
    expect(discoverVisualProjects(projects, '算法').map((item) => item.id)).toEqual(['newer'])
    expect(discoverVisualProjects(projects, '画布').map((item) => item.id)).toEqual(['newer', 'older'])
    expect(discoverVisualProjects(projects, '不存在')).toEqual([])
  })

  it('builds a stable deep link for a saved project', () => {
    expect(visualProjectRoute('visual-1')).toEqual({ path: '/visual', query: { project: 'visual-1' } })
  })
})
