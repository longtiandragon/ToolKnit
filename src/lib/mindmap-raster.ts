export const MAX_MINDMAP_PNG_SIDE = 4096
export const MAX_MINDMAP_PNG_PIXELS = 16_000_000

export interface RasterDimensions {
  width: number
  height: number
  scale: number
  limited: boolean
}

/**
 * Computes a crisp desktop export without allocating an unbounded canvas.
 * The bound is deliberately shared by the copy path so a huge Markdown graph
 * cannot turn a simple right-click action into a renderer-memory spike.
 */
export function mindmapRasterDimensions(width: number, height: number, pixelRatio = 1): RasterDimensions {
  const sourceWidth = Number.isFinite(width) ? Math.max(1, Math.round(width)) : 1
  const sourceHeight = Number.isFinite(height) ? Math.max(1, Math.round(height)) : 1
  const requestedScale = Math.min(2, Math.max(1, Number.isFinite(pixelRatio) ? pixelRatio : 1))
  const sideScale = Math.min(MAX_MINDMAP_PNG_SIDE / sourceWidth, MAX_MINDMAP_PNG_SIDE / sourceHeight)
  const pixelScale = Math.sqrt(MAX_MINDMAP_PNG_PIXELS / (sourceWidth * sourceHeight))
  const scale = Math.min(requestedScale, sideScale, pixelScale)
  const outputWidth = Math.max(1, Math.floor(sourceWidth * scale))
  const outputHeight = Math.max(1, Math.floor(sourceHeight * scale))
  return {
    width: outputWidth,
    height: outputHeight,
    scale,
    limited: scale < requestedScale,
  }
}
