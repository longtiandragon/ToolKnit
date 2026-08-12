<script setup lang="ts">
import { computed, defineAsyncComponent, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { open, save as saveDialog } from '@tauri-apps/plugin-dialog'
import { onBeforeRouteLeave, onBeforeRouteUpdate, useRoute, useRouter } from 'vue-router'
import TagPill from '@/components/TagPill.vue'
import MarkdownContent from '@/components/MarkdownContent.vue'
import AppIcon from '@/components/AppIcon.vue'
import MarkdownInsertDialog from '@/components/MarkdownInsertDialog.vue'
import UnsavedChangesDialog from '@/components/UnsavedChangesDialog.vue'
import EditorRecoveryBanner from '@/components/EditorRecoveryBanner.vue'
import DocumentTabStrip from '@/components/DocumentTabStrip.vue'
import ExternalMarkdownWorkspace from '@/components/ExternalMarkdownWorkspace.vue'
import type { EntityRelation, QuestionReviewFacet, QuestionType, RelationType, StudyDocument } from '@/types'
import { useWorkbenchStore } from '@/stores/workbench'
import { useUiStore } from '@/stores/ui'
import { newId } from '@/lib/id'
import { createIndependentDocumentCopy } from '@/lib/document-copy'
import { cloneStudyDocument } from '@/lib/study-document'
import { deleteDesktopQuestionAttachment, getDesktopDocumentVersion, getDesktopVaultDocument, importDesktopMarkdownImage, importDesktopQuestionAttachment, inspectExternalMarkdown, isDesktop, listDesktopDocumentVersions, listDesktopQuestionAttachments, listDesktopVisualProjects, listenDesktopEvent, listenWindowFileDragEvents, openExternalUrl, pasteDesktopMarkdownClipboardImage, preserveDesktopDocumentVersion, readExternalMarkdown, resolveDesktopQuestionAttachment, revealDesktopFile, saveDesktopVaultDocument, searchExternalMarkdownWorkspace, unwatchDesktopExternalMarkdown, watchDesktopExternalMarkdown, writeExternalMarkdown, type DesktopDocumentVersionSummary, type DesktopEditorCrashDraft, type DesktopFileDragEvent, type DesktopQuestionAttachment, type DesktopVaultSearchResult, type DesktopVisualProjectSummary, type ExternalMarkdownDirectoryEntry, type ExternalMarkdownPayload } from '@/lib/native'
import { deferredMarkdownPreviewMessage, EXPLICIT_MARKDOWN_PREVIEW_THRESHOLD, needsExplicitMarkdownPreview } from '@/lib/markdown-preview-policy'
import { markdownEditorCommitPolicy } from '@/lib/markdown-editor-performance'
import { documentAutoSavePolicy } from '@/lib/document-autosave'
import { externalWikiExactMatches, normalizeWikiTitle, parseWikiLinks, wikiLinkSource } from '@/lib/wiki-links'
import { normalizeDocumentFolder } from '@/lib/study-document'
import { clampMenuPosition, isContextMenuShortcut, nestedMenuIntent, nextMenuItemIndex, preferredMenuItemIndex } from '@/lib/desktop-menu'
import { fixedRowVirtualWindow } from '@/lib/virtual-window'
import { extractMarkdownOutline, type MarkdownOutlineItem } from '@/lib/markdown-outline'
import { nextAvailableNoteTitle, noteStarterTemplates, noteTemplateContent, type NoteStarterTemplate } from '@/lib/note-template'
import type { MarkdownEditCommand } from '@/lib/markdown-edit'
import type { MarkdownInsertion } from '@/lib/markdown-insert'
import { markdownSelectionAiTarget, markdownSelectionTargetPaths } from '@/lib/markdown-selection-target'
import { documentKnowledgeAction } from '@/lib/knowledge-workflows'
import { externalWorkspaceEntryContainsPath, externalWorkspacePathKey, remapExternalWorkspacePath } from '@/lib/external-workspace'
import { externalMarkdownConflictPreview, type ExternalMarkdownConflictPreview } from '@/lib/external-markdown-conflict'
import { createQuestionReviewState, questionReviewCards, questionReviewFacetLabels, questionReviewForFacet, withQuestionReviewFacet } from '@/lib/question-review'
import { matchesQuestionType, questionStructureSummary, questionTypeChoices, questionTypeLabel, type QuestionStructureField } from '@/lib/question-structure'
import { looksLikeCode } from '@/lib/workbench-utils'
import { markdownSelectionTitle } from '@/lib/markdown-selection'
import { markdownImageDropIntent, markdownImageImportSelection, markdownImportedImageMarkup } from '@/lib/markdown-image-import'
import { formatQuestionAttachmentSize, questionAttachmentIcon, upsertQuestionAttachment } from '@/lib/question-attachment'
import { parseMarkdownFrontmatter, stripMarkdownFrontmatter, type MarkdownFrontmatter } from '@/lib/markdown-frontmatter'
import { createdDocumentRoute, markdownInsertRequest, type DocumentEditorMode } from '@/lib/document-route'
import { chooseOutputDirectory, exportOutput } from '@/lib/output'
import { safeMarkdownExportName } from '@/lib/markdown-export-document'
import type { MarkdownExportProgress } from '@/lib/markdown-export'
import { historicalDocumentDraft } from '@/lib/document-version'
import { allowDocumentTransition, type UnsavedDocumentDecision } from '@/lib/document-transition'
import { deleteEditorCrashDraft, editorCrashDraftDelay, getEditorCrashDraft, parseUsableEditorCrashDraft, saveEditorCrashDraft, type EditorCrashDraftSaveState } from '@/lib/editor-crash-draft'
import { adjacentDocumentWorkspaceTab, closeDocumentWorkspaceTab, closeDocumentWorkspaceTabsToRight, closeOtherDocumentWorkspaceTabs, normalizeDocumentWorkspaceTabs, openDocumentWorkspaceTab, toggleDocumentWorkspaceTabPin, type DocumentWorkspaceTab } from '@/lib/document-workspace-tabs'
import { analyzeMarkdownStatistics, markdownStatisticsSummary, type MarkdownStatistics } from '@/lib/markdown-statistics'
import { consumeLocalFileHandoff } from '@/lib/local-file-handoff'
import { normalizePreviewSelection, PREVIEW_SELECTION_MARKDOWN_LIMIT, previewSelectionMarkdown, previewSelectionSummary, type PreviewSelectionPayload } from '@/lib/preview-selection'
import { classifyMarkdownLink, markdownHeadingMatchesFragment } from '@/lib/markdown-link'
import { questionSourceActionLabel, questionSourceReference } from '@/lib/question-source'
import { createAsyncSearchGate } from '@/lib/async-search-gate'
import { mergeRelationTargets, relationKindLabel, resolveRelationTarget, type RelationEntityKind, type RelationTargetSummary } from '@/lib/relation-targets'
import type { MarkdownEditorContextSnapshot, RichPasteResult } from '@/components/LargeTextEditor.vue'

type DocumentFolderItem = { path: string; label: string; depth: number; count: number }
type WikiContextMenuState = { title: string; heading?: string; target?: StudyDocument; externalEligible: boolean; externalCandidates: ExternalMarkdownDirectoryEntry[]; resolving: boolean; resolutionError: string; x: number; y: number }
type ExternalMarkdownConflictState = { documentId: string; current: StudyDocument; disk: ExternalMarkdownPayload; preview: ExternalMarkdownConflictPreview }
type VaultMarkdownSurfaceChange = { documentId: string; kind: 'note' | 'question'; change: 'modified' | 'removed'; status: 'pending' | 'updated' | 'unchanged' | 'missing' | 'untracked'; document?: StudyDocument }
type ManagedVaultConflictState = { documentId: string; current: StudyDocument; disk: StudyDocument; preview: ExternalMarkdownConflictPreview }
type ScrollSyncSurface = { setScrollProgress(progress: number): void }
type MarkdownEditorSurface = ScrollSyncSurface & {
  flush(): string
  focus(): void
  focusAtCoordinates(x: number, y: number): boolean
  focusLine(line: number, query?: string): void
  getValue(): string
  getSelectedText(): string
  undo(): boolean
  redo(): boolean
  selectAll(): boolean
  openSearch(): boolean
  closeSearch(): boolean
  insertText(text: string): boolean
  insertStructured(insertion: MarkdownInsertion, block?: boolean): boolean
  insertCodeBlock(language?: string): boolean
  deleteSelection(): boolean
  applyMarkdownCommand(command: MarkdownEditCommand): void
  copySelection(): Promise<boolean>
  cutSelection(): Promise<boolean>
  pasteClipboard(): Promise<boolean>
  pasteRichClipboard(): Promise<RichPasteResult>
}
type EditorClipboardAction = 'copy' | 'cut' | 'paste' | 'paste-rich'
type EditorHistoryAction = 'undo' | 'redo' | 'select-all'
type EditorContextSubmenu = 'clipboard' | 'code' | 'insert' | 'tools' | 'study' | 'document'
const documentEditorModes: DocumentEditorMode[] = ['edit', 'split', 'preview', 'mindmap']
const markdownFormattingTools: Array<{ command: MarkdownEditCommand; label: string; icon: string; shortcut: string; divider?: boolean }> = [
  { command: 'bold', label: '粗体', icon: 'bold', shortcut: 'Ctrl+B' },
  { command: 'italic', label: '斜体', icon: 'italic', shortcut: 'Ctrl+I' },
  { command: 'heading-2', label: '标题', icon: 'heading', shortcut: 'Ctrl+Shift+2' },
  { command: 'link', label: '链接', icon: 'link', shortcut: 'Ctrl+Shift+L' },
  { command: 'quote', label: '引用', icon: 'quote', shortcut: '右键可用', divider: true },
  { command: 'bullet-list', label: '列表', icon: 'list', shortcut: 'Ctrl+Shift+8' },
  { command: 'inline-code', label: '行内代码', icon: 'inline-code', shortcut: 'Ctrl+E', divider: true },
  { command: 'code-block', label: '代码块', icon: 'code', shortcut: '右键可用' },
]
const codeBlockLanguages = [
  { value: '', label: '无语言' },
  { value: 'typescript', label: 'TypeScript' },
  { value: 'javascript', label: 'JavaScript' },
  { value: 'python', label: 'Python' },
  { value: 'cpp', label: 'C++' },
  { value: 'java', label: 'Java' },
  { value: 'mermaid', label: 'Mermaid' },
]
const questionReviewFacetChoices: QuestionReviewFacet[] = ['answer', 'error']

function documentEditorMode(value: unknown): DocumentEditorMode | undefined {
  return typeof value === 'string' && documentEditorModes.includes(value as DocumentEditorMode) ? value as DocumentEditorMode : undefined
}

// Keep the default reader fast. CodeMirror, Markmap and the AI workbench are
// useful only in their respective modes, so they should not delay a simple
// Markdown preview or document-list navigation.
const AiAssistPanel = defineAsyncComponent(() => import('@/components/AiAssistPanel.vue'))
const MarkdownMindmap = defineAsyncComponent(() => import('@/components/MarkdownMindmap.vue'))
const QuestionImportDialog = defineAsyncComponent(() => import('@/components/QuestionImportDialog.vue'))
const LargeTextEditor = defineAsyncComponent(() => import('@/components/LargeTextEditor.vue'))
const ExternalMarkdownConflictDialog = defineAsyncComponent(() => import('@/components/ExternalMarkdownConflictDialog.vue'))

const store = useWorkbenchStore()
const router = useRouter()
const route = useRoute(); const ui=useUiStore()
const query = ref('')
const appliedQuery = ref('')
const selectedId = ref(store.documents[0]?.id ?? '')
const draft = ref<StudyDocument | null>(store.documents[0] ? cloneStudyDocument(store.documents[0]) : null)
const documentDirty = ref(false)
let replacingDraft = false
const documentLoading = ref(false)
const focusEditorOnMount = ref(false)
const newTag = ref('')
const saved = ref(false)
type DocumentAutoSaveState = 'idle' | 'scheduled' | 'saving' | 'saved' | 'paused' | 'error'
const autoSaveState = ref<DocumentAutoSaveState>('idle')
const documentSaveInProgress = ref(false)
const DOCUMENT_WORKSPACE_TABS_KEY = 'knitspace:document-workspace-tabs:v1'
const DOCUMENT_WORKSPACE_ACTIVE_KEY = 'knitspace:document-workspace-active:v1'
let persistedDocumentTabPayload: unknown = []
try { persistedDocumentTabPayload = JSON.parse(localStorage.getItem(DOCUMENT_WORKSPACE_TABS_KEY) ?? '[]') } catch { /* a corrupt UI session must not affect Vault content */ }
const persistedDocumentTabActiveId = localStorage.getItem(DOCUMENT_WORKSPACE_ACTIVE_KEY) ?? ''
const documentTabs = ref<DocumentWorkspaceTab[]>([])
const crashDraft = ref<DesktopEditorCrashDraft>()
const crashDraftState = ref<EditorCrashDraftSaveState>('idle')
const crashDraftBusy = ref(false)
const unsavedPrompt = ref<{ targetLabel: string } | null>(null)
let unsavedResolver: ((decision: UnsavedDocumentDecision) => void) | undefined
const mode = ref<DocumentEditorMode>(documentEditorMode(route.query.mode) ?? 'preview')
const listFilter = ref<'all' | 'review' | 'plain'>('all')
const questionTypeFilter = ref<QuestionType | ''>('')
const tagFilter = ref('')
const folderFilter = ref('')
const folderTreeExpanded = ref(true)
const externalWorkspaceQa = import.meta.env.DEV && route.query.qa === 'external-workspace'
const previewSelectionQa = computed(() => import.meta.env.DEV && route.query.qa === 'preview-selection')
const externalWorkspaceQaRoot = ref('')
if (externalWorkspaceQa) {
  void import('@/lib/external-workspace-qa').then(({ EXTERNAL_WORKSPACE_QA_ROOT }) => { externalWorkspaceQaRoot.value = EXTERNAL_WORKSPACE_QA_ROOT })
}
const sidebarMode = ref<'vault' | 'workspace'>(externalWorkspaceQa ? 'workspace' : 'vault')
const inspectorOpen = ref(false)
const focusMode = ref(false)
const relationComposerOpen = ref(false)
const relationInput = ref<HTMLInputElement>()
const relationQuery = ref('')
const relationType = ref<RelationType>('related')
const relationResults = ref<RelationTargetSummary[]>([])
const relationSearching = ref(false)
const relationSearchError = ref('')
const visualRelationCatalogWarning = ref('')
const visualRelationCatalog = shallowRef<DesktopVisualProjectSummary[]>([])
const relationMenu = ref<{ relation: EntityRelation; title: string; kind: RelationEntityKind; x: number; y: number } | null>(null)
const wikiContextMenu = ref<WikiContextMenuState | null>(null)
const headingContextMenu = ref<{ heading: string; x: number; y: number } | null>(null)
const questionAttachments = ref<DesktopQuestionAttachment[]>([])
const questionAttachmentsLoading = ref(false)
const questionAttachmentImporting = ref(false)
const questionAttachmentError = ref('')
const questionAttachmentsExpanded = ref(false)
const questionAttachmentMenu = ref<{ attachment: DesktopQuestionAttachment; x: number; y: number } | null>(null)
const questionImportOpen = ref(false)
const relationMenuElement = ref<HTMLElement>()
const wikiContextMenuElement = ref<HTMLElement>()
const headingContextMenuElement = ref<HTMLElement>()
const questionAttachmentMenuElement = ref<HTMLElement>()
const questionStructureMenu = ref<{ x: number; y: number } | null>(null)
const questionStructureMenuElement = ref<HTMLElement>()
const questionDetailsSectionElement = ref<HTMLElement>()
const previewSource = ref('')
const previewPending = ref(false)
const fullLargePreviewRequested = ref(false)
const previewRenderDurationMs = ref<number>()
const previewRenderProgress = shallowRef<{ completed: number; total: number }>()
const largePreviewMenu = ref<{ x: number; y: number } | null>(null)
const largePreviewMenuElement = ref<HTMLElement>()
let largePreviewMenuTrigger: HTMLElement | undefined
const previewContextTarget = ref<HTMLElement>()
const previewSelectionMenu = ref<(PreviewSelectionPayload & { x: number; y: number }) | null>(null)
const previewSelectionMenuElement = ref<HTMLElement>()
const editorSurface = ref<MarkdownEditorSurface>()
const editorDropTarget = ref<HTMLElement>()
const markdownImageDrop = shallowRef<{ count: number; omitted: number }>()
const editorSearchRequest = ref(0)
const previewSurface = ref<ScrollSyncSurface>()
const splitScrollSync = ref(true)
const editorContextMenu = ref<{ x: number; y: number; hasSelection: boolean; submenusLeft: boolean; context: MarkdownEditorContextSnapshot } | null>(null)
const editorContextMenuElement = ref<HTMLElement>()
const editorContextSubmenu = ref<EditorContextSubmenu | null>(null)
const markdownInsertPanel = ref<{ panel: 'table' | 'formula'; selectedText: string; recognizeFormula: boolean } | null>(null)
const pendingRouteInsert = ref<{ panel: 'table' | 'formula'; documentId: string; recognizeFormula: boolean } | null>(null)
const imagePasteState = ref<'idle' | 'saving' | 'ready' | 'error'>('idle')
const imagePasteMessage = ref('')
const richPasteMessage = ref('')
const frontmatter = shallowRef<MarkdownFrontmatter>()
const frontmatterExpanded = ref(false)
const frontmatterMenu = ref<{ x: number; y: number } | null>(null)
const frontmatterMenuElement = ref<HTMLElement>()
const documentMenu = ref<{ document: StudyDocument; x: number; y: number } | null>(null)
const documentMenuElement = ref<HTMLElement>()
const documentVersions = shallowRef<DesktopDocumentVersionSummary[]>([])
const documentVersionsLoading = ref(false)
const documentVersionsError = ref('')
const documentVersionsExpanded = ref(false)
const documentVersionSectionElement = ref<HTMLElement>()
const documentVersionMenu = ref<{ version: DesktopDocumentVersionSummary; x: number; y: number } | null>(null)
const documentVersionMenuElement = ref<HTMLElement>()
const documentOutput = ref<{ documentId: string; detail: string; progress: number } | null>(null)
const documentStatistics = shallowRef<MarkdownStatistics>()
const documentStatisticsPending = ref(false)
const documentStatisticsExpanded = ref(false)
const documentStatisticsMenu = ref<{ x: number; y: number } | null>(null)
const documentStatisticsMenuElement = ref<HTMLElement>()
const noteStarterMenu = ref<{ x: number; y: number } | null>(null)
const noteStarterMenuElement = ref<HTMLElement>()
const documentListElement = ref<HTMLElement>()
const externalFileChanged = ref(false)
const externalFileUnavailable = ref(false)
const externalFileWatchMode = ref<'native' | 'poll' | 'none'>('none')
const externalConflict = shallowRef<ExternalMarkdownConflictState>()
const externalConflictQaDisk = shallowRef<ExternalMarkdownPayload>()
const externalConflictBusy = ref(false)
const externalConflictError = ref('')
let externalConflictTrigger: HTMLElement | undefined
const managedVaultAlert = ref<{ documentId: string; status: 'pending' | 'missing' }>()
const managedVaultPendingDisk = shallowRef<StudyDocument>()
const managedVaultConflict = shallowRef<ManagedVaultConflictState>()
const managedVaultConflictBusy = ref(false)
const managedVaultConflictError = ref('')
const managedVaultMenu = ref<{ x: number; y: number }>()
const managedVaultMenuElement = ref<HTMLElement>()
let managedVaultTrigger: HTMLElement | undefined
const externalFileMenu = ref<{ x: number; y: number }>()
const externalFileMenuElement = ref<HTMLElement>()
let externalFileMenuTrigger: HTMLElement | undefined
const backlinks = ref<Awaited<ReturnType<typeof store.findDocumentBacklinks>>>([])
const backlinksLoading = ref(false)
const markdownOutline = ref<MarkdownOutlineItem[]>([])
const pendingOutline = ref<MarkdownOutlineItem | null>(null)
const outlinePending = ref(false)
const outlineEditorTarget = ref<{ line: number; query?: string; revision: number }>()
const pendingEditorLineTarget = ref<{ documentId: string; line: number; query?: string }>()
const outlineListElement = ref<HTMLElement>()
const OUTLINE_ROW_HEIGHT = 31
const outlineScrollTop = ref(0)
const outlineListHeight = ref(220)
let previewTimer: number | undefined
let externalPollTimer: number | undefined
let externalWatchDebounceTimer: number | undefined
let externalWatchUnlisten: (() => void) | undefined
let externalWatchPath = ''
let externalWatchRevision = 0
let externalWatchMutation = Promise.resolve()
let relationSearchTimer: number | undefined
const relationSearchGate = createAsyncSearchGate()
let visualRelationCatalogLoaded = false
let visualRelationCatalogRequest: Promise<void> | undefined
let wikiHeadingTimer: number | undefined
let wikiResolutionRevision = 0
let queryTimer: number | undefined
let outlineIndexTimer: number | undefined
let documentListResizeObserver: ResizeObserver | undefined
let outlineListResizeObserver: ResizeObserver | undefined
let outlineIndexWorker: Worker | undefined
let outlineIndexWorkerUnavailable = false
let outlineIndexRequestId = 0
let documentStatisticsTimer: number | undefined
let documentStatisticsWorker: Worker | undefined
let documentStatisticsWorkerUnavailable = false
let documentStatisticsRequestId = 0
let externalConflictWorker: Worker | undefined
let externalConflictWorkerUnavailable = false
let externalConflictWorkerDisposed = false
let externalConflictWorkerRequestId = 0
const externalConflictWorkerPending = new Map<number, { resolve: (preview: ExternalMarkdownConflictPreview) => void; reject: (error: Error) => void }>()
let imagePasteTimer: number | undefined
let richPasteTimer: number | undefined
let markdownImageDragFrame: number | undefined
let pendingMarkdownImageDrag: DesktopFileDragEvent | undefined
let markdownImageDragUnlisten: (() => void) | undefined
let markdownImageDragDisposed = false
let frontmatterTimer: number | undefined
let frontmatterDocumentId = ''
let crashDraftTimer: number | undefined
let autoSaveTimer: number | undefined
let autoSaveStatusTimer: number | undefined
let crashDraftRevision = 0
let draftEditRevision = 0
let documentLoadRevision = 0
let documentVersionLoadRevision = 0
let backlinksRevision = 0
let questionAttachmentLoadRevision = 0
let documentMenuTrigger: HTMLElement | undefined
let documentVersionMenuTrigger: HTMLElement | undefined
let noteStarterMenuTrigger: HTMLElement | undefined
let relationMenuTrigger: HTMLElement | undefined
let wikiContextMenuTrigger: HTMLElement | undefined
let headingContextMenuTrigger: HTMLElement | undefined
let questionAttachmentMenuTrigger: HTMLElement | undefined
let questionStructureMenuTrigger: HTMLElement | undefined
let frontmatterMenuTrigger: HTMLElement | undefined
let documentStatisticsMenuTrigger: HTMLElement | undefined
const isNotes = computed(() => route.query.kind === 'note')
const scopedDocuments = computed(() => store.documents.filter((document) => !route.query.kind || document.kind === route.query.kind))
const availableTags = computed(() => {
  const counts = new Map<string, number>()
  for (const document of scopedDocuments.value) {
    for (const tag of document.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1)
  }
  return [...counts.entries()]
    .sort(([left], [right]) => left.localeCompare(right, 'zh-CN'))
    .map(([tag, count]) => ({ tag, count }))
})
const folderItems = computed<DocumentFolderItem[]>(() => {
  const counts = new Map<string, number>()
  for (const document of scopedDocuments.value) {
    const folder = normalizeDocumentFolder(document.folder)
    if (!folder) continue
    const segments = folder.split('/')
    for (let depth = 0; depth < segments.length; depth += 1) {
      const path = segments.slice(0, depth + 1).join('/')
      counts.set(path, (counts.get(path) ?? 0) + 1)
    }
  }
  return [...counts.entries()]
    .map(([path, count]) => ({ path, label: path.split('/').at(-1) ?? path, depth: path.split('/').length - 1, count }))
    .sort((left, right) => left.path.localeCompare(right.path, 'zh-CN'))
})
const docs = computed(() => store.documents.filter((document) => {
  const matchesKind = !route.query.kind || document.kind === route.query.kind
  const matchesFilter = listFilter.value === 'all' || (listFilter.value === 'review' ? document.reviewEnabled : !document.reviewEnabled)
  const matchesType = document.kind !== 'question' || matchesQuestionType(document.questionType, questionTypeFilter.value)
  const matchesTag = !tagFilter.value || document.tags.includes(tagFilter.value)
  const folder = normalizeDocumentFolder(document.folder) ?? ''
  const matchesFolder = !folderFilter.value || folder === folderFilter.value || folder.startsWith(`${folderFilter.value}/`)
  // Full-text body search is handled by the Vault/FTS5 command palette. Keep
  // this sidebar filter metadata-only so thousands of long notes do not get
  // scanned on every keypress.
  const matchesQuery = `${document.title} ${document.subject} ${document.tags.join(' ')}`.toLowerCase().includes(appliedQuery.value.toLowerCase())
  return matchesKind && matchesFilter && matchesType && matchesTag && matchesFolder && matchesQuery
}))
const DOCUMENT_LIST_ROW_HEIGHT = 60
const documentListScrollTop = ref(0)
const documentListHeight = ref(360)
const documentWindow = computed(() => fixedRowVirtualWindow(docs.value.length, documentListScrollTop.value, documentListHeight.value, DOCUMENT_LIST_ROW_HEIGHT, 7))
const visibleDocs = computed(() => docs.value.slice(documentWindow.value.start, documentWindow.value.end))
const selected = computed(() => store.documents.find((document) => document.id === selectedId.value))
const visibleQuestionAttachments = computed(() => questionAttachmentsExpanded.value ? questionAttachments.value : questionAttachments.value.slice(0, 6))
const visibleDocumentVersions = computed(() => documentVersionsExpanded.value ? documentVersions.value : documentVersions.value.slice(0, 6))
const activeExternalMarkdownPath = computed(() => selected.value?.externalFile?.path ?? '')
const isLargeDocument = computed(() => (draft.value?.content.length ?? 0) > 120_000)
const isHugeDocument = computed(() => needsExplicitMarkdownPreview(draft.value?.content ?? ''))
const editorCommitPolicy = computed(() => markdownEditorCommitPolicy(draft.value?.content.length ?? 0))
const autoSavePolicy = computed(() => documentAutoSavePolicy(draft.value?.content.length ?? 0))
const documentSaveLabel = computed(() => {
  if (documentSaveInProgress.value) return autoSaveState.value === 'saving' ? '正在自动保存…' : '正在保存…'
  if (documentDirty.value) {
    if (!store.settings.documentAutoSave) return crashDraftState.value === 'saved' ? '未保存 · 已留恢复点' : crashDraftState.value === 'oversize' ? '大草稿 · 请手动保存' : '未保存修改'
    if (autoSaveState.value === 'paused') return '外部文件待手动确认'
    if (autoSaveState.value === 'error') return '自动保存未完成'
    if (autoSaveState.value === 'scheduled') return `等待自动保存 · ${autoSavePolicy.value.label}`
    return crashDraftState.value === 'saved' ? '未保存 · 已留恢复点' : '未保存修改'
  }
  if (autoSaveState.value === 'saved') return '已自动保存 · 本地'
  return saved.value ? '已保存 · 本地' : '已同步 · 本地'
})
const currentQuestionStructure = computed(() => questionStructureSummary(draft.value?.questionDetails))
const currentQuestionSource = computed(() => questionSourceReference(draft.value?.questionDetails?.source))
const previewRenderDurationLabel = computed(() => {
  const duration = previewRenderDurationMs.value
  if (duration === undefined) return ''
  return duration < 1000 ? `${duration} ms` : `${(duration / 1000).toFixed(1)} 秒`
})
const outlineWindow = computed(() => fixedRowVirtualWindow(markdownOutline.value.length, outlineScrollTop.value, outlineListHeight.value, OUTLINE_ROW_HEIGHT, 6))
const visibleMarkdownOutline = computed(() => markdownOutline.value.slice(outlineWindow.value.start, outlineWindow.value.end))
const isBlankDraft = computed(() => !hasVisibleMarkdownContent(draft.value?.content ?? '', draft.value?.title ?? ''))
// A complete rendered preview can share the document menu. Empty and deferred
// readers already have more specific, intentionally lighter interactions.
const previewMenuEnabled = computed(() => Boolean(
  draft.value
  && !isBlankDraft.value
  && (!isHugeDocument.value || fullLargePreviewRequested.value),
))

// Access history follows selection changes only. Saving the active document
// must not masquerade as another open.
watch(selectedId, (id) => {
  const document = store.documents.find((item) => item.id === id)
  if (document) store.touchContentRecent(document.kind, document.id)
}, { immediate: true })

function syncEditorScroll(progress: number) {
  if (mode.value === 'split' && splitScrollSync.value) previewSurface.value?.setScrollProgress(progress)
}

function syncPreviewScroll(progress: number) {
  if (mode.value === 'split' && splitScrollSync.value) editorSurface.value?.setScrollProgress(progress)
}

function toggleSplitScrollSync() {
  splitScrollSync.value = !splitScrollSync.value
  closeDocumentMenu()
}

function applyEditorCommand(command: MarkdownEditCommand) {
  editorSurface.value?.applyMarkdownCommand(command)
  closeEditorContextMenu(true)
}

function openEditorContextMenu(x: number, y: number, hasSelection: boolean, context: MarkdownEditorContextSnapshot) {
  closePreviewSelectionMenu()
  closeDocumentMenu()
  closeNoteStarterMenu()
  closeRelationMenu()
  closeWikiContextMenu()
  closeHeadingContextMenu()
  editorContextSubmenu.value = null
  editorContextMenu.value = { ...clampMenuPosition(x, y, { menuWidth: 236, menuHeight: 468, margin: 12 }), hasSelection, submenusLeft: x > window.innerWidth - 492, context }
  focusEditorContextMenu()
}

function editorRootMenuItems(menu = editorContextMenuElement.value) {
  if (!menu) return []
  return [...menu.querySelectorAll<HTMLButtonElement>(
    ':scope > button[role="menuitem"]:not(:disabled), :scope > .markdown-menu-icon-grid > button[role="menuitem"]:not(:disabled), :scope > .markdown-menu-branch > .markdown-menu-row[role="menuitem"]:not(:disabled)',
  )]
}

function focusEditorContextMenu() {
  void nextTick(() => {
    const items = editorRootMenuItems()
    const index = preferredMenuItemIndex(items.map((item) => item.classList.contains('markdown-menu-context-action')))
    if (index !== undefined) items[index]?.focus({ preventScroll: true })
  })
}

function editorContextIcon(context: MarkdownEditorContextSnapshot) {
  if (context.kind === 'code') return 'terminal'
  if (context.kind === 'image') return 'file-image'
  if (context.kind === 'wiki-link') return 'book'
  if (context.kind === 'link') return 'link'
  if (context.kind === 'inline-code') return 'inline-code'
  if (context.kind === 'heading') return 'heading'
  if (context.kind === 'list') return 'list'
  if (context.kind === 'selection') return 'duplicate'
  return 'file-text'
}

function closeEditorContextMenu(restoreFocus = false) {
  editorContextSubmenu.value = null
  editorContextMenu.value = null
  if (restoreFocus) void nextTick(() => editorSurface.value?.focus())
}

function editorSubmenuId(branch: Element | null) {
  const value = branch instanceof HTMLElement ? branch.dataset.editorSubmenu : undefined
  return value as EditorContextSubmenu | undefined
}

function setEditorContextSubmenu(id: EditorContextSubmenu | null, focusFirst = false) {
  editorContextSubmenu.value = id
  if (!id || !focusFirst) return
  void nextTick(() => {
    const branch = editorContextMenuElement.value?.querySelector<HTMLElement>(`[data-editor-submenu="${id}"]`)
    branch?.querySelector<HTMLButtonElement>(':scope > .markdown-menu-submenu > button:not(:disabled)')?.focus({ preventScroll: true })
  })
}

function openEditorContextSubmenu(id: EditorContextSubmenu) {
  setEditorContextSubmenu(id, true)
}

function leaveEditorContextSubmenu(event: MouseEvent) {
  const branch = event.currentTarget as HTMLElement
  if (!branch.contains(document.activeElement)) setEditorContextSubmenu(null)
}

function handleEditorContextMenuKeydown(event: KeyboardEvent) {
  const menu = editorContextMenuElement.value
  const active = document.activeElement instanceof HTMLButtonElement ? document.activeElement : undefined
  if (!menu || !active) return
  const submenu = active.closest<HTMLElement>('.markdown-menu-submenu')
  const branch = active.closest<HTMLElement>('[data-editor-submenu]')
  const level = submenu ? 'submenu' : 'root'
  const branchId = editorSubmenuId(branch)
  const intent = nestedMenuIntent(event.key, level, Boolean(branchId))
  if (intent === 'close-menu') {
    event.preventDefault()
    closeEditorContextMenu(true)
    return
  }
  if (intent === 'open-submenu' && branchId) {
    event.preventDefault()
    setEditorContextSubmenu(branchId, true)
    return
  }
  if (intent === 'close-submenu') {
    event.preventDefault()
    setEditorContextSubmenu(null)
    branch?.querySelector<HTMLButtonElement>(':scope > .markdown-menu-row')?.focus({ preventScroll: true })
    return
  }
  const items = submenu
    ? [...submenu.querySelectorAll<HTMLButtonElement>(':scope > button:not(:disabled)')]
    : editorRootMenuItems(menu)
  const nextIndex = nextMenuItemIndex(event.key, items.indexOf(active), items.length)
  if (nextIndex === undefined) return
  event.preventDefault()
  const next = items[nextIndex]
  next?.focus({ preventScroll: true })
  if (!submenu) setEditorContextSubmenu(editorSubmenuId(next?.closest('[data-editor-submenu]')) ?? null)
}

async function runEditorClipboard(action: EditorClipboardAction) {
  const editor = editorSurface.value
  if (!editor) return
  try {
    const result = action === 'copy'
      ? await editor.copySelection()
      : action === 'cut'
        ? await editor.cutSelection()
        : action === 'paste-rich'
          ? await editor.pasteRichClipboard()
          : await editor.pasteClipboard()
    const completed = typeof result === 'boolean' ? result : result.inserted
    if (!completed) ui.toast(action === 'paste' || action === 'paste-rich' ? '剪贴板里没有可粘贴的文字。' : '请先选择一段文字。', undefined, 'info')
    else if (action === 'paste-rich' && typeof result !== 'boolean' && !result.converted) ui.toast('剪贴板没有富文本', '已按纯文本粘贴，没有添加额外格式。', 'info')
  } catch (error) {
    ui.toast('无法访问系统剪贴板', error instanceof Error ? error.message : '请检查桌面剪贴板权限。', 'error')
  } finally {
    closeEditorContextMenu(true)
  }
}

function runEditorHistory(action: EditorHistoryAction) {
  const editor = editorSurface.value
  if (!editor) return
  const completed = action === 'undo' ? editor.undo() : action === 'redo' ? editor.redo() : editor.selectAll()
  if (!completed) ui.toast(action === 'undo' ? '没有可撤销的编辑。' : action === 'redo' ? '没有可重做的编辑。' : '当前文档还是空的。', undefined, 'info')
  closeEditorContextMenu(true)
}

function deleteEditorSelection() {
  if (!editorSurface.value?.deleteSelection()) ui.toast('请先选择要删除的文字。', undefined, 'info')
  closeEditorContextMenu(true)
}

async function copyEditorFormat(format: 'markdown' | 'html' | 'plain') {
  const source = editorSurface.value?.getSelectedText() ?? ''
  if (!source) {
    ui.toast('请先选择一段文字。', undefined, 'info')
    closeEditorContextMenu(true)
    return
  }
  closeEditorContextMenu(true)
  try {
    if (format === 'markdown') await navigator.clipboard.writeText(source)
    else {
      const { renderMarkdownInWorker } = await import('@/lib/markdown-export')
      const html = await renderMarkdownInWorker(source)
      const payload = format === 'html'
        ? html
        : new DOMParser().parseFromString(html, 'text/html').body.textContent ?? ''
      await navigator.clipboard.writeText(payload)
    }
    ui.toast(format === 'markdown' ? '已复制 Markdown' : format === 'html' ? '已复制 HTML 代码' : '已复制无格式文字', undefined, 'success')
  } catch (error) {
    ui.toast('无法写入系统剪贴板', error instanceof Error ? error.message : '请检查桌面剪贴板权限。', 'error')
  }
}

async function copyEditorContextTarget() {
  const target = editorContextMenu.value?.context.target
  if (!target) return
  closeEditorContextMenu(true)
  try {
    await navigator.clipboard.writeText(target)
    ui.toast('已复制目标地址', target, 'success')
  } catch (error) {
    ui.toast('无法写入系统剪贴板', error instanceof Error ? error.message : '请检查桌面剪贴板权限。', 'error')
  }
}

async function copyEditorContextCode() {
  const context = editorContextMenu.value?.context
  if (!context || context.kind !== 'code') return
  closeEditorContextMenu(true)
  try {
    await navigator.clipboard.writeText(context.text ?? '')
    ui.toast('已复制当前代码块', context.truncated ? '代码块过长，本次复制采用了右键菜单的安全上限。' : undefined, 'success')
  } catch (error) {
    ui.toast('无法写入系统剪贴板', error instanceof Error ? error.message : '请检查桌面剪贴板权限。', 'error')
  }
}

function openEditorContextCodeImage() {
  const context = editorContextMenu.value?.context
  if (!context || !['code', 'inline-code'].includes(context.kind) || !context.text) return
  store.prepareCodeDraft(context.text, `${draft.value?.title || 'code-block'}.${context.language || 'txt'}`)
  closeEditorContextMenu()
  void router.push(markdownSelectionTargetPaths.codeImage)
}

function openEditorContextWikiMenu() {
  const menu = editorContextMenu.value
  if (!menu || menu.context.kind !== 'wiki-link' || !menu.context.target) return
  const separator = menu.context.target.indexOf('#')
  const title = separator >= 0 ? menu.context.target.slice(0, separator) : menu.context.target
  const heading = separator >= 0 ? menu.context.target.slice(separator + 1) : undefined
  const { x, y } = menu
  closeEditorContextMenu()
  openWikiContext(title, heading, x, y)
}

async function copyEditorContextHeadingLink() {
  const context = editorContextMenu.value?.context
  if (!context || context.kind !== 'heading' || !draft.value) return
  closeEditorContextMenu(true)
  try {
    await navigator.clipboard.writeText(`[[${draft.value.title}#${context.detail}]]`)
    ui.toast('已复制段落双链', undefined, 'success')
  } catch (error) {
    ui.toast('无法写入系统剪贴板', error instanceof Error ? error.message : '请检查桌面剪贴板权限。', 'error')
  }
}

function handleRichPaste(result: RichPasteResult) {
  if (!result.inserted || !result.converted) return
  if (richPasteTimer !== undefined) window.clearTimeout(richPasteTimer)
  richPasteMessage.value = result.truncated ? '富文本较长 · 已安全截取并转为 Markdown' : '已保留标题、列表、链接和代码格式'
  richPasteTimer = window.setTimeout(() => { richPasteMessage.value = '' }, result.truncated ? 7000 : 4200)
  if (result.truncated) ui.toast('富文本已按安全上限粘贴', '原剪贴板内容过大；为避免编辑器卡顿，只转换了安全范围内的内容。', 'info')
}

function capturedPreviewSelection() {
  const selection = window.getSelection()
  const target = previewContextTarget.value
  if (!selection || selection.isCollapsed || selection.rangeCount !== 1 || !target) return undefined
  const range = selection.getRangeAt(0)
  if (!target.contains(range.commonAncestorContainer)) return undefined
  const container = document.createElement('div')
  container.append(range.cloneContents())
  const payload = normalizePreviewSelection(selection.toString(), container.innerHTML)
  if (!payload) return undefined
  const markdown = previewSelectionMarkdown(container, payload.text)
  return {
    ...payload,
    markdown: markdown.slice(0, PREVIEW_SELECTION_MARKDOWN_LIMIT),
    markdownTruncated: markdown.length > PREVIEW_SELECTION_MARKDOWN_LIMIT,
  }
}

function closePreviewSelectionMenu(restoreFocus = false) {
  previewSelectionMenu.value = null
  if (restoreFocus) void nextTick(() => previewContextTarget.value?.focus({ preventScroll: true }))
}

function openPreviewSelectionMenu(payload: PreviewSelectionPayload, x: number, y: number) {
  closeDocumentMenu()
  closeEditorContextMenu()
  closeNoteStarterMenu()
  closeRelationMenu()
  closeWikiContextMenu()
  closeHeadingContextMenu()
  previewSelectionMenu.value = { ...payload, ...clampMenuPosition(x, y, { menuWidth: 252, menuHeight: 392, margin: 12 }) }
  focusContextMenu(previewSelectionMenuElement)
}

function previewSelectionLimitNotice(payload: PreviewSelectionPayload) {
  if (payload.textTruncated) ui.toast('选区较长，已使用前 12 万个字符', '阅读预览保持完整，只有本次工具输入被限制。', 'info')
}

async function writePreviewSelection(payload: PreviewSelectionPayload, format: 'markdown' | 'text' | 'html') {
  try {
    const value = format === 'markdown' ? payload.markdown || payload.text : format === 'html' ? payload.html || payload.text : payload.text
    await navigator.clipboard.writeText(value)
    const truncated = format === 'markdown' ? payload.markdownTruncated : format === 'html' ? payload.htmlTruncated : payload.textTruncated
    ui.toast(format === 'markdown' ? '已复制为 Markdown' : format === 'html' ? '已复制 HTML 代码' : '已复制无格式文字', truncated ? '超长选区已按安全上限截取。' : undefined, 'success')
  } catch (error) {
    ui.toast('无法写入系统剪贴板', error instanceof Error ? error.message : '请检查桌面剪贴板权限。', 'error')
  }
}

async function copyPreviewSelection(format: 'markdown' | 'text' | 'html') {
  const payload = previewSelectionMenu.value
  if (!payload) return
  closePreviewSelectionMenu(true)
  await writePreviewSelection(payload, format)
}

function openPreviewSelectionInCodeImage() {
  const payload = previewSelectionMenu.value
  if (!payload) return
  previewSelectionLimitNotice(payload)
  store.prepareCodeDraft(payload.text, `${draft.value?.title || 'markdown-selection'}.md`)
  closePreviewSelectionMenu()
  void router.push(markdownSelectionTargetPaths.codeImage)
}

function openPreviewSelectionInAi(action: 'summarize' | 'rewrite') {
  const payload = previewSelectionMenu.value
  if (!payload) return
  previewSelectionLimitNotice(payload)
  store.stageIntake([], payload.text)
  closePreviewSelectionMenu()
  void router.push(markdownSelectionAiTarget(action))
}

async function pinPreviewSelectionAsSnippet() {
  const payload = previewSelectionMenu.value
  if (!payload) return
  try {
    previewSelectionLimitNotice(payload)
    await store.addClipboardItem({ kind: looksLikeCode(payload.text) ? 'code' : 'text', content: payload.text, pinned: true })
    ui.toast('已固定为常用片段', '之后可在剪贴板工具中直接复用。', 'success')
  } catch (error) {
    ui.toast('无法保存常用片段', error instanceof Error ? error.message : undefined, 'error')
  } finally {
    closePreviewSelectionMenu(true)
  }
}

async function createNoteFromPreviewSelection() {
  const payload = previewSelectionMenu.value
  if (!payload || !await confirmDocumentTransition('从阅读选区创建笔记')) return
  previewSelectionLimitNotice(payload)
  const note = store.createNote(markdownSelectionTitle(payload.text, '从选区整理的笔记'), draft.value?.folder, payload.text)
  closePreviewSelectionMenu()
  openNewDocument(note)
  ui.toast('已从阅读选区创建笔记', '原文仍保留在当前文档，新笔记可独立整理。', 'success')
}

async function createQuestionFromPreviewSelection() {
  const payload = previewSelectionMenu.value
  if (!payload || !await confirmDocumentTransition('从阅读选区创建题目')) return
  previewSelectionLimitNotice(payload)
  const question = store.createQuestion()
  question.title = markdownSelectionTitle(payload.text, '从选区整理的题目')
  question.questionType = looksLikeCode(payload.text) ? 'algorithm' : 'general'
  question.subject = draft.value?.subject || question.subject
  question.tags = [...(draft.value?.tags ?? [])]
  if (question.questionDetails) question.questionDetails.stem = payload.text
  store.saveDocument(question)
  inspectorOpen.value = true
  closePreviewSelectionMenu()
  openNewDocument(question)
  ui.toast('已从阅读选区创建题目', '题干已经填好，可继续补答案、解析和错因。', 'success')
}

function insertEditorSnippet(markdown: string) {
  editorSurface.value?.insertText(markdown)
  closeEditorContextMenu(true)
}

function openMarkdownInsert(panel: 'table' | 'formula', recognizeFormula = false) {
  const selectedText = editorSurface.value?.getSelectedText() ?? ''
  closeEditorContextMenu()
  markdownInsertPanel.value = { panel, selectedText, recognizeFormula }
}

function openPendingRouteInsert() {
  const pending = pendingRouteInsert.value
  const editor = editorSurface.value
  const document = draft.value
  if (!pending || !editor || !document || document.id !== pending.documentId) return
  editor.focusLine(document.content.split(/\r?\n/).length)
  pendingRouteInsert.value = null
  openMarkdownInsert(pending.panel, pending.recognizeFormula)
}

function closeMarkdownInsert(restoreFocus = true) {
  markdownInsertPanel.value = null
  if (restoreFocus) void nextTick(() => editorSurface.value?.focus())
}

function insertStructuredMarkdown(insertion: MarkdownInsertion, block: boolean) {
  const inserted = editorSurface.value?.insertStructured(insertion, block)
  closeMarkdownInsert(false)
  if (!inserted) ui.toast('请先切换到编辑或分屏模式。', undefined, 'info')
}

async function openDocumentSearch(document = draft.value) {
  if (!document) return
  if (!await switchToDocument(document)) return
  if (mode.value !== 'edit' && mode.value !== 'split') mode.value = 'edit'
  closeDocumentMenu()
  closeEditorContextMenu()
  editorSearchRequest.value += 1
}

function insertEditorCodeBlock(language = '') {
  editorSurface.value?.insertCodeBlock(language)
  closeEditorContextMenu(true)
}

async function copyCurrentDocumentWikiLink() {
  if (!draft.value) return
  try {
    await navigator.clipboard.writeText(`[[${draft.value.title}]]`)
    ui.toast('文档双链已复制', `[[${draft.value.title}]]`, 'success')
  } catch (error) {
    ui.toast('无法写入剪贴板', error instanceof Error ? error.message : undefined, 'error')
  } finally {
    closeEditorContextMenu(true)
  }
}

async function outputDocumentSnapshot(document: StudyDocument) {
  if (draft.value?.id === document.id) {
    const content = editorSurface.value?.getValue() ?? draft.value.content
    return { ...cloneStudyDocument(draft.value), content }
  }
  const loaded = await store.loadDocument(document.id)
  if (!loaded) throw new Error('文档正文暂时不可用，请重新打开后再试。')
  return cloneStudyDocument(loaded)
}

async function copyWholeDocumentMarkdown(document = draft.value) {
  if (!document) return
  closeDocumentMenu()
  closeEditorContextMenu(true)
  try {
    const snapshot = await outputDocumentSnapshot(document)
    await navigator.clipboard.writeText(snapshot.content)
    ui.toast('已复制整篇 Markdown', `${snapshot.content.length.toLocaleString('zh-CN')} 个字符 · 未改变原文`, 'success')
  } catch (error) {
    ui.toast('整篇 Markdown 未复制', readableError(error), 'error')
  }
}

function markdownExportPercent(progress: MarkdownExportProgress) {
  const ratio = progress.total > 0 ? Math.min(1, progress.completed / progress.total) : 1
  const stages: Record<MarkdownExportProgress['stage'], [number, number]> = {
    render: [0, 28], images: [28, 52], diagrams: [52, 88], assemble: [88, 100],
  }
  const [start, end] = stages[progress.stage]
  return Math.round(start + (end - start) * ratio)
}

async function exportDocumentHtml(document = draft.value) {
  if (!document) return
  if (documentOutput.value) {
    ui.toast('已有文档正在导出', documentOutput.value.detail, 'info')
    closeDocumentMenu()
    closeEditorContextMenu(true)
    return
  }
  closeDocumentMenu()
  closeEditorContextMenu(true)
  documentOutput.value = { documentId: document.id, detail: '正在准备文档…', progress: 0 }
  let job: ReturnType<typeof store.addJob> | undefined
  try {
    const snapshot = await outputDocumentSnapshot(document)
    let outputDirectory = store.settings.outputDirectory
    if (isDesktop() && !outputDirectory) {
      documentOutput.value.detail = '请选择输出目录'
      outputDirectory = await chooseOutputDirectory() ?? ''
      if (!outputDirectory) return
      store.updateSettings({ outputDirectory })
    }
    job = store.addJob('text', `导出文档：${snapshot.title}`, [snapshot.title], {
      toolId: 'markdown-export', route: '/documents', retryable: true,
      inputs: [{ name: snapshot.externalFile?.name ?? `${snapshot.title}.md`, path: snapshot.externalFile?.path, mime: 'text/markdown' }],
      parameters: { format: 'standalone-html', documentId: snapshot.id },
    })
    store.updateJob(job.id, { status: 'running', detail: '正在后台排版 Markdown、代码与公式' })
    const { exportMarkdownHtml } = await import('@/lib/markdown-export')
    const html = await exportMarkdownHtml({
      title: snapshot.title,
      source: snapshot.content,
      documentId: snapshot.id,
      externalMarkdownPath: snapshot.externalFile?.path,
      onProgress(progress) {
        const value = markdownExportPercent(progress)
        documentOutput.value = { documentId: snapshot.id, detail: progress.detail, progress: value }
        if (job) store.updateJob(job.id, { progress: value, detail: progress.detail })
      },
    })
    const filename = safeMarkdownExportName(snapshot.title)
    const output = await exportOutput(outputDirectory, filename, html, 'text/html;charset=utf-8')
    store.updateJob(job.id, { status: 'succeeded', progress: 100, detail: `已生成 ${filename}`, outputNames: [filename], outputs: [output] })
    ui.toast('可打印 HTML 已导出', output.path ?? filename, 'success', output.path ? '打开位置' : undefined, output.path ? () => void revealDesktopFile(output.path!) : undefined)
  } catch (error) {
    const detail = readableError(error)
    if (job) store.updateJob(job.id, { status: 'failed', detail, errorCode: 'MARKDOWN_EXPORT_FAILED' })
    ui.toast('文档导出失败', detail, 'error')
  } finally {
    documentOutput.value = null
  }
}

function openSplitFromEditorMenu() {
  mode.value = 'split'
  closeEditorContextMenu(true)
}

function openFocusFromEditorMenu() {
  toggleFocusMode()
  closeEditorContextMenu()
}

function editorSelection() {
  return editorSurface.value?.getSelectedText().trim() ?? ''
}

function requireEditorSelection() {
  const source = editorSelection()
  if (source) return source
  ui.toast('请先选择一段内容。', '工具只会接收你明确选中的文字，不会默认发送整篇文档。', 'info')
  closeEditorContextMenu(true)
  return ''
}

function openSelectionInCodeImage() {
  const source = requireEditorSelection()
  if (!source) return
  store.prepareCodeDraft(source, `${draft.value?.title || 'markdown-selection'}.md`)
  closeEditorContextMenu()
  void router.push(markdownSelectionTargetPaths.codeImage)
}

function openSelectionInAi(action: 'summarize' | 'rewrite' = 'rewrite') {
  const source = requireEditorSelection()
  if (!source) return
  store.stageIntake([], source)
  closeEditorContextMenu()
  void router.push(markdownSelectionAiTarget(action))
}

async function pinSelectionAsSnippet() {
  const source = requireEditorSelection()
  if (!source) return
  try {
    await store.addClipboardItem({ kind: looksLikeCode(source) ? 'code' : 'text', content: source, pinned: true })
    ui.toast('已固定为常用片段', '之后可在剪贴板工具中直接复用。', 'success')
  } catch (error) {
    ui.toast('无法保存常用片段', error instanceof Error ? error.message : undefined, 'error')
  } finally {
    closeEditorContextMenu(true)
  }
}

async function createNoteFromSelection() {
  const source = requireEditorSelection()
  if (!source) return
  if (!await confirmDocumentTransition('从选区创建笔记')) return
  const note = store.createNote(markdownSelectionTitle(source, '从选区整理的笔记'), draft.value?.folder, source)
  closeEditorContextMenu()
  openNewDocument(note)
  ui.toast('已从选区创建笔记', '原文保留在当前文档，新笔记可独立整理。', 'success')
}

async function createQuestionFromSelection() {
  const source = requireEditorSelection()
  if (!source) return
  if (!await confirmDocumentTransition('从选区创建题目')) return
  const question = store.createQuestion()
  question.title = markdownSelectionTitle(source, '从选区整理的题目')
  question.questionType = looksLikeCode(source) ? 'algorithm' : 'general'
  question.subject = draft.value?.subject || question.subject
  question.tags = [...(draft.value?.tags ?? [])]
  if (question.questionDetails) question.questionDetails.stem = source
  store.saveDocument(question)
  inspectorOpen.value = true
  closeEditorContextMenu()
  openNewDocument(question)
  ui.toast('已从选区创建题目', '题干已经填好，可继续补答案、解析和错因。', 'success')
}

function announceImagePaste(state: 'saving' | 'ready' | 'error', message: string) {
  if (imagePasteTimer !== undefined) window.clearTimeout(imagePasteTimer)
  if (richPasteTimer !== undefined) window.clearTimeout(richPasteTimer)
  imagePasteState.value = state
  imagePasteMessage.value = message
  if (state !== 'saving') imagePasteTimer = window.setTimeout(() => {
    imagePasteState.value = 'idle'
    imagePasteMessage.value = ''
  }, state === 'error' ? 7000 : 4200)
}

async function pasteClipboardImage() {
  const restoreEditorFocus = Boolean(editorContextMenu.value)
  closeEditorContextMenu()
  // Return immediately to the source surface. Restoring only after a slower
  // clipboard/file operation could steal focus from a title field or another
  // page that the user opened while the image was being persisted.
  if (restoreEditorFocus) void nextTick(() => editorSurface.value?.focus())
  const current = draft.value
  if (!current || imagePasteState.value === 'saving') return
  if (!isDesktop()) {
    announceImagePaste('error', '图片粘贴需要 Knitspace 桌面版')
    ui.toast('无法粘贴图片', '请在 Knitspace 桌面开发版中使用此功能。', 'info')
    return
  }
  announceImagePaste('saving', '正在存入本地图片…')
  try {
    const attachment = await pasteDesktopMarkdownClipboardImage(current.id, current.externalFile?.path)
    if (draft.value?.id !== current.id || !editorSurface.value?.insertText(`![粘贴图片](${attachment.source})`)) {
      throw new Error('笔记已经切换，图片未插入正文。')
    }
    const size = attachment.size >= 1024 * 1024
      ? `${(attachment.size / 1024 / 1024).toFixed(1)} MB`
      : `${Math.max(1, Math.round(attachment.size / 1024))} KB`
    announceImagePaste('ready', `已本地插入 ${attachment.filename} · ${size}`)
  } catch (error) {
    const message = error instanceof Error ? error.message : '请确认剪贴板中是一张图片。'
    announceImagePaste('error', message)
    ui.toast('图片未插入', message, 'error')
  }
}

async function loadQuestionAttachments(documentId = draft.value?.id ?? '') {
  const revision = ++questionAttachmentLoadRevision
  closeQuestionAttachmentMenu()
  questionAttachmentsExpanded.value = false
  questionAttachmentError.value = ''
  if (!documentId || draft.value?.kind !== 'question' || !isDesktop()) {
    questionAttachments.value = []
    questionAttachmentsLoading.value = false
    return
  }
  questionAttachmentsLoading.value = true
  try {
    const attachments = await listDesktopQuestionAttachments(documentId)
    if (revision === questionAttachmentLoadRevision && draft.value?.id === documentId) questionAttachments.value = attachments
  } catch (error) {
    if (revision === questionAttachmentLoadRevision) {
      questionAttachments.value = []
      questionAttachmentError.value = readableError(error)
    }
  } finally {
    if (revision === questionAttachmentLoadRevision) questionAttachmentsLoading.value = false
  }
}

async function addQuestionAttachments() {
  const current = draft.value
  if (!current || current.kind !== 'question' || questionAttachmentImporting.value) return
  if (!isDesktop()) {
    ui.toast('题目附件需要桌面版', '附件会复制到本地 Vault，不会上传。', 'info')
    return
  }
  const selection = await open({ title: '添加题目附件', multiple: true })
  const selectedPaths = typeof selection === 'string' ? [selection] : Array.isArray(selection) ? selection : []
  if (!selectedPaths.length) return
  const remaining = Math.max(0, 64 - questionAttachments.value.length)
  if (!remaining) {
    ui.toast('附件数量已达上限', '每道题最多保存 64 个附件。', 'info')
    return
  }
  const paths = selectedPaths.slice(0, remaining)
  questionAttachmentImporting.value = true
  questionAttachmentError.value = ''
  try {
    // A newly-created question may still be waiting in the store mutation
    // queue. Ensure the entity exists before copying any binary attachment.
    await saveDesktopVaultDocument(cloneStudyDocument(current))
    let imported = 0
    for (const sourcePath of paths) {
      const attachment = await importDesktopQuestionAttachment(current.id, sourcePath)
      if (draft.value?.id !== current.id) break
      questionAttachments.value = upsertQuestionAttachment(questionAttachments.value, attachment)
      imported += 1
    }
    if (selectedPaths.length > paths.length) ui.toast('只添加了可容纳的附件', `当前题目最多还能保存 ${remaining} 个。`, 'info')
    else ui.toast(`已添加 ${imported} 个附件`, '文件已复制到当前 Vault。', 'success')
  } catch (error) {
    const message = readableError(error)
    questionAttachmentError.value = message
    ui.toast('附件没有全部添加', message, 'error')
  } finally {
    questionAttachmentImporting.value = false
  }
}

async function revealQuestionAttachment(attachment: DesktopQuestionAttachment) {
  const documentId = draft.value?.id
  if (!documentId || !attachment.available) return
  try {
    const path = await resolveDesktopQuestionAttachment(documentId, attachment.id)
    await revealDesktopFile(path)
  } catch (error) {
    ui.toast('无法定位附件', readableError(error), 'error')
    void loadQuestionAttachments(documentId)
  } finally {
    closeQuestionAttachmentMenu()
  }
}

async function copyQuestionAttachmentName(attachment: DesktopQuestionAttachment) {
  try {
    await navigator.clipboard.writeText(attachment.name)
    ui.toast('已复制附件名称', attachment.name, 'success')
  } catch (error) { ui.toast('无法复制附件名称', readableError(error), 'error') }
  closeQuestionAttachmentMenu()
}

async function removeQuestionAttachment(attachment: DesktopQuestionAttachment) {
  const documentId = draft.value?.id
  if (!documentId) return
  if (!await ui.confirm({ title: `移除“${attachment.name}”？`, message: '会删除 Vault 中的这份附件副本，不会影响原始文件。', danger: true, confirmLabel: '移除附件' })) return
  try {
    await deleteDesktopQuestionAttachment(documentId, attachment.id)
    questionAttachments.value = questionAttachments.value.filter((item) => item.id !== attachment.id)
    ui.toast('已移除题目附件', '原始文件没有变化。', 'success')
  } catch (error) { ui.toast('无法移除附件', readableError(error), 'error') }
  closeQuestionAttachmentMenu()
}

function closeQuestionAttachmentMenu(restoreFocus = false) {
  questionAttachmentMenu.value = null
  if (restoreFocus) questionAttachmentMenuTrigger?.focus({ preventScroll: true })
}

function formatDocumentVersionTime(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).format(date)
}

function formatDocumentVersionSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

async function loadDocumentVersions(documentId = draft.value?.id ?? '') {
  const revision = ++documentVersionLoadRevision
  closeDocumentVersionMenu()
  documentVersionsExpanded.value = false
  documentVersionsError.value = ''
  if (!documentId || !inspectorOpen.value || !isDesktop()) {
    documentVersions.value = []
    documentVersionsLoading.value = false
    return
  }
  documentVersionsLoading.value = true
  try {
    const versions = await listDesktopDocumentVersions(documentId)
    if (revision === documentVersionLoadRevision && draft.value?.id === documentId) documentVersions.value = versions
  } catch (error) {
    if (revision === documentVersionLoadRevision) {
      documentVersions.value = []
      documentVersionsError.value = readableError(error)
    }
  } finally {
    if (revision === documentVersionLoadRevision) documentVersionsLoading.value = false
  }
}

async function importMarkdownImagePaths(value: string | string[] | null | undefined, restoreEditorFocus = false) {
  const current = draft.value
  if (!current || imagePasteState.value === 'saving') return
  const selection = markdownImageImportSelection(value)
  if (!selection.paths.length) {
    if (restoreEditorFocus) void nextTick(() => editorSurface.value?.focus())
    return
  }
  announceImagePaste('saving', `正在导入 ${selection.paths.length} 张本地图片…`)
  const imported: Array<{ source: string; path: string; filename: string; size: number }> = []
  const errors: string[] = []
  for (const sourcePath of selection.paths) {
    if (draft.value?.id !== current.id) { errors.push('笔记已经切换'); break }
    try {
      const attachment = await importDesktopMarkdownImage(current.id, sourcePath, current.externalFile?.path)
      imported.push({ ...attachment, path: sourcePath })
    } catch (error) {
      errors.push(readableError(error))
    }
  }
  if (!imported.length) {
    const message = errors[0] ?? '没有可导入的图片。'
    announceImagePaste('error', message)
    ui.toast('图片未导入', message, 'error')
    return
  }
  if (draft.value?.id !== current.id || !editorSurface.value?.insertText(imported.map(item => markdownImportedImageMarkup(item.source, item.path)).join('\n\n'))) {
    announceImagePaste('error', '笔记已经切换，图片未插入正文。')
    ui.toast('图片未插入正文', '图片副本已经安全存入本地，但当前笔记发生了切换。', 'error')
    return
  }
  const totalSize = imported.reduce((sum, item) => sum + item.size, 0)
  const size = totalSize >= 1024 * 1024 ? `${(totalSize / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(totalSize / 1024))} KB`
  const omitted = selection.unsupported + selection.truncated + errors.length
  announceImagePaste('ready', `已本地插入 ${imported.length} 张图片 · ${size}${omitted ? ` · ${omitted} 张未导入` : ''}`)
  if (errors.length) ui.toast('部分图片未导入', `${errors.length} 张图片未通过格式、尺寸或读取检查。`, 'info')
}

async function importLocalMarkdownImages() {
  const restoreEditorFocus = Boolean(editorContextMenu.value)
  closeEditorContextMenu()
  if (!draft.value || imagePasteState.value === 'saving') return
  if (!isDesktop()) {
    announceImagePaste('error', '本地图片导入需要 Knitspace 桌面版')
    ui.toast('无法导入图片', '请在 Knitspace 桌面开发版中使用此功能。', 'info')
    return
  }
  const selected = await open({
    title: '插入本地图片',
    multiple: true,
    filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'avif', 'ico'] }],
  })
  await importMarkdownImagePaths(selected, restoreEditorFocus)
}

async function openPreviewImageInStudio(file: File) {
  if (!file.type.startsWith('image/')) return
  if (!await confirmDocumentTransition('在图片工作室打开当前图片')) return
  closeDocumentContextMenus()
  store.stageIntake([file])
  await router.push('/visual')
  ui.toast('图片已带入工作室', '可以继续裁剪、缩放、标注、拼图或转换格式。', 'success')
}

function clearMarkdownImageDrag() {
  pendingMarkdownImageDrag = undefined
  if (markdownImageDragFrame !== undefined) window.cancelAnimationFrame(markdownImageDragFrame)
  markdownImageDragFrame = undefined
  markdownImageDrop.value = undefined
}

function markdownImageDragIntent(event: DesktopFileDragEvent) {
  if (event.type === 'leave' || !draft.value || imagePasteState.value === 'saving' || (mode.value !== 'edit' && mode.value !== 'split')) return
  const bounds = editorDropTarget.value?.getBoundingClientRect()
  if (!bounds) return
  return markdownImageDropIntent(event.paths, event.position, bounds)
}

function renderMarkdownImageDrag(event: DesktopFileDragEvent) {
  const intent = markdownImageDragIntent(event)
  if (!intent?.active) {
    markdownImageDrop.value = undefined
    return
  }
  const omitted = intent.unsupported + intent.truncated
  if (markdownImageDrop.value?.count === intent.paths.length && markdownImageDrop.value.omitted === omitted) return
  markdownImageDrop.value = { count: intent.paths.length, omitted }
}

function handleMarkdownImageDrag(event: DesktopFileDragEvent) {
  if (event.type === 'leave') {
    clearMarkdownImageDrag()
    return
  }
  if (event.type === 'drop') {
    if (markdownImageDragFrame !== undefined) window.cancelAnimationFrame(markdownImageDragFrame)
    markdownImageDragFrame = undefined
    pendingMarkdownImageDrag = undefined
    const intent = markdownImageDragIntent(event)
    markdownImageDrop.value = undefined
    if (!intent?.active) return
    editorSurface.value?.focusAtCoordinates(event.position.x, event.position.y)
    void importMarkdownImagePaths(intent.paths)
    return
  }
  pendingMarkdownImageDrag = event
  if (markdownImageDragFrame !== undefined) return
  markdownImageDragFrame = window.requestAnimationFrame(() => {
    markdownImageDragFrame = undefined
    const pending = pendingMarkdownImageDrag
    pendingMarkdownImageDrag = undefined
    if (pending) renderMarkdownImageDrag(pending)
  })
}

function closeDocumentVersionMenu(restoreFocus = false) {
  documentVersionMenu.value = null
  if (restoreFocus) void nextTick(() => documentVersionMenuTrigger?.focus({ preventScroll: true }))
}

function openDocumentVersionMenu(event: MouseEvent | KeyboardEvent, version: DesktopDocumentVersionSummary) {
  if (event instanceof KeyboardEvent && !isContextMenuShortcut(event)) return
  event.preventDefault()
  event.stopPropagation()
  closeDocumentMenu()
  closeEditorContextMenu()
  documentVersionMenuTrigger = event.currentTarget instanceof HTMLElement ? event.currentTarget : undefined
  documentVersionMenu.value = { version, ...menuPosition(event, 246, version.isCurrent ? 102 : 140) }
  focusContextMenu(documentVersionMenuElement)
}

async function copyDocumentVersion(version: DesktopDocumentVersionSummary) {
  const documentId = draft.value?.id
  if (!documentId) return
  try {
    const snapshot = await getDesktopDocumentVersion(documentId, version.id)
    if (!snapshot) throw new Error('这个恢复点已经不存在。')
    await navigator.clipboard.writeText(snapshot.content)
    ui.toast('版本 Markdown 已复制', formatDocumentVersionTime(version.savedAt), 'success')
  } catch (error) {
    ui.toast('无法复制这个版本', readableError(error), 'error')
  } finally {
    closeDocumentVersionMenu(true)
  }
}

async function restoreDocumentVersion(version: DesktopDocumentVersionSummary) {
  const current = draft.value
  if (!current || version.isCurrent) return
  closeDocumentVersionMenu()
  const confirmed = await ui.confirm({
    title: `载入 ${formatDocumentVersionTime(version.savedAt)} 的版本？`,
    message: '当前已保存内容会先固定为恢复点；旧版只载入编辑器草稿，点击保存后才会写入。尚未保存的编辑内容会被替换。',
    confirmLabel: '载入为草稿',
  })
  if (!confirmed || draft.value?.id !== current.id) return
  try {
    await preserveDesktopDocumentVersion(current.id)
    const snapshot = await getDesktopDocumentVersion(current.id, version.id)
    if (!snapshot || draft.value?.id !== current.id) throw new Error('文档已切换或这个恢复点已经不存在。')
    replaceDraft(historicalDocumentDraft(current, snapshot, new Date().toISOString()), true)
    saved.value = false
    mode.value = 'split'
    await loadDocumentVersions(current.id)
    ui.toast('旧版本已载入为草稿', '尚未写入；检查内容后再点击保存。', 'success')
  } catch (error) {
    ui.toast('无法载入旧版本', readableError(error), 'error')
  }
}

async function openVersionHistory(document: StudyDocument = draft.value as StudyDocument) {
  if (!document) return
  if (!await switchToDocument(document)) return
  inspectorOpen.value = true
  focusMode.value = false
  closeDocumentContextMenus()
  void nextTick(async () => {
    await loadDocumentVersions(document.id)
    documentVersionSectionElement.value?.scrollIntoView({
      block: 'nearest',
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
    })
  })
}

function openQuestionAttachmentMenu(event: MouseEvent | KeyboardEvent, attachment: DesktopQuestionAttachment) {
  if (event instanceof KeyboardEvent && !isContextMenuShortcut(event)) return
  event.preventDefault()
  event.stopPropagation()
  questionAttachmentMenuTrigger = event.currentTarget instanceof HTMLElement ? event.currentTarget : undefined
  const bounds = questionAttachmentMenuTrigger?.getBoundingClientRect()
  const x = 'clientX' in event && event.clientX ? event.clientX : (bounds?.right ?? 18) - 18
  const y = 'clientY' in event && event.clientY ? event.clientY : (bounds?.top ?? 18) + 28
  questionAttachmentMenu.value = { attachment, ...clampMenuPosition(x, y, { menuWidth: 242, menuHeight: 190, margin: 12 }) }
  void nextTick(() => questionAttachmentMenuElement.value?.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')?.focus())
}
const anchorCrop = ref<string>()
const inspectorLabel = computed(() => draft.value?.kind === 'question' ? '题目与复习' : '文档信息')
const relationLabel: Record<RelationType, string> = { related: '相关', prerequisite: '前置知识', variation: '变式 / 对比' }
const wikiLinks = computed(() => draft.value ? parseWikiLinks(draft.value.content) : [])
function entityInfo(id: string) {
  return resolveRelationTarget(id, store.documents, store.vocabulary, visualRelationCatalog.value)
}
const relatedEntities = computed(() => {
  const id = draft.value?.id
  if (!id) return []
  return store.relations.flatMap((relation) => {
    const targetId = relation.fromId === id ? relation.toId : relation.toId === id ? relation.fromId : ''
    const target = entityInfo(targetId)
    return target ? [{ relation, ...target, inbound: relation.toId === id }] : []
  })
})

function replaceDraft(document: StudyDocument | null, dirty = false) {
  replacingDraft = true
  draft.value = document ? cloneStudyDocument(document) : null
  documentDirty.value = Boolean(document && dirty)
  replacingDraft = false
}

watch(draft, () => {
  if (!replacingDraft && draft.value) {
    draftEditRevision += 1
    documentDirty.value = true
    scheduleCrashDraft()
    scheduleDocumentAutoSave()
  }
}, { deep: true, flush: 'sync' })

watch(() => store.settings.documentAutoSave, (enabled) => {
  if (enabled) scheduleDocumentAutoSave()
  else resetDocumentAutoSaveState()
})
const previewRenderPercent = computed(() => {
  const progress = previewRenderProgress.value
  if (!progress?.total) return 0
  return Math.max(0, Math.min(100, Math.round(progress.completed / progress.total * 100)))
})

watch([documentDirty, () => draft.value?.id ?? '', () => draft.value?.title ?? ''], ([dirty, id, title]) => {
  window.dispatchEvent(new CustomEvent('knitspace:editor-dirty', {
    detail: { dirty, id, title, kindLabel: '文档', discardRecovery: clearCurrentRecovery },
  }))
}, { immediate: true })

watch(selected, async (document, previousDocument) => {
  if (document?.id !== previousDocument?.id) {
    resetDocumentAutoSaveState()
    managedVaultAlert.value = undefined
    managedVaultPendingDisk.value = undefined
    managedVaultConflict.value = undefined
    managedVaultMenu.value = undefined
  }
  if (document && store.vaultMarkdownIssues[document.id] === 'missing') {
    managedVaultAlert.value = { documentId: document.id, status: 'missing' }
    autoSaveState.value = 'paused'
  }
  const revision = ++documentLoadRevision
  markdownOutline.value = []
  pendingOutline.value = null
  outlinePending.value = false
  outlineScrollTop.value = 0
  outlineEditorTarget.value = undefined
  ++outlineIndexRequestId
  fullLargePreviewRequested.value = false
  previewRenderDurationMs.value = undefined
  if (!document) {
    replaceDraft(null)
    void loadCrashDraft(null)
    documentLoading.value = false
    return
  }
  // A desktop Vault starts with metadata only. Keep the last reader out of
  // view while its body arrives rather than briefly rendering an empty note.
  if (isDesktop() && !document.content) {
    documentLoading.value = true
    replaceDraft(null)
    try {
      const loaded = await store.loadDocument(document.id)
      if (revision === documentLoadRevision) {
        replaceDraft(loaded ?? null)
        void loadCrashDraft(loaded ?? null)
      }
    } catch (error) {
      if (revision === documentLoadRevision) {
        replaceDraft(null)
        ui.toast(`无法读取本机 Markdown：${error instanceof Error ? error.message : '文档暂不可用。'}`, undefined, 'error')
      }
    } finally {
      if (revision === documentLoadRevision) documentLoading.value = false
    }
    return
  }
  replaceDraft(document)
  void loadCrashDraft(document)
  documentLoading.value = false
}, { immediate: true })
watch(() => draft.value?.kind === 'question' ? draft.value.id : '', (documentId) => { void loadQuestionAttachments(documentId) }, { immediate: true })
watch([inspectorOpen, () => draft.value?.id ?? ''], ([open, documentId]) => {
  if (open && documentId) {
    void loadDocumentVersions(documentId as string)
    if (store.relations.some(relation => (relation.fromId === documentId || relation.toId === documentId) && !entityInfo(relation.fromId === documentId ? relation.toId : relation.fromId))) void loadVisualRelationCatalog()
  }
  else {
    ++documentVersionLoadRevision
    documentVersions.value = []
    documentVersionsLoading.value = false
    documentVersionsError.value = ''
  }
}, { immediate: true })
watch(() => selectedId.value ? store.vaultMarkdownIssues[selectedId.value] : undefined, (issue) => {
  if (issue === 'missing' && selectedId.value) {
    managedVaultAlert.value = { documentId: selectedId.value, status: 'missing' }
    resetDocumentAutoSaveState()
    autoSaveState.value = 'paused'
  }
})
let sourceCropRevision = 0
watch(() => {
  const anchor = draft.value?.sourceAnchor
  return anchor?.cropAssetId ? `${anchor.sourceId}:${anchor.cropAssetId}` : ''
}, async (key) => {
  const revision = ++sourceCropRevision
  anchorCrop.value = undefined
  const anchor = draft.value?.sourceAnchor
  if (!key || !anchor?.cropAssetId) return
  try {
    const crop = await store.loadSourceCrop(anchor.sourceId, anchor.cropAssetId)
    if (revision === sourceCropRevision) anchorCrop.value = crop
  } catch { /* A deleted source should not prevent editing the question. */ }
}, { immediate: true })
function normalizedPreview(content: string) { return stripMarkdownFrontmatter(content) }
function hasVisibleMarkdownContent(content: string, title: string) {
  const lines = normalizedPreview(content).replace(/\r/g, '').split('\n')
  const firstMeaningfulLine = lines.findIndex((line) => Boolean(line.trim()))
  if (firstMeaningfulLine < 0) return false
  const first = lines[firstMeaningfulLine]?.trim() ?? ''
  const isDuplicateTitle = first.replace(/^#\s+/, '').trim() === title.trim() && /^#\s+/.test(first)
  return lines.some((line, index) => Boolean(line.trim()) && (!isDuplicateTitle || index !== firstMeaningfulLine))
}
function requestFullLargePreview() {
  if (!draft.value) return
  closeLargePreviewMenu()
  fullLargePreviewRequested.value = true
  previewPending.value = true
  previewRenderDurationMs.value = undefined
  previewRenderProgress.value = undefined
  previewSource.value = normalizedPreview(draft.value.content)
}
function cancelFullLargePreview() {
  closeLargePreviewMenu()
  fullLargePreviewRequested.value = false
  previewPending.value = false
  previewRenderDurationMs.value = undefined
  previewRenderProgress.value = undefined
  previewSource.value = `> ${deferredMarkdownPreviewMessage()}`
}
function handlePreviewRenderProgress(completed: number, total: number) {
  if (!fullLargePreviewRequested.value) return
  previewRenderProgress.value = { completed, total }
}
function closeLargePreviewMenu(restoreFocus = false) {
  largePreviewMenu.value = null
  if (restoreFocus) void nextTick(() => largePreviewMenuTrigger?.focus({ preventScroll: true }))
}
function openLargePreviewMenu(event: MouseEvent | KeyboardEvent) {
  if (!isHugeDocument.value || (event instanceof KeyboardEvent && !isContextMenuShortcut(event))) return
  event.preventDefault()
  event.stopPropagation()
  largePreviewMenuTrigger = event.currentTarget instanceof HTMLElement ? event.currentTarget : undefined
  largePreviewMenu.value = menuPosition(event, 248, 182)
  void nextTick(() => largePreviewMenuElement.value?.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')?.focus({ preventScroll: true }))
}
function returnLargeDocumentToSource() {
  closeLargePreviewMenu()
  cancelFullLargePreview()
  mode.value = 'edit'
  void nextTick(() => editorSurface.value?.focus())
}
function handleDocumentShortcut(event: KeyboardEvent) {
  if (event.defaultPrevented) return
  if (event.key === 'Escape' && !event.ctrlKey && !event.metaKey && !event.altKey && focusMode.value) {
    event.preventDefault()
    focusMode.value = false
    return
  }
  if ((event.ctrlKey || event.metaKey) && event.shiftKey && !event.altKey && event.key.toLowerCase() === 'c') {
    const payload = capturedPreviewSelection()
    if (!payload) return
    event.preventDefault()
    void writePreviewSelection(payload, 'markdown')
    return
  }
  if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'w') {
    event.preventDefault()
    void closeWorkspaceTab(selectedId.value)
    return
  }
  if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key === 'Tab') {
    event.preventDefault()
    const next = adjacentDocumentWorkspaceTab(documentTabs.value, selectedId.value, event.shiftKey ? -1 : 1)
    if (next) void activateWorkspaceTab(next.id)
    return
  }
  if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'f') {
    event.preventDefault()
    openDocumentSearch()
    return
  }
  if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === 'f') {
    event.preventDefault()
    toggleFocusMode()
    return
  }
  if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === 'e') {
    event.preventDefault()
    void exportDocumentHtml()
    return
  }
  if ((event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === 's') {
    event.preventDefault()
    void save()
    return
  }
  if (!event.altKey || event.ctrlKey || event.metaKey) return
  const modeByKey: Record<string, DocumentEditorMode> = { '1': 'edit', '2': 'split', '3': 'preview', '4': 'mindmap' }
  const nextMode = modeByKey[event.key]
  if (!nextMode || !draft.value) return
  event.preventDefault()
  mode.value = nextMode
}

function closeDocumentContextMenus() {
  closeExternalFileMenu()
  closeManagedVaultMenu()
  closeDocumentMenu()
  closePreviewSelectionMenu()
  closeDocumentVersionMenu()
  closeFrontmatterMenu()
  closeNoteStarterMenu()
  closeRelationMenu()
  closeWikiContextMenu()
  closeHeadingContextMenu()
  closeEditorContextMenu()
  closeQuestionAttachmentMenu()
  closeDocumentStatisticsMenu()
}

function ensureDocumentStatisticsWorker() {
  if (documentStatisticsWorker || documentStatisticsWorkerUnavailable || typeof Worker === 'undefined') return documentStatisticsWorker
  documentStatisticsWorker = new Worker(new URL('../workers/markdown-statistics.worker.ts', import.meta.url), { type: 'module' })
  documentStatisticsWorker.onmessage = ({ data }: MessageEvent<{ id: number; statistics?: MarkdownStatistics; error?: string }>) => {
    if (data.id !== documentStatisticsRequestId) return
    documentStatisticsPending.value = false
    if (data.statistics) documentStatistics.value = data.statistics
  }
  documentStatisticsWorker.onerror = () => {
    documentStatisticsWorker?.terminate()
    documentStatisticsWorker = undefined
    documentStatisticsWorkerUnavailable = true
    documentStatisticsPending.value = false
  }
  return documentStatisticsWorker
}

function scheduleDocumentStatistics(immediate = false) {
  if (documentStatisticsTimer !== undefined) window.clearTimeout(documentStatisticsTimer)
  const source = draft.value?.content ?? ''
  const documentId = draft.value?.id ?? ''
  const requestId = ++documentStatisticsRequestId
  if (!documentId) {
    documentStatistics.value = undefined
    documentStatisticsPending.value = false
    return
  }
  documentStatisticsPending.value = true
  const delay = immediate ? 0 : source.length > 240_000 ? 520 : source.length > 48_000 ? 360 : 220
  documentStatisticsTimer = window.setTimeout(() => {
    if (draft.value?.id !== documentId || requestId !== documentStatisticsRequestId) return
    const worker = ensureDocumentStatisticsWorker()
    if (worker) {
      worker.postMessage({ id: requestId, source })
      return
    }
    // A browser that blocks module workers still receives an honest status.
    // The normal desktop path never executes this main-thread fallback.
    if (draft.value?.id !== documentId || requestId !== documentStatisticsRequestId) return
    documentStatistics.value = analyzeMarkdownStatistics(source)
    documentStatisticsPending.value = false
  }, delay)
}

function closeDocumentStatisticsMenu(restoreFocus = false) {
  documentStatisticsMenu.value = null
  if (restoreFocus) void nextTick(() => documentStatisticsMenuTrigger?.focus({ preventScroll: true }))
}

function openDocumentStatisticsMenu(event: MouseEvent | KeyboardEvent) {
  if (event instanceof KeyboardEvent && !isContextMenuShortcut(event)) return
  event.preventDefault()
  event.stopPropagation()
  documentStatisticsMenuTrigger = event.currentTarget instanceof HTMLElement ? event.currentTarget : undefined
  documentStatisticsMenu.value = menuPosition(event, 244, 168)
  void nextTick(() => documentStatisticsMenuElement.value?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus())
}

async function copyDocumentStatistics() {
  const statistics = documentStatistics.value
  if (!statistics) return
  try {
    await navigator.clipboard.writeText(markdownStatisticsSummary(statistics))
    ui.toast('文档统计已复制', '只复制数字摘要，不包含 Markdown 正文。', 'success')
  } catch (error) {
    ui.toast('无法复制文档统计', error instanceof Error ? error.message : undefined, 'error')
  } finally {
    closeDocumentStatisticsMenu(true)
  }
}

function toggleFocusMode() {
  focusMode.value = !focusMode.value
  if (focusMode.value) {
    // Focus mode is a reader-first surface. Keep the source mode available in
    // the normal workspace, while a single shortcut always lands on readable
    // Markdown instead of an unexpectedly blank editing column.
    mode.value = 'preview'
    inspectorOpen.value = false
  }
}

async function openDocumentInFocus(document: StudyDocument) {
  if (focusMode.value && selectedId.value === document.id) {
    focusMode.value = false
  } else {
    if (!await switchToDocument(document)) return
    mode.value = 'preview'
    focusMode.value = true
    inspectorOpen.value = false
  }
  closeDocumentMenu()
}

function closeFrontmatterMenu(restoreFocus = false) {
  frontmatterMenu.value = null
  if (restoreFocus) void nextTick(() => frontmatterMenuTrigger?.focus({ preventScroll: true }))
}

function openFrontmatterMenu(event: MouseEvent | KeyboardEvent) {
  if (event instanceof KeyboardEvent && !isContextMenuShortcut(event)) return
  if (!frontmatter.value) return
  event.preventDefault()
  event.stopPropagation()
  closeDocumentMenu()
  closeEditorContextMenu()
  frontmatterMenuTrigger = event.currentTarget instanceof HTMLElement ? event.currentTarget : undefined
  frontmatterMenu.value = menuPosition(event, 242, 206)
  focusContextMenu(frontmatterMenuElement)
}

function toggleFrontmatterExpanded() {
  frontmatterExpanded.value = !frontmatterExpanded.value
  closeFrontmatterMenu(true)
}

async function copyFrontmatter(format: 'yaml' | 'json') {
  const metadata = frontmatter.value
  if (!metadata) return
  try {
    const text = format === 'json'
      ? JSON.stringify(metadata.json, null, 2)
      : metadata.yaml.replace(/[\r\n]+$/, '')
    await navigator.clipboard.writeText(text)
    ui.toast(format === 'json' ? '属性 JSON 已复制' : 'YAML 属性已复制', 'Markdown 文件没有被修改。', 'success')
  } catch (error) {
    ui.toast('无法复制文档属性', error instanceof Error ? error.message : undefined, 'error')
  } finally {
    closeFrontmatterMenu(true)
  }
}

function editFrontmatterSource() {
  mode.value = 'edit'
  closeFrontmatterMenu()
  void nextTick(() => editorSurface.value?.focusLine(1))
}

watch(() => draft.value?.content ?? '', (content) => {
  if (frontmatterTimer !== undefined) window.clearTimeout(frontmatterTimer)
  const documentId = draft.value?.id ?? ''
  if (documentId !== frontmatterDocumentId) {
    frontmatterDocumentId = documentId
    frontmatter.value = undefined
    frontmatterExpanded.value = false
    closeFrontmatterMenu()
  }
  if (!/^\ufeff?---(?:\r?\n|$)/.test(content)) {
    frontmatter.value = undefined
    frontmatterExpanded.value = false
    closeFrontmatterMenu()
    return
  }
  const delay = content.length > 240_000 ? 260 : 140
  frontmatterTimer = window.setTimeout(() => {
    if (draft.value?.id !== documentId) return
    frontmatter.value = parseMarkdownFrontmatter(content)
    if (!frontmatter.value) frontmatterExpanded.value = false
  }, delay)
}, { immediate: true })

watch(() => draft.value?.content ?? '', (content) => {
  if (previewTimer !== undefined) window.clearTimeout(previewTimer)
  if (content.length > EXPLICIT_MARKDOWN_PREVIEW_THRESHOLD) {
    // Rendering a multi-megabyte document into one DOM tree is expensive even
    // when parsing happens in a Worker. Keep the virtualized CodeMirror view
    // responsive and make the costly reader view an explicit action.
    if (fullLargePreviewRequested.value) fullLargePreviewRequested.value = false
    previewRenderDurationMs.value = undefined
    previewSource.value = `> ${deferredMarkdownPreviewMessage()}`
    previewPending.value = false
    return
  }
  const normalized = normalizedPreview(content)
  const delay = content.length > 240_000 ? 420 : content.length > 48_000 ? 220 : 140
  previewPending.value = true
  previewTimer = window.setTimeout(() => {
    // Frontmatter edits can leave the visible Markdown unchanged. In that
    // case no worker request will follow, so finish the status locally.
    if (previewSource.value === normalized) { previewPending.value = false; return }
    previewSource.value = normalized
  }, delay)
}, { immediate: true })

function normalizeMarkdownOutline(items: MarkdownOutlineItem[]) {
  const title = normalizeWikiTitle(draft.value?.title ?? '')
  return items
    .filter((item, index) => !(index === 0 && title && normalizeWikiTitle(item.label) === title))
    .map((item, index) => ({ ...item, index }))
}

function applyLargeMarkdownOutline(items: MarkdownOutlineItem[], requestId: number) {
  if (requestId !== outlineIndexRequestId || !isHugeDocument.value || !inspectorOpen.value) return
  markdownOutline.value = normalizeMarkdownOutline(items)
  outlinePending.value = false
}

function ensureOutlineIndexWorker() {
  if (outlineIndexWorker || outlineIndexWorkerUnavailable || typeof Worker === 'undefined') return outlineIndexWorker
  outlineIndexWorker = new Worker(new URL('../workers/markdown-outline.worker.ts', import.meta.url), { type: 'module' })
  outlineIndexWorker.onmessage = ({ data }: MessageEvent<{ id: number; items?: MarkdownOutlineItem[]; error?: string }>) => {
    if (data.error || !data.items) {
      if (data.id === outlineIndexRequestId) outlinePending.value = false
      return
    }
    applyLargeMarkdownOutline(data.items, data.id)
  }
  outlineIndexWorker.onerror = () => {
    outlineIndexWorker?.terminate()
    outlineIndexWorker = undefined
    outlineIndexWorkerUnavailable = true
    if (isHugeDocument.value && inspectorOpen.value) scheduleLargeMarkdownOutline()
  }
  return outlineIndexWorker
}

function scheduleLargeMarkdownOutline() {
  if (outlineIndexTimer !== undefined) window.clearTimeout(outlineIndexTimer)
  const requestId = ++outlineIndexRequestId
  const source = draft.value?.content ?? ''
  if (!source || !isHugeDocument.value || !inspectorOpen.value) {
    outlinePending.value = false
    return
  }
  outlinePending.value = true
  outlineIndexTimer = window.setTimeout(() => {
    const worker = ensureOutlineIndexWorker()
    if (worker) {
      worker.postMessage({ id: requestId, source })
      return
    }
    // Worker support is present in Tauri and modern browsers. Keep a
    // synchronous fallback only for older preview environments.
    window.setTimeout(() => applyLargeMarkdownOutline(extractMarkdownOutline(source), requestId), 0)
  }, source.length > 2_000_000 ? 420 : 220)
}

watch([() => draft.value?.content ?? '', isHugeDocument, inspectorOpen], () => {
  if (isHugeDocument.value && inspectorOpen.value) scheduleLargeMarkdownOutline()
  else {
    ++outlineIndexRequestId
    if (outlineIndexTimer !== undefined) window.clearTimeout(outlineIndexTimer)
    outlinePending.value = false
  }
}, { immediate: true })

function askUnsavedDecision(targetLabel: string) {
  if (unsavedResolver) unsavedResolver('stay')
  unsavedPrompt.value = { targetLabel }
  return new Promise<UnsavedDocumentDecision>((resolve) => {
    unsavedResolver = resolve
  })
}

function resolveUnsavedDecision(decision: UnsavedDocumentDecision) {
  const resolve = unsavedResolver
  unsavedResolver = undefined
  unsavedPrompt.value = null
  resolve?.(decision)
}

async function confirmDocumentTransition(targetLabel: string) {
  let discarded = false
  const allowed = await allowDocumentTransition(documentDirty.value, async () => {
    const decision = await askUnsavedDecision(targetLabel)
    discarded = decision === 'discard'
    return decision
  }, save)
  if (allowed && discarded) {
    await clearCurrentRecovery()
    documentDirty.value = false
  }
  return allowed
}

async function loadCrashDraft(document: StudyDocument | null) {
  const revision = ++crashDraftRevision
  window.clearTimeout(crashDraftTimer)
  crashDraft.value = undefined
  crashDraftState.value = 'idle'
  if (!document) return
  try {
    const record = await getEditorCrashDraft('document', document.id)
    if (revision !== crashDraftRevision || selectedId.value !== document.id) return
    if (parseUsableEditorCrashDraft(record, document, 'document')) crashDraft.value = record ?? undefined
    else if (record) await deleteEditorCrashDraft('document', document.id)
  } catch {
    if (revision === crashDraftRevision) crashDraftState.value = 'error'
  }
}
function resetDocumentAutoSaveState() {
  if (autoSaveTimer !== undefined) window.clearTimeout(autoSaveTimer)
  if (autoSaveStatusTimer !== undefined) window.clearTimeout(autoSaveStatusTimer)
  autoSaveTimer = undefined
  autoSaveStatusTimer = undefined
  autoSaveState.value = 'idle'
}
function scheduleDocumentAutoSave() {
  if (autoSaveTimer !== undefined) window.clearTimeout(autoSaveTimer)
  if (autoSaveStatusTimer !== undefined) window.clearTimeout(autoSaveStatusTimer)
  autoSaveTimer = undefined
  autoSaveStatusTimer = undefined
  const current = draft.value
  if (!store.settings.documentAutoSave || !current || !documentDirty.value || documentSaveInProgress.value) {
    if (!documentSaveInProgress.value) autoSaveState.value = 'idle'
    return
  }
  const id = current.id
  autoSaveState.value = 'scheduled'
  autoSaveTimer = window.setTimeout(() => {
    autoSaveTimer = undefined
    if (!store.settings.documentAutoSave || !draft.value || draft.value.id !== id || !documentDirty.value) return
    if (managedVaultAlert.value?.documentId === id || (draft.value.externalFile && (externalFileChanged.value || externalFileUnavailable.value))) {
      autoSaveState.value = 'paused'
      return
    }
    void save({ automatic: true })
  }, documentAutoSavePolicy(current.content.length).delayMs)
}
function scheduleCrashDraft() {
  window.clearTimeout(crashDraftTimer)
  const current = draft.value
  if (!current || !documentDirty.value) return
  const id = current.id
  // Continuing from the persisted version is an explicit choice not to use
  // the older offered snapshot. The new recovery point replaces it shortly.
  crashDraft.value = undefined
  crashDraftState.value = 'pending'
  crashDraftTimer = window.setTimeout(async () => {
    if (!draft.value || draft.value.id !== id || !documentDirty.value) return
    try {
      await saveEditorCrashDraft('document', cloneStudyDocument(draft.value))
      if (draft.value?.id === id && documentDirty.value) {
        crashDraftState.value = 'saved'
      }
    } catch (error) {
      crashDraftState.value = error instanceof RangeError ? 'oversize' : 'error'
    }
  }, editorCrashDraftDelay(current.content.length))
}
async function clearCurrentRecovery() {
  window.clearTimeout(crashDraftTimer)
  const id = draft.value?.id ?? selectedId.value
  crashDraft.value = undefined
  crashDraftState.value = 'idle'
  if (id) await deleteEditorCrashDraft('document', id).catch(() => undefined)
}
async function restoreCrashDraft() {
  const current = selected.value
  const record = crashDraft.value
  if (!current || !record) return
  crashDraftBusy.value = true
  const recovered = parseUsableEditorCrashDraft(record, current, 'document')
  if (recovered) {
    replaceDraft(recovered, true)
    crashDraft.value = undefined
    crashDraftState.value = 'saved'
    scheduleCrashDraft()
    mode.value = 'edit'
    ui.toast('已恢复未完成文档', '内容仍是未保存修改；确认后请按 Ctrl+S。', 'success')
  }
  crashDraftBusy.value = false
}
async function discardCrashDraft() {
  crashDraftBusy.value = true
  await clearCurrentRecovery()
  crashDraftBusy.value = false
}

function handleDocumentBeforeUnload(event: BeforeUnloadEvent) {
  if (!documentDirty.value) return
  event.preventDefault()
  event.returnValue = ''
}

async function switchToDocument(document: StudyDocument, targetLabel = `“${document.title}”`) {
  if (selectedId.value === document.id) return true
  if (!await confirmDocumentTransition(targetLabel)) return false
  selectedId.value = document.id
  saved.value = false
  return true
}

function persistDocumentTabs() {
  if (!store.vaultReady) return
  localStorage.setItem(DOCUMENT_WORKSPACE_TABS_KEY, JSON.stringify(documentTabs.value))
  if (selectedId.value) localStorage.setItem(DOCUMENT_WORKSPACE_ACTIVE_KEY, selectedId.value)
  else localStorage.removeItem(DOCUMENT_WORKSPACE_ACTIVE_KEY)
}
function setDocumentTabs(next: DocumentWorkspaceTab[]) {
  documentTabs.value = next
  persistDocumentTabs()
}
async function activateWorkspaceTab(id: string) {
  const document = store.documents.find((item) => item.id === id)
  if (!document) return false
  if (!await switchToDocument(document, `切换到“${document.title}”`)) return false
  const query: Record<string, string> = { kind: document.kind, document: document.id }
  if (mode.value !== 'preview') query.mode = mode.value
  await router.replace({ path: '/documents', query })
  return true
}
async function closeWorkspaceTab(id: string) {
  if (documentTabs.value.length <= 1) {
    ui.toast('至少保留一个工作标签', '可以从左侧列表打开其他文档后再关闭。', 'info')
    return false
  }
  const document = store.documents.find((item) => item.id === id)
  const result = closeDocumentWorkspaceTab(documentTabs.value, id, selectedId.value)
  if (id === selectedId.value && !await confirmDocumentTransition(`关闭“${document?.title || '当前文档'}”标签`)) return false
  setDocumentTabs(result.tabs)
  if (id === selectedId.value && result.nextActiveId) await activateWorkspaceTab(result.nextActiveId)
  return true
}
async function applyBulkTabClose(next: DocumentWorkspaceTab[], fallbackId: string, targetLabel: string) {
  if (!next.length || next.length === documentTabs.value.length) return
  const closesActive = !next.some((tab) => tab.id === selectedId.value)
  if (closesActive && !await confirmDocumentTransition(targetLabel)) return
  setDocumentTabs(next)
  if (closesActive) await activateWorkspaceTab(fallbackId)
}
async function closeOtherWorkspaceTabs(id: string) {
  await applyBulkTabClose(closeOtherDocumentWorkspaceTabs(documentTabs.value, id), id, '关闭其他文档标签')
}
async function closeWorkspaceTabsToRight(id: string) {
  await applyBulkTabClose(closeDocumentWorkspaceTabsToRight(documentTabs.value, id), id, '关闭右侧文档标签')
}
function toggleWorkspaceTabPin(id: string) {
  const next = toggleDocumentWorkspaceTabPin(documentTabs.value, id)
  if (next === documentTabs.value) {
    ui.toast('固定标签已达上限', '最多固定 9 个标签，并为新打开的文档保留一个位置。', 'info')
    return
  }
  setDocumentTabs(next)
}
async function copyWorkspaceTabLink(id: string) {
  const document = store.documents.find((item) => item.id === id)
  if (!document) return
  try {
    await navigator.clipboard.writeText(`[[${document.title}]]`)
    ui.toast('已复制文档双链', `[[${document.title}]]`, 'success')
  } catch (error) {
    ui.toast('无法写入剪贴板', error instanceof Error ? error.message : '系统剪贴板暂不可用。', 'error')
  }
}

function routeChangesEditingContext(to: { path: string; query: Record<string, unknown> }) {
  if (to.path !== route.path) return true
  const targetId = typeof to.query.document === 'string' ? to.query.document : ''
  return Boolean(targetId && targetId !== selectedId.value) || to.query.kind !== route.query.kind
}

onBeforeRouteLeave(() => confirmDocumentTransition('离开文档工作区'))
onBeforeRouteUpdate((to) => routeChangesEditingContext(to) ? confirmDocumentTransition('打开其他内容') : true)

watch(()=>route.query.document,id=>{if(typeof id==='string'&&store.documents.some(doc=>doc.id===id))selectedId.value=id},{immediate:true})
watch([() => store.vaultReady, () => store.documents.map((document) => document.id).join('|')], ([ready]) => {
  if (!ready) return
  const requestedId = typeof route.query.document === 'string' ? route.query.document : ''
  const restored = !requestedId && store.documents.find((document) => document.id === persistedDocumentTabActiveId && (!route.query.kind || document.kind === route.query.kind))
  if (restored && selectedId.value !== restored.id) selectedId.value = restored.id
  const source = documentTabs.value.length ? documentTabs.value : persistedDocumentTabPayload
  let next = normalizeDocumentWorkspaceTabs(source, store.documents.map((document) => document.id))
  if (selectedId.value && store.documents.some((document) => document.id === selectedId.value)) next = openDocumentWorkspaceTab(next, selectedId.value)
  setDocumentTabs(next)
}, { immediate: true })

watch([() => draft.value?.id ?? '', () => draft.value?.content ?? ''], () => scheduleDocumentStatistics(), { immediate: true })
watch(selectedId, (id) => {
  if (!store.vaultReady || !id || !store.documents.some((document) => document.id === id)) return
  setDocumentTabs(openDocumentWorkspaceTab(documentTabs.value, id))
})
watch(() => route.query.mode, (next) => {
  const nextMode = documentEditorMode(next)
  if (nextMode && nextMode !== mode.value) mode.value = nextMode
})
watch(mode, (nextMode) => {
  const routedMode = documentEditorMode(route.query.mode)
  if (routedMode === nextMode || (!routedMode && nextMode === 'preview')) return
  const { mode: _mode, ...query } = route.query
  router.replace({ path: '/documents', query: nextMode === 'preview' ? query : { ...query, mode: nextMode } })
})
watch([() => route.query.kind, docs], ([kind, visibleDocuments]) => {
  const requestedId = typeof route.query.document === 'string' ? route.query.document : ''
  const requested = visibleDocuments.find(document => document.id === requestedId)
  const currentVisible = visibleDocuments.some(document => document.id === selectedId.value)
  if (requested) selectedId.value = requested.id
  else if (!currentVisible && !documentDirty.value) selectedId.value = visibleDocuments[0]?.id ?? ''
  if (!kind && !selectedId.value && store.documents[0]) selectedId.value = store.documents[0].id
}, { immediate: true })
watch(relationQuery, (value) => {
  if (relationSearchTimer !== undefined) window.clearTimeout(relationSearchTimer)
  relationResults.value = []
  relationSearchError.value = ''
  const needle = value.trim()
  if (!relationComposerOpen.value || !needle) { relationSearchGate.invalidate(); relationSearching.value = false; return }
  const sequence = relationSearchGate.begin()
  relationSearching.value = true
  relationSearchTimer = window.setTimeout(async () => {
    try {
      await loadVisualRelationCatalog()
      const results = await store.searchDocuments(needle)
      const entityResults = results.filter((result): result is DesktopVaultSearchResult & { kind: Exclude<DesktopVaultSearchResult['kind'], 'source'> } => result.kind !== 'source')
      if (relationSearchGate.isCurrent(sequence)) relationResults.value = mergeRelationTargets(entityResults, visualRelationCatalog.value, needle, draft.value?.id)
    } catch (error) {
      if (relationSearchGate.isCurrent(sequence)) relationSearchError.value = error instanceof Error ? error.message : '本地资料暂时无法搜索。'
    } finally {
      if (relationSearchGate.isCurrent(sequence)) relationSearching.value = false
    }
  }, 160)
})

async function pick(document: StudyDocument) { await switchToDocument(document) }
function updateDocumentListViewport() {
  documentListHeight.value = Math.max(1, documentListElement.value?.clientHeight ?? 360)
}
function handleDocumentListScroll(event: Event) {
  documentListScrollTop.value = (event.currentTarget as HTMLElement).scrollTop
  if (documentMenu.value) closeDocumentMenu()
}
function updateOutlineListViewport() {
  outlineListHeight.value = Math.max(1, outlineListElement.value?.clientHeight ?? 220)
}
function handleOutlineListScroll(event: Event) {
  outlineScrollTop.value = (event.currentTarget as HTMLElement).scrollTop
}
function scrollDocumentIntoView(id = selectedId.value) {
  const element = documentListElement.value
  const index = docs.value.findIndex((document) => document.id === id)
  if (!element || index < 0) return
  const top = index * DOCUMENT_LIST_ROW_HEIGHT
  const bottom = top + DOCUMENT_LIST_ROW_HEIGHT
  if (top >= element.scrollTop && bottom <= element.scrollTop + element.clientHeight) return
  element.scrollTo({ top: Math.max(0, top - Math.floor(element.clientHeight * .34)), behavior: 'auto' })
}
function openNewDocument(document: StudyDocument, preferredMode: DocumentEditorMode = 'edit') {
  selectedId.value = document.id
  // Let the route-mode watcher update the visible mode. Mutating `mode` here
  // starts a second router.replace with the old document query and can race
  // away the new document id when creation begins from preview mode.
  return router.replace(createdDocumentRoute(document.kind, document.id, preferredMode, markdownInsertRequest(route.query.insert), route.query.recognize === 'formula' ? 'formula' : undefined))
}
async function createQuestion(preferredMode?: unknown) {
  if (!await confirmDocumentTransition('新建错题')) return
  inspectorOpen.value = true
  openNewDocument(store.createQuestion(), documentEditorMode(preferredMode) ?? 'edit')
}
async function openQuestionImport() {
  if (isNotes.value) return
  if (!await confirmDocumentTransition('批量导入题目')) {
    if (route.query.import === '1') await router.replace({ path: '/documents', query: { kind: 'question', ...(selectedId.value ? { document: selectedId.value } : {}) } })
    return
  }
  questionImportOpen.value = true
}
function openQuestionImportFromKeyboard(event: KeyboardEvent) {
  if (!isContextMenuShortcut(event)) return
  event.preventDefault(); event.stopPropagation(); void openQuestionImport()
}
async function closeQuestionImport() {
  questionImportOpen.value = false
  if (route.query.import === '1') await router.replace({ path: '/documents', query: { kind: 'question', ...(selectedId.value ? { document: selectedId.value } : {}) } })
}
async function completeQuestionImport(summary: { imported: number; skipped: number; reviewCards: number; firstId?: string }) {
  await closeQuestionImport()
  const first = summary.firstId ? store.documents.find(document => document.id === summary.firstId) : undefined
  if (first) openNewDocument(first, 'preview')
  ui.toast(`已导入 ${summary.imported} 道题`, `${summary.reviewCards} 张复习卡已安排${summary.skipped ? ` · 跳过 ${summary.skipped} 道重复题` : ''}`, 'success')
}
async function createNote(preferredMode?: unknown) {
  if (!await confirmDocumentTransition('新建笔记')) return
  openNewDocument(store.createNote('未命名笔记', folderFilter.value), documentEditorMode(preferredMode) ?? 'edit')
}
function closeNoteStarterMenu(restoreFocus = false) {
  noteStarterMenu.value = null
  if (restoreFocus) void nextTick(() => noteStarterMenuTrigger?.focus())
}
function openNoteStarterMenu(event: MouseEvent | KeyboardEvent) {
  if (!isNotes.value) return
  closeDocumentMenu()
  closeRelationMenu()
  closeWikiContextMenu()
  closeHeadingContextMenu()
  noteStarterMenuTrigger = event.currentTarget instanceof HTMLElement ? event.currentTarget : undefined
  noteStarterMenu.value = menuPosition(event, 296, 61 + noteStarterTemplates.length * 59)
  focusContextMenu(noteStarterMenuElement)
}
function openNoteStarterMenuFromKeyboard(event: KeyboardEvent) {
  if (!isContextMenuShortcut(event)) return
  event.preventDefault()
  event.stopPropagation()
  openNoteStarterMenu(event)
}
function openBlankDraftContextMenu(event: MouseEvent) {
  // A blank note is a natural place to choose a starting structure. Questions
  // have their own inspector, so preserve the ordinary browser/editor menu
  // there rather than swallowing a right click that has no action.
  if (!isNotes.value) return
  event.preventDefault()
  openNoteStarterMenu(event)
}
function previewTargetNeedsNativeMenu(event: MouseEvent) {
  if (!(event.target instanceof Element)) return false
  // Links and embedded media have useful browser menus (copy address, save
  // image, controls). Markdown's wiki/heading/diagram handlers additionally
  // prevent the event before it reaches this wrapper.
  return Boolean(event.target.closest('a, button, input, select, textarea, [contenteditable="true"], img, video, audio'))
}
function canOpenPreviewDocumentMenu(event?: MouseEvent) {
  return previewMenuEnabled.value
    && !event?.defaultPrevented
    && !(event && previewTargetNeedsNativeMenu(event))
}
function openPreviewDocumentMenu(event: MouseEvent) {
  if (event.defaultPrevented) return
  const payload = capturedPreviewSelection()
  if (payload) {
    event.preventDefault()
    event.stopPropagation()
    openPreviewSelectionMenu(payload, event.clientX, event.clientY)
    return
  }
  const document = draft.value
  if (!document || !canOpenPreviewDocumentMenu(event)) return
  event.preventDefault()
  event.stopPropagation()
  openDocumentMenu(event, document)
}
function openPreviewDocumentMenuFromKeyboard(event: KeyboardEvent) {
  if (!isContextMenuShortcut(event)) return
  const payload = capturedPreviewSelection()
  if (payload) {
    event.preventDefault()
    event.stopPropagation()
    const bounds = window.getSelection()?.getRangeAt(0).getBoundingClientRect()
    const targetBounds = previewContextTarget.value?.getBoundingClientRect()
    openPreviewSelectionMenu(payload, bounds?.right || targetBounds?.left || 16, bounds?.bottom || targetBounds?.top || 16)
    return
  }
  const document = draft.value
  if (!document || !canOpenPreviewDocumentMenu()) return
  event.preventDefault()
  event.stopPropagation()
  openDocumentMenu(event, document)
}
async function createNoteFromTemplate(template: NoteStarterTemplate, preferredMode: DocumentEditorMode = 'edit') {
  if (!await confirmDocumentTransition(`用“${template.label}”新建笔记`)) return
  const title = nextAvailableNoteTitle(template.title, store.documents.map((item) => item.title))
  const document = store.createNote(title, folderFilter.value, noteTemplateContent(template, title))
  const next = { ...document, subject: template.subject, tags: [...template.tags] }
  store.saveDocument(next)
  closeNoteStarterMenu()
  openNewDocument(next, preferredMode)
  ui.toast('已用“' + template.label + '”创建笔记', '模板只提供起点，内容仍是普通本地 Markdown。', 'success')
}
function beginBlankDraft() {
  if (!draft.value) return
  focusEditorOnMount.value = true
  mode.value = 'edit'
  if (draft.value.kind === 'question') inspectorOpen.value = true
}
function showSaved() { saved.value = true; window.setTimeout(() => saved.value = false, 1600) }
function syncDraft(next: StudyDocument) { if (draft.value?.id === next.id) replaceDraft(next) }
function updateDraftContent(value: string, documentId?: string) {
  // CodeMirror flushes its last buffered edit while unmounting. Desktop Vault
  // navigation intentionally clears the draft while the next body loads, so
  // never let that final emit write through a temporarily null v-model path.
  if (draft.value && (!documentId || draft.value.id === documentId) && draft.value.content !== value) draft.value.content = value
}
function markEditorPending() {
  // The full multi-megabyte string stays inside CodeMirror until the adaptive
  // timer fires, but navigation must know about the edit immediately.
  if (draft.value) {
    draftEditRevision += 1
    documentDirty.value = true
    scheduleDocumentAutoSave()
  }
}
function questionReviewFacetEnabled(document: StudyDocument, facet: QuestionReviewFacet) {
  return Boolean(questionReviewForFacet(document, facet))
}
function toggleQuestionReviewFacet(document: StudyDocument, facet: QuestionReviewFacet) {
  const existing = questionReviewForFacet(document, facet)
  if (existing) {
    Object.assign(document, withQuestionReviewFacet(document, facet))
    return
  }
  const details = document.questionDetails
  if (facet === 'answer' && !details?.answer.trim() && !details?.explanation.trim()) {
    ui.toast('先写下答案或解析，再加入答案回忆。', undefined, 'info')
    return
  }
  if (facet === 'error' && !details?.wrongAnswer.trim() && !details?.errorReason.trim()) {
    ui.toast('先记录错误做法或错误原因，再加入错因复盘。', undefined, 'info')
    return
  }
  Object.assign(document, withQuestionReviewFacet(document, facet, createQuestionReviewState()))
}

function closeQuestionStructureMenu(restoreFocus = false) {
  questionStructureMenu.value = null
  if (restoreFocus) void nextTick(() => questionStructureMenuTrigger?.focus({ preventScroll: true }))
}

async function openQuestionStructure(field?: QuestionStructureField) {
  if (draft.value?.kind !== 'question') return
  inspectorOpen.value = true
  closeQuestionStructureMenu()
  await nextTick()
  const section = questionDetailsSectionElement.value
  const target = field ? section?.querySelector<HTMLTextAreaElement>(`[data-question-field="${field}"]`) : undefined
  const focusTarget = target ?? section?.querySelector<HTMLTextAreaElement>('textarea')
  focusTarget?.scrollIntoView({ block: 'center', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
  focusTarget?.focus({ preventScroll: true })
}

function openQuestionStructureMenu(event: MouseEvent | KeyboardEvent) {
  if (draft.value?.kind !== 'question') return
  if (event instanceof KeyboardEvent && !isContextMenuShortcut(event)) return
  event.preventDefault()
  event.stopPropagation()
  closeDocumentMenu()
  closeEditorContextMenu()
  questionStructureMenuTrigger = event.currentTarget instanceof HTMLElement ? event.currentTarget : undefined
  const bounds = questionStructureMenuTrigger?.getBoundingClientRect()
  const x = 'clientX' in event && event.clientX ? event.clientX : (bounds?.right ?? 16) - 24
  const y = 'clientY' in event && event.clientY ? event.clientY : (bounds?.top ?? 16) + 36
  const sourceRows = Number(Boolean(currentQuestionSource.value.raw)) + Number(currentQuestionSource.value.kind !== 'text')
  questionStructureMenu.value = clampMenuPosition(x, y, { menuWidth: 244, menuHeight: 286 + sourceRows * 34, margin: 12 })
  void nextTick(() => questionStructureMenuElement.value?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus())
}

function toggleCurrentQuestionReview(facet: QuestionReviewFacet) {
  if (draft.value?.kind !== 'question') return
  toggleQuestionReviewFacet(draft.value, facet)
  closeQuestionStructureMenu(true)
}

async function openQuestionStructureFromDocument(document: StudyDocument, field?: QuestionStructureField) {
  if (document.kind !== 'question' || !await switchToDocument(document)) return
  closeDocumentMenu()
  await openQuestionStructure(field)
}

function openCurrentQuestionReview() {
  if (draft.value?.kind !== 'question') return
  const kind = questionReviewFacetEnabled(draft.value, 'error') ? 'error' : 'question'
  closeQuestionStructureMenu()
  void router.push({ path: '/review', query: { kind } })
}
async function copyCurrentQuestionSource() {
  const source = currentQuestionSource.value.raw
  if (!source) return
  try {
    await navigator.clipboard.writeText(source)
    ui.toast('已复制题目来源', source.slice(0, 100), 'success')
    closeQuestionStructureMenu(true)
  } catch (error) {
    ui.toast('无法复制题目来源', readableError(error), 'error')
  }
}
async function openCurrentQuestionSource() {
  const source = currentQuestionSource.value
  if (source.kind === 'text') return
  closeQuestionStructureMenu()
  await openStandardMarkdownLink(source.href, source.label)
}
function readableError(error: unknown) { return error instanceof Error ? error.message : '文件操作没有完成。' }

async function save(options: { automatic?: boolean } = {}): Promise<boolean> {
  const automatic = options.automatic === true
  if (!draft.value || documentSaveInProgress.value) return false
  if (managedVaultAlert.value?.documentId === draft.value.id) {
    autoSaveState.value = 'paused'
    if (!automatic) {
      if (managedVaultAlert.value.status === 'pending') await openManagedVaultConflict()
      else ui.toast('Vault Markdown 文件缺失', '请先从提示条重新创建文件或查看版本历史。', 'warning')
    }
    return false
  }
  if (autoSaveTimer !== undefined) window.clearTimeout(autoSaveTimer)
  autoSaveTimer = undefined
  documentSaveInProgress.value = true
  if (automatic) autoSaveState.value = 'saving'
  // Keyboard save does not blur CodeMirror. Pull its buffered text into the
  // draft before cloning so a fast Ctrl+S cannot persist the previous body.
  editorSurface.value?.flush()
  const editRevision = draftEditRevision
  const next = cloneStudyDocument(draft.value)
  let staleDuringSave = false
  try {
    if (next.externalFile && isDesktop()) {
      try {
        let state
        try {
          state = await writeExternalMarkdown(next.externalFile.path, next.content, next.externalFile.hash)
        } catch (error) {
          if (automatic) {
            autoSaveState.value = 'paused'
            return false
          }
          if (readableError(error).includes('外部文件已被其他程序修改')) {
            externalFileChanged.value = true
            autoSaveState.value = 'paused'
            await openExternalConflictReview(next)
            return false
          }
          throw error
        }
        next.externalFile = { ...next.externalFile, hash: state.hash, modifiedAt: state.modifiedAt, size: state.size }
        externalFileChanged.value = false
        externalFileUnavailable.value = false
      } catch (error) {
        if (automatic) autoSaveState.value = 'error'
        else ui.toast(`外部文件保存失败：${readableError(error)}`, undefined, 'error')
        return false
      }
    }
    staleDuringSave = draftEditRevision !== editRevision || draft.value?.id !== next.id
    if (staleDuringSave) {
      if (next.externalFile && draft.value?.id === next.id) {
        replacingDraft = true
        draft.value.externalFile = { ...next.externalFile }
        replacingDraft = false
      }
      return false
    }
    store.saveDocument(next)
    syncDraft(next)
    await clearCurrentRecovery()
    if (automatic) {
      autoSaveState.value = 'saved'
      autoSaveStatusTimer = window.setTimeout(() => {
        autoSaveStatusTimer = undefined
        if (!documentDirty.value && autoSaveState.value === 'saved') autoSaveState.value = 'idle'
      }, 2600)
    } else {
      autoSaveState.value = 'idle'
      showSaved()
    }
    if (inspectorOpen.value && isDesktop()) window.setTimeout(() => void loadDocumentVersions(next.id), 180)
    return true
  } catch (error) {
    if (automatic) autoSaveState.value = 'error'
    else ui.toast('文档保存失败', readableError(error), 'error')
    return false
  } finally {
    documentSaveInProgress.value = false
    if (staleDuringSave && documentDirty.value) scheduleDocumentAutoSave()
  }
}

async function importMarkdown() {
  if (!isDesktop()) { ui.toast('打开本地 Markdown 需要桌面模式。', undefined, 'info'); return }
  const path = await open({ title: '打开 Markdown 文件', multiple: false, filters: [{ name: 'Markdown', extensions: ['md', 'mdx', 'markdown', 'mkd'] }] })
  if (typeof path !== 'string') return
  await openExternalMarkdownPath(path)
}

function normalizedExternalPath(path: string) {
  return externalWorkspacePathKey(path)
}

function applyPendingEditorLineTarget() {
  const target = pendingEditorLineTarget.value
  if (!target || draft.value?.id !== target.documentId || (mode.value !== 'edit' && mode.value !== 'split') || !editorSurface.value) return
  outlineEditorTarget.value = {
    line: target.line,
    query: target.query,
    revision: (outlineEditorTarget.value?.revision ?? 0) + 1,
  }
  pendingEditorLineTarget.value = undefined
  ui.toast(`已定位到第 ${target.line} 行`, target.query ? '已选中正文里的匹配内容。' : '编辑光标已移到命中位置。', 'success')
}

function queueEditorLineTarget(documentId: string, line?: number, query?: string) {
  if (!line || !Number.isFinite(line)) return
  pendingEditorLineTarget.value = { documentId, line: Math.max(1, Math.round(line)), ...(query?.trim() ? { query: query.trim().slice(0, 160) } : {}) }
  void nextTick(applyPendingEditorLineTarget)
}

async function openExternalMarkdownPath(path: string, line?: number, query?: string) {
  if (!isDesktop() && !externalWorkspaceQa) { ui.toast('打开本地 Markdown 需要桌面模式。', undefined, 'info'); return false }
  if (!await confirmDocumentTransition('打开本地 Markdown')) return false
  const existing = store.documents.find(document => document.externalFile && normalizedExternalPath(document.externalFile.path) === normalizedExternalPath(path))
  if (existing) {
    await openNewDocument(existing, line ? 'edit' : 'preview')
    queueEditorLineTarget(existing.id, line, query)
    if (!line) ui.toast(`已回到 ${existing.externalFile?.name ?? existing.title}`, '这个文件已经关联到资料库。', 'info')
    return true
  }
  try {
    const file = externalWorkspaceQa
      ? (await import('@/lib/external-workspace-qa')).externalWorkspaceQaMarkdown(externalWorkspaceQaRoot.value, path)
      : await readExternalMarkdown(path)
    const title = file.name.replace(/\.(md|mdx|markdown|mkd)$/i, '') || '未命名笔记'
    const document = store.createNote(title, folderFilter.value)
    const next = { ...document, content: file.content, externalFile: { path: file.path, name: file.name, hash: file.hash, modifiedAt: file.modifiedAt, size: file.size } }
    store.saveDocument(next)
    await openNewDocument(next, line ? 'edit' : 'preview')
    queueEditorLineTarget(next.id, line, query)
    if (!line) ui.toast(`已打开 ${file.name}`, undefined, 'success')
    return true
  } catch (error) { ui.toast(`无法打开 Markdown：${readableError(error)}`, undefined, 'error'); return false }
}

async function openStandardMarkdownLink(href: string, label: string) {
  const target = classifyMarkdownLink(href, draft.value?.externalFile?.path)
  try {
    if (target.kind === 'external') {
      await openExternalUrl(target.href)
      ui.toast('已交给系统打开链接', label, 'success')
      return
    }
    if (target.kind === 'anchor') {
      const heading = previewHeadings().find((item) => markdownHeadingMatchesFragment(item.textContent ?? '', target.fragment))
      if (!heading) { ui.toast('没有找到对应段落', target.fragment || '链接没有提供段落名称。', 'info'); return }
      heading.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' })
      heading.tabIndex = -1
      heading.focus({ preventScroll: true })
      ui.toast(`已跳到“${(heading.textContent ?? '').trim()}”`, undefined, 'success')
      return
    }
    if (target.kind === 'markdown') {
      if (!isDesktop() && !externalWorkspaceQa) { ui.toast('打开相对 Markdown 需要桌面模式。', target.path, 'info'); return }
      if (!await openExternalMarkdownPath(target.path)) return
      const opened = store.documents.find(document => document.externalFile && normalizedExternalPath(document.externalFile.path) === normalizedExternalPath(target.path))
      if (opened && target.fragment) await router.replace({ path: '/documents', query: { kind: opened.kind, document: opened.id, wikiHeading: target.fragment } })
      return
    }
    if (target.kind === 'file') {
      if (!isDesktop()) { ui.toast('打开相对附件需要桌面模式。', target.path, 'info'); return }
      await openExternalUrl(target.path)
      ui.toast('已交给系统打开本地文件', target.path.split(/[\\/]/).pop() || label, 'success')
      return
    }
    if (target.kind === 'unresolved-relative') {
      ui.toast('无法确定相对链接的位置', '请先把当前笔记关联到本机 Markdown 文件，再打开它的相对链接。', 'info')
      return
    }
    ui.toast('没有打开这个链接', '只允许网页、邮件、电话、本地文件和文内段落；危险或未知协议已拦截。', 'info')
  } catch (error) {
    ui.toast('链接没有打开', readableError(error), 'error')
  }
}

async function consumeDesktopMarkdownHandoff() {
  if (route.query.handoff !== 'desktop-markdown') return
  const incoming = consumeLocalFileHandoff('markdown')
  const { handoff: _handoff, request: _request, ...query } = route.query
  await router.replace({ path: '/documents', query })
  if (!incoming?.paths.length) return
  for (const path of incoming.paths) {
    if (!await openExternalMarkdownPath(path)) break
  }
}

function setMarkdownWorkspaceRoot(root: string) {
  store.updateSettings({ markdownWorkspaceDirectory: root })
  sidebarMode.value = 'workspace'
}

async function handleWorkspaceEntryRenamed(payload: { kind: 'directory' | 'markdown'; oldPath: string; newPath: string; newName: string }) {
  const affected = store.documents.filter(document => {
    const path = document.externalFile?.path
    return Boolean(path && remapExternalWorkspacePath(path, payload.oldPath, payload.newPath, payload.kind))
  })
  for (const metadata of affected) {
    const loaded = draft.value?.id === metadata.id ? cloneStudyDocument(draft.value) : await store.loadDocument(metadata.id)
    if (!loaded?.externalFile) continue
    const nextPath = remapExternalWorkspacePath(loaded.externalFile.path, payload.oldPath, payload.newPath, payload.kind)
    if (!nextPath) continue
    const next = cloneStudyDocument(loaded)
    const externalFile = loaded.externalFile
    next.externalFile = {
      ...externalFile,
      path: nextPath,
      name: payload.kind === 'markdown' ? payload.newName : nextPath.split(/[\\/]/).pop() || externalFile.name,
    }
    store.saveDocument(next)
    syncDraft(next)
  }
}

function handleWorkspaceEntryTrashed(payload: { kind: 'directory' | 'markdown'; path: string; relativePath: string; name: string }) {
  const currentPath = selected.value?.externalFile?.path
  if (!currentPath) return
  if (!externalWorkspaceEntryContainsPath(payload.path, currentPath, payload.kind)) return
  externalFileChanged.value = false
  externalFileUnavailable.value = true
}

async function saveAsMarkdown(document: StudyDocument) {
  if (!isDesktop()) { ui.toast('另存为 Markdown 需要桌面模式。', undefined, 'info'); return }
  const defaultPath = `${document.title.replace(/[\\/:*?"<>|]/g, '-').trim() || 'untitled'}.md`
  const path = await saveDialog({ title: '另存为并关联 Markdown', defaultPath, filters: [{ name: 'Markdown', extensions: ['md'] }] })
  if (typeof path !== 'string') return
  try {
    const state = await writeExternalMarkdown(path, document.content, undefined, true)
    const name = path.split(/[\\/]/).pop() || defaultPath
    const next = { ...cloneStudyDocument(document), externalFile: { path, name, hash: state.hash, modifiedAt: state.modifiedAt, size: state.size } }
    store.saveDocument(next)
    syncDraft(next)
    externalFileChanged.value = false
    externalFileUnavailable.value = false
    showSaved()
    ui.toast(`已关联 ${name}`, undefined, 'success')
  } catch (error) { ui.toast(`无法另存 Markdown：${readableError(error)}`, undefined, 'error') }
}

function ensureExternalConflictWorker() {
  if (externalConflictWorker || externalConflictWorkerUnavailable || typeof Worker === 'undefined') return externalConflictWorker
  externalConflictWorker = new Worker(new URL('../workers/external-markdown-conflict.worker.ts', import.meta.url), { type: 'module' })
  externalConflictWorker.onmessage = ({ data }: MessageEvent<{ id: number; preview?: ExternalMarkdownConflictPreview; error?: string }>) => {
    const pending = externalConflictWorkerPending.get(data.id)
    if (!pending) return
    externalConflictWorkerPending.delete(data.id)
    if (data.preview) pending.resolve(data.preview)
    else pending.reject(new Error(data.error || '无法建立冲突差异。'))
  }
  externalConflictWorker.onerror = () => {
    externalConflictWorker?.terminate()
    externalConflictWorker = undefined
    externalConflictWorkerUnavailable = true
    for (const pending of externalConflictWorkerPending.values()) pending.reject(new Error('冲突差异 Worker 暂不可用。'))
    externalConflictWorkerPending.clear()
  }
  return externalConflictWorker
}

async function buildExternalConflictPreview(base: string, current: string, disk: string) {
  const worker = ensureExternalConflictWorker()
  if (!worker) return externalMarkdownConflictPreview(base, current, disk)
  const id = ++externalConflictWorkerRequestId
  try {
    return await new Promise<ExternalMarkdownConflictPreview>((resolve, reject) => {
      externalConflictWorkerPending.set(id, { resolve, reject })
      worker.postMessage({ id, base, draft: current, disk })
    })
  } catch {
    externalConflictWorkerPending.delete(id)
    if (externalConflictWorkerDisposed) throw new Error('文档工作区已关闭。')
    return externalMarkdownConflictPreview(base, current, disk)
  }
}

function externalPayloadDocument(document: StudyDocument, file: ExternalMarkdownPayload) {
  return {
    ...cloneStudyDocument(document),
    content: file.content,
    externalFile: { path: file.path, name: file.name, hash: file.hash, modifiedAt: file.modifiedAt, size: file.size },
  }
}

function conflictBaseContent(documentId: string) {
  return store.documents.find((document) => document.id === documentId)?.content ?? ''
}

async function openExternalConflictReview(document: StudyDocument) {
  if (!document.externalFile) return
  externalConflictTrigger = globalThis.document.activeElement instanceof HTMLElement ? globalThis.document.activeElement : undefined
  closeExternalFileMenu()
  if (draft.value?.id === document.id) editorSurface.value?.flush()
  const current = cloneStudyDocument(draft.value?.id === document.id ? draft.value : document)
  externalConflictError.value = ''
  try {
    const disk = !isDesktop() && import.meta.env.DEV && route.query.qa === 'external-conflict'
      ? externalConflictQaDisk.value
      : await readExternalMarkdown(document.externalFile.path)
    if (!disk) return
    externalConflict.value = {
      documentId: document.id,
      current,
      disk,
      preview: await buildExternalConflictPreview(conflictBaseContent(document.id), current.content, disk.content),
    }
  } catch (error) {
    externalFileUnavailable.value = true
    ui.toast('无法读取外部文件', readableError(error), 'error')
  }
}

function hideExternalConflict(restoreFocus = true) {
  externalConflict.value = undefined
  externalConflictError.value = ''
  const trigger = externalConflictTrigger
  externalConflictTrigger = undefined
  if (restoreFocus) void nextTick(() => trigger?.focus({ preventScroll: true }))
}

function closeExternalConflict() {
  if (externalConflictBusy.value) return
  hideExternalConflict()
}

async function resolveExternalConflict(decision: 'stay' | 'keep-both' | 'use-disk' | 'overwrite-disk') {
  if (decision === 'stay') { closeExternalConflict(); return }
  const conflict = externalConflict.value
  if (!conflict || externalConflictBusy.value) return
  const current = cloneStudyDocument(conflict.current)
  const path = current.externalFile?.path
  if (!path) { closeExternalConflict(); return }
  externalConflictBusy.value = true
  externalConflictError.value = ''
  try {
    const fresh = await readExternalMarkdown(path)
    if (fresh.hash !== conflict.disk.hash) {
      externalConflict.value = {
        ...conflict,
        disk: fresh,
        preview: await buildExternalConflictPreview(conflictBaseContent(conflict.documentId), current.content, fresh.content),
      }
      externalConflictError.value = '磁盘文件在审阅期间再次变化，差异已经刷新；请重新确认。'
      return
    }

    let next: StudyDocument
    let preservedCopy: StudyDocument | undefined
    if (decision === 'overwrite-disk') {
      const state = await writeExternalMarkdown(path, current.content, fresh.hash)
      next = { ...current, externalFile: { ...current.externalFile!, hash: state.hash, modifiedAt: state.modifiedAt, size: state.size } }
    } else {
      if (decision === 'keep-both') {
        const createdAt = new Date().toISOString()
        preservedCopy = createIndependentDocumentCopy(current, newId(), createdAt)
        preservedCopy.title = `${current.title.trim() || '未命名笔记'} · 冲突草稿`
        // Conflict preservation must keep the draft byte-for-byte. A normal
        // duplicate may rename its first heading for convenience.
        preservedCopy.content = current.content
        if (!store.insertDocument(preservedCopy)) throw new Error('无法建立独立草稿副本，请重试。')
      }
      next = externalPayloadDocument(current, fresh)
    }

    store.saveDocument(next)
    if (draft.value?.id === next.id) syncDraft(next)
    externalFileChanged.value = false
    externalFileUnavailable.value = false
    autoSaveState.value = 'idle'
    await clearCurrentRecovery()
    showSaved()
    hideExternalConflict()
    if (preservedCopy) ui.toast('草稿和磁盘版本都已保留', `当前草稿已保存为“${preservedCopy.title}”，原文档已载入磁盘版本。`, 'success')
    else if (decision === 'overwrite-disk') ui.toast('已用当前草稿更新磁盘文件', '写入前再次核对了磁盘版本，没有跳过并发修改检查。', 'success')
    else ui.toast('已载入磁盘版本', '当前文档已与外部 Markdown 同步。', 'success')
  } catch (error) {
    externalConflictError.value = readableError(error)
    externalFileChanged.value = true
  } finally {
    externalConflictBusy.value = false
  }
}

async function reconcileManagedVaultIntoEditor() {
  const current = draft.value
  if (!current) return
  const result = await store.reconcileVaultMarkdown(current.id)
  if (result.status === 'missing') {
    managedVaultAlert.value = { documentId: current.id, status: 'missing' }
    managedVaultPendingDisk.value = undefined
    autoSaveState.value = 'paused'
    return
  }
  if (result.status === 'updated' && result.document) {
    replaceDraft(result.document)
    managedVaultAlert.value = undefined
    managedVaultPendingDisk.value = undefined
    resetDocumentAutoSaveState()
    await clearCurrentRecovery()
    if (inspectorOpen.value) void loadDocumentVersions(result.document.id)
    ui.toast('已载入磁盘中的 Markdown 修改', '全文搜索、双链和版本历史已经同步。', 'success')
  } else if (result.status === 'unchanged') {
    managedVaultAlert.value = undefined
    managedVaultPendingDisk.value = undefined
    resetDocumentAutoSaveState()
  }
}

async function handleManagedVaultMarkdownChange(event: Event) {
  const change = (event as CustomEvent<VaultMarkdownSurfaceChange>).detail
  const current = draft.value
  if (!change || !current || change.documentId !== current.id) return
  if (change.status === 'missing') {
    managedVaultAlert.value = { documentId: current.id, status: 'missing' }
    managedVaultPendingDisk.value = undefined
    resetDocumentAutoSaveState()
    autoSaveState.value = 'paused'
    return
  }
  if (change.status === 'updated' && change.document && !documentDirty.value) {
    replaceDraft(change.document)
    managedVaultAlert.value = undefined
    managedVaultPendingDisk.value = undefined
    resetDocumentAutoSaveState()
    await clearCurrentRecovery()
    ui.toast('已同步 Vault Markdown', '这篇文档由其他本机程序更新。', 'success')
    return
  }
  if (change.status !== 'pending' && change.status !== 'updated') return
  try {
    const disk = change.document ?? await getDesktopVaultDocument(current.id)
    if (!disk) return
    const base = conflictBaseContent(current.id)
    // Native writes performed by Knitspace also trigger the OS watcher. If
    // disk and the last committed store copy agree, this is not a conflict.
    if (disk.content === base && !change.document) {
      managedVaultAlert.value = undefined
      managedVaultPendingDisk.value = undefined
      return
    }
    if (!documentDirty.value) {
      await reconcileManagedVaultIntoEditor()
      return
    }
    managedVaultPendingDisk.value = cloneStudyDocument(disk)
    managedVaultAlert.value = { documentId: current.id, status: 'pending' }
    resetDocumentAutoSaveState()
    autoSaveState.value = 'paused'
  } catch (error) {
    ui.toast('无法读取变化后的 Vault Markdown', readableError(error), 'error')
  }
}

async function openManagedVaultConflict() {
  const current = draft.value
  if (!current || managedVaultAlert.value?.documentId !== current.id || managedVaultAlert.value.status !== 'pending') return
  editorSurface.value?.flush()
  if (!managedVaultMenu.value) managedVaultTrigger = globalThis.document.activeElement instanceof HTMLElement ? globalThis.document.activeElement : undefined
  closeManagedVaultMenu()
  managedVaultConflictError.value = ''
  try {
    const disk = managedVaultPendingDisk.value ?? await getDesktopVaultDocument(current.id)
    if (!disk) throw new Error('无法读取磁盘中的 Vault Markdown。')
    const snapshot = cloneStudyDocument(current)
    managedVaultConflict.value = {
      documentId: current.id,
      current: snapshot,
      disk: cloneStudyDocument(disk),
      preview: await buildExternalConflictPreview(conflictBaseContent(current.id), snapshot.content, disk.content),
    }
  } catch (error) {
    managedVaultConflictError.value = readableError(error)
    ui.toast('无法比较 Vault Markdown', managedVaultConflictError.value, 'error')
  }
}

function hideManagedVaultConflict(restoreFocus = true) {
  managedVaultConflict.value = undefined
  managedVaultConflictError.value = ''
  const trigger = managedVaultTrigger
  managedVaultTrigger = undefined
  if (restoreFocus) void nextTick(() => trigger?.focus({ preventScroll: true }))
}

async function resolveManagedVaultConflict(decision: 'stay' | 'keep-both' | 'use-disk' | 'overwrite-disk') {
  if (decision === 'stay') { if (!managedVaultConflictBusy.value) hideManagedVaultConflict(); return }
  const conflict = managedVaultConflict.value
  if (!conflict || managedVaultConflictBusy.value) return
  managedVaultConflictBusy.value = true
  managedVaultConflictError.value = ''
  try {
    const fresh = await getDesktopVaultDocument(conflict.documentId)
    if (!fresh) throw new Error('磁盘版本暂不可读取。')
    if (fresh.content !== conflict.disk.content) {
      managedVaultPendingDisk.value = cloneStudyDocument(fresh)
      managedVaultConflict.value = {
        ...conflict,
        disk: cloneStudyDocument(fresh),
        preview: await buildExternalConflictPreview(conflictBaseContent(conflict.documentId), conflict.current.content, fresh.content),
      }
      managedVaultConflictError.value = '磁盘文件在审阅期间再次变化，差异已经刷新；请重新确认。'
      return
    }
    if (decision === 'overwrite-disk') {
      const saved = await store.writeManagedVaultMarkdown(conflict.current)
      if (draft.value?.id === saved.id) replaceDraft(saved)
      managedVaultAlert.value = undefined
      managedVaultPendingDisk.value = undefined
      resetDocumentAutoSaveState()
      await clearCurrentRecovery()
      hideManagedVaultConflict(false)
      showSaved()
      ui.toast('已用当前草稿更新 Vault Markdown', '写入前重新核对了磁盘版本。', 'success')
      return
    }

    let preservedCopy: StudyDocument | undefined
    if (decision === 'keep-both') {
      const createdAt = new Date().toISOString()
      preservedCopy = createIndependentDocumentCopy(conflict.current, newId(), createdAt)
      preservedCopy.title = `${conflict.current.title.trim() || '未命名笔记'} · 冲突草稿`
      preservedCopy.content = conflict.current.content
      if (!store.insertDocument(preservedCopy)) throw new Error('无法建立独立草稿副本，请重试。')
    }
    const result = await store.reconcileVaultMarkdown(conflict.documentId)
    if (result.status === 'missing') throw new Error('Vault Markdown 已被移走；请返回后选择重新创建。')
    const next = result.document ?? fresh
    if (draft.value?.id === conflict.documentId) replaceDraft(next)
    managedVaultAlert.value = undefined
    managedVaultPendingDisk.value = undefined
    resetDocumentAutoSaveState()
    await clearCurrentRecovery()
    hideManagedVaultConflict(false)
    if (preservedCopy) ui.toast('草稿和磁盘版本都已保留', `当前草稿已保存为“${preservedCopy.title}”。`, 'success')
    else ui.toast('已使用磁盘版本', '全文搜索、双链与版本历史已经同步。', 'success')
  } catch (error) {
    managedVaultConflictError.value = readableError(error)
  } finally {
    managedVaultConflictBusy.value = false
  }
}

async function recreateManagedVaultMarkdown() {
  const current = draft.value
  if (!current || managedVaultAlert.value?.documentId !== current.id) return
  closeManagedVaultMenu()
  try {
    editorSurface.value?.flush()
    const saved = await store.writeManagedVaultMarkdown(cloneStudyDocument(draft.value ?? current))
    if (draft.value?.id === saved.id) replaceDraft(saved)
    managedVaultAlert.value = undefined
    managedVaultPendingDisk.value = undefined
    resetDocumentAutoSaveState()
    await clearCurrentRecovery()
    showSaved()
    ui.toast('已重新创建 Vault Markdown', '使用当前编辑器中的版本恢复了本机文件。', 'success')
  } catch (error) {
    managedVaultAlert.value = { documentId: current.id, status: 'missing' }
    autoSaveState.value = 'paused'
    ui.toast('无法重新创建 Vault Markdown', readableError(error), 'error')
  }
}

async function openManagedVaultVersionHistory() {
  closeManagedVaultMenu(true)
  if (!draft.value) return
  inspectorOpen.value = true
  await loadDocumentVersions(draft.value.id)
}

function closeManagedVaultMenu(restoreFocus = false) {
  managedVaultMenu.value = undefined
  if (restoreFocus) void nextTick(() => managedVaultTrigger?.focus({ preventScroll: true }))
}

function openManagedVaultMenu(event: MouseEvent | KeyboardEvent) {
  if (!managedVaultAlert.value || (event instanceof KeyboardEvent && !isContextMenuShortcut(event))) return
  event.preventDefault(); event.stopPropagation()
  managedVaultTrigger = event.currentTarget instanceof HTMLElement ? event.currentTarget : undefined
  const bounds = managedVaultTrigger?.getBoundingClientRect()
  const x = event instanceof MouseEvent ? event.clientX : (bounds?.right ?? 18) - 24
  const y = event instanceof MouseEvent ? event.clientY : (bounds?.bottom ?? 18) + 5
  managedVaultMenu.value = clampMenuPosition(x, y, { menuWidth: 270, menuHeight: 174, margin: 12 })
  void nextTick(() => managedVaultMenuElement.value?.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')?.focus({ preventScroll: true }))
}

async function copyManagedVaultDocumentId() {
  closeManagedVaultMenu(true)
  if (!draft.value) return
  try { await navigator.clipboard.writeText(draft.value.id); ui.toast('已复制文档 ID', draft.value.id, 'success') }
  catch { ui.toast('无法复制文档 ID', '系统剪贴板当前不可用。', 'error') }
}

function closeExternalFileMenu(restoreFocus = false) {
  externalFileMenu.value = undefined
  if (restoreFocus) void nextTick(() => externalFileMenuTrigger?.focus({ preventScroll: true }))
}

function openExternalFileMenu(event: MouseEvent | KeyboardEvent) {
  if (!draft.value?.externalFile) return
  if (event instanceof KeyboardEvent && !isContextMenuShortcut(event)) return
  event.preventDefault()
  event.stopPropagation()
  closeDocumentContextMenus()
  externalFileMenuTrigger = event.currentTarget instanceof HTMLElement ? event.currentTarget : undefined
  const bounds = externalFileMenuTrigger?.getBoundingClientRect()
  const x = event instanceof MouseEvent ? event.clientX : (bounds?.left ?? 12) + 32
  const y = event instanceof MouseEvent ? event.clientY : (bounds?.bottom ?? 12) + 6
  externalFileMenu.value = clampMenuPosition(x, y, { menuWidth: 270, menuHeight: externalFileChanged.value ? 282 : 246, margin: 12 })
  void nextTick(() => externalFileMenuElement.value?.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')?.focus({ preventScroll: true }))
}

async function recheckExternalMarkdown() {
  closeExternalFileMenu(true)
  await inspectExternalFile()
  if (externalFileChanged.value && draft.value) await openExternalConflictReview(draft.value)
  else if (!externalFileUnavailable.value) ui.toast('外部文件没有新变化', '当前关联状态正常。', 'success')
}

async function copyExternalMarkdownPath() {
  const path = draft.value?.externalFile?.path
  closeExternalFileMenu(true)
  if (!path) return
  try {
    await navigator.clipboard.writeText(path)
    ui.toast('已复制外部文件路径', path, 'success')
  } catch (error) { ui.toast('无法复制文件路径', readableError(error), 'error') }
}

async function revealExternalMarkdown() {
  const path = draft.value?.externalFile?.path
  closeExternalFileMenu(true)
  if (!path) return
  try { await revealDesktopFile(path) } catch (error) { ui.toast('无法在资源管理器中显示文件', readableError(error), 'error') }
}

async function openExternalConflictQa() {
  if (!import.meta.env.DEV || route.query.qa !== 'external-conflict') return
  if (!draft.value) {
    const qaDocument = store.createNote('二分边界', '算法')
    selectedId.value = qaDocument.id
    syncDraft(qaDocument)
  }
  if (!draft.value) return
  const base = cloneStudyDocument(draft.value)
  base.externalFile = { path: 'F:\\Notes\\算法\\二分边界.md', name: '二分边界.md', hash: 'qa-base', modifiedAt: '2026-08-12T03:00:00.000Z', size: base.content.length }
  const current = cloneStudyDocument(base)
  current.content = `${base.content.trimEnd()}\n\n## 当前草稿\n\n补充循环不变量与测试边界。\n`
  const diskContent = `${base.content.trimEnd()}\n\n## 磁盘更新\n\n在 Typora 中补充了复杂度说明。\n`
  const external = current.externalFile!
  replacingDraft = true
  draft.value = current
  replacingDraft = false
  documentDirty.value = true
  externalFileChanged.value = true
  externalConflictQaDisk.value = { path: external.path, name: external.name, content: diskContent, hash: 'qa-disk', modifiedAt: '2026-08-12T03:05:00.000Z', size: diskContent.length }
  externalConflict.value = {
    documentId: current.id,
    current,
    disk: externalConflictQaDisk.value,
    preview: await buildExternalConflictPreview(base.content, current.content, diskContent),
  }
}

async function openManagedVaultConflictQa() {
  if (!import.meta.env.DEV || route.query.qa !== 'managed-vault-conflict' || !draft.value) return
  const base = cloneStudyDocument(draft.value)
  const current = cloneStudyDocument(base)
  const disk = cloneStudyDocument(base)
  current.content = `${base.content.trimEnd()}\n\n## 当前草稿\n正在补充边界条件和复杂度分析。`
  disk.content = `${base.content.trimEnd()}\n\n## Typora 修改\n磁盘中补充了另一套推导过程。`
  replaceDraft(current, true)
  managedVaultPendingDisk.value = disk
  managedVaultAlert.value = { documentId: current.id, status: 'pending' }
  resetDocumentAutoSaveState()
  autoSaveState.value = 'paused'
}

async function reloadExternalMarkdown(document: StudyDocument) {
  if (!document.externalFile || !isDesktop()) return
  if (draft.value?.id === document.id && documentDirty.value) {
    const replace = await ui.confirm({ title: '载入磁盘版本？', message: '当前编辑器还有未保存修改。继续会用磁盘上的 Markdown 替换这些修改。', danger: true, confirmLabel: '放弃修改并载入' })
    if (!replace) return
  }
  try {
    const file = await readExternalMarkdown(document.externalFile.path)
    const next = { ...cloneStudyDocument(document), content: file.content, externalFile: { path: file.path, name: file.name, hash: file.hash, modifiedAt: file.modifiedAt, size: file.size } }
    store.saveDocument(next)
    syncDraft(next)
    externalFileChanged.value = false
    externalFileUnavailable.value = false
    showSaved()
    ui.toast(`已载入 ${file.name} 的磁盘版本`, undefined, 'success')
  } catch (error) { externalFileUnavailable.value = true; ui.toast(`无法载入外部文件：${readableError(error)}`, undefined, 'error') }
}

function unlinkExternalMarkdown(document: StudyDocument) {
  if (draft.value?.id === document.id && documentDirty.value) {
    delete draft.value.externalFile
    externalFileChanged.value = false
    externalFileUnavailable.value = false
    closeDocumentMenu()
    ui.toast('已在草稿中解除关联', '保存后写入资料库；原始 Markdown 文件不会被删除。', 'info')
    return
  }
  const next = cloneStudyDocument(document)
  delete next.externalFile
  store.saveDocument(next)
  syncDraft(next)
  externalFileChanged.value = false
  externalFileUnavailable.value = false
  showSaved()
}

async function inspectExternalFile() {
  const external = selected.value?.externalFile
  if (!external || !isDesktop()) return
  try {
    const state = await inspectExternalMarkdown(external.path)
    externalFileChanged.value = state.modifiedAt !== external.modifiedAt || state.size !== external.size
    externalFileUnavailable.value = false
  } catch { externalFileUnavailable.value = true }
}

function stopExternalPolling() {
  if (externalPollTimer !== undefined) window.clearInterval(externalPollTimer)
  externalPollTimer = undefined
}

function scheduleExternalInspection(delay = 90) {
  if (externalWatchDebounceTimer !== undefined) window.clearTimeout(externalWatchDebounceTimer)
  externalWatchDebounceTimer = window.setTimeout(() => {
    externalWatchDebounceTimer = undefined
    void inspectExternalFile()
  }, delay)
}

async function stopExternalFileWatcher() {
  stopExternalPolling()
  externalFileWatchMode.value = 'none'
  externalWatchUnlisten?.()
  externalWatchUnlisten = undefined
  const path = externalWatchPath
  externalWatchPath = ''
  if (path) await unwatchDesktopExternalMarkdown(path).catch(() => undefined)
}

async function syncExternalFileWatcher(path: string, revision: number) {
  await stopExternalFileWatcher()
  if (revision !== externalWatchRevision || !path || !isDesktop()) return
  scheduleExternalInspection(0)
  let unlisten: (() => void) | undefined
  try {
    unlisten = await listenDesktopEvent<{ path: string }>('toolknit://external-markdown-change', (change) => {
      if (change.path === path) scheduleExternalInspection()
    })
    if (revision !== externalWatchRevision) { unlisten(); return }
    await watchDesktopExternalMarkdown(path)
    if (revision !== externalWatchRevision) {
      unlisten()
      await unwatchDesktopExternalMarkdown(path).catch(() => undefined)
      return
    }
    externalWatchPath = path
    externalWatchUnlisten = unlisten
    externalFileWatchMode.value = 'native'
  } catch {
    unlisten?.()
    if (revision !== externalWatchRevision) return
    // Network folders and restrictive antivirus settings can reject native
    // watching. Retain the old low-frequency check only for that case.
    externalPollTimer = window.setInterval(() => scheduleExternalInspection(0), 3500)
    externalFileWatchMode.value = 'poll'
  }
}

function updateExternalFileWatcher(path: string) {
  const revision = ++externalWatchRevision
  externalWatchMutation = externalWatchMutation.catch(() => undefined).then(() => syncExternalFileWatcher(path, revision))
}

function menuPosition(event: MouseEvent | KeyboardEvent, width: number, height: number) {
  const trigger = event.currentTarget instanceof HTMLElement ? event.currentTarget : undefined
  const bounds = trigger?.getBoundingClientRect()
  const pointerX = 'clientX' in event ? event.clientX : 0
  const pointerY = 'clientY' in event ? event.clientY : 0
  // Keyboard-activated buttons emit a click without pointer coordinates. Put
  // the menu beside that control rather than unexpectedly at (0, 0).
  const x = pointerX || bounds?.right || 16
  const y = pointerY || bounds?.bottom || 16
  return clampMenuPosition(x, y, { menuWidth: width, menuHeight: height, margin: 12 })
}
function focusDocumentMenu() {
  void nextTick(() => documentMenuElement.value?.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')?.focus())
}
function openDocumentMenu(event: MouseEvent | KeyboardEvent, document: StudyDocument) {
  // The external-file variation has eight actions plus its title. Reserve the
  // full height before positioning so a menu near the viewport edge is never
  // cut off.
  closeEditorContextMenu()
  closePreviewSelectionMenu()
  const hasSplitScrollControl = mode.value === 'split' && selectedId.value === document.id
  const recentOffset = store.isContentRecent(document.kind, document.id) ? 37 : 0
  const recoveryOffset = document.id === selectedId.value && crashDraft.value ? 74 : 0
  const questionOffset = document.kind === 'question' ? 37 : 0
  const position = menuPosition(event, 248, (hasSplitScrollControl ? 644 : 607) + recentOffset + recoveryOffset + questionOffset)
  documentMenuTrigger = event.currentTarget instanceof HTMLElement ? event.currentTarget : undefined
  documentMenu.value = { document, ...position }
  focusDocumentMenu()
}
function isInsideFolder(document: StudyDocument, folder: string) {
  const documentFolder = normalizeDocumentFolder(document.folder) ?? ''
  return documentFolder === folder || documentFolder.startsWith(`${folder}/`)
}
function moveDocumentToFolder(document: StudyDocument, folder?: string) {
  const normalizedFolder = normalizeDocumentFolder(folder)
  if (draft.value?.id === document.id && documentDirty.value) {
    if (normalizedFolder) draft.value.folder = normalizedFolder
    else delete draft.value.folder
    closeDocumentMenu()
    ui.toast(normalizedFolder ? `草稿将移至“${normalizedFolder}”` : '草稿将移至收件箱', '保存时一并写入；外部 Markdown 的原始磁盘位置不会变化。', 'info')
    return
  }
  const next = cloneStudyDocument(document)
  if (normalizedFolder) next.folder = normalizedFolder
  else delete next.folder
  store.saveDocument(next)
  syncDraft(next)
  closeDocumentMenu()
  ui.toast(normalizedFolder ? `已移至“${normalizedFolder}”` : '已移至收件箱', '外部 Markdown 的原始磁盘位置没有变化。', 'success')
}
async function copyDocumentWikiLink(document: StudyDocument) {
  try {
    await navigator.clipboard.writeText(`[[${document.title}]]`)
    ui.toast('双链已复制', `可直接粘贴为 [[${document.title}]]。`, 'success')
  } catch (error) {
    ui.toast('无法写入剪贴板', readableError(error), 'error')
  } finally {
    closeDocumentMenu()
  }
}
async function toggleDocumentFavorite(document: StudyDocument) {
  try {
    const favorite = await store.toggleContentFavorite(document.kind, document.id)
    ui.toast(favorite ? '已收藏内容' : '已取消收藏', favorite ? '可从知识库、今天或 Ctrl K 快速返回。' : '文档本身没有被删除。', 'success')
  } catch (error) {
    ui.toast('收藏状态没有保存', readableError(error), 'error')
  } finally {
    closeDocumentMenu()
  }
}
async function removeDocumentFromRecents(document: StudyDocument) {
  try {
    await store.removeFromContentRecents(document.kind, document.id)
    ui.toast('已从最近使用移除', '文档本身没有被删除。', 'success')
  } catch (error) {
    ui.toast('最近使用没有更新', readableError(error), 'error')
  } finally {
    closeDocumentMenu()
  }
}
async function duplicateDocument(document: StudyDocument) {
  if (!await confirmDocumentTransition(`创建“${document.title}”的副本`)) return
  const copy = createIndependentDocumentCopy(document, newId(), new Date().toISOString())
  if (!store.insertDocument(copy)) {
    ui.toast('无法创建独立副本', '生成的文档 ID 已存在，请重试。', 'error')
    return
  }
  selectedId.value = copy.id
  mode.value = 'edit'
  closeDocumentMenu()
  router.replace({ path: '/documents', query: { kind: copy.kind, document: copy.id, mode: 'edit' } })
  ui.toast('已创建独立副本', '没有复制外部 Markdown 关联和复习排程。', 'success')
}
function closeDocumentMenu(restoreFocus = false) {
  documentMenu.value = null
  if (restoreFocus) void nextTick(() => documentMenuTrigger?.focus())
}
function handleDocumentContextKey(event: KeyboardEvent, document: StudyDocument) {
  if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return
  event.preventDefault()
  event.stopPropagation()
  openDocumentMenu(event, document)
}
function handleDocumentMenuKeydown(event: KeyboardEvent) {
  const items = [...(documentMenuElement.value?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? [])]
  if (!items.length) return
  const current = items.indexOf(document.activeElement as HTMLButtonElement)
  if (event.key === 'Escape') { event.preventDefault(); closeDocumentMenu(true); return }
  if (event.key === 'Home') { event.preventDefault(); items[0].focus(); return }
  if (event.key === 'End') { event.preventDefault(); items.at(-1)?.focus(); return }
  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
  event.preventDefault()
  const offset = event.key === 'ArrowDown' ? 1 : -1
  items[(current + offset + items.length) % items.length].focus()
}
function focusContextMenu(element: typeof relationMenuElement) {
  void nextTick(() => element.value?.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')?.focus())
}
function closeRelationMenu(restoreFocus = false) {
  relationMenu.value = null
  if (restoreFocus) void nextTick(() => relationMenuTrigger?.focus())
}
function closeWikiContextMenu(restoreFocus = false) {
  wikiResolutionRevision += 1
  wikiContextMenu.value = null
  if (restoreFocus) void nextTick(() => wikiContextMenuTrigger?.focus())
}
function closeHeadingContextMenu(restoreFocus = false) {
  headingContextMenu.value = null
  if (restoreFocus) void nextTick(() => headingContextMenuTrigger?.focus())
}
function handleContextMenuKeydown(event: KeyboardEvent, element: HTMLElement | undefined, close: () => void) {
  const items = [...(element?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? [])]
  if (!items.length) return
  if (event.key === 'Escape') { event.preventDefault(); close(); return }
  const nextIndex = nextMenuItemIndex(event.key, items.indexOf(document.activeElement as HTMLButtonElement), items.length)
  if (nextIndex === undefined) return
  event.preventDefault()
  items[nextIndex]?.focus()
}
function wikiTargetByTitle(title: string) {
  const normalized = normalizeWikiTitle(title)
  return store.documents.find((document) => normalizeWikiTitle(document.title) === normalized)
}
function externalWikiWorkspaceRoot() {
  return externalWorkspaceQa ? externalWorkspaceQaRoot.value : store.settings.markdownWorkspaceDirectory
}
function externalWikiResolutionEnabled() {
  const root = externalWikiWorkspaceRoot()
  const path = draft.value?.externalFile?.path
  return Boolean(root && path && externalWorkspaceEntryContainsPath(root, path, 'directory'))
}
async function findExternalWikiCandidates(title: string) {
  const root = externalWikiWorkspaceRoot()
  if (!root || !externalWikiResolutionEnabled()) return [] as ExternalMarkdownDirectoryEntry[]
  const result = externalWorkspaceQa
    ? (await import('@/lib/external-workspace-qa')).externalWorkspaceQaSearch(root, title, 80)
    : await searchExternalMarkdownWorkspace(root, title, 80)
  return externalWikiExactMatches(title, result.entries).slice(0, 12)
}
async function openExternalWikiCandidate(entry: ExternalMarkdownDirectoryEntry, heading?: string) {
  closeWikiContextMenu()
  if (!await openExternalMarkdownPath(entry.path)) return false
  const opened = store.documents.find(document => document.externalFile && normalizedExternalPath(document.externalFile.path) === normalizedExternalPath(entry.path))
  if (opened && heading) await router.replace({ path: '/documents', query: { kind: opened.kind, document: opened.id, wikiHeading: heading } })
  return true
}
async function openWikiLink(title: string, heading?: string) {
  const target = wikiTargetByTitle(title)
  if (target) {
    await router.push({ path: '/documents', query: { kind: target.kind, document: target.id, ...(heading ? { wikiHeading: heading } : {}) } })
    return
  }
  if (externalWikiResolutionEnabled()) {
    try {
      const matches = await findExternalWikiCandidates(title)
      if (matches.length === 1) { await openExternalWikiCandidate(matches[0], heading); return }
      if (matches.length > 1) {
        ui.toast(`找到 ${matches.length} 个“${title}”`, '存在同名外部笔记；右键这条双链并选择所在资料夹。', 'info')
        return
      }
    } catch (error) {
      ui.toast('无法解析外部双链', `${readableError(error)}；可右键链接重试或创建内部笔记。`, 'error')
      return
    }
  }
  ui.toast(`“${title}”还不是一条笔记`, '右键这条链接即可创建，并保留当前 Markdown 原文。', 'info')
}
async function resolveWikiContextExternal(revision: number) {
  const context = wikiContextMenu.value
  if (!context?.externalEligible) return
  try {
    const candidates = await findExternalWikiCandidates(context.title)
    if (revision !== wikiResolutionRevision || wikiContextMenu.value !== context) return
    context.externalCandidates = candidates
  } catch (error) {
    if (revision !== wikiResolutionRevision || wikiContextMenu.value !== context) return
    context.resolutionError = readableError(error)
  } finally {
    if (revision === wikiResolutionRevision && wikiContextMenu.value === context) {
      context.resolving = false
      focusContextMenu(wikiContextMenuElement)
    }
  }
}
function openWikiContext(title: string, heading: string | undefined, x: number, y: number, trigger?: HTMLElement) {
  closeHeadingContextMenu()
  wikiContextMenuTrigger = trigger ?? (document.activeElement instanceof HTMLElement ? document.activeElement : undefined)
  const target = wikiTargetByTitle(title)
  const externalEligible = !target && externalWikiResolutionEnabled()
  const revision = ++wikiResolutionRevision
  wikiContextMenu.value = { title, heading, target, externalEligible, externalCandidates: [], resolving: externalEligible, resolutionError: '', ...clampMenuPosition(x, y, { menuWidth: externalEligible ? 300 : 226, menuHeight: externalEligible ? 360 : 132, margin: 12 }) }
  if (externalEligible) void resolveWikiContextExternal(revision)
  else focusContextMenu(wikiContextMenuElement)
}
function openHeadingContext(heading: string, x: number, y: number, trigger: HTMLElement) {
  closeWikiContextMenu()
  headingContextMenuTrigger = trigger
  headingContextMenu.value = { heading, ...clampMenuPosition(x, y, { menuWidth: 248, menuHeight: 124, margin: 12 }) }
  focusContextMenu(headingContextMenuElement)
}
async function copyHeadingWikiLink() {
  const context = headingContextMenu.value
  const document = draft.value
  if (!context || !document) return
  const link = wikiLinkSource(document.title, context.heading)
  try {
    await navigator.clipboard.writeText(link)
    ui.toast('段落双链已复制', `可直接粘贴为 ${link}。`, 'success')
  } catch (error) {
    ui.toast('无法写入剪贴板', readableError(error), 'error')
  } finally {
    closeHeadingContextMenu()
  }
}
async function copyHeadingTitle() {
  const context = headingContextMenu.value
  if (!context) return
  try {
    await navigator.clipboard.writeText(context.heading)
    ui.toast('段落标题已复制', context.heading, 'success')
  } catch (error) {
    ui.toast('无法写入剪贴板', readableError(error), 'error')
  } finally {
    closeHeadingContextMenu()
  }
}
function openBacklinkContext(event: MouseEvent, backlink: Awaited<ReturnType<typeof store.findDocumentBacklinks>>[number]) {
  openWikiContext(backlink.title, undefined, event.clientX, event.clientY, event.currentTarget as HTMLElement)
}
function openWikiContextFromKeyboard(event: KeyboardEvent, title: string, heading?: string) {
  if (!isContextMenuShortcut(event)) return
  event.preventDefault()
  event.stopPropagation()
  const trigger = event.currentTarget as HTMLElement
  const bounds = trigger.getBoundingClientRect()
  openWikiContext(title, heading, bounds.right + 8, bounds.top + 8, trigger)
}
function openBacklink(backlink: Awaited<ReturnType<typeof store.findDocumentBacklinks>>[number]) {
  if (backlink.kind === 'note' || backlink.kind === 'question') openRelated(backlink.id, backlink.kind)
}
async function createWikiNote() {
  const context = wikiContextMenu.value
  if (!context) return
  if (!await confirmDocumentTransition(`新建“${context.title}”`)) return
  const document = store.createNote(context.title, draft.value?.folder ?? folderFilter.value)
  selectedId.value = document.id
  closeWikiContextMenu()
  router.replace({ path: '/documents', query: { kind: 'note', document: document.id } })
  ui.toast(`已创建“${document.title}”`, '原来的 [[链接]] 会立刻成为可导航入口。', 'success')
}
function relateWikiTarget() {
  const context = wikiContextMenu.value
  if (!context?.target || !draft.value) return
  if (context.target.id === draft.value.id) { ui.toast('不能关联到当前笔记本身。', undefined, 'info'); return }
  const relation = store.createRelation(draft.value.id, context.target.id, 'related')
  closeWikiContextMenu()
  ui.toast(relation ? `已把“${context.target.title}”织入关联知识` : '这条关联已经存在。', undefined, relation ? 'success' : 'info')
}
async function refreshBacklinks() {
  const document = selected.value
  const revision = ++backlinksRevision
  backlinks.value = []
  if (!document) return
  backlinksLoading.value = true
  try {
    const results = await store.findDocumentBacklinks(document.title, document.id)
    if (revision === backlinksRevision) backlinks.value = results
  } catch {
    if (revision === backlinksRevision) backlinks.value = []
  } finally {
    if (revision === backlinksRevision) backlinksLoading.value = false
  }
}
function scrollToWikiHeading() {
  const heading = typeof route.query.wikiHeading === 'string' ? route.query.wikiHeading : ''
  if (!heading) return
  const normalized = normalizeWikiTitle(heading)
  const target = previewHeadings().find((element) => normalizeWikiTitle(element.textContent ?? '') === normalized)
  if (!target) return
  target.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' })
  const { wikiHeading: _wikiHeading, ...query } = route.query
  router.replace({ path: '/documents', query })
}
function previewHeadings() {
  return [...document.querySelectorAll<HTMLElement>('.markdown-preview.markdown-content h1, .markdown-preview.markdown-content h2, .markdown-preview.markdown-content h3, .markdown-preview.markdown-content h4, .markdown-preview.markdown-content h5, .markdown-preview.markdown-content h6')]
    .filter((heading) => !heading.hasAttribute('data-duplicate-document-title'))
}
function scrollToOutline(item: MarkdownOutlineItem) {
  const target = previewHeadings()[item.index]
  if (!target) return false
  target.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' })
  return true
}
function focusMarkdownOutline(item: MarkdownOutlineItem) {
  if (isHugeDocument.value && !fullLargePreviewRequested.value && item.sourceLine) {
    outlineEditorTarget.value = { line: item.sourceLine, revision: (outlineEditorTarget.value?.revision ?? 0) + 1 }
    mode.value = 'edit'
    return
  }
  if (mode.value === 'edit') mode.value = 'preview'
  if (scrollToOutline(item)) return
  pendingOutline.value = item
  window.setTimeout(() => {
    if (pendingOutline.value?.index === item.index && scrollToOutline(item)) pendingOutline.value = null
  }, 80)
}
function syncMarkdownOutline(items: MarkdownOutlineItem[]) {
  // Large documents receive a complete, source-line-aware outline from the
  // lightweight Worker. The preview component intentionally exposes only its
  // already-rendered DOM, which may be deferred or still incomplete.
  if (isHugeDocument.value) return
  markdownOutline.value = normalizeMarkdownOutline(items)
  // Preview enhancement now yields the DOM heading scan until an idle turn.
  // Honor a navigation request again when that deferred outline arrives.
  if (pendingOutline.value) void nextTick(() => {
    if (pendingOutline.value && scrollToOutline(pendingOutline.value)) pendingOutline.value = null
  })
}
function handlePreviewRendered(elapsedMs?: number) {
  previewPending.value = false
  if (isHugeDocument.value && fullLargePreviewRequested.value) {
    if (elapsedMs !== undefined) previewRenderDurationMs.value = elapsedMs
    const total = previewRenderProgress.value?.total
    if (total) previewRenderProgress.value = { completed: total, total }
  }
  if (pendingOutline.value && scrollToOutline(pendingOutline.value)) pendingOutline.value = null
  scrollToWikiHeading()
  if (previewSelectionQa.value) void nextTick(() => {
    const target = previewContextTarget.value?.querySelector<HTMLElement>('code code, pre code, p')
    const textNode = target?.firstChild
    if (!target || !textNode || !textNode.textContent?.trim()) return
    const range = document.createRange()
    range.selectNodeContents(target)
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)
  })
}
function scheduleWikiHeadingScroll() {
  if (wikiHeadingTimer !== undefined) window.clearTimeout(wikiHeadingTimer)
  wikiHeadingTimer = window.setTimeout(scrollToWikiHeading, 0)
}
async function loadVisualRelationCatalog() {
  if (visualRelationCatalogLoaded || !isDesktop()) {
    visualRelationCatalogLoaded = true
    return
  }
  if (visualRelationCatalogRequest) return visualRelationCatalogRequest
  visualRelationCatalogRequest = (async () => {
    try {
      visualRelationCatalog.value = await listDesktopVisualProjects(100)
      visualRelationCatalogWarning.value = ''
      visualRelationCatalogLoaded = true
    } catch (error) {
      visualRelationCatalogWarning.value = `画布摘要暂时不可用：${error instanceof Error ? error.message : '本地资料库没有响应。'}`
    } finally {
      visualRelationCatalogRequest = undefined
    }
  })()
  return visualRelationCatalogRequest
}
function openRelationComposer() {
  relationComposerOpen.value = !relationComposerOpen.value
  relationSearchGate.invalidate()
  relationQuery.value = ''
  relationResults.value = []
  relationSearchError.value = ''
  if (relationComposerOpen.value) {
    void loadVisualRelationCatalog()
    void nextTick(() => relationInput.value?.focus({ preventScroll: true }))
  }
}
function createRelation(target: RelationTargetSummary) {
  if (!draft.value) return
  const relation = store.createRelation(draft.value.id, target.id, relationType.value)
  if (!relation) { ui.toast('这条关联已经存在。', undefined, 'info'); return }
  relationQuery.value = ''; relationResults.value = []; relationComposerOpen.value = false
  ui.toast(`已关联到“${target.title}”`, undefined, 'success')
}
function openRelationMenu(event: MouseEvent | KeyboardEvent, relation: EntityRelation, title: string, kind: RelationEntityKind) {
  relationMenuTrigger = event.currentTarget instanceof HTMLElement ? event.currentTarget : undefined
  relationMenu.value = { relation, title, kind, ...menuPosition(event, 214, 122) }
  focusContextMenu(relationMenuElement)
}
function openRelationMenuFromKeyboard(event: KeyboardEvent, relation: EntityRelation, title: string, kind: RelationEntityKind) {
  if (!isContextMenuShortcut(event)) return
  event.preventDefault()
  event.stopPropagation()
  openRelationMenu(event, relation, title, kind)
}
function openRelated(id: string, kind: RelationEntityKind) {
  if (kind === 'word') void router.push({ path: '/words', query: { word: id } })
  else if (kind === 'diagram') void router.push({ path: '/visual', query: { project: id } })
  else void router.push({ path: '/documents', query: { kind, document: id } })
}
async function removeRelation(relation: EntityRelation, title: string) { if (!await ui.confirm({ title: `移除与“${title}”的关联？`, message: '只移除关系，不会删除笔记、错题、单词或画布本身。', danger: true, confirmLabel: '移除关联' })) return; store.deleteRelation(relation); closeRelationMenu(); ui.toast('已移除关联', undefined, 'success') }
function addTag() { const tag = newTag.value.trim(); if (draft.value && tag && !draft.value.tags.includes(tag)) draft.value.tags.push(tag); newTag.value = '' }
function removeTag(tag: string) { if (draft.value) draft.value.tags = draft.value.tags.filter((item) => item !== tag) }
function normalizeDraftFolder() {
  if (!draft.value) return
  const folder = normalizeDocumentFolder(draft.value.folder)
  if (folder) draft.value.folder = folder
  else delete draft.value.folder
}
async function removeDocument(document: StudyDocument) {
  if (!await ui.confirm({ title: `删除“${document.title}”？`, message: '删除后不会影响原始资料，但该笔记或错题无法恢复。', danger: true, confirmLabel: '删除' })) return
  const removingActive = selectedId.value === document.id
  if (removingActive) await clearCurrentRecovery()
  else await deleteEditorCrashDraft('document', document.id).catch(() => undefined)
  store.deleteDocument(document.id)
  if (removingActive) {
    const fallback = docs.value[0]
    selectedId.value = fallback?.id ?? ''
    if (fallback) await router.replace(createdDocumentRoute(fallback.kind, fallback.id, mode.value))
    else await router.replace({ path: '/documents', query: { kind: document.kind } })
  }
  ui.toast('已删除文档', undefined, 'success')
}
async function remove() { if (draft.value) await removeDocument(draft.value) }
function insertAi(content: string) { if (!draft.value) return; draft.value.content += `\n\n---\n\n## AI 草稿（已确认）\n\n${content}\n`; save() }
function returnToSource() {
  const anchor = draft.value?.sourceAnchor
  if (!anchor) return
  router.push({ path: '/library', query: { source: anchor.sourceId, page: String(anchor.pageIndex) } })
}
watch(() => route.query.create, (create) => {
  const preferredMode = documentEditorMode(route.query.mode) ?? 'edit'
  if (create === 'note' && route.query.kind === 'note') createNote(preferredMode)
  if (create === 'question' && route.query.kind === 'question') createQuestion(preferredMode)
}, { immediate: true })
watch([() => route.query.action, () => route.query.kind], async ([action, kind]) => {
  if (!documentKnowledgeAction(action, kind)) return
  const { action: _action, ...query } = route.query
  await router.replace({ path: '/documents', query })
  await importMarkdown()
}, { immediate: true })
watch(() => route.query.import, (value) => {
  if (value === '1' && route.query.kind === 'question' && !questionImportOpen.value) void openQuestionImport()
}, { immediate: true })
watch(() => route.query.template, (templateId) => {
  if (route.query.kind !== 'note' || typeof templateId !== 'string') return
  const template = noteStarterTemplates.find((item) => item.id === templateId)
  if (!template) return
  createNoteFromTemplate(template, documentEditorMode(route.query.mode) ?? 'edit')
}, { immediate: true })
watch([() => route.query.insert, () => route.query.create], async ([requested, creating]) => {
  const panel = markdownInsertRequest(requested)
  if (!panel || creating || route.query.kind !== 'note') return
  const documentId = typeof route.query.document === 'string' ? route.query.document : draft.value?.id
  if (!documentId) return
  pendingRouteInsert.value = { panel, documentId, recognizeFormula: panel === 'formula' && route.query.recognize === 'formula' }
  const { insert: _insert, recognize: _recognize, ...query } = route.query
  await router.replace({ path: '/documents', query })
  await nextTick()
  openPendingRouteInsert()
}, { immediate: true })
watch([editorSurface, () => draft.value?.id], openPendingRouteInsert)
watch([editorSurface, () => draft.value?.id, mode], applyPendingEditorLineTarget)
watch([mode, () => draft.value?.id], clearMarkdownImageDrag)
watch(() => route.query.qa, (qa) => {
  if (import.meta.env.DEV && qa === 'markdown-image-drop') void nextTick(() => { markdownImageDrop.value = { count: 3, omitted: 1 } })
  else clearMarkdownImageDrag()
})
watch(() => route.query.document, (documentId) => {
  if (pendingRouteInsert.value && documentId !== pendingRouteInsert.value.documentId) pendingRouteInsert.value = null
})
watch(query, (value) => {
  if (queryTimer !== undefined) window.clearTimeout(queryTimer)
  queryTimer = window.setTimeout(() => { appliedQuery.value = value.trim() }, 140)
})
watch([docs, selectedId], () => {
  void nextTick(() => scrollDocumentIntoView())
})
watch(availableTags, (tags) => {
  if (tagFilter.value && !tags.some(({ tag }) => tag === tagFilter.value)) tagFilter.value = ''
})
watch(folderItems, (folders) => {
  if (folderFilter.value && !folders.some(({ path }) => path === folderFilter.value)) folderFilter.value = ''
})
watch([inspectorOpen, () => markdownOutline.value.length, outlinePending], ([open]) => {
  outlineListResizeObserver?.disconnect()
  outlineListResizeObserver = undefined
  if (!open) return
  void nextTick(() => {
    if (!outlineListElement.value) return
    updateOutlineListViewport()
    outlineListResizeObserver = new ResizeObserver(updateOutlineListViewport)
    outlineListResizeObserver.observe(outlineListElement.value)
  })
})
watch(() => route.query.kind, () => { folderFilter.value = ''; tagFilter.value = ''; documentListScrollTop.value = 0; documentListElement.value?.scrollTo({ top: 0, behavior: 'auto' }) })
watch(() => route.query.wikiHeading, () => { scheduleWikiHeadingScroll() })
watch([() => route.query.handoff, () => route.query.request], () => { void consumeDesktopMarkdownHandoff() }, { immediate: true })
watch(() => `${selected.value?.id ?? ''}:${selected.value?.title ?? ''}:${selected.value?.updatedAt ?? ''}`, () => { void refreshBacklinks() }, { immediate: true })
watch(() => `${selected.value?.externalFile?.path ?? ''}:${selected.value?.externalFile?.modifiedAt ?? ''}:${selected.value?.externalFile?.size ?? ''}`, () => {
  externalFileChanged.value = false
  externalFileUnavailable.value = false
  updateExternalFileWatcher(selected.value?.externalFile?.path ?? '')
}, { immediate: true })
watch(focusMode, (active) => ui.setDocumentFocusMode(active), { immediate: true })
onMounted(() => {
  window.addEventListener('keydown', handleDocumentShortcut)
  window.addEventListener('knitspace:close-context-menus', closeDocumentContextMenus)
  window.addEventListener('knitspace:vault-markdown-change', handleManagedVaultMarkdownChange)
  window.addEventListener('beforeunload', handleDocumentBeforeUnload)
  void nextTick(() => {
    updateDocumentListViewport()
    void openExternalConflictQa()
    void openManagedVaultConflictQa()
    if (import.meta.env.DEV && route.query.qa === 'markdown-image-drop') markdownImageDrop.value = { count: 3, omitted: 1 }
    if (!documentListElement.value) return
    documentListResizeObserver = new ResizeObserver(updateDocumentListViewport)
    documentListResizeObserver.observe(documentListElement.value)
  })
  if (isDesktop()) {
    void listenWindowFileDragEvents(handleMarkdownImageDrag).then((unlisten) => {
      if (markdownImageDragDisposed) unlisten()
      else markdownImageDragUnlisten = unlisten
    }).catch(() => undefined)
  }
})
onBeforeUnmount(() => {
  ui.setDocumentFocusMode(false)
  markdownImageDragDisposed = true
  markdownImageDragUnlisten?.()
  clearMarkdownImageDrag()
  window.removeEventListener('keydown', handleDocumentShortcut)
  window.removeEventListener('knitspace:close-context-menus', closeDocumentContextMenus)
  window.removeEventListener('knitspace:vault-markdown-change', handleManagedVaultMarkdownChange)
  window.removeEventListener('beforeunload', handleDocumentBeforeUnload)
  window.dispatchEvent(new CustomEvent('knitspace:editor-dirty', { detail: { dirty: false } }))
  if (unsavedResolver) resolveUnsavedDecision('stay')
  documentListResizeObserver?.disconnect()
  outlineListResizeObserver?.disconnect()
  if (previewTimer !== undefined) window.clearTimeout(previewTimer)
  if (outlineIndexTimer !== undefined) window.clearTimeout(outlineIndexTimer)
  externalWatchRevision += 1
  void stopExternalFileWatcher()
  if (externalWatchDebounceTimer !== undefined) window.clearTimeout(externalWatchDebounceTimer)
  if (relationSearchTimer !== undefined) window.clearTimeout(relationSearchTimer)
  if (wikiHeadingTimer !== undefined) window.clearTimeout(wikiHeadingTimer)
  if (queryTimer !== undefined) window.clearTimeout(queryTimer)
  if (imagePasteTimer !== undefined) window.clearTimeout(imagePasteTimer)
  if (frontmatterTimer !== undefined) window.clearTimeout(frontmatterTimer)
  if (documentStatisticsTimer !== undefined) window.clearTimeout(documentStatisticsTimer)
  if (crashDraftTimer !== undefined) window.clearTimeout(crashDraftTimer)
  if (autoSaveTimer !== undefined) window.clearTimeout(autoSaveTimer)
  if (autoSaveStatusTimer !== undefined) window.clearTimeout(autoSaveStatusTimer)
  outlineIndexWorker?.terminate()
  documentStatisticsWorker?.terminate()
  externalConflictWorker?.terminate()
  externalConflictWorkerDisposed = true
  for (const pending of externalConflictWorkerPending.values()) pending.reject(new Error('文档工作区已关闭。'))
  externalConflictWorkerPending.clear()
})
</script>

<template>
    <div class="documents page-enter" @click="closeDocumentMenu(); closeManagedVaultMenu(); closeFrontmatterMenu(); closeNoteStarterMenu(); closeRelationMenu(); closeWikiContextMenu(); closeHeadingContextMenu(); closeEditorContextMenu(); closeQuestionAttachmentMenu(); closeQuestionStructureMenu(); closeDocumentStatisticsMenu(); closeLargePreviewMenu()">
    <div class="documents-layout" :class="{ 'documents-layout--focus': focusMode }">
      <aside v-if="!focusMode" class="document-list">
        <header class="document-list__header"><div><strong>{{ isNotes ? '笔记' : '错题' }}</strong><span>{{ docs.length }} 条</span></div><div class="document-list__header-actions"><button v-if="isNotes" class="icon-button document-import-button" title="打开单个本地 Markdown" aria-label="打开单个本地 Markdown" @click.stop="importMarkdown"><AppIcon name="file-text" :size="15" /></button><button v-else class="icon-button document-import-button" title="批量导入 CSV、TSV 或 TXT 题目" aria-label="批量导入题目" @click.stop="openQuestionImport"><AppIcon name="inbox" :size="15" /></button><button v-if="isNotes" class="icon-button" title="左键新建空白笔记；右键或 Shift+F10 选择模板" aria-haspopup="menu" :aria-expanded="Boolean(noteStarterMenu)" @click.stop="createNote" @contextmenu.prevent.stop="openNoteStarterMenu" @keydown="openNoteStarterMenuFromKeyboard">＋</button><button v-else class="icon-button" title="左键新建错题；右键或 Shift+F10 批量导入" @click.stop="createQuestion" @contextmenu.prevent.stop="openQuestionImport" @keydown="openQuestionImportFromKeyboard">＋</button></div></header>
        <div v-if="isNotes" class="document-source-switch" role="tablist" aria-label="笔记来源"><button role="tab" :aria-selected="sidebarMode === 'vault'" :class="{ active: sidebarMode === 'vault' }" @click="sidebarMode = 'vault'">Knitspace 资料库</button><button role="tab" :aria-selected="sidebarMode === 'workspace'" :class="{ active: sidebarMode === 'workspace' }" @click="sidebarMode = 'workspace'">外部工作区</button></div>
        <template v-if="!isNotes || sidebarMode === 'vault'">
          <div class="document-list__search"><input v-model="query" class="search-input" :placeholder="isNotes ? '按标题、分类或标签筛选' : '按标题、分类或标签筛选'" title="全文搜索请使用 Ctrl K" /></div>
          <div class="document-filter" role="tablist" aria-label="内容筛选"><button :class="{ active: listFilter === 'all' }" @click="listFilter = 'all'">全部</button><button :class="{ active: listFilter === 'review' }" @click="listFilter = 'review'">待复习</button><button :class="{ active: listFilter === 'plain' }" @click="listFilter = 'plain'">未加入</button></div>
          <label v-if="!isNotes" class="document-question-type-filter"><span>题型</span><select v-model="questionTypeFilter" aria-label="按题型筛选"><option value="">全部题型</option><option v-for="choice in questionTypeChoices" :key="choice.value" :value="choice.value">{{ choice.label }}</option></select></label>
          <label v-if="availableTags.length" class="document-tag-filter"><span>标签</span><select v-model="tagFilter" aria-label="按标签筛选"><option value="">全部标签</option><option v-for="item in availableTags" :key="item.tag" :value="item.tag">{{ item.tag }} · {{ item.count }}</option></select></label>
          <section v-if="folderItems.length" class="document-folder-tree" aria-label="资料夹导航"><header><span>资料夹</span><button class="quiet-button" :aria-expanded="folderTreeExpanded" @click="folderTreeExpanded = !folderTreeExpanded">{{ folderTreeExpanded ? '收起' : '展开' }}</button></header><div v-show="folderTreeExpanded" role="tree"><button role="treeitem" :aria-selected="!folderFilter" :class="{ active: !folderFilter }" @click="folderFilter = ''"><b>全部文档</b><small>{{ scopedDocuments.length }}</small></button><button v-for="folder in folderItems" :key="folder.path" role="treeitem" :aria-level="folder.depth + 1" :aria-selected="folderFilter === folder.path" :class="{ active: folderFilter === folder.path }" :style="{ '--folder-depth': folder.depth }" :title="`筛选资料夹：${folder.path}`" @click="folderFilter = folder.path"><b>{{ folder.label }}</b><small>{{ folder.count }}</small></button></div></section>
          <div ref="documentListElement" class="document-list__rows" aria-label="文档列表" @scroll.passive="handleDocumentListScroll"><div class="document-list__spacer" :style="{ height: `${documentWindow.before}px` }" aria-hidden="true"></div><button v-for="doc in visibleDocs" :key="doc.id" v-memo="[doc.id, doc.title, doc.updatedAt, doc.id === selectedId, doc.id === selectedId && documentDirty, store.isContentFavorite(doc.kind, doc.id)]" class="document-row" :class="{ selected: doc.id === selectedId, dirty: doc.id === selectedId && documentDirty }" @click="pick(doc)" @contextmenu.prevent.stop="openDocumentMenu($event, doc)" @keydown="handleDocumentContextKey($event, doc)"><i></i><div><h4>{{ doc.title }}</h4><p>{{ doc.subject }}<template v-if="doc.kind === 'question'"> · {{ questionTypeLabel(doc.questionType) }}</template><template v-if="doc.tags.length"> · {{ doc.tags.slice(0, 2).join(' · ') }}</template></p></div><small><template v-if="doc.id === selectedId && documentDirty"><span class="document-row__dirty-dot"></span>未保存</template><template v-else-if="store.isContentFavorite(doc.kind, doc.id)"><AppIcon name="star" :size="10" />收藏</template><template v-else>{{ doc.reviewEnabled ? '复习' : '' }}</template></small></button><div class="document-list__spacer" :style="{ height: `${documentWindow.after}px` }" aria-hidden="true"></div><div v-if="!docs.length" class="empty-strip">没有匹配的内容。</div></div>
          <footer :class="{ 'document-list__footer--question': !isNotes }"><button v-if="isNotes" aria-haspopup="menu" :aria-expanded="Boolean(noteStarterMenu)" @click="createNote" @contextmenu.prevent.stop="openNoteStarterMenu" @keydown="openNoteStarterMenuFromKeyboard">＋ 新建笔记</button><template v-else><button @click="createQuestion" @contextmenu.prevent.stop="openQuestionImport" @keydown="openQuestionImportFromKeyboard">＋ 新建错题</button><button title="从 CSV、TSV 或 TXT 批量导入" @click="openQuestionImport"><AppIcon name="inbox" :size="12" />批量导入</button></template></footer>
        </template>
        <ExternalMarkdownWorkspace v-else :root="externalWorkspaceQa ? externalWorkspaceQaRoot : store.settings.markdownWorkspaceDirectory" :active-path="activeExternalMarkdownPath" :qa="externalWorkspaceQa" @update:root="setMarkdownWorkspaceRoot" @open-file="openExternalMarkdownPath" @entry-renamed="handleWorkspaceEntryRenamed" @entry-trashed="handleWorkspaceEntryTrashed" />
      </aside>
      <section v-if="documentLoading" class="panel detail-empty detail-loading" role="status" aria-live="polite"><div><span class="detail-empty__mark"><AppIcon name="book" :size="25" /></span><p class="eyebrow">本地 Markdown 库</p><b>正在打开笔记</b><p>正文仍在本机资料库中，准备好后会显示在这里。</p></div></section>
      <section v-else-if="draft" class="editor-shell panel">
        <DocumentTabStrip :tabs="documentTabs" :documents="store.documents" :active-id="selectedId" :active-title="draft.title" :dirty-id="documentDirty ? selectedId : undefined" @activate="activateWorkspaceTab" @close="closeWorkspaceTab" @close-others="closeOtherWorkspaceTabs" @close-right="closeWorkspaceTabsToRight" @toggle-pin="toggleWorkspaceTabPin" @copy-link="copyWorkspaceTabLink" />
        <header class="editor-header"><div class="editor-title-block"><input v-model="draft.title" class="title-input" aria-label="标题" /><div class="metadata-row"><select v-model="draft.subject" aria-label="分类"><option>算法</option><option>数学</option><option>物理</option><option>计算机</option><option>英语</option><option>未分类</option></select><select v-if="draft.kind === 'question'" v-model="draft.questionType" aria-label="题型"><option v-for="choice in questionTypeChoices" :key="choice.value" :value="choice.value">{{ choice.label }}</option></select><select v-if="draft.kind === 'question'" v-model="draft.difficulty" aria-label="难度"><option :value="1">难度 1</option><option :value="2">难度 2</option><option :value="3">难度 3</option><option :value="4">难度 4</option><option :value="5">难度 5</option></select><span v-if="draft.kind === 'question'" class="question-review-summary"><i></i>{{ questionReviewCards(draft).length ? `${questionReviewCards(draft).length} 张复习卡` : '未加入复习' }}</span></div></div><div class="editor-actions"><div class="editor-mode" role="tablist" aria-label="编辑模式"><button :class="{ active: mode === 'edit' }" title="源码编辑（Alt+1）" @click="mode = 'edit'">编辑</button><button :class="{ active: mode === 'split' }" title="分栏编辑（Alt+2）" @click="mode = 'split'">分屏</button><button :class="{ active: mode === 'preview' }" title="阅读预览（Alt+3）" @click="mode = 'preview'">预览</button><button :class="{ active: mode === 'mindmap' }" title="思维图谱（Alt+4）" @click="mode = 'mindmap'">图谱</button></div><button v-if="mode === 'split'" class="quiet-button editor-scroll-sync" :class="{ active: splitScrollSync }" :aria-pressed="splitScrollSync" :title="splitScrollSync ? '关闭源码与预览滚动联动' : '开启源码与预览滚动联动'" @click="toggleSplitScrollSync">{{ splitScrollSync ? '联动滚动' : '独立滚动' }}</button><button class="quiet-button editor-focus-toggle" :class="{ active: focusMode }" :title="focusMode ? '退出专注阅读（Ctrl+Shift+F）' : '专注阅读（Ctrl+Shift+F）'" @click="toggleFocusMode">{{ focusMode ? '退出专注' : '专注阅读' }}</button><span v-if="documentOutput?.documentId === draft.id" class="document-output-state" role="status" aria-live="polite" :title="documentOutput.detail"><i :style="{ '--output-progress': `${documentOutput.progress}%` }"></i>{{ documentOutput.detail }}</span><span v-else class="save-state" :class="{ 'is-dirty': documentDirty }" role="status" aria-live="polite" :title="store.settings.documentAutoSave ? `自动保存：${autoSavePolicy.label}；外部文件冲突时等待手动确认` : '自动保存已关闭；使用 Ctrl+S 保存'"><i></i>{{ documentSaveLabel }}</span><button class="primary-button" :disabled="documentSaveInProgress" title="立即保存（Ctrl+S）" @click="save()">{{ documentSaveInProgress ? '保存中…' : '保存' }}</button><button class="more-button" aria-label="更多操作" @click.stop="openDocumentMenu($event, draft)">•••</button></div></header>
        <EditorRecoveryBanner v-if="crashDraft" :saved-at="crashDraft.savedAt" item-kind="文档" :busy="crashDraftBusy" @restore="restoreCrashDraft" @discard="discardCrashDraft" />
        <div class="tag-editor" :aria-label="draft.kind === 'question' ? '知识点标签' : '文档标签'"><TagPill v-for="tag in draft.tags" :key="tag" :label="`${tag} ×`" @click="removeTag(tag)" /><input v-model="newTag" :placeholder="draft.kind === 'question' ? '添加知识点后回车' : '添加标签后回车'" @keydown.enter.prevent="addTag" /></div>
        <div v-if="mode === 'edit' || mode === 'split'" class="markdown-format-bar" role="toolbar" aria-label="Markdown 格式工具">
          <span>格式</span>
          <button type="button" title="在当前文档中查找或替换 · Ctrl+F" aria-label="查找或替换，Ctrl+F" @mousedown.prevent @click.stop="openDocumentSearch()"><AppIcon name="search" :size="14" /><i>查找</i></button>
          <button type="button" class="divider" title="配置并插入 Markdown 表格" aria-label="插入表格" @mousedown.prevent @click.stop="openMarkdownInsert('table')"><AppIcon name="table" :size="14" /><i>表格</i></button>
          <button type="button" title="编写并预览 LaTeX 公式" aria-label="插入公式" @mousedown.prevent @click.stop="openMarkdownInsert('formula')"><AppIcon name="math" :size="14" /><i>公式</i></button>
          <button v-for="tool in markdownFormattingTools" :key="tool.command" type="button" :class="{ divider: tool.divider }" :title="`${tool.label} · ${tool.shortcut}`" :aria-label="`${tool.label}，${tool.shortcut}`" @mousedown.prevent @click.stop="applyEditorCommand(tool.command)"><AppIcon :name="tool.icon" :size="14" /><i>{{ tool.label }}</i></button>
          <button type="button" class="divider markdown-image-paste-button" :disabled="imagePasteState === 'saving'" :title="isDesktop() ? '选择本机图片并复制到当前文档资源目录' : '仅桌面版可用'" aria-label="导入本地图片到当前 Markdown" @mousedown.prevent @click.stop="importLocalMarkdownImages"><AppIcon name="file-image" :size="14" /><i>{{ imagePasteState === 'saving' ? '存入中' : '本地图片' }}</i></button>
          <small v-if="imagePasteState === 'idle' && !richPasteMessage">右键编辑区查看更多</small>
          <small v-else-if="imagePasteState === 'idle'" class="markdown-rich-paste-status" role="status" aria-live="polite"><AppIcon name="clipboard" :size="12" />{{ richPasteMessage }}</small>
          <small v-else class="markdown-image-paste-status" :class="`is-${imagePasteState}`" role="status" aria-live="polite"><i></i>{{ imagePasteMessage }}</small>
        </div>
        <section v-if="managedVaultAlert?.documentId === draft.id" class="managed-vault-alert" :class="`is-${managedVaultAlert.status}`" tabindex="0" role="alert" aria-live="assertive" aria-haspopup="menu" :aria-expanded="Boolean(managedVaultMenu)" title="右键或 Shift+F10 查看安全处理选项" @contextmenu.prevent.stop="openManagedVaultMenu" @keydown="openManagedVaultMenu"><span><AppIcon name="warning" :size="16" /></span><div><b>{{ managedVaultAlert.status === 'missing' ? 'Vault Markdown 文件已不存在' : '另一程序修改了这篇 Vault Markdown' }}</b><small>{{ managedVaultAlert.status === 'missing' ? '数据库记录与版本历史仍保留；自动保存已暂停，避免意外创建或覆盖。' : '当前草稿不会被后台覆盖；请比较两个版本后再继续保存。' }}</small></div><div><button v-if="managedVaultAlert.status === 'pending'" class="primary-button" @click.stop="openManagedVaultConflict">比较并处理</button><button v-else class="primary-button" @click.stop="recreateManagedVaultMarkdown">用当前版本重新创建</button><button class="quiet-button" @click.stop="openManagedVaultVersionHistory">版本历史</button></div></section>
        <div v-if="draft.externalFile" class="external-markdown-bar" :class="{ changed: externalFileChanged || externalFileUnavailable }" tabindex="0" role="group" aria-label="外部 Markdown 关联状态；右键或 Shift 加 F10 打开文件菜单" aria-haspopup="menu" :aria-expanded="Boolean(externalFileMenu)" aria-live="polite" title="右键或 Shift+F10 可比较版本、显示文件或复制路径" @contextmenu.prevent="openExternalFileMenu" @keydown="openExternalFileMenu"><span>↗ {{ draft.externalFile.name }}</span><button v-if="externalFileChanged" @click="openExternalConflictReview(draft)">磁盘文件已有更新 · 比较</button><button v-else-if="externalFileUnavailable" @click="recheckExternalMarkdown">外部文件暂不可访问 · 重试</button><span v-else class="external-markdown-bar__watch"><i :class="externalFileWatchMode"></i>{{ externalFileWatchMode === 'native' ? '已关联 · 正在监听' : externalFileWatchMode === 'poll' ? '已关联 · 定时检查' : '已关联 · 保存时同步' }}</span><button class="quiet-button" @click="saveAsMarkdown(draft)">另存为…</button></div>
        <section v-if="frontmatter" class="markdown-frontmatter" :class="{ expanded: frontmatterExpanded, invalid: frontmatter.error }" aria-label="Markdown 文档属性">
          <button class="markdown-frontmatter__summary" type="button" :aria-expanded="frontmatterExpanded" aria-controls="markdown-frontmatter-details" aria-haspopup="menu" title="展开文档属性；右键或 Shift+F10 打开属性菜单" @click.stop="toggleFrontmatterExpanded" @contextmenu.prevent.stop="openFrontmatterMenu" @keydown="openFrontmatterMenu">
            <b><AppIcon name="json" :size="14" />属性</b>
            <span v-if="frontmatter.error" class="markdown-frontmatter__error"><AppIcon name="warning" :size="12" />YAML 需要检查</span>
            <span v-else-if="frontmatter.entries.length" class="markdown-frontmatter__chips"><i v-for="entry in frontmatter.entries.slice(0, 4)" :key="entry.key"><strong>{{ entry.key }}</strong>{{ entry.summary }}</i><em v-if="frontmatter.entries.length > 4">+{{ frontmatter.entries.length - 4 }}</em></span>
            <span v-else class="markdown-frontmatter__empty">空属性区</span>
            <small>{{ frontmatter.error ? '源码仍完整保留' : `${frontmatter.entries.length}${frontmatter.truncated ? '+' : ''} 项 · 预览已隐藏 YAML` }}</small>
            <AppIcon name="chevron" :size="13" />
          </button>
          <div v-if="frontmatterExpanded" id="markdown-frontmatter-details" class="markdown-frontmatter__details">
            <p v-if="frontmatter.error" role="status"><AppIcon name="warning" :size="14" /><span><b>无法解析这段 YAML</b><small>{{ frontmatter.error }}。你仍可在源码中原样编辑和保存。</small></span></p>
            <dl v-else-if="frontmatter.entries.length"><div v-for="entry in frontmatter.entries" :key="entry.key"><dt>{{ entry.key }}</dt><dd :class="`is-${entry.kind}`">{{ entry.summary }}</dd></div></dl>
            <p v-else><AppIcon name="json" :size="14" /><span><b>当前没有属性</b><small>分隔符会保留，之后可直接在源码中添加 YAML 键值。</small></span></p>
            <footer><span>只读解析 · 不重写原始 Markdown</span><div><button type="button" class="quiet-button" @click.stop="copyFrontmatter('yaml')">复制 YAML</button><button type="button" class="quiet-button" @click.stop="editFrontmatterSource">在源码中编辑</button></div></footer>
          </div>
        </section>
        <div v-if="draft.sourceAnchor" class="source-anchor"><img v-if="anchorCrop" :src="anchorCrop" alt="来源选区" /><span>↗ 来源仍然系着：第 {{ draft.sourceAnchor.pageIndex + 1 }} 页，区域 {{ draft.sourceAnchor.bbox.map((n) => n.toFixed(2)).join(' · ') }}</span><button @click="returnToSource">回到原资料</button></div>
        <section v-if="draft.kind === 'question'" class="question-structure-rail" tabindex="0" aria-haspopup="menu" :aria-expanded="Boolean(questionStructureMenu)" :aria-label="`题目结构，已完成 ${currentQuestionStructure.completed} 项，共 ${currentQuestionStructure.total} 项；右键或 Shift 加 F10 打开题目菜单`" @contextmenu.prevent.stop="openQuestionStructureMenu" @keydown="openQuestionStructureMenu">
          <header><div><span>题目结构</span><b>{{ currentQuestionStructure.completed }} / {{ currentQuestionStructure.total }}</b></div><small>题干、答案、解析与错因保持独立</small></header>
          <div role="list" aria-label="题目字段完成状态"><button v-for="item in currentQuestionStructure.items" :key="item.key" role="listitem" :class="{ complete: item.complete, optional: !item.required }" :aria-label="`${item.label}；${item.complete ? '已填写' : item.required ? '待补充' : '可选'}`" @click.stop="openQuestionStructure(item.key)"><span><AppIcon :name="item.complete ? 'check' : 'plus'" :size="12" /></span><div><b>{{ item.shortLabel }}</b><small>{{ item.complete ? '已填写' : item.required ? '待补充' : '可选' }}</small></div></button></div>
          <button class="question-structure-rail__action" @click.stop="openQuestionStructure(currentQuestionStructure.nextField)"><span>{{ questionTypeLabel(draft.questionType) }}</span><b>{{ currentQuestionStructure.nextField ? '继续补充' : '查看结构' }}</b><AppIcon name="arrow-right" :size="13" /></button>
        </section>
        <div class="editor-grid" :class="`editor-grid--${mode}`">
          <div v-if="mode === 'edit' || mode === 'split'" ref="editorDropTarget" class="markdown-editor-source-pane">
            <Suspense>
              <template #default><LargeTextEditor :key="draft.id" ref="editorSurface" :model-value="draft.content" :document-id="draft.id" aria-label="Markdown 正文；右键或 Shift 加 F10 打开格式菜单；也可拖入本地图片" placeholder="在这里开始记录…" :debounce-ms="editorCommitPolicy.delayMs" :focus-on-mount="focusEditorOnMount" :search-request="editorSearchRequest" :scroll-target="outlineEditorTarget" @update:model-value="updateDraftContent" @pending-change="markEditorPending" @focused="focusEditorOnMount = false" @scroll-progress="syncEditorScroll" @context-menu="openEditorContextMenu" @paste-image="pasteClipboardImage" @paste-rich="handleRichPaste" /></template>
              <template #fallback><div class="editor-mode-loading" role="status">正在准备轻量编辑器…</div></template>
            </Suspense>
            <div v-if="markdownImageDrop" class="markdown-image-drop-overlay" role="status" aria-live="polite">
              <span><AppIcon name="file-image" :size="22" /></span>
              <b>松手插入 {{ markdownImageDrop.count }} 张图片</b>
              <small>插入鼠标位置 · 原文件不会移动<template v-if="markdownImageDrop.omitted"> · {{ markdownImageDrop.omitted }} 项将跳过</template></small>
            </div>
          </div>
          <div v-if="mode === 'preview' || mode === 'split'" ref="previewContextTarget" class="markdown-preview-wrap" :tabindex="previewMenuEnabled ? 0 : -1" role="region" :aria-label="previewMenuEnabled ? 'Markdown 阅读预览；选中文字后右键可打开选区工具，空白处右键打开文档操作' : 'Markdown 阅读预览'" :aria-haspopup="previewMenuEnabled ? 'menu' : undefined" :aria-expanded="previewMenuEnabled ? Boolean(documentMenu || previewSelectionMenu) : undefined" @contextmenu="openPreviewDocumentMenu" @keydown="openPreviewDocumentMenuFromKeyboard">
            <div v-if="isHugeDocument && !fullLargePreviewRequested" class="markdown-preview markdown-preview--deferred" role="region" tabindex="0" aria-label="大型 Markdown 预览控制；右键或 Shift 加 F10 打开阅读菜单" aria-haspopup="menu" :aria-expanded="Boolean(largePreviewMenu)" title="右键或 Shift+F10 打开大文档阅读菜单" @contextmenu.prevent.stop="openLargePreviewMenu" @keydown="openLargePreviewMenu">
              <div><b>大型文档预览已暂停</b><p>先用源码模式流畅编辑；需要阅读排版效果时再按需渲染。</p></div>
              <button class="quiet-button" @click="requestFullLargePreview">加载完整预览</button>
            </div>
            <section v-else-if="isBlankDraft" class="blank-document-preview" role="region" aria-label="空白内容启动提示" @contextmenu="openBlankDraftContextMenu">
              <span class="blank-document-preview__mark"><AppIcon :name="draft.kind === 'question' ? 'review' : 'book'" :size="23" /></span>
              <p class="eyebrow">{{ draft.kind === 'question' ? '本地复习卡' : '本地 Markdown' }}</p>
              <b>{{ draft.kind === 'question' ? '先把题目写下来' : '从一段想法开始' }}</b>
              <p>{{ draft.kind === 'question' ? '填写题干、答案和错因；之后可按节奏回到复习。' : '阅读模式会忠实呈现 Markdown；先在源码模式写下第一行。' }}</p>
              <div class="blank-document-preview__actions">
                <button class="primary-button" @click="beginBlankDraft">{{ draft.kind === 'question' ? '填写题目' : '开始编辑' }}</button>
                <button v-if="draft.kind === 'note'" class="quiet-button" aria-haspopup="menu" :aria-expanded="Boolean(noteStarterMenu)" title="从学习模板开始；右键空白页面也可打开" @click.stop="openNoteStarterMenu" @contextmenu.prevent.stop="openNoteStarterMenu">从模板开始</button>
              </div>
              <small>{{ draft.kind === 'question' ? '会同时打开“题目与复习”检查器。' : 'Alt + 1 也可切换到源码模式；右键此页可挑选模板。' }}</small>
            </section>
            <template v-else>
              <div v-if="previewPending" class="markdown-render-status" role="status" aria-live="polite" :tabindex="isHugeDocument && fullLargePreviewRequested ? 0 : undefined" :aria-haspopup="isHugeDocument && fullLargePreviewRequested ? 'menu' : undefined" :aria-expanded="isHugeDocument && fullLargePreviewRequested ? Boolean(largePreviewMenu) : undefined" @contextmenu.prevent.stop="openLargePreviewMenu" @keydown="openLargePreviewMenu"><div><span>{{ isHugeDocument && fullLargePreviewRequested ? (previewRenderProgress?.total ? `正在铺开阅读内容 · ${previewRenderPercent}%` : '正在分析文档排版…') : '正在更新预览…' }}</span><small v-if="previewRenderProgress?.total">{{ previewRenderProgress.completed }} / {{ previewRenderProgress.total }} 节</small></div><i v-if="previewRenderProgress?.total" class="markdown-render-status__track" aria-hidden="true"><i :style="{ width: `${previewRenderPercent}%` }"></i></i><button v-if="isHugeDocument && fullLargePreviewRequested" class="quiet-button" @click="cancelFullLargePreview">停止加载</button></div>
              <div v-else-if="isHugeDocument && fullLargePreviewRequested && previewRenderDurationMs !== undefined" class="markdown-render-status markdown-render-status--ready" role="status" aria-live="polite" tabindex="0" aria-haspopup="menu" :aria-expanded="Boolean(largePreviewMenu)" title="右键或 Shift+F10 打开大文档阅读菜单" @contextmenu.prevent.stop="openLargePreviewMenu" @keydown="openLargePreviewMenu"><div><span>完整预览已就绪 · {{ previewRenderDurationLabel }}</span><small v-if="previewRenderProgress?.total">{{ previewRenderProgress.total }} 节渐进载入</small></div><button class="quiet-button" @click="cancelFullLargePreview">返回轻量模式</button></div>
              <MarkdownContent ref="previewSurface" class="markdown-preview" :source="previewSource" :large-reader="isHugeDocument && fullLargePreviewRequested" :external-markdown-path="draft.externalFile?.path" :document-id="draft.id" :suppress-leading-title="draft.title" defer worker @scroll-progress="syncPreviewScroll" @wiki-open="openWikiLink" @wiki-context="openWikiContext" @link-open="openStandardMarkdownLink" @heading-context="openHeadingContext" @image-edit="openPreviewImageInStudio" @outline="syncMarkdownOutline" @render-start="previewPending = true" @render-progress="handlePreviewRenderProgress" @rendered="handlePreviewRendered" />
            </template>
          </div>
          <Suspense v-if="mode === 'mindmap'">
            <template #default><MarkdownMindmap :source="draft.content" :title="draft.title" /></template>
            <template #fallback><div class="editor-mode-loading" role="status">正在加载思维导图…</div></template>
          </Suspense>
        </div>
        <footer class="document-statistics-bar" aria-label="Markdown 文档状态">
          <div><span>MARKDOWN</span><i></i><span>{{ mode === 'edit' ? '源码' : mode === 'split' ? '分屏' : mode === 'mindmap' ? '图谱' : '阅读' }}</span><template v-if="isLargeDocument"><i></i><span :title="`输入即时显示；预览按 ${editorCommitPolicy.label}，自动保存按 ${autoSavePolicy.label}。Ctrl+S 仍会立即同步。`">大文档保护 · {{ editorCommitPolicy.label }}</span></template></div>
          <button
            type="button"
            aria-haspopup="menu"
            :aria-expanded="Boolean(documentStatisticsMenu)"
            :aria-busy="documentStatisticsPending"
            title="点击查看完整统计；右键或 Shift+F10 打开统计菜单"
            @click.stop="documentStatisticsExpanded = !documentStatisticsExpanded"
            @contextmenu.prevent.stop="openDocumentStatisticsMenu"
            @keydown="openDocumentStatisticsMenu"
          >
            <template v-if="documentStatistics">
              <b>{{ documentStatistics.charactersWithoutWhitespace.toLocaleString('zh-CN') }}</b><span>字符</span><i></i><b>{{ documentStatistics.lines.toLocaleString('zh-CN') }}</b><span>行</span><i></i><span>约 {{ documentStatistics.readingMinutes }} 分钟</span>
            </template>
            <span v-else>{{ documentStatisticsPending ? '正在本机统计…' : '暂无统计' }}</span>
            <AppIcon name="chevron" :size="12" />
          </button>
          <section v-if="documentStatisticsExpanded && documentStatistics" class="document-statistics-popover" aria-label="完整 Markdown 统计">
            <header><div><b>文档统计</b></div><button aria-label="关闭文档统计" @click.stop="documentStatisticsExpanded = false">×</button></header>
            <dl>
              <div><dt>字符</dt><dd>{{ documentStatistics.charactersWithoutWhitespace.toLocaleString('zh-CN') }}<small>不含空格</small></dd></div>
              <div><dt>中文</dt><dd>{{ documentStatistics.cjkCharacters.toLocaleString('zh-CN') }}<small>字符</small></dd></div>
              <div><dt>英文 / 数字</dt><dd>{{ documentStatistics.latinWords.toLocaleString('zh-CN') }}<small>词</small></dd></div>
              <div><dt>结构</dt><dd>{{ documentStatistics.paragraphs }}<small>段 · {{ documentStatistics.headings }} 标题</small></dd></div>
              <div><dt>源码</dt><dd>{{ documentStatistics.lines.toLocaleString('zh-CN') }}<small>行 · {{ documentStatistics.codeLines }} 代码行</small></dd></div>
              <div><dt>预计阅读</dt><dd>{{ documentStatistics.readingMinutes }}<small>分钟</small></dd></div>
            </dl>
            <footer><span>{{ documentStatisticsPending ? '正在更新…' : 'Worker 已完成 · 内容未上传' }}</span><button @click.stop="copyDocumentStatistics">复制摘要</button></footer>
          </section>
        </footer>
        <button v-if="!focusMode" class="document-inspector-tab" :class="{ open: inspectorOpen }" :aria-expanded="inspectorOpen" @click="inspectorOpen = !inspectorOpen"><span>{{ inspectorLabel }}</span><b>{{ inspectorOpen ? '×' : '‹' }}</b></button>
        <aside v-if="!focusMode && inspectorOpen" class="document-inspector" :aria-label="inspectorLabel">
          <header><div><p class="eyebrow">{{ draft.kind === 'question' ? '题目与复习' : '知识关联' }}</p><h3>{{ inspectorLabel }}</h3></div><button :aria-label="`关闭${inspectorLabel}`" @click="inspectorOpen = false">×</button></header>
          <section v-if="draft.kind === 'question'" class="question-attachments" :aria-busy="questionAttachmentsLoading || questionAttachmentImporting"><header><div><span>题目附件</span><small>图片、PDF、音频和代码文件只复制到当前 Vault。</small></div><button class="quiet-button" :disabled="questionAttachmentImporting || questionAttachments.length >= 64" @click.stop="addQuestionAttachments"><AppIcon name="attachment" :size="13" />{{ questionAttachmentImporting ? '添加中…' : '＋ 添加' }}</button></header><div v-if="questionAttachmentsLoading" class="question-attachments__loading" role="status"><i></i><i></i><span>正在读取附件摘要…</span></div><div v-else-if="visibleQuestionAttachments.length" class="question-attachments__list"><button v-for="attachment in visibleQuestionAttachments" :key="attachment.id" v-memo="[attachment.id, attachment.name, attachment.size, attachment.available]" :class="{ missing: !attachment.available }" :aria-disabled="!attachment.available" :title="attachment.available ? '在资源管理器中定位；右键查看更多操作' : 'Vault 中的附件文件已经不存在；右键可移除记录'" aria-haspopup="menu" :aria-expanded="questionAttachmentMenu?.attachment.id === attachment.id" @click.stop="revealQuestionAttachment(attachment)" @contextmenu.prevent.stop="openQuestionAttachmentMenu($event, attachment)" @keydown="openQuestionAttachmentMenu($event, attachment)"><span><AppIcon :name="questionAttachmentIcon(attachment)" :size="15" /></span><div><b>{{ attachment.name }}</b><small>{{ attachment.available ? `${formatQuestionAttachmentSize(attachment.size)} · ${attachment.mime}` : '本地文件已经不存在' }}</small></div><i>{{ attachment.available ? '本地' : '缺失' }}</i></button></div><div v-else-if="!questionAttachmentError" class="question-attachments__empty"><AppIcon name="attachment" :size="17" /><span><b>还没有附件</b><small>可一次选择多个文件；不会把文件字节读进编辑页面。</small></span></div><p v-if="questionAttachmentError" class="question-attachments__error" role="alert"><AppIcon name="warning" :size="13" /><span>{{ questionAttachmentError }}</span><button @click.stop="loadQuestionAttachments()">重试</button></p><footer v-if="questionAttachments.length > 6"><button @click.stop="questionAttachmentsExpanded = !questionAttachmentsExpanded">{{ questionAttachmentsExpanded ? '收起附件' : `再显示 ${questionAttachments.length - 6} 个` }}</button><span>{{ questionAttachments.length }} / 64</span></footer></section>
          <section v-if="draft.questionDetails" ref="questionDetailsSectionElement" class="question-details"><header><span>题目结构</span><small>题目只保存一份；答案与错因可以独立安排复习。</small></header><label class="question-source-field"><span>来源 / 出处</span><input v-model.trim="draft.questionDetails.source" data-question-field="source" aria-label="题目来源或出处" maxlength="2000" placeholder="例如：LeetCode 704、教材第 7 章或课程链接" /><div><small>{{ currentQuestionSource.hint }}</small><button v-if="currentQuestionSource.kind !== 'text'" class="quiet-button" :title="currentQuestionSource.label" @click.stop="openCurrentQuestionSource"><AppIcon :name="currentQuestionSource.kind === 'markdown' ? 'book' : currentQuestionSource.kind === 'file' ? 'folder-open' : 'link'" :size="12" />{{ questionSourceActionLabel(currentQuestionSource) }}</button></div></label><label><span>题干</span><textarea v-model="draft.questionDetails.stem" data-question-field="stem" aria-label="题干" placeholder="把题目或需要回想的条件写在这里…" /></label><label><span>答案 / 结论</span><textarea v-model="draft.questionDetails.answer" data-question-field="answer" aria-label="答案或结论" placeholder="先写最终答案，再补充推导。" /></label><label><span>解析 / 正确思路</span><textarea v-model="draft.questionDetails.explanation" data-question-field="explanation" aria-label="解析或正确思路" placeholder="关键步骤、边界和为什么这样做。" /></label><label><span>当时的错误做法</span><textarea v-model="draft.questionDetails.wrongAnswer" data-question-field="wrongAnswer" aria-label="错误做法" placeholder="记录第一次的思路或答案。" /></label><label><span>错误原因</span><textarea v-model="draft.questionDetails.errorReason" data-question-field="errorReason" aria-label="错误原因" placeholder="例如：遗漏边界、概念混淆、时间复杂度判断失误。" /></label><div class="question-review-facets" aria-label="题目的复习方向"><div><b>复习方向</b><small>每张卡独立计算 FSRS</small></div><div><label v-for="facet in questionReviewFacetChoices" :key="facet" :class="{ active: questionReviewFacetEnabled(draft, facet) }"><input type="checkbox" :checked="questionReviewFacetEnabled(draft, facet)" @change="toggleQuestionReviewFacet(draft, facet)" /><span>{{ questionReviewFacetLabels[facet] }}</span></label></div></div></section>
          <template v-if="draft.kind === 'question'"><label><span>分类</span><select v-model="draft.subject"><option>算法</option><option>数学</option><option>物理</option><option>计算机</option><option>英语</option><option>未分类</option></select></label><label><span>难度</span><select v-model="draft.difficulty"><option :value="1">1 · 入门</option><option :value="2">2 · 基础</option><option :value="3">3 · 中等</option><option :value="4">4 · 困难</option><option :value="5">5 · 挑战</option></select></label></template>
          <section v-else class="document-folder-section"><header><div><span>资料夹</span><small>仅组织 Knitspace，不会移动外部 Markdown。</small></div><code>{{ draft.folder ? draft.folder.split('/').length : 0 }}</code></header><label><span class="visually-hidden">资料夹路径</span><input v-model="draft.folder" placeholder="例如：算法 / 图论" @blur="normalizeDraftFolder" /></label></section>
          <section ref="documentVersionSectionElement" class="document-version-section" :aria-busy="documentVersionsLoading">
            <header><div><span>版本历史</span><small>{{ isDesktop() ? '连续保存会按 5 分钟合并，最多保留 40 个恢复点。' : '桌面开发版保存后会在这里建立本地恢复点。' }}</small></div><code>{{ documentVersions.length || 'LOCAL' }}</code></header>
            <div v-if="documentVersionsLoading" class="document-version-section__loading" role="status"><i></i><i></i><span>正在读取版本摘要…</span></div>
            <div v-else-if="visibleDocumentVersions.length" class="document-version-list">
              <article v-for="version in visibleDocumentVersions" :key="version.id" v-memo="[version.id, version.savedAt, version.byteSize, version.preview, version.isCurrent]" :class="{ current: version.isCurrent }" tabindex="0" aria-haspopup="menu" :aria-expanded="documentVersionMenu?.version.id === version.id" title="右键或 Shift + F10 可复制、恢复" @contextmenu.prevent.stop="openDocumentVersionMenu($event, version)" @keydown="openDocumentVersionMenu($event, version)">
                <span><AppIcon :name="version.isCurrent ? 'check' : 'clock'" :size="14" /></span><div><b>{{ formatDocumentVersionTime(version.savedAt) }} <i v-if="version.isCurrent">当前</i></b><small>{{ version.preview || '空白文档' }}</small></div><code>{{ formatDocumentVersionSize(version.byteSize) }}</code>
                <button v-if="!version.isCurrent" class="quiet-button" @click.stop="restoreDocumentVersion(version)">载入草稿</button>
              </article>
            </div>
            <div v-else-if="!documentVersionsError" class="document-version-section__empty"><AppIcon name="clock" :size="17" /><span><b>{{ isDesktop() ? '还没有可恢复的版本' : '版本历史只保存在桌面 Vault' }}</b><small>{{ isDesktop() ? '保存当前文档后，第一个本地恢复点会自动出现。' : '浏览器预览不会创建或读取你的文档快照。' }}</small></span></div>
            <p v-if="documentVersionsError" class="document-version-section__error" role="alert"><AppIcon name="warning" :size="13" /><span>{{ documentVersionsError }}</span><button @click.stop="loadDocumentVersions()">重试</button></p>
            <footer v-if="documentVersions.length > 6"><button @click.stop="documentVersionsExpanded = !documentVersionsExpanded">{{ documentVersionsExpanded ? '收起版本' : `再显示 ${documentVersions.length - 6} 个` }}</button><span>{{ documentVersions.length }} / 40</span></footer>
          </section>
          <section class="relation-section">
            <header><div><span>关联知识</span><small>{{ relatedEntities.length ? `${relatedEntities.length} 条关系已织入资料库` : '把笔记、题目、单词和画布织到一起。' }}</small></div><button class="quiet-button" :aria-expanded="relationComposerOpen" @click="openRelationComposer">{{ relationComposerOpen ? '收起' : '＋ 关联' }}</button></header>
            <div v-if="relationComposerOpen" class="relation-composer" :aria-busy="relationSearching">
              <label><span class="visually-hidden">搜索要关联的内容</span><input ref="relationInput" v-model="relationQuery" placeholder="搜索笔记、错题、单词或画布…" /></label>
              <select v-model="relationType" aria-label="关联类型"><option value="related">相关</option><option value="prerequisite">前置知识</option><option value="variation">变式 / 对比</option></select>
              <p v-if="relationSearching" role="status">正在查找本地资料与画布摘要…</p>
              <p v-else-if="relationSearchError" class="relation-composer__error" role="alert">{{ relationSearchError }}</p>
              <div v-else-if="relationResults.length" class="relation-results">
                <button v-for="result in relationResults" :key="result.id" v-memo="[result.id, result.title, result.kind, result.subtitle, relationType]" @click="createRelation(result)"><b>{{ result.title }}</b><small>{{ relationKindLabel(result.kind) }} · {{ result.subtitle }}</small></button>
              </div>
              <p v-else-if="relationQuery.trim()">没有可关联的结果。</p>
              <p v-else>输入标题或关键词；这里只读取轻量摘要，不加载画布源图。</p>
              <p v-if="visualRelationCatalogWarning" class="relation-composer__warning" role="status">{{ visualRelationCatalogWarning }}；笔记、错题和单词仍可搜索。</p>
            </div>
            <div v-if="relatedEntities.length" class="relation-list"><button v-for="item in relatedEntities" :key="`${item.relation.fromId}:${item.relation.toId}:${item.relation.relationType}`" v-memo="[item.relation.fromId, item.relation.toId, item.relation.relationType, item.title, item.subtitle]" aria-haspopup="menu" :aria-expanded="relationMenu?.relation === item.relation" @click="openRelated(item.id, item.kind)" @contextmenu.prevent.stop="openRelationMenu($event, item.relation, item.title, item.kind)" @keydown="openRelationMenuFromKeyboard($event, item.relation, item.title, item.kind)"><span>{{ relationLabel[item.relation.relationType] }}<i v-if="item.inbound">来自</i></span><b>{{ item.title }}</b><small>{{ relationKindLabel(item.kind) }} · {{ item.subtitle }}</small></button></div>
            <p v-else-if="!relationComposerOpen" class="relation-empty">还没有关系。可关联一条笔记、错题、单词或视觉画布。</p>
          </section>
          <section v-if="markdownOutline.length || outlinePending" class="markdown-outline-section"><header><div><span>{{ isHugeDocument ? '本地大纲' : '文档大纲' }}</span><small>{{ outlinePending ? '正在从本地 Markdown 建立索引…' : `${markdownOutline.length} 个章节${isHugeDocument ? ' · 不加载全文预览' : ' · 已渲染'}` }}</small></div><code>{{ isHugeDocument ? 'LOCAL' : '⌘' }}</code></header><nav ref="outlineListElement" class="markdown-outline" aria-label="当前文档大纲" @scroll.passive="handleOutlineListScroll"><div class="markdown-outline__spacer" :style="{ height: `${outlineWindow.before}px` }" aria-hidden="true"></div><button v-for="item in visibleMarkdownOutline" :key="`${item.index}:${item.label}`" v-memo="[item.index, item.level, item.label, item.sourceLine]" :class="`markdown-outline__item--${item.level}`" :title="isHugeDocument && !fullLargePreviewRequested ? `在源码中定位至第 ${item.sourceLine ?? 1} 行：${item.label}` : `跳至：${item.label}`" :aria-posinset="item.index + 1" :aria-setsize="markdownOutline.length" @click="focusMarkdownOutline(item)"><span>H{{ item.level }}</span><b>{{ item.label }}</b></button><div class="markdown-outline__spacer" :style="{ height: `${outlineWindow.after}px` }" aria-hidden="true"></div></nav></section>
          <section class="wiki-links-section"><header><div><span>文内链接</span><small>{{ wikiLinks.length ? `${wikiLinks.length} 处 Markdown 链接` : '用 [[笔记标题]] 把知识点连起来。' }}</small></div><code>[[…]]</code></header><div v-if="wikiLinks.length" class="wiki-links-list"><button v-for="link in wikiLinks" :key="`${link.start}:${link.end}`" aria-haspopup="menu" :aria-expanded="wikiContextMenu?.title === link.target && wikiContextMenu?.heading === link.heading" @click="openWikiLink(link.target, link.heading)" @contextmenu.prevent.stop="openWikiContext(link.target, link.heading, $event.clientX, $event.clientY, $event.currentTarget as HTMLElement)" @keydown="openWikiContextFromKeyboard($event, link.target, link.heading)"><span>{{ link.heading ? '段落' : '笔记' }}</span><b>{{ link.label }}</b><small>{{ link.target }}<template v-if="link.heading"> · {{ link.heading }}</template></small></button></div><p v-else class="relation-empty">输入 [[笔记标题]]，预览中即可点击，右键还能新建目标或建立关系。</p></section>
          <section class="wiki-links-section wiki-links-section--backlinks"><header><div><span>回链</span><small>{{ backlinksLoading ? '正在从本地资料库查找…' : backlinks.length ? `${backlinks.length} 条笔记提到了当前内容` : '还没有其他笔记链接到这里。' }}</small></div><code>{{ backlinks.length }}</code></header><div v-if="backlinks.length" class="wiki-links-list"><button v-for="backlink in backlinks" :key="backlink.id" aria-haspopup="menu" :aria-expanded="wikiContextMenu?.title === backlink.title && !wikiContextMenu?.heading" @click="openBacklink(backlink)" @contextmenu.prevent.stop="openBacklinkContext($event, backlink)" @keydown="openWikiContextFromKeyboard($event, backlink.title)"><span>{{ backlink.kind === 'question' ? '错题' : '笔记' }}</span><b>{{ backlink.title }}</b><small>{{ backlink.subject }}<template v-if="backlink.tags.length"> · {{ backlink.tags.slice(0, 2).join(' · ') }}</template></small></button></div></section>
          <div class="inspector-tags"><span>{{ draft.kind === 'question' ? '知识点' : '标签' }}</span><div><TagPill v-for="tag in draft.tags" :key="tag" :label="tag" /></div></div>
          <div class="inspector-note"><b>本地保存</b><p>内容、关系、复习状态和来源锚点只保存在当前资料库。</p></div>
          <footer><button class="quiet-button danger" @click="remove">删除这条{{ draft.kind === 'question' ? '错题' : '笔记' }}</button><button class="primary-button" :disabled="documentSaveInProgress" @click="save()">{{ documentSaveInProgress ? '保存中…' : '保存更改' }}</button></footer>
        </aside>
        <AiAssistPanel v-if="!focusMode" :document="draft" @insert="insertAi" />
      </section>
      <section v-else class="panel detail-empty"><div><span class="detail-empty__mark"><AppIcon :name="isNotes ? 'book' : 'review'" :size="25" /></span><p class="eyebrow">{{ isNotes ? '本地 Markdown 库' : '本地复习库' }}</p><b>{{ isNotes ? '还没有笔记' : '还没有错题' }}</b><p>{{ isNotes ? '新建一条笔记，或打开已有 Markdown；内容始终留在当前资料库。' : '从一条错题开始，或把已有题单一次整理成答案、解析与错因。' }}</p><div class="detail-empty__actions"><button class="primary-button" @click="isNotes ? createNote() : createQuestion()">{{ isNotes ? '新建笔记' : '新建错题' }}</button><button v-if="isNotes" class="quiet-button" aria-haspopup="menu" :aria-expanded="Boolean(noteStarterMenu)" @click.stop="openNoteStarterMenu">从模板开始</button><button v-if="isNotes" class="quiet-button" @click="importMarkdown">打开 Markdown</button><button v-else class="quiet-button" @click="openQuestionImport"><AppIcon name="inbox" :size="13" />批量导入题目</button></div><small>{{ isNotes ? '支持标准 .md 文件、相对图片和 Obsidian 风格双链。' : 'CSV、TSV 与 TXT 会先在本机预览；保存后按 FSRS 节奏进入复习。' }}</small></div></section>
    </div>
    <div v-if="noteStarterMenu" ref="noteStarterMenuElement" class="note-starter-menu" role="menu" aria-label="新建学习笔记模板" :style="{ left: noteStarterMenu.x + 'px', top: noteStarterMenu.y + 'px' }" @click.stop @contextmenu.prevent @keydown.stop="handleContextMenuKeydown($event, noteStarterMenuElement, () => closeNoteStarterMenu(true))">
      <p>从模板开始 <small>普通 Markdown · 可随时删改</small></p>
      <button v-for="template in noteStarterTemplates" :key="template.id" role="menuitem" @click="createNoteFromTemplate(template)"><span><b>{{ template.label }}</b><small>{{ template.description }}</small></span><i>{{ template.subject }}</i></button>
    </div>
    <div v-if="previewSelectionMenu" ref="previewSelectionMenuElement" class="document-context-menu preview-selection-context-menu" :style="{ left: `${previewSelectionMenu.x}px`, top: `${previewSelectionMenu.y}px` }" role="menu" aria-label="阅读选区操作" @click.stop @contextmenu.prevent @keydown.stop="handleContextMenuKeydown($event, previewSelectionMenuElement, () => closePreviewSelectionMenu(true))">
      <p><span>{{ previewSelectionSummary(previewSelectionMenu.text) }}</span><small>{{ previewSelectionMenu.text.length.toLocaleString('zh-CN') }} 字</small></p>
      <button role="menuitem" @click="copyPreviewSelection('markdown')"><span><AppIcon name="file-text" :size="14" />复制为 Markdown</span><kbd>Ctrl+Shift+C</kbd></button>
      <button role="menuitem" @click="copyPreviewSelection('text')"><span><AppIcon name="duplicate" :size="14" />复制无格式文字</span><kbd>Ctrl+C</kbd></button>
      <button role="menuitem" @click="copyPreviewSelection('html')"><span><AppIcon name="code" :size="14" />复制为 HTML 代码</span></button>
      <button role="menuitem" @click="openPreviewSelectionInCodeImage"><span><AppIcon name="terminal" :size="14" />生成代码分享图</span><kbd>选区</kbd></button>
      <button role="menuitem" @click="pinPreviewSelectionAsSnippet"><span><AppIcon name="star" :size="14" />固定为常用片段</span><kbd>本地</kbd></button>
      <button class="separator" role="menuitem" @click="createNoteFromPreviewSelection"><span><AppIcon name="book" :size="14" />从选区创建笔记</span></button>
      <button role="menuitem" @click="createQuestionFromPreviewSelection"><span><AppIcon name="review" :size="14" />从选区创建题目</span></button>
      <button class="separator" role="menuitem" @click="openPreviewSelectionInAi('summarize')"><span><AppIcon name="sparkle" :size="14" />提炼选区要点</span><kbd>AI 草稿</kbd></button>
      <button role="menuitem" @click="openPreviewSelectionInAi('rewrite')"><span><AppIcon name="sparkle" :size="14" />交给 AI 改写</span></button>
    </div>
    <div v-if="documentMenu" ref="documentMenuElement" class="document-context-menu" :style="{ left: `${documentMenu.x}px`, top: `${documentMenu.y}px` }" role="menu" @click.stop @keydown="handleDocumentMenuKeydown">
      <p>{{ documentMenu.document.title }}</p>
      <template v-if="documentMenu.document.id === selectedId && crashDraft"><button role="menuitem" @click="closeDocumentMenu(); restoreCrashDraft()">恢复异常退出草稿</button><button role="menuitem" @click="closeDocumentMenu(); discardCrashDraft()">放弃恢复点</button></template>
      <button role="menuitem" @click="pick(documentMenu.document); closeDocumentMenu()">在此打开</button>
      <button v-if="documentMenu.document.kind === 'question'" role="menuitem" @click="openQuestionStructureFromDocument(documentMenu.document)">编辑题目结构 <kbd>题干 / 答案 / 错因</kbd></button>
      <button role="menuitem" @click="openDocumentSearch(documentMenu.document)">在文档中查找 <kbd>Ctrl+F</kbd></button>
      <button role="menuitem" @click="openDocumentInFocus(documentMenu.document)">{{ focusMode && selectedId === documentMenu.document.id ? '退出专注阅读' : '专注阅读此文档' }}</button>
      <button v-if="mode === 'split' && selectedId === documentMenu.document.id" role="menuitem" @click="toggleSplitScrollSync">{{ splitScrollSync ? '关闭分屏滚动联动' : '开启分屏滚动联动' }}</button>
      <button role="menuitem" @click="copyDocumentWikiLink(documentMenu.document)">复制双链 [[{{ documentMenu.document.title }}]]</button>
      <button role="menuitem" @click="copyWholeDocumentMarkdown(documentMenu.document)">复制整篇 Markdown</button>
      <button role="menuitem" :disabled="Boolean(documentOutput)" @click="exportDocumentHtml(documentMenu.document)">导出可打印 HTML… <kbd>Ctrl+Shift+E</kbd></button>
      <button role="menuitem" @click="openVersionHistory(documentMenu.document)">查看版本历史 <kbd>本地</kbd></button>
      <button role="menuitem" @click="toggleDocumentFavorite(documentMenu.document)">{{ store.isContentFavorite(documentMenu.document.kind, documentMenu.document.id) ? '取消收藏' : '加入收藏' }}</button>
      <button v-if="store.isContentRecent(documentMenu.document.kind, documentMenu.document.id)" role="menuitem" @click="removeDocumentFromRecents(documentMenu.document)">从最近使用移除</button>
      <button role="menuitem" @click="duplicateDocument(documentMenu.document)">创建独立副本</button>
      <button v-if="folderFilter && !isInsideFolder(documentMenu.document, folderFilter)" role="menuitem" @click="moveDocumentToFolder(documentMenu.document, folderFilter)">移至“{{ folderFilter }}”</button>
      <button v-if="documentMenu.document.folder" role="menuitem" @click="moveDocumentToFolder(documentMenu.document)">移至收件箱</button>
      <button role="menuitem" @click="saveAsMarkdown(documentMenu.document); closeDocumentMenu()">另存为并关联 Markdown…</button>
      <button v-if="documentMenu.document.externalFile" role="menuitem" @click="reloadExternalMarkdown(documentMenu.document); closeDocumentMenu()">载入外部文件版本</button>
      <button v-if="documentMenu.document.externalFile" role="menuitem" @click="unlinkExternalMarkdown(documentMenu.document); closeDocumentMenu()">断开外部文件关联</button>
      <button class="danger" role="menuitem" @click="removeDocument(documentMenu.document); closeDocumentMenu()">删除文档</button>
    </div>
    <section v-if="questionStructureMenu && draft?.kind === 'question'" ref="questionStructureMenuElement" class="document-context-menu question-structure-context-menu" :style="{ left: `${questionStructureMenu.x}px`, top: `${questionStructureMenu.y}px` }" role="menu" aria-label="题目结构操作" @click.stop @contextmenu.prevent @keydown.stop="handleContextMenuKeydown($event, questionStructureMenuElement, () => closeQuestionStructureMenu(true))">
      <p>{{ draft.title }}<small>{{ currentQuestionStructure.completed }} / {{ currentQuestionStructure.total }} 已填写</small></p>
      <button role="menuitem" @click="openQuestionStructure('stem')">编辑题干</button>
      <button role="menuitem" @click="openQuestionStructure('source')">补充来源 / 出处</button>
      <button v-if="currentQuestionSource.raw" role="menuitem" @click="copyCurrentQuestionSource">复制来源 / 出处</button>
      <button v-if="currentQuestionSource.kind !== 'text'" role="menuitem" @click="openCurrentQuestionSource">{{ questionSourceActionLabel(currentQuestionSource) }}</button>
      <button role="menuitem" @click="openQuestionStructure('answer')">编辑答案与解析</button>
      <button role="menuitem" @click="openQuestionStructure('wrongAnswer')">记录错误做法与错因</button>
      <button role="menuitem" @click="toggleCurrentQuestionReview('answer')">{{ questionReviewFacetEnabled(draft, 'answer') ? '关闭答案回忆卡' : '启用答案回忆卡' }}</button>
      <button role="menuitem" @click="toggleCurrentQuestionReview('error')">{{ questionReviewFacetEnabled(draft, 'error') ? '关闭错因复盘卡' : '启用错因复盘卡' }}</button>
      <button role="menuitem" :disabled="!questionReviewCards(draft).length" @click="openCurrentQuestionReview">去复习当前题型</button>
    </section>
    <div v-if="documentVersionMenu" ref="documentVersionMenuElement" class="document-context-menu document-version-context-menu" :style="{ left: `${documentVersionMenu.x}px`, top: `${documentVersionMenu.y}px` }" role="menu" aria-label="文档版本操作" @click.stop @contextmenu.prevent @keydown.stop="handleContextMenuKeydown($event, documentVersionMenuElement, () => closeDocumentVersionMenu(true))">
      <p>{{ formatDocumentVersionTime(documentVersionMenu.version.savedAt) }}<small>{{ formatDocumentVersionSize(documentVersionMenu.version.byteSize) }}</small></p>
      <button v-if="!documentVersionMenu.version.isCurrent" role="menuitem" @click="restoreDocumentVersion(documentVersionMenu.version)">载入为未保存草稿</button>
      <button role="menuitem" @click="copyDocumentVersion(documentVersionMenu.version)">复制这个版本的 Markdown</button>
    </div>
    <div v-if="editorContextMenu" ref="editorContextMenuElement" class="markdown-editor-context-menu markdown-editor-context-menu--typora" :class="{ 'submenus-left': editorContextMenu.submenusLeft }" :style="{ left: `${editorContextMenu.x}px`, top: `${editorContextMenu.y}px` }" role="menu" aria-label="Markdown 编辑操作" @click.stop @contextmenu.prevent @keydown.stop="handleEditorContextMenuKeydown">
      <header class="markdown-menu-context" aria-hidden="true">
        <b><AppIcon :name="editorContextIcon(editorContextMenu.context)" :size="14" /></b>
        <span><strong>{{ editorContextMenu.context.label }}</strong><small :title="editorContextMenu.context.detail">{{ editorContextMenu.context.detail }}</small></span>
        <kbd>L{{ editorContextMenu.context.line }}</kbd>
      </header>
      <div class="markdown-menu-icon-grid markdown-menu-icon-grid--clipboard" role="group" aria-label="剪贴板快捷操作">
        <button role="menuitem" :disabled="!editorContextMenu.hasSelection" title="剪切" aria-label="剪切选中文字" @click="runEditorClipboard('cut')"><AppIcon name="cut" :size="16" /></button>
        <button role="menuitem" :disabled="!editorContextMenu.hasSelection" title="复制" aria-label="复制选中文字" @click="runEditorClipboard('copy')"><AppIcon name="duplicate" :size="16" /></button>
        <button role="menuitem" title="粘贴并保留 Markdown 格式" aria-label="粘贴并保留 Markdown 格式" @click="runEditorClipboard('paste-rich')"><AppIcon name="clipboard" :size="16" /></button>
        <button role="menuitem" :disabled="!editorContextMenu.hasSelection" title="删除" aria-label="删除选中文字" @click="deleteEditorSelection"><AppIcon name="trash" :size="16" /></button>
      </div>
      <button v-if="editorContextMenu.context.kind === 'wiki-link'" class="markdown-menu-row markdown-menu-context-action" role="menuitem" @click="openEditorContextWikiMenu"><span><AppIcon name="book" :size="14" />打开或创建这条双链</span><kbd>[[…]]</kbd></button>
      <button v-else-if="editorContextMenu.context.target" class="markdown-menu-row markdown-menu-context-action" role="menuitem" @click="copyEditorContextTarget"><span><AppIcon name="duplicate" :size="14" />复制{{ editorContextMenu.context.kind === 'image' ? '图片路径' : '链接地址' }}</span><kbd>当前项</kbd></button>
      <button v-else-if="editorContextMenu.context.kind === 'inline-code'" class="markdown-menu-row markdown-menu-context-action" role="menuitem" @click="openEditorContextCodeImage"><span><AppIcon name="terminal" :size="14" />生成代码分享图</span><kbd>行内</kbd></button>
      <button v-else-if="editorContextMenu.context.kind === 'heading'" class="markdown-menu-row markdown-menu-context-action" role="menuitem" @click="copyEditorContextHeadingLink"><span><AppIcon name="link" :size="14" />复制当前段落双链</span><kbd>[[#]]</kbd></button>
      <div class="markdown-menu-branch" data-editor-submenu="clipboard" :class="{ open: editorContextSubmenu === 'clipboard' }" @mouseenter="setEditorContextSubmenu('clipboard')" @mouseleave="leaveEditorContextSubmenu">
        <button class="markdown-menu-row" role="menuitem" aria-haspopup="menu" aria-controls="markdown-editor-menu-clipboard" :aria-expanded="editorContextSubmenu === 'clipboard'" @click="openEditorContextSubmenu('clipboard')"><span>复制 / 粘贴…</span><AppIcon name="arrow-right" :size="14" /></button>
        <section id="markdown-editor-menu-clipboard" class="markdown-menu-submenu" role="menu" aria-label="复制和粘贴选项">
          <button role="menuitem" @click="runEditorHistory('undo')"><span>撤销</span><kbd>Ctrl+Z</kbd></button>
          <button role="menuitem" @click="runEditorHistory('redo')"><span>重做</span><kbd>Ctrl+Y</kbd></button>
          <button role="menuitem" :disabled="!editorContextMenu.hasSelection" @click="copyEditorFormat('markdown')"><span>复制为 Markdown</span><kbd>Ctrl+Shift+C</kbd></button>
          <button role="menuitem" :disabled="!editorContextMenu.hasSelection" @click="copyEditorFormat('html')"><span>复制为 HTML 代码</span></button>
          <button role="menuitem" :disabled="!editorContextMenu.hasSelection" @click="copyEditorFormat('plain')"><span>复制内容并简化格式</span></button>
          <button class="separator" role="menuitem" @click="runEditorClipboard('paste-rich')"><span>粘贴并保留 Markdown 格式</span><kbd>Ctrl+V</kbd></button>
          <button role="menuitem" @click="runEditorClipboard('paste')"><span>粘贴为纯文本</span><kbd>Ctrl+Shift+V</kbd></button>
          <button role="menuitem" :disabled="imagePasteState === 'saving'" @click="pasteClipboardImage"><span>粘贴剪贴板图片</span><kbd>本地</kbd></button>
          <button class="separator" role="menuitem" @click="runEditorHistory('select-all')"><span>全选当前文档</span><kbd>Ctrl+A</kbd></button>
        </section>
      </div>
      <div class="markdown-menu-icon-grid markdown-menu-icon-grid--format" role="group" aria-label="高频 Markdown 格式">
        <button role="menuitem" title="粗体 · Ctrl+B" aria-label="切换粗体" @click="applyEditorCommand('bold')"><AppIcon name="bold" :size="15" /></button>
        <button role="menuitem" title="斜体 · Ctrl+I" aria-label="切换斜体" @click="applyEditorCommand('italic')"><AppIcon name="italic" :size="15" /></button>
        <button role="menuitem" title="行内代码 · Ctrl+E" aria-label="切换行内代码" @click="applyEditorCommand('inline-code')"><AppIcon name="inline-code" :size="15" /></button>
        <button role="menuitem" title="链接 · Ctrl+Shift+L" aria-label="插入链接" @click="applyEditorCommand('link')"><AppIcon name="link" :size="15" /></button>
        <button role="menuitem" title="引用" aria-label="切换引用" @click="applyEditorCommand('quote')"><AppIcon name="quote" :size="15" /></button>
        <button role="menuitem" title="有序列表" aria-label="切换有序列表" @click="applyEditorCommand('numbered-list')"><AppIcon name="sort" :size="15" /></button>
        <button role="menuitem" title="无序列表" aria-label="切换无序列表" @click="applyEditorCommand('bullet-list')"><AppIcon name="list" :size="15" /></button>
        <button role="menuitem" title="任务列表" aria-label="切换任务列表" @click="applyEditorCommand('task-list')"><AppIcon name="task" :size="15" /></button>
      </div>
      <div class="markdown-menu-branch markdown-menu-branch--code separator" data-editor-submenu="code" :class="{ open: editorContextSubmenu === 'code' }" @mouseenter="setEditorContextSubmenu('code')" @mouseleave="leaveEditorContextSubmenu">
        <button class="markdown-menu-row" role="menuitem" aria-haspopup="menu" aria-controls="markdown-editor-menu-code" :aria-expanded="editorContextSubmenu === 'code'" @click="openEditorContextSubmenu('code')"><span>代码块</span><AppIcon name="arrow-right" :size="14" /></button>
        <section id="markdown-editor-menu-code" class="markdown-menu-submenu" role="menu" aria-label="代码块语言">
          <template v-if="editorContextMenu.context.kind === 'code'">
            <button role="menuitem" @click="copyEditorContextCode"><span><AppIcon name="duplicate" :size="14" />复制当前代码块</span><kbd>{{ editorContextMenu.context.language || '纯文本' }}</kbd></button>
            <button class="separator" role="menuitem" :disabled="!editorContextMenu.context.text" @click="openEditorContextCodeImage"><span><AppIcon name="terminal" :size="14" />生成代码分享图</span><kbd>当前块</kbd></button>
          </template>
          <button v-for="language in codeBlockLanguages" :key="language.value || 'plain'" role="menuitem" @click="insertEditorCodeBlock(language.value)"><span>{{ language.label }}</span><code v-if="language.value">{{ language.value }}</code></button>
        </section>
      </div>
      <div class="markdown-menu-branch markdown-menu-branch--insert" data-editor-submenu="insert" :class="{ open: editorContextSubmenu === 'insert' }" @mouseenter="setEditorContextSubmenu('insert')" @mouseleave="leaveEditorContextSubmenu">
        <button class="markdown-menu-row" role="menuitem" aria-haspopup="menu" aria-controls="markdown-editor-menu-insert" :aria-expanded="editorContextSubmenu === 'insert'" @click="openEditorContextSubmenu('insert')"><span>插入</span><AppIcon name="arrow-right" :size="14" /></button>
        <section id="markdown-editor-menu-insert" class="markdown-menu-submenu" role="menu" aria-label="Markdown 插入项">
          <button role="menuitem" :disabled="imagePasteState === 'saving'" @click="importLocalMarkdownImages"><span><AppIcon name="file-image" :size="14" />本地图片…</span><kbd>最多 12 张</kbd></button>
          <button role="menuitem" @click="pasteClipboardImage"><span><AppIcon name="file-image" :size="14" />剪贴板图片</span><kbd>本地</kbd></button>
          <button role="menuitem" @click="applyEditorCommand('link')"><span><AppIcon name="link" :size="14" />链接</span></button>
          <button role="menuitem" @click="openMarkdownInsert('table')"><span><AppIcon name="table" :size="14" />表格…</span><kbd>配置尺寸</kbd></button>
          <button role="menuitem" @click="insertEditorSnippet('\n\n---\n\n')"><span><AppIcon name="rule" :size="14" />分隔线</span></button>
          <button role="menuitem" @click="openMarkdownInsert('formula')"><span><AppIcon name="math" :size="14" />公式…</span><kbd>即时预览</kbd></button>
          <button role="menuitem" @click="insertEditorSnippet('[[笔记标题]]')"><span><AppIcon name="book" :size="14" />笔记双链</span></button>
        </section>
      </div>
      <div class="markdown-menu-branch markdown-menu-branch--tools separator" data-editor-submenu="tools" :class="{ open: editorContextSubmenu === 'tools' }" @mouseenter="setEditorContextSubmenu('tools')" @mouseleave="leaveEditorContextSubmenu">
        <button class="markdown-menu-row" role="menuitem" aria-haspopup="menu" aria-controls="markdown-editor-menu-tools" :aria-expanded="editorContextSubmenu === 'tools'" @click="openEditorContextSubmenu('tools')"><span>常用工具</span><AppIcon name="arrow-right" :size="14" /></button>
        <section id="markdown-editor-menu-tools" class="markdown-menu-submenu" role="menu" aria-label="选区常用工具">
          <button role="menuitem" :disabled="!editorContextMenu.hasSelection" @click="openSelectionInCodeImage"><span><AppIcon name="terminal" :size="14" />生成代码分享图</span><kbd>仅选区</kbd></button>
          <button role="menuitem" :disabled="!editorContextMenu.hasSelection" @click="openSelectionInAi('rewrite')"><span><AppIcon name="sparkle" :size="14" />交给 AI 改写</span><kbd>需确认配置</kbd></button>
          <button role="menuitem" :disabled="!editorContextMenu.hasSelection" @click="pinSelectionAsSnippet"><span><AppIcon name="star" :size="14" />固定为常用片段</span><kbd>本地</kbd></button>
        </section>
      </div>
      <div class="markdown-menu-branch markdown-menu-branch--study" data-editor-submenu="study" :class="{ open: editorContextSubmenu === 'study' }" @mouseenter="setEditorContextSubmenu('study')" @mouseleave="leaveEditorContextSubmenu">
        <button class="markdown-menu-row" role="menuitem" aria-haspopup="menu" aria-controls="markdown-editor-menu-study" :aria-expanded="editorContextSubmenu === 'study'" @click="openEditorContextSubmenu('study')"><span>学习工具</span><AppIcon name="arrow-right" :size="14" /></button>
        <section id="markdown-editor-menu-study" class="markdown-menu-submenu" role="menu" aria-label="选区学习工具">
          <button role="menuitem" :disabled="!editorContextMenu.hasSelection" @click="createNoteFromSelection"><span><AppIcon name="book" :size="14" />从选区创建笔记</span><kbd>本地</kbd></button>
          <button role="menuitem" :disabled="!editorContextMenu.hasSelection" @click="createQuestionFromSelection"><span><AppIcon name="review" :size="14" />从选区创建题目</span><kbd>进入错题库</kbd></button>
          <button role="menuitem" :disabled="!editorContextMenu.hasSelection" @click="openSelectionInAi('summarize')"><span><AppIcon name="sparkle" :size="14" />提炼选区要点</span><kbd>AI 草稿</kbd></button>
        </section>
      </div>
      <div class="markdown-menu-branch markdown-menu-branch--document" data-editor-submenu="document" :class="{ open: editorContextSubmenu === 'document' }" @mouseenter="setEditorContextSubmenu('document')" @mouseleave="leaveEditorContextSubmenu">
        <button class="markdown-menu-row" role="menuitem" aria-haspopup="menu" aria-controls="markdown-editor-menu-document" :aria-expanded="editorContextSubmenu === 'document'" @click="openEditorContextSubmenu('document')"><span>文档操作</span><AppIcon name="arrow-right" :size="14" /></button>
        <section id="markdown-editor-menu-document" class="markdown-menu-submenu" role="menu" aria-label="文档操作">
          <template v-if="crashDraft"><button role="menuitem" @click="closeEditorContextMenu(); restoreCrashDraft()"><span>恢复异常退出草稿</span><kbd>本地</kbd></button><button class="separator" role="menuitem" @click="closeEditorContextMenu(); discardCrashDraft()"><span>放弃恢复点</span></button></template>
          <button role="menuitem" @click="openDocumentSearch()"><span>在当前文档中查找</span><kbd>Ctrl+F</kbd></button>
          <button role="menuitem" @click="copyCurrentDocumentWikiLink"><span>复制当前文档双链</span></button>
          <button role="menuitem" @click="copyWholeDocumentMarkdown()"><span>复制整篇 Markdown</span></button>
          <button role="menuitem" :disabled="Boolean(documentOutput)" @click="exportDocumentHtml()"><span>导出可打印 HTML…</span><kbd>Ctrl+Shift+E</kbd></button>
          <button role="menuitem" @click="openVersionHistory()"><span>查看版本历史</span><kbd>本地</kbd></button>
          <button role="menuitem" @click="openSplitFromEditorMenu"><span>切换为分屏编辑</span><kbd>Alt+2</kbd></button>
          <button role="menuitem" @click="openFocusFromEditorMenu"><span>{{ focusMode ? '退出专注阅读' : '进入专注阅读' }}</span><kbd>Ctrl+Shift+F</kbd></button>
        </section>
      </div>
    </div>
    <div v-if="externalFileMenu && draft?.externalFile" ref="externalFileMenuElement" class="document-context-menu external-file-context-menu" :style="{ left: `${externalFileMenu.x}px`, top: `${externalFileMenu.y}px` }" role="menu" aria-label="外部 Markdown 文件操作" @click.stop @contextmenu.prevent @keydown.stop="handleContextMenuKeydown($event, externalFileMenuElement, () => closeExternalFileMenu(true))">
      <p>{{ draft.externalFile.name }}<small>{{ externalFileWatchMode === 'native' ? '本机实时监听' : externalFileWatchMode === 'poll' ? '低频检查' : '外部 Markdown' }}</small></p>
      <button v-if="externalFileChanged" role="menuitem" @click="openExternalConflictReview(draft)"><span><AppIcon name="diff" :size="14" />比较并处理版本</span><kbd>推荐</kbd></button>
      <button role="menuitem" @click="recheckExternalMarkdown"><span><AppIcon name="refresh" :size="14" />立即检查磁盘变化</span></button>
      <button role="menuitem" @click="revealExternalMarkdown"><span><AppIcon name="folder" :size="14" />在资源管理器中显示</span></button>
      <button role="menuitem" @click="copyExternalMarkdownPath"><span><AppIcon name="duplicate" :size="14" />复制完整路径</span></button>
      <button role="menuitem" @click="closeExternalFileMenu(); saveAsMarkdown(draft)"><span><AppIcon name="download" :size="14" />另存为并重新关联…</span></button>
      <button role="menuitem" @click="closeExternalFileMenu(); unlinkExternalMarkdown(draft)"><span><AppIcon name="link" :size="14" />断开文件关联</span></button>
    </div>
    <div v-if="managedVaultMenu && managedVaultAlert && draft" ref="managedVaultMenuElement" class="document-context-menu managed-vault-menu" :style="{ left: `${managedVaultMenu.x}px`, top: `${managedVaultMenu.y}px` }" role="menu" aria-label="Vault Markdown 变化操作" @click.stop @contextmenu.prevent @keydown.stop="handleContextMenuKeydown($event, managedVaultMenuElement, () => closeManagedVaultMenu(true))">
      <p>{{ draft.title }}<small>{{ managedVaultAlert.status === 'missing' ? 'Vault 文件缺失' : '检测到磁盘修改' }}</small></p>
      <button v-if="managedVaultAlert.status === 'pending'" role="menuitem" @click="openManagedVaultConflict"><span><AppIcon name="diff" :size="14" />比较并处理版本</span><kbd>推荐</kbd></button>
      <button v-else role="menuitem" @click="recreateManagedVaultMarkdown"><span><AppIcon name="refresh" :size="14" />用当前版本重新创建</span></button>
      <button role="menuitem" @click="openManagedVaultVersionHistory"><span><AppIcon name="clock" :size="14" />查看版本历史</span></button>
      <button role="menuitem" @click="copyManagedVaultDocumentId"><span><AppIcon name="duplicate" :size="14" />复制文档 ID</span></button>
    </div>
    <ExternalMarkdownConflictDialog v-if="externalConflict" :title="externalConflict.current.title" :file-name="externalConflict.disk.name" :preview="externalConflict.preview" :busy="externalConflictBusy" :error="externalConflictError" @decision="resolveExternalConflict" />
    <ExternalMarkdownConflictDialog v-if="managedVaultConflict" managed-vault :title="managedVaultConflict.current.title" file-name="Vault Markdown" :preview="managedVaultConflict.preview" :busy="managedVaultConflictBusy" :error="managedVaultConflictError" @decision="resolveManagedVaultConflict" />
    <UnsavedChangesDialog v-if="unsavedPrompt" :item-label="draft?.title || '未命名文档'" :target-label="unsavedPrompt.targetLabel" item-kind="文档" @decision="resolveUnsavedDecision" />
    <MarkdownInsertDialog v-if="markdownInsertPanel" :initial-panel="markdownInsertPanel.panel" :initial-formula-recognition="markdownInsertPanel.recognizeFormula" :selected-text="markdownInsertPanel.selectedText" @close="closeMarkdownInsert()" @insert="insertStructuredMarkdown" />
    <QuestionImportDialog v-if="questionImportOpen" @cancel="closeQuestionImport" @complete="completeQuestionImport" />
    <div v-if="frontmatterMenu && frontmatter" ref="frontmatterMenuElement" class="relation-context-menu markdown-frontmatter-context-menu" :style="{ left: `${frontmatterMenu.x}px`, top: `${frontmatterMenu.y}px` }" role="menu" aria-label="文档属性操作" @click.stop @contextmenu.prevent @keydown.stop="handleContextMenuKeydown($event, frontmatterMenuElement, () => closeFrontmatterMenu(true))"><p>文档属性<small>{{ frontmatter.error ? 'YAML 需要检查' : `${frontmatter.entries.length}${frontmatter.truncated ? '+' : ''} 项` }}</small></p><button role="menuitem" @click="copyFrontmatter('yaml')">复制 YAML 原文</button><button role="menuitem" :disabled="!frontmatter.json" @click="copyFrontmatter('json')">复制为 JSON</button><button role="menuitem" @click="editFrontmatterSource">在源码中编辑</button><button role="menuitem" @click="toggleFrontmatterExpanded">{{ frontmatterExpanded ? '收起属性' : '展开全部属性' }}</button></div>
    <div v-if="relationMenu" ref="relationMenuElement" class="relation-context-menu" :style="{ left: `${relationMenu.x}px`, top: `${relationMenu.y}px` }" role="menu" aria-label="关联知识操作" @click.stop @contextmenu.prevent @keydown.stop="handleContextMenuKeydown($event, relationMenuElement, () => closeRelationMenu(true))"><p>{{ relationMenu.title }}</p><button role="menuitem" @click="openRelated(relationMenu.relation.fromId === draft?.id ? relationMenu.relation.toId : relationMenu.relation.fromId, relationMenu.kind); closeRelationMenu()">打开关联内容</button><button class="danger" role="menuitem" @click="removeRelation(relationMenu.relation, relationMenu.title)">移除关联</button></div>
    <div v-if="wikiContextMenu" ref="wikiContextMenuElement" class="wiki-context-menu" :class="{ 'wiki-context-menu--external': wikiContextMenu.externalEligible }" :style="{ left: `${wikiContextMenu.x}px`, top: `${wikiContextMenu.y}px` }" role="menu" aria-label="双链操作" @click.stop @contextmenu.prevent @keydown.stop="handleContextMenuKeydown($event, wikiContextMenuElement, () => closeWikiContextMenu(true))">
      <p>{{ wikiContextMenu.title }}<small v-if="wikiContextMenu.heading"> · {{ wikiContextMenu.heading }}</small><small v-if="wikiContextMenu.externalEligible">外部工作区</small></p>
      <template v-if="wikiContextMenu.target"><button role="menuitem" @click="openWikiLink(wikiContextMenu.title, wikiContextMenu.heading); closeWikiContextMenu()">打开知识库内容</button><button v-if="draft && wikiContextMenu.target.id !== draft.id" role="menuitem" @click="relateWikiTarget">与当前内容建立关联</button></template>
      <template v-else-if="wikiContextMenu.externalEligible">
        <button v-if="wikiContextMenu.resolving" role="menuitem" disabled>正在工作区查找精确文件…</button>
        <button v-for="candidate in wikiContextMenu.externalCandidates.slice(0, 6)" :key="candidate.relativePath" v-memo="[candidate.relativePath, wikiContextMenu.heading]" class="wiki-context-menu__external" role="menuitem" :title="candidate.relativePath" @click="openExternalWikiCandidate(candidate, wikiContextMenu?.heading)"><span>打开外部 Markdown</span><small>{{ candidate.relativePath }}</small></button>
        <button v-if="wikiContextMenu.externalCandidates.length > 6" role="menuitem" disabled>另有 {{ wikiContextMenu.externalCandidates.length - 6 }} 个同名文件，请使用路径双链</button>
        <button v-if="wikiContextMenu.resolutionError" role="menuitem" disabled>查找失败 · {{ wikiContextMenu.resolutionError }}</button>
        <button v-if="!wikiContextMenu.resolving" class="wiki-context-menu__internal" role="menuitem" @click="createWikiNote">改为新建内部笔记“{{ wikiContextMenu.title }}”</button>
      </template>
      <button v-else role="menuitem" @click="createWikiNote">新建“{{ wikiContextMenu.title }}”笔记</button>
    </div>
    <div v-if="headingContextMenu" ref="headingContextMenuElement" class="markdown-heading-context-menu" :style="{ left: `${headingContextMenu.x}px`, top: `${headingContextMenu.y}px` }" role="menu" aria-label="段落操作" @click.stop @contextmenu.prevent @keydown.stop="handleContextMenuKeydown($event, headingContextMenuElement, () => closeHeadingContextMenu(true))"><p>段落 · {{ headingContextMenu.heading }}</p><button role="menuitem" @click="copyHeadingWikiLink">复制段落双链 [[{{ draft?.title }}#{{ headingContextMenu.heading }}]]</button><button role="menuitem" @click="copyHeadingTitle">复制段落标题</button></div>
    <div v-if="questionAttachmentMenu" ref="questionAttachmentMenuElement" class="relation-context-menu question-attachment-context-menu" :style="{ left: `${questionAttachmentMenu.x}px`, top: `${questionAttachmentMenu.y}px` }" role="menu" aria-label="题目附件操作" @click.stop @contextmenu.prevent @keydown.stop="handleContextMenuKeydown($event, questionAttachmentMenuElement, () => closeQuestionAttachmentMenu(true))"><p>{{ questionAttachmentMenu.attachment.name }}<small>{{ formatQuestionAttachmentSize(questionAttachmentMenu.attachment.size) }}</small></p><button role="menuitem" :disabled="!questionAttachmentMenu.attachment.available" @click="revealQuestionAttachment(questionAttachmentMenu.attachment)">在资源管理器中查看</button><button role="menuitem" @click="copyQuestionAttachmentName(questionAttachmentMenu.attachment)">复制附件名称</button><button class="danger" role="menuitem" @click="removeQuestionAttachment(questionAttachmentMenu.attachment)">从题目中移除</button></div>
    <div v-if="documentStatisticsMenu" ref="documentStatisticsMenuElement" class="relation-context-menu document-statistics-menu" :style="{ left: `${documentStatisticsMenu.x}px`, top: `${documentStatisticsMenu.y}px` }" role="menu" aria-label="文档统计操作" @click.stop @contextmenu.prevent @keydown.stop="handleContextMenuKeydown($event, documentStatisticsMenuElement, () => closeDocumentStatisticsMenu(true))"><p>文档统计<small>{{ documentStatisticsPending ? '正在更新' : '本机 Worker' }}</small></p><button role="menuitem" @click="documentStatisticsExpanded = !documentStatisticsExpanded; closeDocumentStatisticsMenu(true)">{{ documentStatisticsExpanded ? '收起完整统计' : '查看完整统计' }}</button><button role="menuitem" :disabled="!documentStatistics" @click="copyDocumentStatistics">复制统计摘要</button><button role="menuitem" @click="scheduleDocumentStatistics(true); closeDocumentStatisticsMenu(true)">立即重新统计</button></div>
    <div v-if="largePreviewMenu" ref="largePreviewMenuElement" class="relation-context-menu large-preview-context-menu" :style="{ left: `${largePreviewMenu.x}px`, top: `${largePreviewMenu.y}px` }" role="menu" aria-label="大文档阅读操作" @click.stop @contextmenu.prevent @keydown.stop="handleContextMenuKeydown($event, largePreviewMenuElement, () => closeLargePreviewMenu(true))"><p>大文档阅读<small>{{ previewPending ? (previewRenderProgress?.total ? `${previewRenderPercent}% · 渐进载入` : 'Worker 分析中') : fullLargePreviewRequested ? '完整阅读模式' : '轻量保护模式' }}</small></p><button v-if="!fullLargePreviewRequested" role="menuitem" @click="requestFullLargePreview">渐进加载完整预览</button><button v-else role="menuitem" @click="cancelFullLargePreview">{{ previewPending ? '停止加载' : '返回轻量模式' }}</button><button class="separator" role="menuitem" @click="returnLargeDocumentToSource">返回源码模式</button></div>
  </div>
</template>

<style scoped>
/* Reading focus is route-owned and therefore lazy-loaded with DocumentsView.
   The native titlebar, save state and exit button remain available while the
   global rail and topbar step away without rebuilding the Markdown renderer. */
:global(.document-focus-mode .rail),:global(.document-focus-mode .topbar){display:none}
:global(.document-focus-mode .workspace){width:100%;height:100vh;margin-left:0;padding:0}
:global(.document-focus-mode .workspace-content){height:100%}
:global(.has-desktop-titlebar.document-focus-mode .workspace){height:calc(100vh - 34px)}
:global(.has-desktop-titlebar.document-focus-mode .workspace-content){height:100%}
.external-markdown-bar:focus-visible{position:relative;z-index:1;outline:2px solid color-mix(in srgb,var(--green) 44%,transparent);outline-offset:-2px}
.external-markdown-bar>button:not(.quiet-button):hover,.external-markdown-bar>button:not(.quiet-button):focus-visible{color:var(--warn);text-decoration:underline;text-underline-offset:3px}
.external-file-context-menu{width:270px}.external-file-context-menu>p{display:grid;gap:2px}.external-file-context-menu>p small{overflow:hidden;color:var(--muted);font:8.5px var(--font-mono);text-overflow:ellipsis;white-space:nowrap}.external-file-context-menu>button span{display:inline-flex;min-width:0;align-items:center;gap:8px}
.managed-vault-alert{display:grid;grid-template-columns:34px minmax(0,1fr) auto;align-items:center;gap:10px;margin:0 14px 10px;padding:10px 11px;border:1px solid var(--warn-soft);border-radius:10px;color:var(--warn);background:linear-gradient(110deg,var(--surface-2),var(--surface));box-shadow:0 5px 18px var(--warn-soft)}
.managed-vault-alert>span{display:grid;width:32px;height:32px;place-items:center;border-radius:9px;color:var(--warn);background:var(--surface-2)}.managed-vault-alert>div:nth-child(2){display:grid;min-width:0;gap:3px}.managed-vault-alert b{color:var(--warn);font:720 11px/1.35 var(--font-ui)}.managed-vault-alert small{color:var(--fg-2);font:9.5px/1.5 var(--font-ui)}.managed-vault-alert>div:last-child{display:flex;align-items:center;gap:6px}.managed-vault-alert button{min-height:31px;white-space:nowrap}.managed-vault-alert.is-missing{border-color:var(--danger-soft);background:linear-gradient(110deg,var(--surface-2),var(--surface))}.managed-vault-alert.is-missing>span{color:var(--danger);background:var(--surface-2)}.managed-vault-alert:focus-visible{outline:2px solid var(--warn);outline-offset:2px}
.managed-vault-menu{width:270px}.managed-vault-menu>p{display:grid;gap:2px}.managed-vault-menu>p small{color:var(--muted);font:8.5px var(--font-mono)}.managed-vault-menu>button span{display:inline-flex;align-items:center;gap:8px}
.markdown-preview--deferred:focus-visible{outline:3px solid color-mix(in srgb,var(--green) 38%,transparent);outline-offset:-5px}
.markdown-render-status{z-index:3;display:grid;grid-template-columns:minmax(0,auto) auto;align-items:center;gap:6px 11px;min-width:min(310px,calc(100% - 32px));max-width:390px;padding:8px 9px 8px 12px;border-radius:12px}.markdown-render-status>div{display:grid;min-width:0;gap:2px}.markdown-render-status>div span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.markdown-render-status>div small{color:var(--reading-muted,var(--muted));font:600 9px/1.35 var(--font-ui)}.markdown-render-status--ready{border-color:var(--accent-soft);background:var(--surface)}.markdown-render-status__track{grid-column:1/-1;display:block;height:3px;overflow:hidden;border-radius:99px;background:var(--accent-soft)}.markdown-render-status__track>i{display:block;height:100%;border-radius:inherit;background:var(--green);transition:width 120ms ease-out}.markdown-render-status .quiet-button{grid-column:2;grid-row:1;min-height:29px;padding-inline:10px;border-color:var(--accent-soft);color:var(--green-strong);background:var(--surface);box-shadow:var(--shadow-xs);font-size:9px}.markdown-render-status .quiet-button:hover,.markdown-render-status .quiet-button:focus-visible{border-color:var(--accent);background:var(--green-bg)}.markdown-render-status:focus-visible{outline:2px solid color-mix(in srgb,var(--green) 48%,transparent);outline-offset:2px}
@media(prefers-reduced-motion:reduce){.markdown-render-status__track>i{transition:none}}
@media(max-width:860px){.managed-vault-alert{grid-template-columns:34px minmax(0,1fr);margin-inline:10px}.managed-vault-alert>div:last-child{grid-column:1/-1;justify-content:flex-end}}
</style>
