export type KnowledgeAreaId = 'note' | 'question' | 'word' | 'source'

export type KnowledgeWorkflowAction = {
  id: string
  area: KnowledgeAreaId
  label: string
  detail: string
  icon: string
  to: string
}

/** Canonical knowledge-entry actions shared by the visible task strip and the
 * category context menus. Keeping the routes here prevents those two desktop
 * surfaces from drifting apart as import workflows evolve. */
export const knowledgeWorkflowActions = [
  { id: 'new-note', area: 'note', label: '新建 Markdown', detail: '从空白笔记开始', icon: 'plus', to: '/documents?kind=note&create=note' },
  { id: 'open-markdown', area: 'note', label: '打开本机 Markdown', detail: '保持与 Typora 兼容', icon: 'folder-open', to: '/documents?kind=note&action=open-file' },
  { id: 'new-question', area: 'question', label: '记录一道错题', detail: '答案、解析与错因', icon: 'review', to: '/documents?kind=question&create=question' },
  { id: 'import-questions', area: 'question', label: '批量导入题目', detail: '粘贴 TSV 或文本', icon: 'inbox', to: '/documents?kind=question&import=1' },
  { id: 'new-word', area: 'word', label: '录入结构化单词', detail: '词性、义项与例句', icon: 'plus', to: '/words?action=create' },
  { id: 'import-words', area: 'word', label: '批量导入词表', detail: '合并重复词与义项', icon: 'inbox', to: '/words?import=1' },
  { id: 'collect-source', area: 'source', label: '收进一份资料', detail: 'PDF、图片与代码', icon: 'attachment', to: '/library' },
  { id: 'review-knowledge', area: 'source', label: '复习到期内容', detail: '单词与题目共用队列', icon: 'review', to: '/review' },
] as const satisfies readonly KnowledgeWorkflowAction[]

const browseActions: Record<KnowledgeAreaId, KnowledgeWorkflowAction> = {
  note: { id: 'browse-notes', area: 'note', label: '浏览 Markdown 笔记', detail: '源码、分栏、阅读与图谱', icon: 'book', to: '/documents?kind=note' },
  question: { id: 'browse-questions', area: 'question', label: '浏览题目与错题', detail: '按分类与难度查找', icon: 'review', to: '/documents?kind=question' },
  word: { id: 'browse-words', area: 'word', label: '浏览结构化单词', detail: '查找词形、词义与例句', icon: 'sort', to: '/words' },
  source: { id: 'browse-sources', area: 'source', label: '浏览资料与摘录', detail: '查看本地原件与来源', icon: 'inbox', to: '/library' },
}

const areaActionIds: Record<KnowledgeAreaId, readonly string[]> = {
  note: ['new-note', 'open-markdown'],
  question: ['new-question', 'import-questions'],
  word: ['new-word', 'import-words'],
  source: ['collect-source', 'review-knowledge'],
}

export function knowledgeAreaActions(area: KnowledgeAreaId) {
  const byId = new Map<string, KnowledgeWorkflowAction>(knowledgeWorkflowActions.map(action => [action.id, action]))
  return [browseActions[area], ...areaActionIds[area].flatMap(id => byId.get(id) ?? [])]
}

export function documentKnowledgeAction(action: unknown, kind: unknown) {
  return action === 'open-file' && kind === 'note' ? 'open-file' as const : undefined
}

export function vocabularyKnowledgeAction(action: unknown) {
  return action === 'create' ? 'create' as const : undefined
}
