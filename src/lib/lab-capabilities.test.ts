import { describe, expect, it } from 'vitest'
import { buildLabCapabilityCards, type LabCapabilitySnapshot } from './lab-capabilities'

function snapshot(overrides: Partial<LabCapabilitySnapshot> = {}): LabCapabilitySnapshot {
  return {
    desktop: true,
    vault: { integrity: 'ok', schemaVersion: 9, latestSchemaVersion: 9, missingMarkdownCount: 0, noteCount: 12, questionCount: 4, vocabularyCount: 30, ftsEntryCount: 46 },
    storage: { availableBytes: 80 * 1024 ** 3, totalBytes: 500 * 1024 ** 3 },
    media: { available: true, version: 'ffmpeg 8.0' },
    ocr: { available: true, languageCount: 2, defaultLanguage: 'zh-Hans', detail: 'Windows 本机 OCR 已就绪，共 2 个语言包；图片不会离开本机。' },
    outputDirectory: 'F:\\Exports',
    transcriptionConfigured: true,
    aiProfileCount: 1,
    clipboardEnabled: true,
    clipboardPaused: false,
    ...overrides,
  }
}

describe('lab capability cards', () => {
  it('reports real ready details without merging independent capabilities', () => {
    const cards = buildLabCapabilityCards(snapshot())
    expect(cards.map((card) => [card.id, card.status])).toEqual([
      ['vault', 'ready'], ['media', 'ready'], ['transcription', 'ready'], ['ocr', 'ready'], ['output', 'ready'], ['ai', 'ready'], ['clipboard', 'ready'],
    ])
    expect(cards[0]?.detail).toContain('46 条索引')
    expect(cards[0]?.detail).toContain('可用 80.0 GB')
    expect(cards[1]?.detail).toBe('ffmpeg 8.0')
    expect(cards[2]?.statusLabel).toBe('已配置')
    expect(cards[3]?.statusLabel).toBe('2 个语言包')
  })

  it('keeps asynchronous native checks visibly pending', () => {
    const cards = buildLabCapabilityCards(snapshot({ vault: undefined, media: undefined, ocr: undefined }))
    expect(cards.find((card) => card.id === 'vault')?.statusLabel).toBe('检查中')
    expect(cards.find((card) => card.id === 'media')?.statusLabel).toBe('检查中')
    expect(cards.find((card) => card.id === 'ocr')?.statusLabel).toBe('检查中')
    expect(cards.find((card) => card.id === 'transcription')?.statusLabel).toBe('已配置')
  })

  it('distinguishes missing, paused and damaged states with text', () => {
    const cards = buildLabCapabilityCards(snapshot({
      vault: { integrity: 'ok', schemaVersion: 8, latestSchemaVersion: 9, missingMarkdownCount: 2, noteCount: 1, questionCount: 0, vocabularyCount: 0, ftsEntryCount: 1 },
      media: { available: false }, outputDirectory: '', transcriptionConfigured: false, aiProfileCount: 0, clipboardPaused: true,
    }))
    expect(cards.find((card) => card.id === 'vault')).toMatchObject({ status: 'attention', statusLabel: '需要处理' })
    expect(cards.find((card) => card.id === 'media')).toMatchObject({ status: 'attention', statusLabel: '未检测到' })
    expect(cards.find((card) => card.id === 'transcription')).toMatchObject({ status: 'attention', statusLabel: '需要配置' })
    expect(cards.find((card) => card.id === 'output')?.statusLabel).toBe('尚未设置')
    expect(cards.find((card) => card.id === 'ai')?.status).toBe('off')
    expect(cards.find((card) => card.id === 'clipboard')?.statusLabel).toBe('已暂停')
  })

  it('prioritizes a write-starved disk even when SQLite cannot open', () => {
    const cards = buildLabCapabilityCards(snapshot({
      vault: undefined,
      vaultError: 'database or disk is full',
      storage: { availableBytes: 120 * 1024 ** 2, totalBytes: 360 * 1024 ** 3 },
    }))
    expect(cards.find((card) => card.id === 'vault')).toMatchObject({ status: 'attention', statusLabel: '磁盘严重不足' })
    expect(cards.find((card) => card.id === 'vault')?.detail).toContain('120 MB')
  })
})
