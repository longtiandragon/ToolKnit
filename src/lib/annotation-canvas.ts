export type AnnotationKind = 'box' | 'arrow' | 'text' | 'mosaic' | 'pen'
export type CanvasTool = 'select' | AnnotationKind

/**
 * Geometry is stored as proportions of the composition, so annotations keep
 * their position when the desktop preview is resized and when a card exports
 * at a larger resolution.
 */
export interface CanvasAnnotation {
  id: number
  kind: AnnotationKind
  x: number
  y: number
  width?: number
  height?: number
  text: string
  color: string
  /** Clockwise degrees. Arrows encode their direction in their endpoints. */
  rotation?: number
  /** Freehand strokes (pen) store their path as proportional points. */
  points?: { x: number; y: number }[]
  /** Logical pen width at a 1000px-wide canvas; both preview and export
   *  scale it proportionally. */
  strokeWidth?: number
}

export type AnnotationLayerMove = 'forward' | 'backward' | 'front' | 'back'

const clamp = (value: number, minimum: number, maximum: number) => Math.max(minimum, Math.min(maximum, value))
const cleanFloatingZero = (value: number) => Math.abs(value) < 1e-9 ? 0 : value

export function normalizeAnnotationRotation(value: unknown) {
  const degrees = Number(value)
  if (!Number.isFinite(degrees)) return 0
  const normalized = ((degrees % 360) + 360) % 360
  const signed = normalized >= 180 ? normalized - 360 : normalized
  return Math.abs(signed) < .001 ? 0 : signed
}

export function normalizeAnnotation(annotation: CanvasAnnotation): CanvasAnnotation {
  const { rotation: rawRotation, ...rest } = annotation
  const x = clamp(annotation.x, 0, 1)
  const y = clamp(annotation.y, 0, 1)
  if (annotation.kind === 'pen') {
    const points = (annotation.points ?? []).map((point) => ({ x: clamp(point.x, 0, 1), y: clamp(point.y, 0, 1) }))
    return { ...rest, x, y, points, width: undefined, height: undefined }
  }
  const width = annotation.width ?? (annotation.kind === 'text' ? 0.19 : annotation.kind === 'arrow' ? 0.2 : 0.18)
  const height = annotation.height ?? (annotation.kind === 'text' ? 0.06 : annotation.kind === 'arrow' ? -0.15 : 0.15)

  if (annotation.kind === 'arrow') {
    return {
      ...rest,
      x,
      y,
      width: cleanFloatingZero(clamp(width, -x, 1 - x)),
      height: cleanFloatingZero(clamp(height, -y, 1 - y)),
    }
  }

  const safeWidth = clamp(width, 0.025, 1)
  const safeHeight = annotation.kind === 'text' ? clamp(height, 0.025, 0.25) : clamp(height, 0.025, 1)
  const normalized = {
    ...rest,
    x: clamp(x, 0, 1 - safeWidth),
    y: clamp(y, 0, 1 - safeHeight),
    width: safeWidth,
    height: safeHeight,
  }
  const rotation = normalizeAnnotationRotation(rawRotation)
  return rotation ? { ...normalized, rotation } : normalized
}

export function createAnnotation(input: Omit<CanvasAnnotation, 'id'> & { id?: number }) {
  return normalizeAnnotation({ ...input, id: input.id ?? Date.now() + Math.random() })
}

export function duplicateAnnotation(annotation: CanvasAnnotation, id = Date.now() + Math.random()) {
  const offset = 0.025
  return normalizeAnnotation({ ...annotation, id, x: annotation.x + offset, y: annotation.y + offset })
}

/** Reorder the immutable paint list. The end of the array is the top layer. */
export function moveAnnotationLayer(annotations: CanvasAnnotation[], id: number, move: AnnotationLayerMove) {
  const index = annotations.findIndex((annotation) => annotation.id === id)
  if (index < 0) return annotations
  const target = move === 'front'
    ? annotations.length - 1
    : move === 'back'
      ? 0
      : move === 'forward'
        ? Math.min(annotations.length - 1, index + 1)
        : Math.max(0, index - 1)
  if (target === index) return annotations
  const next = annotations.slice()
  const [annotation] = next.splice(index, 1)
  if (!annotation) return annotations
  next.splice(target, 0, annotation)
  return next
}

export function annotationLayerPosition(annotations: CanvasAnnotation[], id: number) {
  const index = annotations.findIndex((annotation) => annotation.id === id)
  return {
    index,
    count: annotations.length,
    canMoveForward: index >= 0 && index < annotations.length - 1,
    canMoveBackward: index > 0,
  }
}

/** Rotate boxes/text around their origin. An arrow keeps its tail pinned and
 * rotates the endpoint vector, which keeps the persisted format export-safe. */
export function rotateAnnotation(annotation: CanvasAnnotation, degrees: number) {
  if (!Number.isFinite(degrees) || degrees === 0) return annotation
  if (annotation.kind !== 'arrow') {
    return normalizeAnnotation({ ...annotation, rotation: normalizeAnnotationRotation((annotation.rotation ?? 0) + degrees) })
  }
  const radians = degrees * Math.PI / 180
  const width = annotation.width ?? .2
  const height = annotation.height ?? -.15
  return normalizeAnnotation({
    ...annotation,
    width: width * Math.cos(radians) - height * Math.sin(radians),
    height: width * Math.sin(radians) + height * Math.cos(radians),
  })
}

/**
 * Konva's Transformer keeps an Arrow's source points and applies its result
 * through the node transform. Persist the transformed endpoints instead of
 * those temporary scale/position values, so an arrow still points at the same
 * place when the preview is resized or exported at a different resolution.
 */
export function arrowFromCanvasEndpoints(
  annotation: CanvasAnnotation,
  start: { x: number; y: number },
  end: { x: number; y: number },
  canvas: { width: number; height: number },
) {
  const width = Number.isFinite(canvas.width) && canvas.width > 0 ? canvas.width : 1
  const height = Number.isFinite(canvas.height) && canvas.height > 0 ? canvas.height : 1
  return normalizeAnnotation({
    ...annotation,
    kind: 'arrow',
    x: start.x / width,
    y: start.y / height,
    width: (end.x - start.x) / width,
    height: (end.y - start.y) / height,
  })
}

/** Text is the only editable annotation payload. Keeping this operation pure
 * makes a small history snapshot instead of touching the source image or
 * rebuilding the canvas layer. */
export function updateAnnotationText(annotations: CanvasAnnotation[], id: number, text: string) {
  return annotations.map((annotation) => annotation.id === id && annotation.kind === 'text'
    ? { ...annotation, text }
    : annotation)
}
