import type { MediaFileInfo } from './native'

export type MediaOperation =
  | 'extract-mp3'
  | 'transcode-m4a'
  | 'transcode-wav'
  | 'transcode-mp4'
  | 'mute-video'
  | 'trim-clip'

export interface MediaOperationDefinition {
  id: MediaOperation
  title: string
  description: string
  detail: string
  extension: string
  requiredTrack: 'audio' | 'video' | 'media'
}

export const mediaOperations: readonly MediaOperationDefinition[] = [
  { id: 'extract-mp3', title: '提取为 MP3', description: '从视频取出第一条音轨', detail: '录课、讲解与视频配乐', extension: 'MP3', requiredTrack: 'audio' },
  { id: 'transcode-m4a', title: '转为 M4A', description: '压缩音频，保留清晰语音', detail: 'AAC 192 kbps · 长期收纳', extension: 'M4A', requiredTrack: 'audio' },
  { id: 'transcode-wav', title: '转为语音 WAV', description: '生成 16 kHz 单声道音频', detail: '适合 Whisper 与语音处理', extension: 'WAV', requiredTrack: 'audio' },
  { id: 'transcode-mp4', title: '转为 MP4', description: '统一为便于播放的 H.264', detail: 'AAC 音频 · 快速播放', extension: 'MP4', requiredTrack: 'video' },
  { id: 'mute-video', title: '生成静音视频', description: '移除音轨并保留画面', detail: '适合演示与无声素材', extension: '静音 MP4', requiredTrack: 'video' },
  { id: 'trim-clip', title: '截取一个片段', description: '按开始与结束时间生成新媒体', detail: '精确区间 · 原件保持完整', extension: '片段', requiredTrack: 'media' },
]

const mediaExtensions = new Set(['mp4', 'm4v', 'mov', 'mkv', 'webm', 'avi', 'mp3', 'm4a', 'aac', 'wav', 'flac', 'ogg', 'opus'])

export function routeMediaOperation(value: unknown): MediaOperation {
  if (value === 'clip' || value === 'trim-clip') return 'trim-clip'
  return mediaOperations.some((item) => item.id === value) ? value as MediaOperation : 'extract-mp3'
}

export function mediaOperationAvailable(operation: MediaOperationDefinition, source?: Pick<MediaFileInfo, 'audioCodec' | 'videoCodec'>) {
  if (!source) return true
  if (operation.requiredTrack === 'audio') return Boolean(source.audioCodec)
  if (operation.requiredTrack === 'video') return Boolean(source.videoCodec)
  return Boolean(source.audioCodec || source.videoCodec)
}

export function mediaOperationUnavailableReason(operation: MediaOperationDefinition, source?: Pick<MediaFileInfo, 'audioCodec' | 'videoCodec'>) {
  if (mediaOperationAvailable(operation, source)) return ''
  return operation.requiredTrack === 'video' ? '当前文件没有视频轨' : operation.requiredTrack === 'audio' ? '当前文件没有音轨' : '没有可处理的媒体轨道'
}

export function firstAvailableMediaOperation(source?: Pick<MediaFileInfo, 'audioCodec' | 'videoCodec'>) {
  return mediaOperations.find((item) => mediaOperationAvailable(item, source))?.id ?? 'extract-mp3'
}

export function isSupportedMediaPath(path: string) {
  const extension = path.split(/[\\/]/).at(-1)?.split('.').at(-1)?.toLocaleLowerCase('en-US')
  return Boolean(extension && mediaExtensions.has(extension))
}

export function mediaOutputMime(name: string) {
  const lower = name.toLocaleLowerCase('en-US')
  if (lower.endsWith('.mp4')) return 'video/mp4'
  if (lower.endsWith('.mp3')) return 'audio/mpeg'
  if (lower.endsWith('.wav')) return 'audio/wav'
  return 'audio/mp4'
}
