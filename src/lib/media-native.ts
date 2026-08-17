import { invoke } from '@tauri-apps/api/core'

function isDesktop() {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

export interface MediaDetectionSegment {
  startSeconds: number
  endSeconds?: number
  durationSeconds?: number
  closed: boolean
}

export interface MediaDetectionReport {
  kind: 'silence' | 'black'
  segments: MediaDetectionSegment[]
  truncated: boolean
  elapsedMs: number
}

export interface MediaWaveformReport {
  sampleRate: number
  sampledDurationSeconds: number
  sourceDurationSeconds?: number
  limited: boolean
  peaks: number[]
  elapsedMs: number
}

export async function analyzeDesktopMedia(path: string, kind: 'silence' | 'black') {
  if (!isDesktop()) throw new Error('媒体检测仅支持桌面模式。')
  return invoke<MediaDetectionReport>(kind === 'silence' ? 'analyze_media_silence' : 'analyze_media_black', { path })
}

export async function analyzeDesktopMediaWaveform(path: string) {
  if (!isDesktop()) throw new Error('媒体波形分析仅支持桌面模式。')
  return invoke<MediaWaveformReport>('analyze_media_waveform', { path })
}
