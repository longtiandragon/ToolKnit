export type BlankCanvasPreset = {
  id: 'landscape' | 'square' | 'portrait'
  label: string
  detail: string
  width: number
  height: number
}

export const blankCanvasPresets: ReadonlyArray<BlankCanvasPreset> = [
  { id: 'landscape', label: '横向画布', detail: '1600 × 1000 · 笔记与演示', width: 1600, height: 1000 },
  { id: 'square', label: '方形画布', detail: '1080 × 1080 · 分享卡', width: 1080, height: 1080 },
  { id: 'portrait', label: '竖向画布', detail: '1080 × 1440 · 长内容', width: 1080, height: 1440 },
]

const blankCanvasPattern = /^knitspace-blank-(landscape|square|portrait)-(\d+)x(\d+)\.png$/i

export function blankCanvasFileName(preset: BlankCanvasPreset) {
  return `knitspace-blank-${preset.id}-${preset.width}x${preset.height}.png`
}

export function blankCanvasPresetFromName(name: string | undefined) {
  if (!name) return undefined
  const match = name.match(blankCanvasPattern)
  if (!match) return undefined
  const width = Number(match[2])
  const height = Number(match[3])
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 320 || height < 320 || width > 4096 || height > 4096) return undefined
  return blankCanvasPresets.find((preset) => preset.id === match[1] && preset.width === width && preset.height === height)
}

export function visualCanvasDimensions(layout: 'single' | 'pair' | 'grid', sourceName?: string) {
  const blank = layout === 'single' ? blankCanvasPresetFromName(sourceName) : undefined
  return blank ? { width: blank.width, height: blank.height } : { width: 1600, height: layout === 'single' ? 1100 : 1200 }
}

export function visualCanvasForeground(background: string) {
  const normalized = /^#[0-9a-f]{6}$/i.test(background) ? background.slice(1) : '172321'
  const channels = [0, 2, 4].map((offset) => {
    const value = Number.parseInt(normalized.slice(offset, offset + 2), 16) / 255
    return value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4
  })
  const luminance = channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722
  return luminance > .42
    ? { text: '#17352b', muted: '#47675b' }
    : { text: '#f4f7f2', muted: '#b8d1c4' }
}
