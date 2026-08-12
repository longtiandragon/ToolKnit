type MermaidRenderer = {
  initialize: (config: Record<string, unknown>) => void
  render: (id: string, source: string) => Promise<{ svg: string }>
}

const SVG_CACHE_LIMIT = 24
const renderedSvgCache = new Map<string, string>()
const pendingRenders = new Map<string, Promise<string>>()

function diagramKey(source: string) {
  let hash = 2166136261
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return `${source.length}-${(hash >>> 0).toString(36)}`
}

function cacheSvg(key: string, svg: string) {
  renderedSvgCache.delete(key)
  renderedSvgCache.set(key, svg)
  if (renderedSvgCache.size > SVG_CACHE_LIMIT) {
    renderedSvgCache.delete(renderedSvgCache.keys().next().value as string)
  }
}

// Importing Mermaid at module evaluation time made every Markdown reader fetch
// its diagram engine, even for plain notes. Keep the promise cached, but begin
// the import only after a visible diagram asks to render.
let mermaidModule: Promise<MermaidRenderer> | undefined

function getMermaidModule() {
  mermaidModule ??= import('mermaid').then(({ default: mermaid }) => {
    const renderer = mermaid as MermaidRenderer
    renderer.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      theme: 'base',
      fontFamily: '"Segoe UI Variable Text", "Microsoft YaHei UI", sans-serif',
      themeVariables: {
        background: '#fffefa', primaryColor: '#e7f1ea', primaryBorderColor: '#0c6557', primaryTextColor: '#1a2723',
        secondaryColor: '#f5f7f3', tertiaryColor: '#fbfaf7', lineColor: '#4d5d57', textColor: '#1a2723',
        clusterBkg: '#f5f7f3', clusterBorder: '#88a697', edgeLabelBackground: '#fffefa'
      },
      flowchart: { useMaxWidth: true, htmlLabels: true, curve: 'basis' }
    })
    return renderer
  })
  return mermaidModule
}

export function decodeMermaidSource(encodedSource: string | undefined) {
  if (!encodedSource) return ''
  try {
    return decodeURIComponent(encodedSource)
  } catch {
    return ''
  }
}

export async function renderMermaidSource(source: string) {
  const key = diagramKey(source)
  const cached = renderedSvgCache.get(key)
  if (cached !== undefined) {
    renderedSvgCache.delete(key)
    renderedSvgCache.set(key, cached)
    return cached
  }

  const pending = pendingRenders.get(key)
  if (pending) return pending

  const task = getMermaidModule()
    .then((renderer) => renderer.render(`knitspace-mermaid-${key}`, source))
    .then(({ svg }) => {
      cacheSvg(key, svg)
      return svg
    })
    .finally(() => pendingRenders.delete(key))
  pendingRenders.set(key, task)
  return task
}
