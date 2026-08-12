export const MAX_PREVIEW_PIXELS = 12_000_000
export const MAX_PREVIEW_EDGE = 8192

/**
 * Keep a single source preview sharp on a desktop display without allowing a
 * malformed scan to allocate an unbounded canvas. The same calculation works
 * for PDF pages and imported images.
 */
export function fitCanvasPreviewScale(
  width: number,
  height: number,
  requestedScale = 1,
  maxPixels = MAX_PREVIEW_PIXELS,
  maxEdge = MAX_PREVIEW_EDGE,
) {
  const safeWidth = Number.isFinite(width) && width > 0 ? width : 1
  const safeHeight = Number.isFinite(height) && height > 0 ? height : 1
  const safeRequested = Number.isFinite(requestedScale) && requestedScale > 0 ? requestedScale : 1
  const safePixels = Number.isFinite(maxPixels) && maxPixels > 0 ? maxPixels : MAX_PREVIEW_PIXELS
  const safeEdge = Number.isFinite(maxEdge) && maxEdge > 0 ? maxEdge : MAX_PREVIEW_EDGE

  const areaScale = Math.sqrt(safePixels / (safeWidth * safeHeight))
  const edgeScale = safeEdge / Math.max(safeWidth, safeHeight)
  return Math.min(safeRequested, areaScale, edgeScale)
}
