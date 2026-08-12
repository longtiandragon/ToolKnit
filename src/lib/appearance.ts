import type { ReadingDensity, ReadingScale, ReadingWidth, WorkbenchSettings } from '@/types'

const scaleValues: Record<ReadingScale, { reading: string; editor: string }> = {
  compact: { reading: '14px', editor: '12px' },
  comfortable: { reading: '16px', editor: '14px' },
  large: { reading: '18px', editor: '16px' },
}

const densityValues: Record<ReadingDensity, { reading: string; editor: string }> = {
  compact: { reading: '1.62', editor: '1.62' },
  comfortable: { reading: '1.78', editor: '1.72' },
  airy: { reading: '1.94', editor: '1.86' },
}

const widthValues: Record<ReadingWidth, string> = {
  focused: '680px',
  balanced: '860px',
  wide: '1040px',
}

export function appearanceVariables(settings: Pick<WorkbenchSettings, 'readingScale' | 'readingDensity' | 'readingWidth'>) {
  const scale = scaleValues[settings.readingScale] ?? scaleValues.comfortable
  const density = densityValues[settings.readingDensity] ?? densityValues.comfortable
  const width = widthValues[settings.readingWidth] ?? widthValues.balanced
  return {
    '--reading-font-size': scale.reading,
    '--editor-font-size': scale.editor,
    '--reading-line-height': density.reading,
    '--editor-line-height': density.editor,
    '--reading-max-width': width,
  }
}

export function appearanceClasses(settings: Pick<WorkbenchSettings, 'readingPaperTone' | 'reduceMotion'>) {
  const paperTone = ['warm', 'neutral', 'mist', 'night'].includes(settings.readingPaperTone) ? settings.readingPaperTone : 'warm'
  return [`reading-paper--${paperTone}`, { 'reduce-motion': settings.reduceMotion === true }]
}
