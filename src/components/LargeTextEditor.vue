<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { EditorSelection, EditorState } from '@codemirror/state'
import { defaultKeymap, history, historyKeymap, indentWithTab, redo as redoHistory, undo as undoHistory } from '@codemirror/commands'
import { drawSelection, dropCursor, EditorView, highlightActiveLine, keymap, placeholder as editorPlaceholder } from '@codemirror/view'
import { closeSearchPanel, highlightSelectionMatches, openSearchPanel, search, searchKeymap } from '@codemirror/search'
import { scrollOffset, scrollProgress } from '@/lib/scroll-sync'
import { applyMarkdownCodeBlock, applyMarkdownEdit, isMarkdownLineCommand, markdownLinePrefixLength, markdownLineQueryRange, type MarkdownEditCommand } from '@/lib/markdown-edit'
import { placeMarkdownBlock, type MarkdownInsertion } from '@/lib/markdown-insert'
import { editorClipboardShortcut, isContextMenuShortcut } from '@/lib/desktop-menu'
import { htmlToMarkdown } from '@/lib/html-to-markdown'
import { detectMarkdownEditorContext, type MarkdownEditorContextSnapshot } from '@/lib/markdown-editor-context'

export type RichPasteResult = { inserted: boolean; converted: boolean; truncated: boolean; markdownLength: number }
export type { MarkdownEditorContextSnapshot } from '@/lib/markdown-editor-context'

const props = withDefaults(defineProps<{
  modelValue: string
  documentId?: string
  ariaLabel?: string
  placeholder?: string
  debounceMs?: number
  focusOnMount?: boolean
  searchRequest?: number
  scrollTarget?: { line: number; query?: string; revision: number }
}>(), { ariaLabel: '文本编辑器', placeholder: '', debounceMs: 120, focusOnMount: false, searchRequest: 0, scrollTarget: undefined })

const emit = defineEmits<{
  'update:modelValue': [value: string, documentId?: string]
  blur: []
  focused: []
  'scroll-progress': [progress: number]
  'context-menu': [x: number, y: number, hasSelection: boolean, context: MarkdownEditorContextSnapshot]
  'paste-image': []
  'paste-rich': [result: RichPasteResult]
  'pending-change': []
}>()

const host = ref<HTMLElement>()
let view: EditorView | undefined
let emitTimer: number | undefined
let lastEmitted: string | undefined
let pendingChange = false
let applyingExternalValue = false
let scrollFrame: number | undefined
let suppressScrollEvent = false

function flush() {
  if (emitTimer !== undefined) window.clearTimeout(emitTimer)
  emitTimer = undefined
  if (!view) return props.modelValue
  const value = view.state.doc.toString()
  pendingChange = false
  lastEmitted = value
  emit('update:modelValue', value, props.documentId)
  return value
}

function scheduleEmit() {
  if (!pendingChange) {
    pendingChange = true
    emit('pending-change')
  }
  if (emitTimer !== undefined) window.clearTimeout(emitTimer)
  emitTimer = window.setTimeout(flush, props.debounceMs)
}

function getValue() {
  return view?.state.doc.toString() ?? props.modelValue
}

function focusLine(line: number | undefined, query?: string) {
  if (!view || !line || line < 1) return
  const targetLine = Math.min(Math.max(1, Math.round(line)), view.state.doc.lines)
  const lineInfo = view.state.doc.line(targetLine)
  const match = markdownLineQueryRange(lineInfo.text, query)
  const from = lineInfo.from + (match?.from ?? 0)
  const to = lineInfo.from + (match?.to ?? 0)
  view.dispatch({
    selection: match ? EditorSelection.range(from, to) : EditorSelection.cursor(from),
    effects: EditorView.scrollIntoView(from, { y: 'center', yMargin: 48 }),
  })
  view.focus()
}

function focus() {
  view?.focus()
}

function undo() {
  if (!view) return false
  const changed = undoHistory(view)
  if (changed) view.focus()
  return changed
}

function redo() {
  if (!view) return false
  const changed = redoHistory(view)
  if (changed) view.focus()
  return changed
}

function selectAll() {
  if (!view || !view.state.doc.length) return false
  view.dispatch({ selection: EditorSelection.range(0, view.state.doc.length) })
  view.focus()
  return true
}

function focusAtCoordinates(x: number, y: number) {
  if (!view) return false
  const position = view.posAtCoords({ x, y })
  if (position === null) return false
  view.dispatch({ selection: EditorSelection.cursor(position), scrollIntoView: true })
  view.focus()
  return true
}

function openSearch() {
  return view ? openSearchPanel(view) : false
}

function closeSearch() {
  return view ? closeSearchPanel(view) : false
}

function insertText(text: string) {
  if (!view || !text) return false
  const selection = view.state.selection.main
  view.dispatch({
    changes: { from: selection.from, to: selection.to, insert: text },
    selection: EditorSelection.cursor(selection.from + text.length),
    scrollIntoView: true,
  })
  view.focus()
  return true
}

function insertStructured(insertion: MarkdownInsertion, block = true) {
  if (!view || !insertion.text) return false
  const selection = view.state.selection.main
  const prepared = block
    ? placeMarkdownBlock(view.state.doc.toString(), selection.from, selection.to, insertion)
    : insertion
  view.dispatch({
    changes: { from: selection.from, to: selection.to, insert: prepared.text },
    selection: EditorSelection.range(selection.from + prepared.selectionStart, selection.from + prepared.selectionEnd),
    scrollIntoView: true,
  })
  view.focus()
  return true
}

function commandSelection(command: MarkdownEditCommand) {
  if (!view) return
  const selection = view.state.selection.main
  if (!isMarkdownLineCommand(command)) return { from: selection.from, to: selection.to, text: view.state.sliceDoc(selection.from, selection.to), selection }
  const startLine = view.state.doc.lineAt(selection.from)
  const endPosition = selection.to > selection.from && selection.to === view.state.doc.lineAt(selection.to).from ? selection.to - 1 : selection.to
  const endLine = view.state.doc.lineAt(Math.max(selection.from, endPosition))
  return { from: startLine.from, to: endLine.to, text: view.state.sliceDoc(startLine.from, endLine.to), selection }
}

function applyMarkdownCommand(command: MarkdownEditCommand) {
  if (!view) return
  const target = commandSelection(command)
  if (!target) return
  const result = applyMarkdownEdit(command, target.text)
  let anchor = target.from + result.selectionStart
  let head = target.from + result.selectionEnd
  if (isMarkdownLineCommand(command) && target.selection.empty) {
    const oldPrefix = markdownLinePrefixLength(command, target.text)
    const newPrefix = markdownLinePrefixLength(command, result.text)
    const oldOffset = target.selection.head - target.from
    anchor = head = target.from + Math.min(result.text.length, Math.max(newPrefix, oldOffset + newPrefix - oldPrefix))
  }
  view.dispatch({
    changes: { from: target.from, to: target.to, insert: result.text },
    selection: EditorSelection.range(anchor, head),
    scrollIntoView: true,
  })
  view.focus()
}

function selectionText() {
  if (!view) return ''
  const selection = view.state.selection.main
  return view.state.sliceDoc(selection.from, selection.to)
}

function getSelectedText() {
  return selectionText()
}

function deleteSelection() {
  if (!view) return false
  const selection = view.state.selection.main
  if (selection.empty) return false
  view.dispatch({ changes: { from: selection.from, to: selection.to }, selection: EditorSelection.cursor(selection.from) })
  view.focus()
  return true
}

function insertCodeBlock(language = '') {
  if (!view) return false
  const selection = view.state.selection.main
  const result = applyMarkdownCodeBlock(view.state.sliceDoc(selection.from, selection.to), language)
  view.dispatch({
    changes: { from: selection.from, to: selection.to, insert: result.text },
    selection: EditorSelection.range(selection.from + result.selectionStart, selection.from + result.selectionEnd),
    scrollIntoView: true,
  })
  view.focus()
  return true
}

async function copySelection() {
  const text = selectionText()
  if (!text) return false
  await navigator.clipboard.writeText(text)
  return true
}

async function cutSelection() {
  if (!view) return false
  const selection = view.state.selection.main
  const text = view.state.sliceDoc(selection.from, selection.to)
  if (!text) return false
  await navigator.clipboard.writeText(text)
  view.dispatch({ changes: { from: selection.from, to: selection.to }, selection: EditorSelection.cursor(selection.from) })
  view.focus()
  return true
}

async function pasteClipboard() {
  if (!view) return false
  const text = await navigator.clipboard.readText()
  if (!text) return false
  const selection = view.state.selection.main
  view.dispatch({ changes: { from: selection.from, to: selection.to, insert: text }, selection: EditorSelection.cursor(selection.from + text.length) })
  view.focus()
  return true
}

function insertRichClipboard(html: string, plainText = ''): RichPasteResult {
  const converted = htmlToMarkdown(html)
  const text = converted.rich && converted.markdown ? converted.markdown : plainText
  const inserted = insertText(text)
  const result = { inserted, converted: inserted && converted.rich, truncated: inserted && converted.truncated, markdownLength: inserted ? text.length : 0 }
  if (inserted) emit('paste-rich', result)
  return result
}

async function pasteRichClipboard(): Promise<RichPasteResult> {
  const clipboard = navigator.clipboard
  if (typeof clipboard.read === 'function') {
    try {
      const items = await clipboard.read()
      for (const item of items) {
        if (!item.types.includes('text/html')) continue
        const html = await (await item.getType('text/html')).text()
        const plain = item.types.includes('text/plain') ? await (await item.getType('text/plain')).text() : ''
        return insertRichClipboard(html, plain)
      }
    } catch { /* Some WebView clipboard backends expose read() but only permit readText(). */ }
  }
  const inserted = await pasteClipboard()
  return { inserted, converted: false, truncated: false, markdownLength: 0 }
}

function pasteContainsImage(event: ClipboardEvent) {
  const clipboard = event.clipboardData
  if (!clipboard) return false
  return [...clipboard.items].some((item) => item.kind === 'file' && item.type.startsWith('image/'))
    || [...clipboard.files].some((file) => file.type.startsWith('image/'))
}

function handlePaste(event: ClipboardEvent) {
  if (pasteContainsImage(event)) {
    event.preventDefault()
    event.stopPropagation()
    emit('paste-image')
    return true
  }
  const html = event.clipboardData?.getData('text/html') ?? ''
  if (!html) return false
  const converted = htmlToMarkdown(html)
  if (!converted.rich || !converted.markdown) return false
  event.preventDefault()
  event.stopPropagation()
  const inserted = insertText(converted.markdown)
  if (inserted) emit('paste-rich', { inserted, converted: true, truncated: converted.truncated, markdownLength: converted.markdown.length })
  return inserted
}

function handleEditorKeydown(event: KeyboardEvent) {
  if (isContextMenuShortcut(event)) return openContextMenu(event)
  const shortcut = editorClipboardShortcut(event)
  if (!shortcut) return false
  event.preventDefault()
  const action = shortcut === 'copy-markdown' ? copySelection() : pasteClipboard()
  void action.catch(() => false)
  return true
}

function openContextMenu(event: MouseEvent | KeyboardEvent) {
  if (!view) return false
  event.preventDefault()
  event.stopPropagation()
  let selection = view.state.selection.main
  if (event instanceof MouseEvent) {
    const clickedPosition = view.posAtCoords({ x: event.clientX, y: event.clientY })
    if (clickedPosition !== null && (selection.empty || clickedPosition < selection.from || clickedPosition > selection.to)) {
      view.dispatch({ selection: EditorSelection.cursor(clickedPosition) })
      selection = view.state.selection.main
    }
  }
  const cursor = view.coordsAtPos(selection.head)
  const bounds = host.value?.getBoundingClientRect()
  const x = 'clientX' in event && event.clientX ? event.clientX : cursor?.left ?? bounds?.left ?? 16
  const y = 'clientY' in event && event.clientY ? event.clientY : cursor?.bottom ?? bounds?.top ?? 16
  const activeLine = view.state.doc.lineAt(selection.head)
  const windowStart = Math.max(1, activeLine.number - 240)
  const windowEnd = Math.min(view.state.doc.lines, activeLine.number + 240)
  const nearbyLines: string[] = []
  for (let lineNumber = windowStart; lineNumber <= windowEnd; lineNumber += 1) nearbyLines.push(view.state.doc.line(lineNumber).text)
  const selectedText = selection.empty ? '' : view.state.sliceDoc(selection.from, Math.min(selection.to, selection.from + 120_001))
  const context = detectMarkdownEditorContext(nearbyLines, activeLine.number - windowStart, selection.head - activeLine.from, activeLine.number, selectedText)
  emit('context-menu', x, y, !selection.empty, context)
  return true
}

function handleEditorScroll() {
  if (suppressScrollEvent || scrollFrame !== undefined || !view) return
  scrollFrame = window.requestAnimationFrame(() => {
    scrollFrame = undefined
    if (!view) return
    const scroller = view.scrollDOM
    emit('scroll-progress', scrollProgress(scroller.scrollTop, scroller.scrollHeight, scroller.clientHeight))
  })
}

function setScrollProgress(progress: number) {
  if (!view) return
  const scroller = view.scrollDOM
  const next = scrollOffset(progress, scroller.scrollHeight, scroller.clientHeight)
  if (Math.abs(scroller.scrollTop - next) < 1) return
  suppressScrollEvent = true
  scroller.scrollTop = next
  window.requestAnimationFrame(() => { suppressScrollEvent = false })
}

defineExpose({ flush, getValue, getSelectedText, focusLine, focus, undo, redo, selectAll, focusAtCoordinates, openSearch, closeSearch, insertText, insertStructured, insertCodeBlock, deleteSelection, setScrollProgress, applyMarkdownCommand, copySelection, cutSelection, pasteClipboard, pasteRichClipboard })

onMounted(() => {
  if (!host.value) return
  view = new EditorView({
    parent: host.value,
    state: EditorState.create({
      doc: props.modelValue,
      extensions: [
        history(),
        drawSelection(),
        dropCursor(),
        highlightActiveLine(),
        search({ top: true }),
        highlightSelectionMatches({ minSelectionLength: 2, maxMatches: 180 }),
        EditorState.phrases.of({
          Find: '查找',
          Replace: '替换为',
          next: '下一个',
          previous: '上一个',
          all: '全选匹配',
          'match case': '区分大小写',
          regexp: '正则',
          'by word': '整词',
          replace: '替换',
          'replace all': '全部替换',
          close: '关闭查找',
          'current match': '当前匹配',
          'on line': '位于第',
          'replaced match on line $': '已替换第 $ 行的匹配',
          'replaced $ matches': '已替换 $ 处匹配',
          'Go to line': '跳转到行',
          go: '跳转',
        }),
        keymap.of([
          { key: 'Mod-b', run: () => { applyMarkdownCommand('bold'); return true } },
          { key: 'Mod-i', run: () => { applyMarkdownCommand('italic'); return true } },
          { key: 'Mod-e', run: () => { applyMarkdownCommand('inline-code'); return true } },
          { key: 'Mod-Shift-l', run: () => { applyMarkdownCommand('link'); return true } },
          { key: 'Mod-Shift-2', run: () => { applyMarkdownCommand('heading-2'); return true } },
          { key: 'Mod-Shift-8', run: () => { applyMarkdownCommand('bullet-list'); return true } },
          ...searchKeymap,
          indentWithTab,
          ...defaultKeymap,
          ...historyKeymap,
        ]),
        editorPlaceholder(props.placeholder),
        EditorView.contentAttributes.of({ 'aria-label': props.ariaLabel, 'aria-keyshortcuts': 'Shift+F10', spellcheck: 'false' }),
        EditorView.updateListener.of((update) => { if (update.docChanged && !applyingExternalValue) scheduleEmit() }),
        EditorView.domEventHandlers({
          blur: () => { flush(); emit('blur') },
          contextmenu: (event) => openContextMenu(event),
          paste: (event) => handlePaste(event),
          keydown: (event) => handleEditorKeydown(event),
        }),
        EditorView.theme({
          '&': { height: '100%', color: 'var(--reading-ink, var(--text))', backgroundColor: 'var(--reading-paper, var(--bg))' },
          '&.cm-focused': { outline: 'none' },
          '.cm-scroller': { overflow: 'auto', fontFamily: "'Cascadia Mono','DM Mono',Consolas,monospace", fontSize: 'var(--editor-font-size, 14px)', lineHeight: 'var(--editor-line-height, 1.72)' },
          '.cm-content': { minHeight: '100%', padding: '14px 18px', caretColor: 'var(--accent)' },
          '.cm-line': { padding: '0' },
          '.cm-activeLine': { backgroundColor: 'color-mix(in srgb,var(--accent) 4%,transparent)' },
          '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground': { backgroundColor: 'rgba(30,142,119,.24)' },
          '.cm-content ::selection': { backgroundColor: 'rgba(30,142,119,.24)' },
          '.cm-cursor': { borderLeftColor: 'var(--accent)' },
          '.cm-placeholder': { color: 'var(--muted)' },
        }),
      ],
    }),
  })
  view.scrollDOM.addEventListener('scroll', handleEditorScroll, { passive: true })
  if (props.focusOnMount) requestAnimationFrame(() => {
    view?.focus()
    emit('focused')
  })
  if (props.scrollTarget) requestAnimationFrame(() => focusLine(props.scrollTarget?.line, props.scrollTarget?.query))
  if (props.searchRequest) requestAnimationFrame(openSearch)
})

watch(() => props.modelValue, (value) => {
  if (!view) return
  if (value === lastEmitted) { lastEmitted = undefined; return }
  const current = view.state.doc.toString()
  if (value === current) return
  if (emitTimer !== undefined) window.clearTimeout(emitTimer)
  emitTimer = undefined
  applyingExternalValue = true
  try {
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value } })
  } finally {
    applyingExternalValue = false
  }
})

watch(() => props.scrollTarget?.revision, () => focusLine(props.scrollTarget?.line, props.scrollTarget?.query))
watch(() => props.searchRequest, (request, previous) => {
  if (request && request !== previous) requestAnimationFrame(openSearch)
})

onBeforeUnmount(() => {
  flush()
  if (scrollFrame !== undefined) window.cancelAnimationFrame(scrollFrame)
  view?.scrollDOM.removeEventListener('scroll', handleEditorScroll)
  view?.destroy()
  view = undefined
})
</script>

<template><div ref="host" class="large-text-editor"></div></template>

<style scoped>
.large-text-editor{min-width:0;min-height:0;flex:1;overflow:hidden;border:0;background:var(--bg);color:var(--text)}
.large-text-editor:focus-within{box-shadow:inset 3px 0 0 var(--accent)}
.large-text-editor :deep(.cm-selectionBackground){background:var(--accent-soft)!important}
.large-text-editor :deep(.cm-content ::selection){background:var(--accent-soft)!important}
.large-text-editor :deep(.cm-panels-top){border-bottom:0;background:transparent}
.large-text-editor :deep(.cm-panel.cm-search){display:flex;min-height:43px;box-sizing:border-box;align-items:center;flex-wrap:wrap;gap:5px;padding:7px 41px 7px 10px;border-bottom:1px solid var(--accent-soft);color:var(--text-secondary);background:linear-gradient(180deg,var(--surface-2),var(--surface-2));box-shadow:0 5px 14px var(--accent-soft);font:600 11px var(--font-family-ui)}
.large-text-editor :deep(.cm-panel.cm-search br){width:100%;height:0;flex-basis:100%}
.large-text-editor :deep(.cm-panel.cm-search input.cm-textfield){width:min(228px,31vw);min-height:29px;box-sizing:border-box;margin:0;padding:0 9px;border:1px solid var(--accent-soft);border-radius:7px;outline:0;color:var(--text);background:var(--surface);font:11px var(--font-family-ui)}
.large-text-editor :deep(.cm-panel.cm-search input.cm-textfield:focus){border-color:var(--accent);box-shadow:0 0 0 3px var(--accent-soft)}
.large-text-editor :deep(.cm-panel.cm-search .cm-button){min-height:29px;margin:0;padding:0 9px;border:1px solid var(--accent-soft);border-radius:7px;color:var(--text-secondary);background:var(--surface);background-image:none;font:650 11px var(--font-family-ui);text-transform:none}
.large-text-editor :deep(.cm-panel.cm-search .cm-button:hover),.large-text-editor :deep(.cm-panel.cm-search .cm-button:focus-visible){border-color:var(--accent-soft);color:var(--green-strong);background:var(--green-bg)}
.large-text-editor :deep(.cm-panel.cm-search label){display:inline-flex;min-height:27px;align-items:center;gap:3px;margin:0!important;color:var(--muted);font:600 11px var(--font-family-ui);white-space:nowrap}
.large-text-editor :deep(.cm-panel.cm-search input[type='checkbox']){margin:0;accent-color:var(--green)}
.large-text-editor :deep(.cm-panel.cm-search [name='close']){display:grid!important;top:8px!important;right:9px!important;width:27px;height:27px;place-items:center;border:1px solid transparent!important;border-radius:7px;color:var(--muted);background:transparent!important;font-size:17px!important}
.large-text-editor :deep(.cm-panel.cm-search [name='close']:hover),.large-text-editor :deep(.cm-panel.cm-search [name='close']:focus-visible){border-color:var(--accent-soft)!important;color:var(--green-strong);background:var(--green-bg)!important;outline:2px solid color-mix(in srgb,var(--green) 38%,transparent);outline-offset:1px}
.large-text-editor :deep(.cm-searchMatch){border-bottom:1px solid var(--warn);background:var(--warn-soft)!important}
.large-text-editor :deep(.cm-searchMatch-selected){border-bottom-color:var(--accent);background:var(--accent-soft)!important}
@media(max-width:900px){.large-text-editor :deep(.cm-panel.cm-search input.cm-textfield){width:min(190px,42vw)}.large-text-editor :deep(.cm-panel.cm-search label){font-size:0}.large-text-editor :deep(.cm-panel.cm-search label input){width:14px;height:14px}}
</style>
