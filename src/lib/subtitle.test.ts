import { describe, expect, it } from 'vitest'
import { formatSubtitleTimestamp, mergeSubtitleCues, parseSubtitle, parseSubtitleTimestamp, repairSubtitleTiming, serializeSubtitle, shiftSubtitleCues, splitSubtitleCue, subtitleCueIndexes } from './subtitle'

describe('subtitle workflow', () => {
  it('parses SRT with BOM and keeps multiline text', () => {
    const result = parseSubtitle('\uFEFF1\r\n00:00:01,200 --> 00:00:03,400\r\n第一行\r\n第二行\r\n\r\n2\r\n00:00:04,000 --> 00:00:05,000\r\n结束', 'lesson.srt')
    expect(result.format).toBe('srt')
    expect(result.cues).toHaveLength(2)
    expect(result.cues[0]).toMatchObject({ startMs: 1200, endMs: 3400, text: '第一行\n第二行' })
  })

  it('parses VTT cue identifiers and serializes both formats', () => {
    const result = parseSubtitle('WEBVTT\n\nintro\n00:01.000 --> 00:03.250 align:start\nHello\n', 'lesson.vtt')
    expect(result.cues[0]).toMatchObject({ startMs: 1000, endMs: 3250, text: 'Hello' })
    expect(serializeSubtitle(result.cues, 'vtt')).toContain('00:00:01.000 --> 00:00:03.250')
    expect(serializeSubtitle(result.cues, 'srt')).toContain('1\n00:00:01,000 --> 00:00:03,250')
  })

  it('rejects malformed blocks and reports overlaps', () => {
    const result = parseSubtitle('1\nwrong\ntext\n\n2\n00:00:01,000 --> 00:00:03,000\nA\n\n3\n00:00:02,000 --> 00:00:04,000\nB')
    expect(result.cues).toHaveLength(2)
    expect(result.warnings.join(' ')).toContain('跳过 1')
    expect(result.warnings.join(' ')).toContain('时间重叠')
  })

  it('shifts the whole timeline without crossing zero or compressing gaps', () => {
    const shifted = shiftSubtitleCues([
      { id: 'a', startMs: 200, endMs: 1200, text: 'A' },
      { id: 'b', startMs: 2000, endMs: 3000, text: 'B' },
    ], -500)
    expect(shifted[0]).toMatchObject({ startMs: 0, endMs: 1000 })
    expect(shifted[1]).toMatchObject({ startMs: 1800, endMs: 2800 })
  })

  it('repairs subtitle overlaps without changing text or cue ids', () => {
    const result = repairSubtitleTiming([
      { id: 'b', startMs: 900, endMs: 800, text: '后一句' },
      { id: 'a', startMs: 0, endMs: 1200, text: '前一句' },
    ])
    expect(result.overlapCount).toBe(1)
    expect(result.reordered).toBe(true)
    expect(result.adjustedCount).toBe(1)
    expect(result.cues).toEqual([
      { id: 'a', startMs: 0, endMs: 1200, text: '前一句' },
      { id: 'b', startMs: 1200, endMs: 1400, text: '后一句' },
    ])
  })

  it('splits and merges cue text without losing its time range', () => {
    const original = { id: 'a', startMs: 1000, endMs: 5000, text: '第一句话，第二句话' }
    const split = splitSubtitleCue(original, 'b')!
    expect(split[0].startMs).toBe(1000)
    expect(split[1].endMs).toBe(5000)
    expect(mergeSubtitleCues(split[0], split[1])).toMatchObject({ startMs: 1000, endMs: 5000, text: '第一句话\n，第二句话' })
  })

  it('formats and parses desktop timecodes', () => {
    expect(formatSubtitleTimestamp(3_723_004, 'srt')).toBe('01:02:03,004')
    expect(parseSubtitleTimestamp('01:02:03.004')).toBe(3_723_004)
  })

  it('keeps original ordinals while filtering a long virtual timeline', () => {
    const cues = [
      { id: 'a', startMs: 0, endMs: 1000, text: '开场' },
      { id: 'b', startMs: 1000, endMs: 2000, text: 'Binary Search' },
      { id: 'c', startMs: 2000, endMs: 3000, text: '二分答案' },
    ]
    expect(subtitleCueIndexes(cues)).toEqual([0, 1, 2])
    expect(subtitleCueIndexes(cues, 'binary')).toEqual([1])
    expect(subtitleCueIndexes(cues, '二分')).toEqual([2])
  })
})
