import type { MediaFileInfo } from './native'

export type MediaOperation =
  | 'extract-mp3'
  | 'transcode-m4a'
  | 'transcode-wav'
  | 'transcode-mp4'
  | 'mute-video'
  | 'remove-audio'
  | 'remove-subtitles'
  | 'add-subtitle'
  | 'trim-clip'
  | 'lossless-clip'
  | 'remux-mp4'
  | 'extract-subtitle'
  | 'extract-cover'
  | 'clean-metadata'

export interface MediaOperationDefinition {
  id: MediaOperation
  title: string
  description: string
  detail: string
  extension: string
  requiredTrack: 'audio' | 'video' | 'subtitle' | 'media'
}

export const mediaOperations: readonly MediaOperationDefinition[] = [
  { id: 'extract-mp3', title: '提取为 MP3', description: '从视频取出第一条音轨', detail: '录课、讲解与视频配乐', extension: 'MP3', requiredTrack: 'audio' },
  { id: 'transcode-m4a', title: '转为 M4A', description: '压缩音频，保留清晰语音', detail: 'AAC 192 kbps · 长期收纳', extension: 'M4A', requiredTrack: 'audio' },
  { id: 'transcode-wav', title: '转为语音 WAV', description: '生成 16 kHz 单声道音频', detail: '适合 Whisper 与语音处理', extension: 'WAV', requiredTrack: 'audio' },
  { id: 'transcode-mp4', title: '转为 MP4', description: '统一为便于播放的 H.264', detail: 'AAC 音频 · 快速播放', extension: 'MP4', requiredTrack: 'video' },
  { id: 'mute-video', title: '生成静音视频', description: '移除音轨并保留画面', detail: '适合演示与无声素材', extension: '静音 MP4', requiredTrack: 'video' },
  { id: 'remove-audio', title: '无损移除音轨', description: '复制画面、字幕与附件并移除所有音频', detail: '不重新编码 · 原容器输出', extension: '无音频', requiredTrack: 'video' },
  { id: 'remove-subtitles', title: '无损移除字幕轨', description: '复制画面与音频并移除内嵌字幕', detail: '不重新编码 · 原容器输出', extension: '无字幕', requiredTrack: 'media' },
  { id: 'add-subtitle', title: '加入外部字幕', description: '把 SRT、VTT 或 ASS 封装为新的字幕轨', detail: '输出 MKV · 原文件与字幕保持完整', extension: '字幕 MKV', requiredTrack: 'media' },
  { id: 'trim-clip', title: '截取一个片段', description: '按开始与结束时间生成新媒体', detail: '精确区间 · 原件保持完整', extension: '片段', requiredTrack: 'media' },
  { id: 'lossless-clip', title: '无损截取片段', description: '不重新编码，快速裁出原始轨道', detail: '画质与音质不变 · 关键帧附近更准确', extension: '原容器', requiredTrack: 'media' },
  { id: 'remux-mp4', title: '重新封装为 MP4', description: '只换容器，不重新编码视频和音频', detail: '适合播放器兼容性整理', extension: 'MP4', requiredTrack: 'video' },
  { id: 'extract-subtitle', title: '提取字幕为 SRT', description: '把第一条文字字幕导出为通用格式', detail: '保留时间轴 · 位图字幕需先转码', extension: 'SRT', requiredTrack: 'subtitle' },
  { id: 'extract-cover', title: '提取视频封面', description: '从视频第一条画面导出一张 JPG', detail: '单帧封面 · 不修改原视频', extension: 'JPG', requiredTrack: 'video' },
  { id: 'clean-metadata', title: '清除媒体元数据', description: '移除标题、设备和位置等容器元数据', detail: '只复制轨道 · 原文件保持完整', extension: '清理', requiredTrack: 'media' },
]

const mediaExtensions = new Set(['mp4', 'm4v', 'mov', 'mkv', 'webm', 'avi', 'mp3', 'm4a', 'aac', 'wav', 'flac', 'ogg', 'opus'])

export function routeMediaOperation(value: unknown): MediaOperation {
  if (value === 'clip' || value === 'trim-clip') return 'trim-clip'
  return mediaOperations.some((item) => item.id === value) ? value as MediaOperation : 'extract-mp3'
}

export function mediaOperationAvailable(operation: MediaOperationDefinition, source?: Pick<MediaFileInfo, 'audioCodec' | 'videoCodec' | 'tracks'>) {
  if (!source) return true
  if (operation.requiredTrack === 'audio') return Boolean(source.audioCodec)
  if (operation.requiredTrack === 'video') return Boolean(source.videoCodec)
  if (operation.requiredTrack === 'subtitle') return Boolean(source.tracks?.some((track) => track.kind === 'subtitle'))
  return Boolean(source.audioCodec || source.videoCodec)
}

export function mediaOperationUnavailableReason(operation: MediaOperationDefinition, source?: Pick<MediaFileInfo, 'audioCodec' | 'videoCodec' | 'tracks'>) {
  if (mediaOperationAvailable(operation, source)) return ''
  return operation.requiredTrack === 'video' ? '当前文件没有视频轨' : operation.requiredTrack === 'audio' ? '当前文件没有音轨' : operation.requiredTrack === 'subtitle' ? '当前文件没有文字字幕轨' : '没有可处理的媒体轨道'
}

export function firstAvailableMediaOperation(source?: Pick<MediaFileInfo, 'audioCodec' | 'videoCodec' | 'tracks'>) {
  return mediaOperations.find((item) => mediaOperationAvailable(item, source))?.id ?? 'extract-mp3'
}

export function isSupportedMediaPath(path: string) {
  const extension = path.split(/[\\/]/).at(-1)?.split('.').at(-1)?.toLocaleLowerCase('en-US')
  return Boolean(extension && mediaExtensions.has(extension))
}

export function mediaOutputMime(name: string) {
  const lower = name.toLocaleLowerCase('en-US')
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg'
  if (lower.endsWith('.png')) return 'image/png'
  if (lower.endsWith('.mp4') || lower.endsWith('.m4v')) return 'video/mp4'
  if (lower.endsWith('.mov')) return 'video/quicktime'
  if (lower.endsWith('.mkv')) return 'video/x-matroska'
  if (lower.endsWith('.webm')) return 'video/webm'
  if (lower.endsWith('.avi')) return 'video/x-msvideo'
  if (lower.endsWith('.mp3')) return 'audio/mpeg'
  if (lower.endsWith('.wav')) return 'audio/wav'
  if (lower.endsWith('.flac')) return 'audio/flac'
  if (lower.endsWith('.ogg') || lower.endsWith('.opus')) return 'audio/ogg'
  if (lower.endsWith('.srt') || lower.endsWith('.vtt')) return 'text/plain'
  return lower.endsWith('.m4a') || lower.endsWith('.aac') ? 'audio/mp4' : 'application/octet-stream'
}
