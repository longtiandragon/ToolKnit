import { storageSpaceLevel, type StorageSpaceSnapshot } from '@/lib/storage-health'

export type LabCapabilityStatus = 'checking' | 'ready' | 'attention' | 'off'
export type LabCapabilityId = 'vault' | 'media' | 'transcription' | 'ocr' | 'output' | 'ai' | 'clipboard'

export interface LabVaultSnapshot {
  integrity: string
  schemaVersion: number
  latestSchemaVersion: number
  missingMarkdownCount: number
  noteCount: number
  questionCount: number
  vocabularyCount: number
  ftsEntryCount: number
}

export interface LabMediaSnapshot { available: boolean; version?: string }
export interface LabOcrSnapshot { available: boolean; languageCount: number; defaultLanguage?: string; detail: string }

export interface LabCapabilitySnapshot {
  desktop: boolean
  vault?: LabVaultSnapshot
  vaultError?: string
  storage?: StorageSpaceSnapshot
  storageError?: string
  media?: LabMediaSnapshot
  mediaError?: string
  ocr?: LabOcrSnapshot
  ocrError?: string
  outputDirectory?: string
  transcriptionConfigured?: boolean
  aiProfileCount: number
  clipboardEnabled: boolean
  clipboardPaused: boolean
}

export interface LabCapabilityCard {
  id: LabCapabilityId
  icon: string
  title: string
  description: string
  status: LabCapabilityStatus
  statusLabel: string
  detail: string
  to: string
  actionLabel: string
}

function vaultCard(snapshot: LabCapabilitySnapshot): LabCapabilityCard {
  const base = { id: 'vault' as const, icon: 'archive', title: 'Vault、磁盘与全文索引', description: '可用空间、SQLite 完整性、迁移版本、Markdown 正文和 FTS5 索引。', to: '/settings?section=backup', actionLabel: '查看数据健康' }
  if (!snapshot.desktop) return { ...base, status: 'attention', statusLabel: '需要桌面版', detail: '浏览器预览不会执行本机资料库检查。' }
  const storageLevel = storageSpaceLevel(snapshot.storage)
  const storageAvailable = snapshot.storage?.availableBytes
  const storageLabel = storageAvailable === undefined ? '' : storageAvailable < 1024 ** 3 ? `${(storageAvailable / 1024 ** 2).toFixed(0)} MB` : `${(storageAvailable / 1024 ** 3).toFixed(1)} GB`
  if (storageLevel === 'critical') return { ...base, status: 'attention', statusLabel: '磁盘严重不足', detail: `Vault 所在磁盘仅剩 ${storageLabel}；SQLite、附件和自动归档随时可能写入失败。` }
  if (storageLevel === 'low') return { ...base, status: 'attention', statusLabel: '磁盘空间偏低', detail: `Vault 所在磁盘剩余 ${storageLabel}；建议在继续导入前释放空间。` }
  if (snapshot.storageError) return { ...base, status: 'attention', statusLabel: '容量检查失败', detail: snapshot.storageError }
  if (snapshot.vaultError) return { ...base, status: 'attention', statusLabel: '检查失败', detail: snapshot.vaultError }
  if (!snapshot.vault) return { ...base, status: 'checking', statusLabel: '检查中', detail: '正在执行 SQLite 快速检查。' }
  const healthy = snapshot.vault.integrity === 'ok'
    && snapshot.vault.schemaVersion === snapshot.vault.latestSchemaVersion
    && snapshot.vault.missingMarkdownCount === 0
  return {
    ...base,
    status: healthy ? 'ready' : 'attention',
    statusLabel: healthy ? '已就绪' : '需要处理',
    detail: healthy
      ? `${snapshot.vault.noteCount} 篇笔记 · ${snapshot.vault.questionCount} 道题 · ${snapshot.vault.vocabularyCount} 个单词 · ${snapshot.vault.ftsEntryCount} 条索引${storageLabel ? ` · 可用 ${storageLabel}` : ''}`
      : `完整性 ${snapshot.vault.integrity} · Schema v${snapshot.vault.schemaVersion}/${snapshot.vault.latestSchemaVersion} · ${snapshot.vault.missingMarkdownCount} 个正文缺失`,
  }
}

function mediaCard(snapshot: LabCapabilitySnapshot): LabCapabilityCard {
  const base = { id: 'media' as const, icon: 'play', title: '本机媒体引擎', description: 'FFmpeg 与 FFprobe 在后台处理音视频，不把大文件载入页面。', to: '/media', actionLabel: '打开媒体转换' }
  if (!snapshot.desktop) return { ...base, status: 'attention', statusLabel: '需要桌面版', detail: '媒体探针只在 Knitspace 桌面进程中运行。' }
  if (snapshot.mediaError) return { ...base, status: 'attention', statusLabel: '检查失败', detail: snapshot.mediaError }
  if (!snapshot.media) return { ...base, status: 'checking', statusLabel: '检查中', detail: '正在查找 FFmpeg 与 FFprobe。' }
  return snapshot.media.available
    ? { ...base, status: 'ready', statusLabel: '已就绪', detail: snapshot.media.version || 'FFmpeg 与 FFprobe 均可用。' }
    : { ...base, status: 'attention', statusLabel: '未检测到', detail: '安装 FFmpeg 并加入 PATH 后即可使用，不需要重装 Knitspace。' }
}

function ocrCard(snapshot: LabCapabilitySnapshot): LabCapabilityCard {
  const base = { id: 'ocr' as const, icon: 'file-text', title: 'Windows 离线 OCR', description: '使用系统已安装语言包识别截图、扫描题和资料图片，不上传原图。', to: '/ocr', actionLabel: '打开离线识别' }
  if (!snapshot.desktop) return { ...base, status: 'attention', statusLabel: '需要桌面版', detail: 'Windows OCR 只在 Knitspace 桌面进程中运行。' }
  if (snapshot.ocrError) return { ...base, status: 'attention', statusLabel: '检查失败', detail: snapshot.ocrError }
  if (!snapshot.ocr) return { ...base, status: 'checking', statusLabel: '检查中', detail: '正在读取 Windows OCR 语言包。' }
  return snapshot.ocr.available
    ? { ...base, status: 'ready', statusLabel: `${snapshot.ocr.languageCount} 个语言包`, detail: snapshot.ocr.detail }
    : { ...base, status: 'attention', statusLabel: '缺少语言包', detail: snapshot.ocr.detail }
}

export function buildLabCapabilityCards(snapshot: LabCapabilitySnapshot): LabCapabilityCard[] {
  const outputReady = Boolean(snapshot.outputDirectory?.trim())
  const aiReady = snapshot.aiProfileCount > 0
  const clipboardStatus: LabCapabilityStatus = snapshot.clipboardEnabled && !snapshot.clipboardPaused ? 'ready' : 'off'
  return [
    vaultCard(snapshot),
    mediaCard(snapshot),
    {
      id: 'transcription', icon: 'file-text', title: '本机语音转写', description: '用你选择的 whisper.cpp CLI 与模型生成可校对 SRT，媒体不上传。',
      status: snapshot.transcriptionConfigured && snapshot.desktop ? 'ready' : 'attention', statusLabel: snapshot.transcriptionConfigured && snapshot.desktop ? '已配置' : '需要配置',
      detail: snapshot.transcriptionConfigured && snapshot.desktop ? 'CLI 与模型路径已保存；实际运行前仍会显示媒体、模型与输出位置供确认。' : '在设置中选择兼容 CLI 与本机模型；Knitspace 不捆绑模型，也不会自动执行所选程序。',
      to: snapshot.transcriptionConfigured ? '/subtitles?transcribe=1' : '/settings?section=engines', actionLabel: snapshot.transcriptionConfigured ? '打开本机转写' : '配置本机引擎',
    },
    ocrCard(snapshot),
    {
      id: 'output', icon: 'folder', title: '统一输出目录', description: '文件、图片、PDF、媒体和私人工具共享安全的新文件输出位置。',
      status: outputReady ? 'ready' : 'attention', statusLabel: outputReady ? '已设置' : '尚未设置',
      detail: outputReady ? snapshot.outputDirectory! : '首次导出时仍可临时选择，但固定目录更适合连续工作。',
      to: '/settings?section=config', actionLabel: '管理输出位置',
    },
    {
      id: 'ai', icon: 'sparkle', title: '自带凭据的 AI', description: '仅在你明确确认内容后调用配置的兼容 API。',
      status: aiReady ? 'ready' : 'off', statusLabel: aiReady ? `${snapshot.aiProfileCount} 个配置` : '未配置',
      detail: aiReady ? '配置元数据已保存；桌面密钥仍由 Windows 凭据库单独保管。' : '没有 API 配置时，其他本地功能仍可完整使用。',
      to: '/settings?section=ai', actionLabel: '管理 AI 配置',
    },
    {
      id: 'clipboard', icon: 'clipboard', title: '剪贴板监听', description: '仅在本机保存有界历史，可暂停、清空并设置保留天数。',
      status: clipboardStatus,
      statusLabel: snapshot.clipboardEnabled ? snapshot.clipboardPaused ? '已暂停' : '正在监听' : '未启用',
      detail: snapshot.clipboardEnabled ? snapshot.clipboardPaused ? '历史仍保留，但不会继续收集新内容。' : '监听已开启；敏感内容规则和保留策略可在设置中调整。' : '按需开启即可，不影响快速捕获和手动读取剪贴板。',
      to: '/settings?section=clipboard', actionLabel: '管理监听策略',
    },
  ]
}
