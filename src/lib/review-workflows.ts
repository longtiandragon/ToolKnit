export type ReviewWorkflowAction = {
  id: string
  label: string
  detail: string
  icon: string
  to: string
  group: 'question' | 'word'
}

/** Material-management tasks shown before the review card. Session filtering
 * remains in the review header; this catalog answers the different question
 * “how do I create or maintain the cards I am about to review?”. */
export const reviewWorkflowActions = [
  { id: 'new-question', label: '记录新错题', detail: '答案、解析与错因', icon: 'plus', to: '/documents?kind=question&create=question', group: 'question' },
  { id: 'import-questions', label: '批量导入题目', detail: '粘贴 TSV 或文本', icon: 'inbox', to: '/documents?kind=question&import=1', group: 'question' },
  { id: 'browse-questions', label: '管理题目卡', detail: '复习方向与难度', icon: 'review', to: '/documents?kind=question', group: 'question' },
  { id: 'new-word', label: '录入结构化单词', detail: '词性、义项与例句', icon: 'plus', to: '/words?action=create', group: 'word' },
  { id: 'import-words', label: '批量导入词表', detail: '合并重复词与义项', icon: 'inbox', to: '/words?import=1', group: 'word' },
  { id: 'browse-words', label: '管理单词卡', detail: '词义、拼写与例句', icon: 'sort', to: '/words', group: 'word' },
] as const satisfies readonly ReviewWorkflowAction[]

export function reviewWorkflowGroups(actions: readonly ReviewWorkflowAction[] = reviewWorkflowActions) {
  return {
    question: actions.filter(action => action.group === 'question'),
    word: actions.filter(action => action.group === 'word'),
  }
}
