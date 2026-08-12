import { calculateCodeLayout } from '@/lib/code-layout'

type LayoutRequest = { id: number; source: string }

self.onmessage = ({ data }: MessageEvent<LayoutRequest>) => {
  self.postMessage({ id: data.id, layout: calculateCodeLayout(data.source) })
}
