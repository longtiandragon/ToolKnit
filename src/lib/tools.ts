import type { ToolAction } from '@/types'

export const toolActions: ToolAction[] = [
  { id: 'create-note', title: '整理为笔记', description: '保留原资料、页码和选区来源', accepts: ['image', 'pdf', 'code', 'text'] },
  { id: 'create-question', title: '整理为错题', description: '保留来源并套用错题模板', accepts: ['image', 'pdf', 'code', 'text'] },
  { id: 'image-edit', title: '图片标注与编辑', description: '带入裁剪、箭头、文字与拼图', accepts: ['image'] },
  { id: 'ocr', title: '离线识别文字', description: '用 Windows 本机语言包提取图片文字', accepts: ['image'] },
  { id: 'formula', title: '整理公式草稿', description: '保留图片或 PDF 来源，打开 LaTeX 即时预览', accepts: ['image', 'pdf'] },
  { id: 'code-image', title: '导出长代码图', description: '自动按行分页，绝不截断', accepts: ['code', 'text'] },
  { id: 'batch', title: '带入文件工具', description: '带入当前图片或 PDF，并继续选择操作', accepts: ['image', 'pdf'] }
]
