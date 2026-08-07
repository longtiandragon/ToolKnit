import type { ToolAction } from '@/types'

export const toolActions: ToolAction[] = [
  { id: 'create-question', title: '整理为错题', description: '保留来源并套用错题模板', accepts: ['image', 'pdf', 'code', 'text'] },
  { id: 'ocr', title: '识别文字', description: '框选或导入后识别中英文', accepts: ['image', 'pdf'], requiresEngine: 'ocr' },
  { id: 'formula', title: '识别公式', description: '将公式区域转换为可编辑 LaTeX', accepts: ['image', 'pdf'], requiresEngine: 'formula' },
  { id: 'code-image', title: '导出长代码图', description: '自动按行分页，绝不截断', accepts: ['code', 'text'] },
  { id: 'batch', title: '加入文档批处理', description: '合并、拆分、旋转或批量 OCR', accepts: ['image', 'pdf'] }
]
