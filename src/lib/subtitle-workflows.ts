export type SubtitleWorkflowId = 'import' | 'paste' | 'transcribe' | 'create' | 'convert' | 'shift'

export interface SubtitleWorkflowAction {
  id: SubtitleWorkflowId
  label: string
  detail: string
  icon: string
  to: string
  requiresCues?: boolean
}

/** Canonical task metadata shared by the subtitle page, navigation and tests.
 * Keeping these as workflows instead of separate pages makes the capability
 * visible without expanding the five-space information architecture. */
export const subtitleWorkflowActions: readonly SubtitleWorkflowAction[] = [
  { id: 'import', label: '打开字幕文件', detail: 'SRT / WebVTT，最多 5 MB', icon: 'folder-open', to: '/subtitles?action=import' },
  { id: 'paste', label: '粘贴字幕源码', detail: '解析前保留当前时间轴', icon: 'clipboard', to: '/subtitles?action=paste' },
  { id: 'transcribe', label: '本机语音转写', detail: 'Whisper 草稿，不上传媒体', icon: 'play', to: '/subtitles?transcribe=1' },
  { id: 'create', label: '新建空白字幕', detail: '从第一条时间轴开始', icon: 'plus', to: '/subtitles?action=create' },
  { id: 'convert', label: 'SRT / VTT 互转', detail: '载入后导出另一种格式', icon: 'rotate', to: '/subtitles?action=convert', requiresCues: true },
  { id: 'shift', label: '整体时间校准', detail: '统一提前或延后毫秒数', icon: 'clock', to: '/subtitles?action=shift', requiresCues: true },
]

export function subtitleWorkflowId(value: unknown): SubtitleWorkflowId | undefined {
  return subtitleWorkflowActions.some(action => action.id === value) ? value as SubtitleWorkflowId : undefined
}

