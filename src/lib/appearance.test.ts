import { describe, expect, it } from 'vitest'
import { appearanceClasses, appearanceVariables } from './appearance'

describe('reading appearance', () => {
  it('maps bounded preferences to stable CSS variables', () => {
    expect(appearanceVariables({ readingScale: 'large', readingDensity: 'airy', readingWidth: 'focused' })).toEqual({
      '--reading-font-size': '18px', '--editor-font-size': '16px', '--reading-line-height': '1.94', '--editor-line-height': '1.86', '--reading-max-width': '680px',
    })
  })

  it('keeps paper tone and motion state scoped to the application root', () => {
    expect(appearanceClasses({ readingPaperTone: 'mist', reduceMotion: true })).toEqual(['reading-paper--mist', { 'reduce-motion': true }])
    expect(appearanceClasses({ readingPaperTone: 'night', reduceMotion: false })).toEqual(['reading-paper--night', { 'reduce-motion': false }])
  })

  it('stays renderable while a legacy in-memory store is hot reloaded', () => {
    expect(appearanceVariables({ readingScale: undefined, readingDensity: undefined, readingWidth: undefined } as never)['--reading-max-width']).toBe('860px')
    expect(appearanceClasses({ readingPaperTone: undefined, reduceMotion: undefined } as never)[0]).toBe('reading-paper--warm')
  })
})
