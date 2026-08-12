export type ClipboardFilter = 'all' | 'snippets' | 'text' | 'code' | 'image'
export type ClipboardRouteAction = 'capture' | 'create-snippet'

export interface ClipboardFilterOption {
  id: ClipboardFilter
  label: string
}

export const clipboardFilterOptions: readonly ClipboardFilterOption[] = [
  { id: 'all', label: '全部' },
  { id: 'snippets', label: '常用片段' },
  { id: 'text', label: '文本' },
  { id: 'code', label: '代码' },
  { id: 'image', label: '图片' },
]

export const clipboardEntryActions = [
  { id: 'capture' as const, label: '读取当前剪贴板', to: '/clipboard?action=capture', icon: 'clipboard' },
  { id: 'create-snippet' as const, label: '新建常用片段', to: '/clipboard?action=create-snippet', icon: 'plus' },
  { id: 'snippets' as const, label: '常用片段', to: '/clipboard?view=snippets', icon: 'star' },
] as const

export function clipboardFilterFromQuery(value: unknown): ClipboardFilter {
  return clipboardFilterOptions.some(option => option.id === value) ? value as ClipboardFilter : 'all'
}

export function clipboardRouteAction(value: unknown): ClipboardRouteAction | undefined {
  return value === 'capture' || value === 'create-snippet' ? value : undefined
}

export function toggleClipboardSelection(selected: ReadonlySet<string>, id: string) {
  const next = new Set(selected)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  return next
}

