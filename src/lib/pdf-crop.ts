export interface PdfCropBox {
  x: number
  y: number
  width: number
  height: number
}

export function calculatePdfCropBox(pageWidth: number, pageHeight: number, left: number, top: number, width: number, height: number): PdfCropBox {
  if (![pageWidth, pageHeight, left, top, width, height].every(Number.isFinite) || pageWidth <= 0 || pageHeight <= 0) {
    throw new Error('PDF 页面尺寸或裁剪参数无效。')
  }
  if (left < 0 || top < 0 || width <= 0 || height <= 0 || left + width > 100 || top + height > 100) {
    throw new Error('PDF 裁剪区域必须位于页面内：起点不小于 0%，宽高大于 0%，且不能超过 100%。')
  }
  return {
    x: pageWidth * left / 100,
    y: pageHeight * (100 - top - height) / 100,
    width: pageWidth * width / 100,
    height: pageHeight * height / 100,
  }
}
