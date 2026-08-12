export interface CreateQuickStart {
  id: string
  label: string
  detail: string
  icon: string
  to: string
}

export function recentCreateMenuHeight(kind: 'note' | 'visual') {
  const actionCount = kind === 'note' ? 6 : 2
  return 57 + actionCount * 55
}

export const createQuickStarts: readonly CreateQuickStart[] = [
  { id: 'markdown', label: '空白 Markdown', detail: '源码、分屏与阅读', icon: 'book', to: '/documents?kind=note&create=note' },
  { id: 'mindmap', label: '思维图谱', detail: 'Markdown 标题转 Markmap', icon: 'sort', to: '/documents?kind=note&template=mindmap&mode=mindmap' },
  { id: 'mermaid', label: 'Mermaid 图表', detail: '流程、时序、类图与 ER', icon: 'split', to: '/documents?kind=note&template=diagram&mode=split' },
  { id: 'formula', label: 'LaTeX 公式', detail: '即时预览与图片识别', icon: 'math', to: '/documents?kind=note&create=note&mode=split&insert=formula' },
  { id: 'visual', label: '图片标注', detail: '箭头、文字、拼图与水印', icon: 'palette', to: '/visual' },
  { id: 'stitch', label: '滚动长图', detail: '连续截图自动识别重叠', icon: 'image', to: '/visual?tool=stitch' },
  { id: 'code', label: '代码长图', detail: '高亮、自动分页与 PDF', icon: 'terminal', to: '/code-image' },
  { id: 'ai', label: 'AI 内容处理', detail: '摘要、翻译与结构提取', icon: 'sparkle', to: '/ai' },
]
