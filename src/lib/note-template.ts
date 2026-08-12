export type NoteStarterTemplateId = 'algorithm' | 'concept' | 'english' | 'mindmap' | 'diagram'

export interface NoteStarterTemplate {
  id: NoteStarterTemplateId
  label: string
  description: string
  title: string
  subject: string
  tags: readonly string[]
  sections: readonly string[]
}

// These templates deliberately cover note-taking workflows only. Vocabulary
// senses and review scheduling remain in the dedicated word-card space, while
// answer/error fields remain in the question space.
export const noteStarterTemplates = [
  {
    id: 'algorithm',
    label: '算法 / 代码记录',
    description: '题意、思路、正确性、复杂度与实现放在同一页。',
    title: '算法记录',
    subject: '算法',
    tags: ['算法', '待整理'],
    sections: [
      '> 用一句话写下问题与适用信号。',
      '',
      '## 问题与约束',
      '',
      '## 思路',
      '',
      '## 正确性 / 不变量',
      '',
      '## 复杂度',
      '',
      '## 实现',
      '',
      '~~~ts',
      '// 记录关键实现，而不是整段无关模板。',
      '~~~',
      '',
      '## 变式与关联',
      '- [[相关知识点]]',
    ],
  },
  {
    id: 'concept',
    label: '课程概念笔记',
    description: '把结论、推导、例子和易混淆点沉淀为可回看的结构。',
    title: '概念笔记',
    subject: '计算机',
    tags: ['课程', '待整理'],
    sections: [
      '> 先写一句自己的结论，再补充资料原文。',
      '',
      '## 核心结论',
      '',
      '## 推导 / 示例',
      '',
      '## 易混淆点',
      '',
      '## 待确认的问题',
      '',
      '## 关联知识',
      '- [[前置概念]]',
    ],
  },
  {
    id: 'english',
    label: '英语素材 / 句型',
    description: '保存语境、表达与易错点；单词词性和释义仍交给单词卡。',
    title: '英语素材',
    subject: '英语',
    tags: ['英语', '待整理'],
    sections: [
      '> 单词卡用于词性和释义；这里记录语境、句型与可复用表达。',
      '',
      '## 原句与语境',
      '',
      '## 表达拆解',
      '',
      '## 可替换表达',
      '',
      '## 易错点',
      '',
      '## 下次回顾',
    ],
  },
  {
    id: 'mindmap',
    label: '思维图谱骨架',
    description: '用 Markdown 标题维护可编辑、可搜索的 Markmap 图谱。',
    title: '思维图谱',
    subject: '未分类',
    tags: ['图谱', '待整理'],
    sections: [
      '> 标题就是节点；编辑层级后，图谱会按需重新生成。',
      '',
      '## 中心主题',
      '### 分支一',
      '- 关键点',
      '### 分支二',
      '- 关键点',
      '#### 继续展开',
      '- 细节',
    ],
  },
  {
    id: 'diagram',
    label: 'Mermaid 图表',
    description: '在普通 Markdown 中维护流程、时序和结构关系。',
    title: '流程与结构图',
    subject: '计算机',
    tags: ['图表', 'Mermaid'],
    sections: [
      '> 修改下面的 Mermaid 源码；图表只在进入视口后绘制。',
      '',
      '## 流程图',
      '',
      '~~~mermaid',
      'flowchart LR',
      '  A[输入] --> B{判断}',
      '  B -->|通过| C[处理]',
      '  B -->|返回| A',
      '  C --> D[输出]',
      '~~~',
      '',
      '## 说明',
      '- 右键图表可复制 Mermaid 源码或 SVG。',
    ],
  },
] as const satisfies readonly NoteStarterTemplate[]

export function noteTemplateContent(template: NoteStarterTemplate, title = template.title) {
  return ['# ' + title, '', ...template.sections, ''].join('\n')
}

// Wiki links use the note title as their portable target. A predictable
// suffix is better than silently creating several indistinguishable
// “算法记录” notes that later compete for the same link.
export function nextAvailableNoteTitle(proposed: string, existingTitles: Iterable<string>) {
  const base = proposed.trim() || '未命名笔记'
  const taken = new Set([...existingTitles].map((title) => title.trim().toLocaleLowerCase('zh-CN')))
  if (!taken.has(base.toLocaleLowerCase('zh-CN'))) return base

  for (let index = 2; index < 10_000; index += 1) {
    const candidate = base + ' ' + index
    if (!taken.has(candidate.toLocaleLowerCase('zh-CN'))) return candidate
  }
  return base + ' ' + Date.now()
}
