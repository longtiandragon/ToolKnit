import { describe, expect, it } from 'vitest'
import { firstAvailableMediaOperation, isSupportedMediaPath, mediaOperationAvailable, mediaOperationUnavailableReason, mediaOperations, mediaOutputMime, routeMediaOperation } from './media-operation'

describe('media operation catalog', () => {
  it('restores every operation from a deep link and keeps the clip alias', () => {
    for (const operation of mediaOperations) expect(routeMediaOperation(operation.id)).toBe(operation.id)
    expect(routeMediaOperation('clip')).toBe('trim-clip')
    expect(routeMediaOperation('unknown')).toBe('extract-mp3')
  })

  it('only offers operations supported by the detected tracks', () => {
    const audio = { audioCodec: 'aac' }
    const video = { videoCodec: 'h264' }
    expect(mediaOperationAvailable(mediaOperations.find((item) => item.id === 'transcode-wav')!, audio)).toBe(true)
    expect(mediaOperationAvailable(mediaOperations.find((item) => item.id === 'mute-video')!, audio)).toBe(false)
    expect(mediaOperationUnavailableReason(mediaOperations.find((item) => item.id === 'mute-video')!, audio)).toBe('当前文件没有视频轨')
    expect(firstAvailableMediaOperation(video)).toBe('transcode-mp4')
    expect(mediaOperationAvailable(mediaOperations.find((item) => item.id === 'normalize-audio')!, { ...video, audioCodec: 'aac' })).toBe(true)
    expect(mediaOperationAvailable(mediaOperations.find((item) => item.id === 'lossless-clip')!, audio)).toBe(true)
    expect(mediaOperationAvailable(mediaOperations.find((item) => item.id === 'remux-mp4')!, audio)).toBe(false)
    expect(mediaOperationAvailable(mediaOperations.find((item) => item.id === 'remove-audio')!, video)).toBe(true)
    expect(mediaOperationAvailable(mediaOperations.find((item) => item.id === 'remove-audio')!, audio)).toBe(false)
    expect(mediaOperationAvailable(mediaOperations.find((item) => item.id === 'remove-subtitles')!, audio)).toBe(true)
    expect(mediaOperationAvailable(mediaOperations.find((item) => item.id === 'add-subtitle')!, video)).toBe(true)
    expect(mediaOperationAvailable(mediaOperations.find((item) => item.id === 'burn-subtitle')!, video)).toBe(true)
    expect(mediaOperationAvailable(mediaOperations.find((item) => item.id === 'edit-chapters')!, video)).toBe(true)
    expect(mediaOperationAvailable(mediaOperations.find((item) => item.id === 'extract-subtitle')!, { tracks: [{ index: 2, kind: 'subtitle', codec: 'subrip' }] })).toBe(true)
    expect(mediaOperationUnavailableReason(mediaOperations.find((item) => item.id === 'extract-subtitle')!, audio)).toBe('当前文件没有文字字幕轨')
  })

  it('recognizes supported desktop drops and output MIME types', () => {
    expect(isSupportedMediaPath('F:\\Recordings\\lecture.MKV')).toBe(true)
    expect(isSupportedMediaPath('F:\\Notes\\lecture.md')).toBe(false)
    expect(mediaOutputMime('speech.wav')).toBe('audio/wav')
    expect(mediaOutputMime('silent.mp4')).toBe('video/mp4')
    expect(mediaOutputMime('clip-lossless.mkv')).toBe('video/x-matroska')
    expect(mediaOutputMime('voice.flac')).toBe('audio/flac')
    expect(mediaOutputMime('captions.srt')).toBe('text/plain')
    expect(mediaOutputMime('cover.jpg')).toBe('image/jpeg')
  })
})
