import { normalizeAnnotation, type CanvasAnnotation } from './annotation-canvas'

export type VisualProjectLayout = 'single' | 'pair' | 'grid'

export interface VisualProjectSignatureInput {
  title: string
  canvasTitle: string
  layout: VisualProjectLayout
  background: string
  watermark: string
  annotations: CanvasAnnotation[]
  images: Pick<File, 'name' | 'size' | 'type' | 'lastModified'>[]
}

export interface VisualProjectDiscoveryItem {
  id: string
  title: string
  imageCount: number
  annotationCount: number
  updatedAt: string
}

const visualProjectAliases = '画布 图片 图像 标注 箭头 文本 拼图 创作 项目 image canvas annotation collage visual'

/** Search only the small project summaries returned by SQLite. Image bytes stay
 * out of Ctrl+K and the Create space, so discovery does not compete with typing. */
export function discoverVisualProjects<T extends VisualProjectDiscoveryItem>(projects: T[], query = '', limit = 8): T[] {
  const terms = query.trim().toLocaleLowerCase('zh-CN').split(/\s+/).filter(Boolean)
  return projects
    .filter((project) => {
      if (!terms.length) return true
      const haystack = `${project.title} ${visualProjectAliases}`.toLocaleLowerCase('zh-CN')
      return terms.every((term) => haystack.includes(term))
    })
    .slice()
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .slice(0, Math.max(0, Math.trunc(limit)))
}

export function visualProjectRoute(id: string) {
  return { path: '/visual', query: { project: id } }
}

function finite(value: unknown, fallback = 0) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

/** Native metadata is untrusted at the renderer boundary. Normalize geometry
 * before giving it to Konva and bound text/color payloads so a damaged project
 * cannot produce a huge canvas update. */
export function normalizeVisualProjectAnnotations(value: unknown): CanvasAnnotation[] {
  if (!Array.isArray(value)) return []
  return value.slice(0, 500).flatMap((candidate, index) => {
    if (!candidate || typeof candidate !== 'object') return []
    const record = candidate as Record<string, unknown>
    const kind = record.kind
    if (kind !== 'box' && kind !== 'arrow' && kind !== 'text') return []
    return [normalizeAnnotation({
      id: finite(record.id, Date.now() + index),
      kind,
      x: finite(record.x),
      y: finite(record.y),
      width: record.width === undefined ? undefined : finite(record.width),
      height: record.height === undefined ? undefined : finite(record.height),
      rotation: record.rotation === undefined ? undefined : finite(record.rotation),
      text: String(record.text ?? '').slice(0, 80),
      color: /^#[\da-f]{6}$/i.test(String(record.color ?? '')) ? String(record.color) : '#ffbf69',
    })]
  })
}

/** A metadata-only signature avoids hashing or rereading image bytes while the
 * user types. File identity plus immutable annotation snapshots is sufficient
 * for an honest unsaved-change indicator within one editor session. */
export function visualProjectSignature(input: VisualProjectSignatureInput) {
  return JSON.stringify({
    title: input.title.trim(),
    canvasTitle: input.canvasTitle,
    layout: input.layout,
    background: input.background,
    watermark: input.watermark,
    annotations: input.annotations,
    images: input.images.map(({ name, size, type, lastModified }) => ({ name, size, type, lastModified })),
  })
}
