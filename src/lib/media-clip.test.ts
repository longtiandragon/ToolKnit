import { describe, expect, it } from 'vitest'
import { formatMediaTimecode, mediaClipPercent, parseMediaTimecode, validateMediaClipRange } from './media-clip'

describe('media clip ranges', () => {
  it('parses seconds, minutes and hours without locale-dependent inputs', () => {
    expect(parseMediaTimecode('12.5')).toBe(12.5)
    expect(parseMediaTimecode('01:30')).toBe(90)
    expect(parseMediaTimecode('1:02:03')).toBe(3723)
    expect(parseMediaTimecode('1:70')).toBeUndefined()
    expect(parseMediaTimecode('not-time')).toBeUndefined()
  })

  it('validates an ordered range within the inspected source duration', () => {
    expect(validateMediaClipRange('00:12', '01:15', 90).range).toEqual({ startSeconds: 12, endSeconds: 75, durationSeconds: 63 })
    expect(validateMediaClipRange('01:15', '00:12', 90).error).toContain('晚于')
    expect(validateMediaClipRange('00:12', '01:45', 90).error).toContain('媒体时长')
  })

  it('formats readable labels and clamps timeline percentages', () => {
    expect(formatMediaTimecode(65)).toBe('1:05')
    expect(formatMediaTimecode(3723)).toBe('1:02:03')
    expect(mediaClipPercent(30, 120)).toBe(25)
    expect(mediaClipPercent(150, 120)).toBe(100)
  })
})
