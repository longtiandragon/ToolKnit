import { describe, expect, it } from 'vitest'
import { annotationLayerPosition, arrowFromCanvasEndpoints, createAnnotation, duplicateAnnotation, moveAnnotationLayer, normalizeAnnotation, rotateAnnotation, updateAnnotationText } from './annotation-canvas'

describe('annotation canvas geometry', () => {
  it('keeps rectangle geometry inside the normalized composition', () => {
    const annotation = normalizeAnnotation({ id: 1, kind: 'box', x: .94, y: .92, width: .2, height: .2, text: '', color: '#fff' })
    expect(annotation.x).toBeCloseTo(.8)
    expect(annotation.y).toBeCloseTo(.8)
    expect(annotation.width).toBeCloseTo(.2)
  })

  it('retains an arrow direction while constraining its endpoint', () => {
    const annotation = normalizeAnnotation({ id: 1, kind: 'arrow', x: .1, y: .8, width: -.3, height: .4, text: '', color: '#fff' })
    expect(annotation.width).toBeCloseTo(-.1)
    expect(annotation.height).toBeCloseTo(.2)
  })

  it('creates and offsets an export-compatible duplicate', () => {
    const original = createAnnotation({ kind: 'text', x: .2, y: .2, text: '重点', color: '#13806e' })
    const copy = duplicateAnnotation(original, 2)
    expect(copy.id).toBe(2)
    expect(copy.x).toBeGreaterThan(original.x)
    expect(copy.y).toBeGreaterThan(original.y)
  })

  it('stores transformed arrow endpoints as responsive proportions', () => {
    const arrow = createAnnotation({ id: 1, kind: 'arrow', x: .1, y: .2, width: .3, height: -.1, text: '', color: '#fff' })
    const transformed = arrowFromCanvasEndpoints(arrow, { x: 240, y: 360 }, { x: 1080, y: 120 }, { width: 1200, height: 600 })
    expect(transformed).toMatchObject({ kind: 'arrow', x: .2, y: .6, width: .7, height: -.4 })
  })

  it('keeps transformed arrow endpoints inside the composition', () => {
    const arrow = createAnnotation({ id: 1, kind: 'arrow', x: .1, y: .2, width: .3, height: -.1, text: '', color: '#fff' })
    const transformed = arrowFromCanvasEndpoints(arrow, { x: -40, y: 680 }, { x: 1400, y: -120 }, { width: 1200, height: 600 })
    expect(transformed).toMatchObject({ x: 0, y: 1, width: 1, height: -1 })
  })

  it('updates only text annotations without changing other canvas objects', () => {
    const text = createAnnotation({ id: 1, kind: 'text', x: .1, y: .2, text: '旧文字', color: '#ffffff' })
    const box = createAnnotation({ id: 2, kind: 'box', x: .2, y: .3, text: '', color: '#ffbf69' })
    const updated = updateAnnotationText([text, box], text.id, '新文字')
    expect(updated[0]).toMatchObject({ id: text.id, text: '新文字' })
    expect(updated[1]).toEqual(box)
    expect(updateAnnotationText(updated, box.id, '不会写入方框')).toEqual(updated)
  })

  it('reorders layers without mutating the paint list', () => {
    const first = createAnnotation({ id: 1, kind: 'box', x: .1, y: .1, text: '', color: '#ffffff' })
    const second = createAnnotation({ id: 2, kind: 'text', x: .2, y: .2, text: '上层', color: '#ffffff' })
    const layers = [first, second]
    expect(moveAnnotationLayer(layers, first.id, 'forward').map((item) => item.id)).toEqual([2, 1])
    expect(moveAnnotationLayer(layers, second.id, 'front')).toBe(layers)
    expect(annotationLayerPosition(layers, first.id)).toMatchObject({ index: 0, canMoveForward: true, canMoveBackward: false })
  })

  it('normalizes box rotation and rotates arrow endpoints', () => {
    const box = createAnnotation({ id: 1, kind: 'box', x: .1, y: .1, text: '', color: '#ffffff', rotation: 375 })
    expect(box.rotation).toBe(15)
    expect(rotateAnnotation(box, -15)).not.toHaveProperty('rotation')
    const arrow = createAnnotation({ id: 2, kind: 'arrow', x: .2, y: .2, width: .2, height: 0, text: '', color: '#ffffff' })
    expect(rotateAnnotation(arrow, 90)).toMatchObject({ x: .2, y: .2, width: 0, height: .2 })
  })
})

describe('mosaic and pen annotations', () => {
  it('keeps mosaic rectangles in normalized proportions like boxes', () => {
    const mosaic = createAnnotation({ id: 1, kind: 'mosaic', x: .3, y: .3, width: .4, height: .3, text: '', color: '#ffffff' })
    expect(mosaic).toMatchObject({ kind: 'mosaic', x: .3, y: .3, width: .4, height: .3 })
  })

  it('clamps freehand pen points into the composition and ignores rect geometry', () => {
    const pen = createAnnotation({ id: 2, kind: 'pen', x: .2, y: .2, text: '', color: '#ffbf69', points: [{ x: .2, y: .2 }, { x: 1.4, y: -.2 }, { x: .6, y: .6 }] })
    expect(pen.points).toEqual([{ x: .2, y: .2 }, { x: 1, y: 0 }, { x: .6, y: .6 }])
    expect(pen.width).toBeUndefined()
    expect(pen.height).toBeUndefined()
  })

  it('keeps pen points untouched by text updates', () => {
    const pen = createAnnotation({ id: 3, kind: 'pen', x: 0, y: 0, text: '', color: '#ffffff', points: [{ x: .1, y: .1 }, { x: .2, y: .2 }] })
    expect(updateAnnotationText([pen], pen.id, '不会写入画笔')).toEqual([pen])
  })
})
