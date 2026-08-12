import type { Source, SourceAnchor } from '@/types'

export interface FormulaDraftScaffold {
  title: string
  folder: string
  subject: string
  tags: string[]
  content: string
  sourceAnchor: SourceAnchor
}

/** Turn an existing local source into an editable LaTeX workflow. The source
 * remains linked; an image is sent only from the explicit recognition action. */
export function formulaDraftScaffold(source: Source, anchor?: SourceAnchor): FormulaDraftScaffold {
  const baseName = source.name.replace(/\.[^.]+$/, '').trim() || '未命名资料'
  const title = `公式草稿 · ${baseName}`.slice(0, 100)
  return {
    title,
    folder: '数学/公式',
    subject: '数学',
    tags: ['公式', '待整理'],
    content: `# ${title}\n\n> 来源：${source.name}\n> 当前使用可校对的 LaTeX 编辑器；图片只有在你明确确认后才会发送到选定服务。\n\n## 公式\n\n`,
    sourceAnchor: anchor ?? { sourceId: source.id, pageIndex: 0, bbox: [0, 0, 1, 1] },
  }
}
