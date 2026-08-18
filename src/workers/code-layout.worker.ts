import { calculateCodeLayout, type CodeLayoutOptions } from '@/lib/code-layout'

type LayoutRequest = { id: number; source: string; options?: CodeLayoutOptions }

self.onmessage = ({ data }: MessageEvent<LayoutRequest>) => {
  self.postMessage({ id: data.id, layout: calculateCodeLayout(data.source, data.options ?? {}) })
}
