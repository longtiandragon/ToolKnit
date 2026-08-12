/**
 * Keeps image controls responsive while a user drags quality/size sliders.
 * Large source files get a little more settling time so only the last input
 * starts a decode and canvas encode on the main thread.
 */
export function imagePreviewDebounceMs(size: number) {
  if (size >= 16 * 1024 * 1024) return 320
  if (size >= 4 * 1024 * 1024) return 220
  return 120
}
