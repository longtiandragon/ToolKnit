import { describe, expect, it } from 'vitest'
import { blankCanvasFileName, blankCanvasPresetFromName, blankCanvasPresets, visualCanvasDimensions, visualCanvasForeground } from './visual-blank-canvas'

describe('visual blank canvas', () => {
  it('round-trips every bounded canvas preset through its portable file name', () => {
    for (const preset of blankCanvasPresets) expect(blankCanvasPresetFromName(blankCanvasFileName(preset))).toEqual(preset)
    expect(blankCanvasPresetFromName('photo.png')).toBeUndefined()
    expect(blankCanvasPresetFromName('knitspace-blank-square-99999x99999.png')).toBeUndefined()
  })

  it('uses blank dimensions only for a single-canvas composition', () => {
    const square = blankCanvasFileName(blankCanvasPresets[1])
    expect(visualCanvasDimensions('single', square)).toEqual({ width: 1080, height: 1080 })
    expect(visualCanvasDimensions('pair', square)).toEqual({ width: 1600, height: 1200 })
    expect(visualCanvasDimensions('single', 'photo.png')).toEqual({ width: 1600, height: 1100 })
  })

  it('keeps title and watermark readable on both paper and deep backgrounds', () => {
    expect(visualCanvasForeground('#fffaf0')).toEqual({ text: '#17352b', muted: '#47675b' })
    expect(visualCanvasForeground('#172321')).toEqual({ text: '#f4f7f2', muted: '#b8d1c4' })
    expect(visualCanvasForeground('invalid')).toEqual({ text: '#f4f7f2', muted: '#b8d1c4' })
  })
})
