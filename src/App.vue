<script setup lang="ts">
import { computed, KeepAlive, nextTick, onBeforeUnmount, onErrorCaptured, onMounted, ref, watch } from 'vue'
import { RouterLink, RouterView, useRoute, useRouter } from 'vue-router'
import { useWorkbenchStore } from '@/stores/workbench'
import { useUiStore } from '@/stores/ui'
import { browseCommandTools, searchTools, toolCatalog, toolCatalogOwnerLocation, type ToolCatalogItem } from '@/lib/tool-catalog'
import { cancelDesktopMediaTranscode, cancelDesktopTranscription, checkDesktopUpdate, cleanupClipboardAssets, createDesktopAutoBackup, hideMainWindow, isDesktop, listDesktopVisualProjects, listenDesktopEvent, quitDesktopApp, sendSystemNotification, setClipboardMonitor, takeDesktopOpenedMarkdownFiles, watchDesktopVaultMarkdown, type DesktopVaultSearchResult, type DesktopVisualProjectSummary } from '@/lib/native'
import { buildProfile, personalPackEnabled } from '@/lib/build-profile'
import type { Job, StudyDocument } from '@/types'
import AppIcon from '@/components/AppIcon.vue'
import AppRail from '@/components/AppRail.vue'
import AppToastHost from '@/components/AppToastHost.vue'
import AppConfirmDialog from '@/components/AppConfirmDialog.vue'
import { looksLikeCode } from '@/lib/workbench-utils'
import { isQuickIntakeShortcut } from '@/lib/intake'
import { readClipboardPayload } from '@/lib/clipboard'
import { clampMenuPosition, isContextMenuShortcut, nextMenuItemIndex } from '@/lib/desktop-menu'
import { createAsyncSearchGate } from '@/lib/async-search-gate'
import { activeWorkspaceChildTarget, searchWorkspaceCommands, workspaceContextActionGroups, workspaceFeatureGroups, workspaceNavGroups as navGroups, type WorkspaceNavAction as NavAction, type WorkspaceNavItem as NavItem } from '@/lib/workspace-navigation'
import { discoverVisualProjects, visualProjectRoute } from '@/lib/visual-project'
import { favoriteContentIcons, favoriteContentLabels, favoriteContentRoute, resolveFavoriteContent, type FavoriteContentItem } from '@/lib/content-favorites'
import { resolveRecentContent } from '@/lib/content-recents'
import { appearanceClasses, appearanceVariables } from '@/lib/appearance'
import { searchGlobalClipboard, searchGlobalSources } from '@/lib/global-local-search'
import { stageLocalFileHandoff } from '@/lib/local-file-handoff'
import { isMarkdownOpenShortcut, normalizeMarkdownOpenPaths } from '@/lib/markdown-open'
import { createWorkspaceHistory, recordWorkspaceHistory, selectWorkspaceHistoryIndex, workspaceHistoryMenuEntries, workspaceHistoryTarget } from '@/lib/workspace-history'
const route=useRoute(),router=useRouter(),store=useWorkbenchStore(),ui=useUiStore(),desktop=isDesktop();const commandOpen=ref(false),commandQuery=ref(''),commandBrowseOpen=ref(false),commandInput=ref<HTMLInputElement>(),commandPalette=ref<HTMLElement>(),taskPanelOpen=ref(false),closePrompt=ref(false),rememberClose=ref(true),documentDirty=ref(false),activeDocumentId=ref(''),dirtyDocumentTitle=ref(''),dirtyWorkKind=ref('内容'),routeError=ref(''),documentResults=ref<DesktopVaultSearchResult[]>([]),documentSearchPending=ref(false),visualProjectCatalog=ref<DesktopVisualProjectSummary[]>([]),visualProjectSearchPending=ref(false);const unlisteners:Array<()=>void>=[];const documentSearchGate=createAsyncSearchGate();let commandTrigger:HTMLElement|undefined,documentSearchTimer:number|undefined,automaticBackupTimer:number|undefined,windowStateTimer:number|undefined
const vaultMarkdownChangeTimers=new Map<string,number>()
type VaultMarkdownNativeChange={documentId:string;kind:'note'|'question';change:'modified'|'removed'}
type VaultMarkdownSurfaceChange=VaultMarkdownNativeChange&{status:'pending'|'updated'|'unchanged'|'missing'|'untracked';document?:StudyDocument}
let discardDirtyRecovery: (() => Promise<void>) | undefined
const commandFeatureGroups=workspaceFeatureGroups()
const commandFeatureCount=commandFeatureGroups.reduce((count,group)=>count+group.features.length,0)
const initialSpace=navGroups.flatMap(group=>group.items).find(item=>isNavActive(item.to))??navGroups[0]?.items[0]
const expandedSpaces=ref(new Set(initialSpace?[initialSpace.to]:[]))
const activeWorkspace=computed(()=>navGroups.flatMap(group=>group.items).find(item=>isNavActive(item.to))??navGroups[0]?.items[0])
const workspaceContextGroups=computed(()=>activeWorkspace.value?workspaceContextActionGroups(activeWorkspace.value.to):{primary:[],more:[]})
const workspaceContextFeatures=computed(()=>workspaceContextGroups.value.primary)
const workspaceContextMoreFeatures=computed(()=>workspaceContextGroups.value.more)
const navContext=ref<{item:NavItem;x:number;y:number}|null>(null),navContextElement=ref<HTMLElement>();let navContextTrigger:HTMLElement|undefined
const workspaceContext=ref<{x:number;y:number}|null>(null),workspaceContextElement=ref<HTMLElement>(),workspaceContentElement=ref<HTMLElement>(),workspaceContextMoreOpen=ref(false);let workspaceContextTrigger:HTMLElement|undefined,workspaceContextAnchor:{x:number;y:number}|undefined
const titlebarContext=ref<{x:number;y:number}|null>(null),titlebarContextElement=ref<HTMLElement>(),windowMaximized=ref(false);let titlebarContextTrigger:HTMLElement|undefined
const workspaceHistory=ref(createWorkspaceHistory({path:route.fullPath,label:'Knitspace'})),historyMenu=ref<{x:number;y:number;direction:-1|1}|null>(null),historyMenuElement=ref<HTMLElement>();let historyMenuTrigger:HTMLElement|undefined
const vaultNoticeContext=ref<{x:number;y:number}|null>(null),vaultNoticeContextElement=ref<HTMLElement>();let vaultNoticeContextTrigger:HTMLElement|undefined
const vaultErrorFixture=ref('')
const visibleVaultError=computed(()=>vaultErrorFixture.value||store.vaultError)
const visibleVaultErrorSentence=computed(()=>/[。！？.!?]$/.test(visibleVaultError.value)?visibleVaultError.value:`${visibleVaultError.value}。`)
watch(()=>route.query.qa,qa=>{vaultErrorFixture.value=import.meta.env.DEV&&qa==='vault-migration-error'?'无法打开 SQLite：模拟的资料库文件占用错误。':''},{immediate:true})
let applicationHydrated=false,desktopOpenRequest=0
type CommandContentSource='favorite'|'recent'|'search'
type CommandContentItem={itemId:string;itemKind:FavoriteContentItem['itemKind'];title:string;detail:string;addedAt?:string;openedAt?:string;updatedAt?:string}
const commandContentContext=ref<{item:CommandContentItem;source:CommandContentSource;x:number;y:number}|null>(null),commandContentContextElement=ref<HTMLElement>();let commandContentContextTrigger:HTMLElement|undefined
const commandToolContext=ref<{item:ToolCatalogItem;x:number;y:number}|null>(null),commandToolContextElement=ref<HTMLElement>();let commandToolContextTrigger:HTMLElement|undefined
const knowledgeSearchResults=computed(()=>documentResults.value.filter(item=>item.kind!=='source'))
const sourceSearchResults=computed<CommandContentItem[]>(()=>{
  const indexed=documentResults.value.filter(item=>item.kind==='source').map(item=>({itemId:item.id,itemKind:'source' as const,title:item.title,detail:item.snippet||`${item.subject.toUpperCase()}${item.tags.length?` · ${item.tags.join(' · ')}`:''}`}))
  const indexedIds=new Set(indexed.map(item=>item.itemId))
  const metadata=searchGlobalSources(store.sources,commandQuery.value).filter(item=>!indexedIds.has(item.id)).map(item=>({itemId:item.id,itemKind:'source' as const,title:item.title,detail:item.detail}))
  return [...indexed,...metadata]
})
const clipboardSearchResults=computed(()=>searchGlobalClipboard(store.clipboardItems,commandQuery.value))
const title=computed(()=>route.path==='/documents'?(route.query.kind==='note'?'知识库':route.query.kind==='question'?'题目与错题':'全部学习内容'):String(route.meta.title??'Knitspace'));const runningJobs=computed(()=>store.jobs.filter(j=>j.status==='running'||j.status==='queued'));const commandHasQuery=computed(()=>Boolean(commandQuery.value.trim()));const commandWorkspaceResults=computed(()=>searchWorkspaceCommands(commandQuery.value));const commandToolGroups=computed(()=>{const query=commandQuery.value.trim();if(query)return [{id:'suggested' as const,label:'工具',tools:searchTools(query)}];return browseCommandTools(store.favorites.slice().sort((left,right)=>left.order-right.order).map(item=>item.toolId),store.toolUsages.map(item=>item.toolId))});const commandResults=computed(()=>commandToolGroups.value.flatMap(group=>group.tools));const favoriteContentResults=computed(()=>commandHasQuery.value?[]:resolveFavoriteContent(store.contentFavorites,store.documents,store.vocabulary,store.sources,6,visualProjectCatalog.value));const recentContentResults=computed(()=>{if(commandHasQuery.value)return[];const favorites=new Set(store.contentFavorites.map(item=>`${item.itemKind}:${item.itemId}`));return resolveRecentContent(store.contentRecents,store.documents,store.vocabulary,store.sources,12,visualProjectCatalog.value).filter(item=>!favorites.has(`${item.itemKind}:${item.itemId}`)).slice(0,6)});const visualProjectResults=computed(()=>{const projects=discoverVisualProjects(visualProjectCatalog.value,commandQuery.value,commandHasQuery.value?8:3);if(commandHasQuery.value)return projects;const surfaced=new Set([...store.contentFavorites,...store.contentRecents].map(item=>`${item.itemKind}:${item.itemId}`));return projects.filter(project=>!surfaced.has(`diagram:${project.id}`))});const commandSearchPending=computed(()=>documentSearchPending.value||visualProjectSearchPending.value);const commandResultCount=computed(()=>commandWorkspaceResults.value.length+commandResults.value.length+favoriteContentResults.value.length+recentContentResults.value.length+visualProjectResults.value.length+knowledgeSearchResults.value.length+sourceSearchResults.value.length+clipboardSearchResults.value.length);const currentBreadcrumb=computed(()=>navGroups.flatMap(group=>group.items.map(item=>({group:group.label,to:item.to,label:item.label}))).find(item=>isNavActive(item.to))??navGroups.flatMap(group=>group.items.map(item=>({group:group.label,to:item.to,label:item.label}))).find(item=>router.resolve(item.to).path===route.path))
const canNavigateBack=computed(()=>Boolean(workspaceHistoryTarget(workspaceHistory.value,-1))),canNavigateForward=computed(()=>Boolean(workspaceHistoryTarget(workspaceHistory.value,1))),historyMenuEntries=computed(()=>historyMenu.value?workspaceHistoryMenuEntries(workspaceHistory.value,historyMenu.value.direction):[])
const vaultBootstrapStages=[
  {id:'opening',label:'打开 SQLite 与 Markdown',detail:'核对数据库版本，并续接尚未完成的浏览器数据迁移。'},
  {id:'sources',label:'接入本地资料',detail:'把图片、PDF 与文件引用交给 Vault 管理。'},
  {id:'pointers',label:'恢复收藏与最近使用',detail:'重建轻量导航入口，不重复读取正文。'},
  {id:'activity',label:'整理学习活动',detail:'载入专注记录、纪念日和操作时间线。'},
  {id:'clipboard',label:'连接剪贴板历史',detail:'仅载入有界预览，完整内容按需读取。'},
] as const
const vaultBootstrapIndex=computed(()=>Math.max(0,vaultBootstrapStages.findIndex(stage=>stage.id===store.vaultBootstrapStage)))
const vaultBootstrapCopy=computed(()=>vaultBootstrapStages[vaultBootstrapIndex.value]??vaultBootstrapStages[0])
function routeMatches(to:string){const target=router.resolve(to);return route.path===target.path&&Object.entries(target.query).every(([key,value])=>String(route.query[key]??'')===String(value))&&(!target.hash||route.hash===target.hash)}
function isNavActive(to:string){const item=navGroups.flatMap(group=>group.items).find(entry=>entry.to===to);return routeMatches(to)||Boolean(item?.children.some(child=>routeMatches(child.to)))}
function isChildNavActive(item:NavItem,child:NavAction){return activeWorkspaceChildTarget(item.children,{path:route.path,query:route.query,hash:route.hash})===child.to}
function isSpaceExpanded(item:NavItem){return expandedSpaces.value.has(item.to)}
function toggleSpace(item:NavItem){const next=new Set(expandedSpaces.value);if(next.has(item.to))next.delete(item.to);else next.add(item.to);expandedSpaces.value=next}
function expandActiveSpace(){const active=navGroups.flatMap(group=>group.items).find(item=>isNavActive(item.to));if(active)expandedSpaces.value=new Set([active.to])}
function openCommand(trigger?:HTMLElement){commandTrigger=trigger??(document.activeElement instanceof HTMLElement?document.activeElement:undefined);window.dispatchEvent(new CustomEvent('knitspace:close-context-menus'));commandBrowseOpen.value=false;commandOpen.value=true;void loadVisualProjectCatalog();nextTick(()=>commandInput.value?.focus())}
function openFeatureMap(trigger?:HTMLElement){
  if(!commandOpen.value)openCommand(trigger)
  else{
    commandTrigger=trigger??commandTrigger
    window.dispatchEvent(new CustomEvent('knitspace:close-context-menus'))
    commandQuery.value='';documentResults.value=[];documentSearchPending.value=false;documentSearchGate.invalidate()
    if(documentSearchTimer!==undefined)window.clearTimeout(documentSearchTimer)
  }
  commandBrowseOpen.value=true
  void nextTick(()=>commandInput.value?.focus({preventScroll:true}))
}
function closeCommand(restoreFocus=false){documentSearchGate.invalidate();commandContentContext.value=null;commandToolContext.value=null;commandBrowseOpen.value=false;commandOpen.value=false;commandQuery.value='';documentResults.value=[];documentSearchPending.value=false;if(documentSearchTimer!==undefined)window.clearTimeout(documentSearchTimer);if(restoreFocus)nextTick(()=>commandTrigger?.focus({preventScroll:true}))}
function toggleCommandBrowse(){commandBrowseOpen.value=!commandBrowseOpen.value;commandQuery.value='';documentResults.value=[];documentSearchPending.value=false;documentSearchGate.invalidate();if(documentSearchTimer!==undefined)window.clearTimeout(documentSearchTimer);void nextTick(()=>commandInput.value?.focus({preventScroll:true}))}
function leaveCommandBrowse(){if(!commandBrowseOpen.value)return false;commandBrowseOpen.value=false;void nextTick(()=>commandInput.value?.focus({preventScroll:true}));return true}
function commandResultLinks(){return [...(commandPalette.value?.querySelectorAll<HTMLElement>('[data-command-result]')??[])]}
function commandFocusable(){return [...(commandPalette.value?.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')??[])].filter(item=>item.getClientRects().length>0)}
function focusCommandResult(direction:1|-1|'first'|'last'){
  const links=commandResultLinks();if(!links.length)return
  const current=links.indexOf(document.activeElement as HTMLElement)
  const index=direction==='first'?0:direction==='last'?links.length-1:current<0?(direction===1?0:links.length-1):(current+direction+links.length)%links.length
  links[index]?.focus({preventScroll:true})
}
function handleCommandDialogKeydown(event:KeyboardEvent){
  if(event.altKey&&event.key.toLocaleLowerCase()==='a'){event.preventDefault();toggleCommandBrowse();return}
  if(event.key!=='Tab')return
  const items=commandFocusable();if(!items.length)return
  const current=items.indexOf(document.activeElement as HTMLElement)
  const next=event.shiftKey?(current<=0?items.length-1:current-1):(current<0||current===items.length-1?0:current+1)
  event.preventDefault();items[next]?.focus({preventScroll:true})
}
function handleCommandKeydown(event:KeyboardEvent){
  if(event.key==='Escape'){event.preventDefault();event.stopPropagation();if(!leaveCommandBrowse())closeCommand(true);return}
  if(event.key==='ArrowDown'||event.key==='ArrowUp'||event.key==='Home'||event.key==='End'){
    event.preventDefault();focusCommandResult(event.key==='Home'?'first':event.key==='End'?'last':event.key==='ArrowDown'?1:-1)
  }
}
function handleCommandResultKeydown(event:KeyboardEvent){
  if(event.key==='Escape'){event.preventDefault();event.stopPropagation();if(!leaveCommandBrowse())closeCommand(true);return}
  if(event.key==='ArrowDown'||event.key==='ArrowUp'||event.key==='Home'||event.key==='End'){
    event.preventDefault();focusCommandResult(event.key==='Home'?'first':event.key==='End'?'last':event.key==='ArrowDown'?1:-1)
  }
}
function closeCommandContentContext(restoreFocus=false){commandContentContext.value=null;if(restoreFocus)nextTick(()=>commandContentContextTrigger?.focus({preventScroll:true}))}
function showCommandContentContext(item:CommandContentItem,source:CommandContentSource,x:number,y:number,trigger:HTMLElement){
  const actionCount=source==='recent'?5:4
  commandToolContext.value=null
  commandContentContextTrigger=trigger
  commandContentContext.value={item,source,...clampMenuPosition(x,y,{menuWidth:252,menuHeight:57+actionCount*38,margin:12})}
  void nextTick(()=>commandContentContextElement.value?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus({preventScroll:true}))
}
function openCommandContentContext(event:MouseEvent,item:CommandContentItem,source:CommandContentSource){event.preventDefault();event.stopPropagation();showCommandContentContext(item,source,event.clientX,event.clientY,event.currentTarget as HTMLElement)}
function handleCommandContentResultKeydown(event:KeyboardEvent,item:CommandContentItem,source:CommandContentSource){
  if(isContextMenuShortcut(event)){event.preventDefault();event.stopPropagation();const trigger=event.currentTarget as HTMLElement,bounds=trigger.getBoundingClientRect();showCommandContentContext(item,source,bounds.right-18,bounds.top+12,trigger);return}
  handleCommandResultKeydown(event)
}
function handleCommandContentContextKeydown(event:KeyboardEvent){
  const menu=commandContentContextElement.value;if(!menu)return
  if(event.key==='Escape'){event.preventDefault();closeCommandContentContext(true);return}
  const items=[...menu.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')]
  const nextIndex=nextMenuItemIndex(event.key,items.indexOf(document.activeElement as HTMLButtonElement),items.length)
  if(nextIndex===undefined)return
  event.preventDefault();items[nextIndex]?.focus({preventScroll:true})
}
function closeCommandToolContext(restoreFocus=false){commandToolContext.value=null;if(restoreFocus)nextTick(()=>commandToolContextTrigger?.focus({preventScroll:true}))}
function showCommandToolContext(item:ToolCatalogItem,x:number,y:number,trigger:HTMLElement){
  commandContentContext.value=null
  commandToolContextTrigger=trigger
  commandToolContext.value={item,...clampMenuPosition(x,y,{menuWidth:252,menuHeight:209,margin:12})}
  void nextTick(()=>commandToolContextElement.value?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus({preventScroll:true}))
}
function openCommandToolContext(event:MouseEvent,item:ToolCatalogItem){event.preventDefault();event.stopPropagation();showCommandToolContext(item,event.clientX,event.clientY,event.currentTarget as HTMLElement)}
function handleCommandToolResultKeydown(event:KeyboardEvent,item:ToolCatalogItem){
  if(isContextMenuShortcut(event)){event.preventDefault();event.stopPropagation();const trigger=event.currentTarget as HTMLElement,bounds=trigger.getBoundingClientRect();showCommandToolContext(item,bounds.right-18,bounds.top+12,trigger);return}
  handleCommandResultKeydown(event)
}
function handleCommandToolContextKeydown(event:KeyboardEvent){
  const menu=commandToolContextElement.value;if(!menu)return
  if(event.key==='Escape'){event.preventDefault();closeCommandToolContext(true);return}
  const items=[...menu.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')]
  const nextIndex=nextMenuItemIndex(event.key,items.indexOf(document.activeElement as HTMLButtonElement),items.length)
  if(nextIndex===undefined)return
  event.preventDefault();items[nextIndex]?.focus({preventScroll:true})
}
async function runCommandToolAction(action:'open'|'favorite'|'copy-description'|'browse-tools'){
  const target=commandToolContext.value;if(!target)return
  closeCommandToolContext()
  if(action==='open'){store.recordToolUsage(target.item.id,target.item.to.path);await router.push(target.item.to);closeCommand();return}
  if(action==='favorite'){await store.toggleFavorite(target.item.id);ui.toast(store.favorites.some(item=>item.toolId===target.item.id)?'已收藏工具':'已取消收藏',target.item.title,'success');nextTick(()=>commandInput.value?.focus({preventScroll:true}));return}
  if(action==='browse-tools'){await router.push(toolCatalogOwnerLocation(target.item));closeCommand();return}
  const description=`${target.item.title} — ${target.item.description}`
  try{await navigator.clipboard.writeText(description);ui.toast('已复制工具说明',description,'success')}
  catch(error){ui.toast('复制失败',error instanceof Error?error.message:'系统剪贴板暂时不可用。','error')}
  nextTick(()=>commandInput.value?.focus({preventScroll:true}))
}
function commandContentCollectionRoute(item:CommandContentItem){if(item.itemKind==='word')return'/words';if(item.itemKind==='source')return'/library';if(item.itemKind==='diagram')return'/create';return{path:'/documents',query:{kind:item.itemKind}}}
function vaultSearchCommandContent(item:DesktopVaultSearchResult):CommandContentItem{return{itemId:item.id,itemKind:item.kind,title:item.title,detail:item.snippet||`${item.subject}${item.tags.length?` · ${item.tags.join(' · ')}`:''}`,updatedAt:item.updatedAt}}
async function runCommandContentAction(action:'open'|'favorite'|'remove-recent'|'copy-reference'|'browse-kind'){
  const target=commandContentContext.value;if(!target)return
  closeCommandContentContext()
  if(action==='open'){await router.push(favoriteContentRoute(target.item));closeCommand();return}
  if(action==='browse-kind'){await router.push(commandContentCollectionRoute(target.item));closeCommand();return}
  if(action==='favorite'){const wasFavorite=store.isContentFavorite(target.item.itemKind,target.item.itemId);await store.toggleContentFavorite(target.item.itemKind,target.item.itemId);ui.toast(wasFavorite?'已取消收藏':'已加入收藏',target.item.title,'success');nextTick(()=>commandInput.value?.focus({preventScroll:true}));return}
  if(action==='remove-recent'){await store.removeFromContentRecents(target.item.itemKind,target.item.itemId);ui.toast('已从最近打开移除','原内容没有被删除。','success');nextTick(()=>commandInput.value?.focus({preventScroll:true}));return}
  const reference=target.item.itemKind==='note'||target.item.itemKind==='question'?`[[${target.item.title}]]`:target.item.title
  try{await navigator.clipboard.writeText(reference);ui.toast(target.item.itemKind==='note'||target.item.itemKind==='question'?'双链已复制':'名称已复制',reference,'success')}
  catch(error){ui.toast('复制失败',error instanceof Error?error.message:'系统剪贴板暂时不可用。','error')}
  nextTick(()=>commandInput.value?.focus({preventScroll:true}))
}
function openFirstResult(){const workspace=commandWorkspaceResults.value[0];if(workspace){router.push(workspace.to);closeCommand();return}const first=commandResults.value[0];if(first){store.recordToolUsage(first.id,first.to.path);router.push(first.to);closeCommand();return}const project=visualProjectResults.value[0];if(project){router.push(visualProjectRoute(project.id));closeCommand();return}const document=knowledgeSearchResults.value[0];if(document){router.push(document.kind==='word'?{path:'/words',query:{word:document.id}}:{path:'/documents',query:{kind:document.kind,document:document.id}});closeCommand();return}const source=sourceSearchResults.value[0];if(source){router.push(favoriteContentRoute(source));closeCommand();return}const clipboard=clipboardSearchResults.value[0];if(clipboard){router.push({path:'/clipboard',query:{item:clipboard.id}});closeCommand()}}
async function loadVisualProjectCatalog(){
  if(!desktop||visualProjectSearchPending.value)return
  visualProjectSearchPending.value=true
  try{visualProjectCatalog.value=await listDesktopVisualProjects(60)}
  catch{visualProjectCatalog.value=[]}
  finally{visualProjectSearchPending.value=false}
}
function scheduleDocumentSearch(query:string){
  if(documentSearchTimer!==undefined)window.clearTimeout(documentSearchTimer)
  const sequence=documentSearchGate.begin()
  const normalized=query.trim()
  if(normalized.length<2){documentResults.value=[];documentSearchPending.value=false;return}
  documentSearchPending.value=true
  documentSearchTimer=window.setTimeout(async()=>{
    try{const results=await store.searchDocuments(normalized);if(documentSearchGate.isCurrent(sequence))documentResults.value=results}
    catch{if(documentSearchGate.isCurrent(sequence))documentResults.value=[]}
    finally{if(documentSearchGate.isCurrent(sequence))documentSearchPending.value=false}
  },150)
}
function historyLocationLabel(path:string){
  const resolved=router.resolve(path),documentId=typeof resolved.query.document==='string'?resolved.query.document:''
  if(documentId){const document=store.documents.find(item=>item.id===documentId);if(document)return document.title||'未命名文档'}
  return String(resolved.meta.title??(resolved.path==='/'?'今天':'Knitspace'))
}
function closeHistoryMenu(restoreFocus=false){historyMenu.value=null;if(restoreFocus)historyMenuTrigger?.focus({preventScroll:true})}
function showHistoryMenu(direction:-1|1,x:number,y:number,trigger:HTMLElement){
  const count=workspaceHistoryMenuEntries(workspaceHistory.value,direction).length
  if(!count)return
  closeShellMenus();historyMenuTrigger=trigger
  historyMenu.value={direction,...clampMenuPosition(x,y,{menuWidth:276,menuHeight:51+count*39,margin:12})}
  void nextTick(()=>historyMenuElement.value?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus({preventScroll:true}))
}
function openHistoryMenu(event:MouseEvent,direction:-1|1){event.preventDefault();event.stopPropagation();showHistoryMenu(direction,event.clientX,event.clientY,event.currentTarget as HTMLElement)}
function openHistoryMenuFromKeyboard(event:KeyboardEvent,direction:-1|1){if(!isContextMenuShortcut(event))return;event.preventDefault();event.stopPropagation();const trigger=event.currentTarget as HTMLElement,bounds=trigger.getBoundingClientRect();showHistoryMenu(direction,bounds.left,bounds.bottom+6,trigger)}
function handleHistoryMenuKeydown(event:KeyboardEvent){
  const menu=historyMenuElement.value;if(!menu)return
  if(event.key==='Escape'){event.preventDefault();closeHistoryMenu(true);return}
  const items=[...menu.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')],nextIndex=nextMenuItemIndex(event.key,items.indexOf(document.activeElement as HTMLButtonElement),items.length)
  if(nextIndex===undefined)return
  event.preventDefault();items[nextIndex]?.focus({preventScroll:true})
}
async function navigateToWorkspaceHistoryTarget(target:{entry:{path:string;label:string};index:number}|undefined){
  if(!target)return
  const previous=workspaceHistory.value
  workspaceHistory.value=selectWorkspaceHistoryIndex(previous,target.index)
  closeHistoryMenu();closeShellMenus()
  try{const failure=await router.push(target.entry.path);if(failure||route.fullPath!==router.resolve(target.entry.path).fullPath)workspaceHistory.value=previous}
  catch{workspaceHistory.value=previous}
}
function navigateWorkspaceHistory(direction:-1|1){return navigateToWorkspaceHistoryTarget(workspaceHistoryTarget(workspaceHistory.value,direction))}
function navigateWorkspaceHistoryIndex(index:number){const entry=workspaceHistory.value.entries[index];return navigateToWorkspaceHistoryTarget(entry?{entry,index}:undefined)}
function handleShortcut(event:KeyboardEvent){if(event.altKey&&!event.ctrlKey&&!event.metaKey&&!event.shiftKey&&(event.key==='ArrowLeft'||event.key==='ArrowRight')){event.preventDefault();void navigateWorkspaceHistory(event.key==='ArrowLeft'?-1:1)}else if(isQuickIntakeShortcut(event)){event.preventDefault();window.dispatchEvent(new CustomEvent('knitspace:close-context-menus'));closeCommand();taskPanelOpen.value=false;void router.push('/quick')}else if(isMarkdownOpenShortcut(event)){event.preventDefault();closeCommand();closeShellMenus();void chooseMarkdownFiles()}else if((event.ctrlKey||event.metaKey)&&event.shiftKey&&!event.altKey&&event.key.toLowerCase()==='k'){event.preventDefault();openFeatureMap()}else if((event.ctrlKey||event.metaKey)&&!event.shiftKey&&!event.altKey&&event.key.toLowerCase()==='k'){event.preventDefault();commandOpen.value?closeCommand(true):openCommand()}else if(event.ctrlKey&&event.altKey&&/^[1-9]$/.test(event.key)){const favorite=store.favorites.slice().sort((a,b)=>a.order-b.order)[Number(event.key)-1];const tool=favorite&&toolCatalog.find(item=>item.id===favorite.toolId);if(tool){event.preventDefault();store.recordToolUsage(tool.id,tool.to.path);router.push(tool.to)}}else if(event.key==='Escape'){const shouldRestoreCommandFocus=commandOpen.value;closeCommand(shouldRestoreCommandFocus);taskPanelOpen.value=false;closePrompt.value=false;if(historyMenu.value)closeHistoryMenu(true);if(navContext.value){navContext.value=null;navContextTrigger?.focus()}if(workspaceContext.value){workspaceContext.value=null;workspaceContextTrigger?.focus()}if(titlebarContext.value){titlebarContext.value=null;titlebarContextTrigger?.focus()}if(vaultNoticeContext.value)closeVaultNoticeContext(true)}}
function closeNavContext(restoreFocus=false){navContext.value=null;if(restoreFocus)navContextTrigger?.focus()}
function showNavContext(item:NavItem,x:number,y:number,trigger:HTMLElement){const menuHeight=62+item.menu.length*38;workspaceContext.value=null;navContextTrigger=trigger;navContext.value={item,...clampMenuPosition(x,y,{menuWidth:220,menuHeight:Math.min(menuHeight,window.innerHeight-24),margin:12})};void nextTick(()=>navContextElement.value?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus({preventScroll:true}))}
function openNavContext(event:MouseEvent,item:NavItem){showNavContext(item,event.clientX,event.clientY,event.currentTarget as HTMLElement)}
function openNavContextFromKeyboard(item:NavItem,trigger:HTMLElement){const bounds=trigger.getBoundingClientRect();showNavContext(item,bounds.right+8,bounds.top+8,trigger)}
function handleNavLinkKeydown(event:KeyboardEvent,item:NavItem){if(event.key!=='ContextMenu'&&!(event.shiftKey&&event.key==='F10'))return;event.preventDefault();openNavContextFromKeyboard(item,event.currentTarget as HTMLElement)}
function handleNavContextKeydown(event:KeyboardEvent){const menu=navContextElement.value;if(!menu)return;const items=[...menu.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')];const activeIndex=items.indexOf(document.activeElement as HTMLButtonElement);if(event.key==='Escape'){event.preventDefault();closeNavContext(true);return}if(event.key==='ArrowDown'||event.key==='ArrowUp'||event.key==='Home'||event.key==='End'){event.preventDefault();const nextIndex=event.key==='Home'?0:event.key==='End'?items.length-1:(activeIndex+(event.key==='ArrowDown'?1:-1)+items.length)%items.length;items[nextIndex]?.focus()}}
function runNavAction(action:NavAction){closeNavContext();router.push(action.to)}
function isWorkspaceContextTarget(target:EventTarget|null){if(!(target instanceof Element))return false;return !target.closest('a,button,input,textarea,select,summary,[contenteditable="true"],[role="button"],[role="menu"],.cm-editor,.markdown-content,pre,code,canvas,svg,.canvas-stage,.visual-process-canvas,.markdown-mindmap__stage')}
function workspaceContextMenuHeight(expanded=workspaceContextMoreOpen.value){return 104+workspaceContextFeatures.value.length*37+(workspaceContextMoreFeatures.value.length?42:0)+(expanded?28+workspaceContextMoreFeatures.value.length*37:0)+4*49}
function closeWorkspaceContext(restoreFocus=false){workspaceContext.value=null;workspaceContextMoreOpen.value=false;workspaceContextAnchor=undefined;if(restoreFocus)workspaceContextTrigger?.focus({preventScroll:true})}
function fitWorkspaceContextToViewport(){const menu=workspaceContextElement.value;if(!menu||!workspaceContextAnchor)return;const rect=menu.getBoundingClientRect();workspaceContext.value=clampMenuPosition(workspaceContextAnchor.x,workspaceContextAnchor.y,{menuWidth:rect.width,menuHeight:rect.height,margin:12})}
function showWorkspaceContext(x:number,y:number,trigger:HTMLElement){workspaceContextMoreOpen.value=false;workspaceContextAnchor={x,y};const position=clampMenuPosition(x,y,{menuWidth:274,menuHeight:Math.min(workspaceContextMenuHeight(false),window.innerHeight-24),margin:12});navContext.value=null;workspaceContextTrigger=trigger;workspaceContext.value=position;void nextTick(()=>{fitWorkspaceContextToViewport();workspaceContextElement.value?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus()})}
function openWorkspaceContext(event:MouseEvent){if(event.defaultPrevented||!isWorkspaceContextTarget(event.target))return;event.preventDefault();event.stopPropagation();if(!(event.currentTarget instanceof HTMLElement))return;showWorkspaceContext(event.clientX,event.clientY,event.currentTarget)}
function openWorkspaceContextFromKeyboard(event:KeyboardEvent){if(!isContextMenuShortcut(event)||!isWorkspaceContextTarget(event.target))return;if(!(event.currentTarget instanceof HTMLElement))return;event.preventDefault();const bounds=event.currentTarget.getBoundingClientRect();showWorkspaceContext(bounds.left+Math.min(220,bounds.width*.44),bounds.top+Math.min(180,bounds.height*.26),event.currentTarget)}
function handleWorkspaceContextKeydown(event:KeyboardEvent){const menu=workspaceContextElement.value;if(!menu)return;if(event.key==='Escape'){event.preventDefault();if(workspaceContextMoreOpen.value){workspaceContextMoreOpen.value=false;void nextTick(()=>workspaceContextElement.value?.querySelector<HTMLButtonElement>('.workspace-context-menu__more-toggle')?.focus({preventScroll:true}));return}closeWorkspaceContext(true);return}const items=[...menu.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')];const nextIndex=nextMenuItemIndex(event.key,items.indexOf(document.activeElement as HTMLButtonElement),items.length);if(nextIndex===undefined)return;event.preventDefault();items[nextIndex]?.focus()}
function toggleWorkspaceContextMore(){if(!workspaceContextMoreFeatures.value.length)return;workspaceContextMoreOpen.value=!workspaceContextMoreOpen.value;if(workspaceContextMoreOpen.value&&workspaceContextAnchor){workspaceContext.value=clampMenuPosition(workspaceContextAnchor.x,workspaceContextAnchor.y,{menuWidth:274,menuHeight:Math.min(workspaceContextMenuHeight(true),window.innerHeight-24),margin:12})}void nextTick(()=>{fitWorkspaceContextToViewport();workspaceContextElement.value?.querySelector<HTMLButtonElement>('.workspace-context-menu__more-toggle')?.focus({preventScroll:true})})}
async function runWorkspaceFeature(action:NavAction){closeWorkspaceContext();await router.push(action.to)}
async function runWorkspaceAction(action:'open-markdown'|'clipboard'|'browse'|'command'){
  closeWorkspaceContext()
  if(action==='open-markdown'){await chooseMarkdownFiles();return}
  if(action==='browse'){openFeatureMap(workspaceContextTrigger);return}
  if(action==='command'){openCommand(workspaceContextTrigger);return}
  try{const payload=await readClipboardPayload();if(!payload)throw new Error('剪贴板中没有支持的文本或图片。');const kind=payload.kind==='image'?'image':looksLikeCode(payload.content||'')?'code':'text';await store.addClipboardItem({kind,content:payload.content,preview:payload.preview,assetPath:payload.assetPath,hash:payload.hash});ui.toast('已收进本地剪贴板历史','可以在工具空间随时重新复制或固定。','success')}
  catch(error){ui.toast('读取剪贴板失败',error instanceof Error?error.message:'当前内容无法保存。','error')}
}
function closeTitlebarContext(restoreFocus=false){titlebarContext.value=null;if(restoreFocus)titlebarContextTrigger?.focus({preventScroll:true})}
function showTitlebarContext(x:number,y:number,trigger:HTMLElement){
  const position=clampMenuPosition(x,y,{menuWidth:226,menuHeight:286,margin:8})
  navContext.value=null;workspaceContext.value=null
  titlebarContextTrigger=trigger
  titlebarContext.value=position
  void nextTick(()=>titlebarContextElement.value?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus())
}
function openTitlebarContext(event:MouseEvent){if(desktop)showTitlebarContext(event.clientX,event.clientY,event.currentTarget as HTMLElement)}
function openTitlebarContextFromKeyboard(event:KeyboardEvent){if(!desktop||!isContextMenuShortcut(event))return;event.preventDefault();const trigger=event.currentTarget as HTMLElement,bounds=trigger.getBoundingClientRect();showTitlebarContext(bounds.left+168,bounds.top+30,trigger)}
function handleTitlebarContextKeydown(event:KeyboardEvent){
  const menu=titlebarContextElement.value;if(!menu)return
  if(event.key==='Escape'){event.preventDefault();closeTitlebarContext(true);return}
  const items=[...menu.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')]
  const nextIndex=nextMenuItemIndex(event.key,items.indexOf(document.activeElement as HTMLButtonElement),items.length)
  if(nextIndex===undefined)return
  event.preventDefault();items[nextIndex]?.focus({preventScroll:true})
}
async function syncWindowState(){
  if(!desktop)return
  try{const{getCurrentWindow}=await import('@tauri-apps/api/window');windowMaximized.value=await getCurrentWindow().isMaximized()}
  catch{/* 窗口状态只影响图标，不应中断工作台。 */}
}
function scheduleWindowStateSync(){
  if(windowStateTimer!==undefined)window.clearTimeout(windowStateTimer)
  windowStateTimer=window.setTimeout(()=>{windowStateTimer=undefined;void syncWindowState()},100)
}
async function runWindowAction(action:'open-markdown'|'feature-map'|'minimize'|'toggle-maximize'|'settings'|'close'){
  closeTitlebarContext()
  if(action==='open-markdown'){await chooseMarkdownFiles();return}
  if(action==='feature-map'){openFeatureMap(titlebarContextTrigger);return}
  if(action==='settings'){await router.push('/settings');return}
  try{
    const{getCurrentWindow}=await import('@tauri-apps/api/window'),appWindow=getCurrentWindow()
    if(action==='minimize')await appWindow.minimize()
    else if(action==='toggle-maximize'){await appWindow.toggleMaximize();await syncWindowState()}
    else await appWindow.close()
  }catch(error){ui.toast('窗口操作失败',error instanceof Error?error.message:'桌面窗口暂时没有响应。','error')}
}
function closeVaultNoticeContext(restoreFocus=false){vaultNoticeContext.value=null;if(restoreFocus)vaultNoticeContextTrigger?.focus({preventScroll:true})}
function showVaultNoticeContext(x:number,y:number,trigger:HTMLElement){closeShellMenus();vaultNoticeContextTrigger=trigger;vaultNoticeContext.value=clampMenuPosition(x,y,{menuWidth:246,menuHeight:171,margin:12});void nextTick(()=>vaultNoticeContextElement.value?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus({preventScroll:true}))}
function openVaultNoticeContext(event:MouseEvent){event.preventDefault();event.stopPropagation();showVaultNoticeContext(event.clientX,event.clientY,event.currentTarget as HTMLElement)}
function openVaultNoticeContextFromKeyboard(event:KeyboardEvent){if(!isContextMenuShortcut(event))return;event.preventDefault();event.stopPropagation();const trigger=event.currentTarget as HTMLElement,bounds=trigger.getBoundingClientRect();showVaultNoticeContext(bounds.right-252,bounds.bottom+6,trigger)}
function handleVaultNoticeContextKeydown(event:KeyboardEvent){const menu=vaultNoticeContextElement.value;if(!menu)return;if(event.key==='Escape'){event.preventDefault();closeVaultNoticeContext(true);return}const items=[...menu.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')],nextIndex=nextMenuItemIndex(event.key,items.indexOf(document.activeElement as HTMLButtonElement),items.length);if(nextIndex===undefined)return;event.preventDefault();items[nextIndex]?.focus({preventScroll:true})}
async function retryVaultHydration(){closeVaultNoticeContext();if(vaultErrorFixture.value){vaultErrorFixture.value='';ui.toast('本地资料库已恢复连接','SQLite、Markdown 与轻量索引已经重新接入。','success');return}await store.hydrateVault();if(!store.vaultError)ui.toast('本地资料库已恢复连接','SQLite、Markdown 与轻量索引已经重新接入。','success')}
async function openVaultRecoverySettings(){closeVaultNoticeContext();await router.push({path:'/settings',query:{section:'backup'}})}
async function copyVaultError(){closeVaultNoticeContext();try{await navigator.clipboard.writeText(`Knitspace 本地资料库：${visibleVaultError.value}`);ui.toast('错误详情已复制','可用于排查权限、磁盘空间或数据库问题。','success')}catch(error){ui.toast('复制失败',error instanceof Error?error.message:'系统剪贴板暂时不可用。','error')}}
function closeShellMenus(){navContext.value=null;workspaceContext.value=null;titlebarContext.value=null;historyMenu.value=null;vaultNoticeContext.value=null}
unlisteners.push(router.afterEach(to=>{workspaceHistory.value=recordWorkspaceHistory(workspaceHistory.value,{path:to.fullPath,label:historyLocationLabel(to.fullPath)})}))
function toolForRoute(){return toolCatalog.find(item=>item.to.path===route.path&&Object.entries(item.to.query??{}).every(([key,value])=>String(route.query[key]??'')===value))}
function focusMain(){document.getElementById('main-content')?.focus()}
function recoverRoute(){routeError.value='';router.replace({path:'/',query:{recovered:route.path}})}
function handleDocumentDirty(event:Event){const detail=(event as CustomEvent<{dirty?:boolean;id?:string;title?:string;kindLabel?:string;discardRecovery?:()=>Promise<void>}>).detail;documentDirty.value=Boolean(detail?.dirty);activeDocumentId.value=detail?.id??'';dirtyDocumentTitle.value=detail?.title??'';dirtyWorkKind.value=detail?.kindLabel??'内容';discardDirtyRecovery=detail?.dirty?detail.discardRecovery:undefined}
// Register during setup so child setup/immediate watchers cannot publish the
// active document before the shell starts listening. The native Vault watcher
// must always leave conflict ownership with the visible editor.
window.addEventListener('knitspace:editor-dirty',handleDocumentDirty)
function dispatchVaultMarkdownChange(detail:VaultMarkdownSurfaceChange){window.dispatchEvent(new CustomEvent('knitspace:vault-markdown-change',{detail}))}
function scheduleVaultMarkdownChange(change:VaultMarkdownNativeChange){
  const previous=vaultMarkdownChangeTimers.get(change.documentId);if(previous!==undefined)window.clearTimeout(previous)
  vaultMarkdownChangeTimers.set(change.documentId,window.setTimeout(async()=>{
    vaultMarkdownChangeTimers.delete(change.documentId)
    // The active editor owns its conflict decision even while currently
    // clean; this closes the small race where typing begins during native IO.
    if(activeDocumentId.value===change.documentId){dispatchVaultMarkdownChange({...change,status:'pending'});return}
    try{
      const result=await store.reconcileVaultMarkdown(change.documentId)
      if(result.status==='untracked'||result.status==='unchanged')return
      dispatchVaultMarkdownChange({...change,status:result.status,document:result.document})
      if(result.status==='updated')store.addActivity('source','已同步外部 Markdown 修改',result.document?.title||'Vault 索引、双链与全文搜索已更新')
      else if(result.status==='missing')ui.toast('Vault Markdown 文件已不存在',change.kind==='question'?'题目记录仍保留，可在文档页处理。':'笔记记录仍保留，可在文档页处理。','warning','查看',()=>router.push({path:'/documents',query:{kind:change.kind,document:change.documentId}}))
    }catch(error){ui.toast('无法同步 Vault Markdown',error instanceof Error?error.message:'文件可能不是有效的 UTF-8 Markdown。','error')}
  },320))
}
async function chooseClose(action:'tray'|'quit'){if(!documentDirty.value&&rememberClose.value)store.updateSettings({closeBehavior:action});closePrompt.value=false;if(action==='tray')await hideMainWindow();else{if(documentDirty.value)await discardDirtyRecovery?.();await quitDesktopApp()}}
async function cancelMediaJob(job:Job){const runId=job.kind==='media'&&typeof job.parameters?.runId==='string'?job.parameters.runId:'';if(!runId)return;const transcription=job.parameters?.engine==='whisper-cpp';store.updateJob(job.id,{status:'running',errorCode:'MEDIA_CANCEL_REQUESTED',detail:transcription?'已向本机 Whisper 发送停止请求…':'已向本机 FFmpeg 发送停止请求…'});try{await(transcription?cancelDesktopTranscription(runId):cancelDesktopMediaTranscode(runId));ui.toast(transcription?'正在停止本机转写':'正在停止媒体转换',transcription?'等待清理临时音轨与字幕草稿。':'等待 FFmpeg 清理临时输出。','info')}catch(error){store.updateJob(job.id,{status:'running',errorCode:undefined,detail:'停止请求未送达；任务仍在继续。'});ui.toast(transcription?'无法停止本机转写':'无法停止转换',error instanceof Error?error.message:'媒体任务状态不可用。','error')}}
async function cancelPrivateToolJob(job:Job){if(!personalPackEnabled)return;const runId=job.kind==='script'&&typeof job.parameters?.runId==='string'?job.parameters.runId:'';if(!runId||job.errorCode==='PRIVATE_TOOL_CANCEL_REQUESTED')return;store.updateJob(job.id,{status:'running',errorCode:'PRIVATE_TOOL_CANCEL_REQUESTED',detail:'已向本机脚本发送停止请求…'});try{const { cancelPrivateToolRun }=await import('@/lib/private-tools-native');await cancelPrivateToolRun(runId);ui.toast('正在停止私人工具','等待脚本进程安全退出。','info')}catch(error){store.updateJob(job.id,{status:'running',errorCode:undefined,detail:'停止请求未送达；脚本仍在继续。'});ui.toast('无法停止私人工具',error instanceof Error?error.message:'脚本任务状态不可用。','error')}}
async function autoCheck(){if(!isDesktop()||!store.settings.autoCheckUpdates)return;const last=store.settings.lastUpdateCheck?new Date(store.settings.lastUpdateCheck).getTime():0;if(Date.now()-last<86400000)return;store.updateSettings({lastUpdateCheck:new Date().toISOString()});try{const release=await checkDesktopUpdate();if(release&&release.tag_name.replace(/^v/,'')!==__APP_VERSION__)ui.toast(`发现新版本 ${release.tag_name}`,release.name||'前往设置查看更新说明。','info','查看',()=>router.push({path:'/settings',query:{section:'update'}}))}catch{/* 离线时保持安静 */}}
async function routeMarkdownFiles(paths:string[],sourceLabel:string){
  const supported=normalizeMarkdownOpenPaths(paths)
  if(!supported.length){ui.toast('没有可打开的 Markdown','支持 .md、.mdx、.markdown 和 .mkd。','info');return}
  stageLocalFileHandoff('markdown',supported,sourceLabel)
  desktopOpenRequest+=1
  await router.push({path:'/documents',query:{kind:'note',handoff:'desktop-markdown',request:String(desktopOpenRequest)}})
}
async function chooseMarkdownFiles(){
  if(!desktop){ui.toast('打开本地 Markdown 需要桌面版。',undefined,'info');return}
  if(!applicationHydrated){ui.toast('资料库正在准备','完成后即可打开 Markdown。','info');return}
  try{
    const { open }=await import('@tauri-apps/plugin-dialog')
    const selection=await open({title:'打开 Markdown 文件',multiple:true,filters:[{name:'Markdown',extensions:['md','mdx','markdown','mkd']}]})
    const paths=typeof selection==='string'?[selection]:selection??[]
    if(paths.length)await routeMarkdownFiles(paths,'手动打开')
  }catch(error){ui.toast('无法打开 Markdown 选择器',error instanceof Error?error.message:'系统文件选择器暂时不可用。','error')}
}
async function openDesktopMarkdownFiles(){
  if(!desktop||!applicationHydrated)return
  try{
    const paths=await takeDesktopOpenedMarkdownFiles()
    if(!paths.length)return
    await routeMarkdownFiles(paths,'系统打开')
  }catch(error){ui.toast('无法接收系统打开的 Markdown',error instanceof Error?error.message:'桌面文件入口暂时不可用。','error')}
}
watch(()=>route.fullPath,()=>{routeError.value='';closeCommand();closeShellMenus();expandActiveSpace()})
watch(()=>toolForRoute()?.id,()=>{const tool=toolForRoute();if(tool)store.recordToolUsage(tool.id,router.resolve(tool.to).fullPath)})
watch(commandQuery,query=>{closeCommandContentContext();closeCommandToolContext();scheduleDocumentSearch(query)})
onErrorCaptured((error)=>{routeError.value=error instanceof Error?error.message:'页面初始化失败';return false})
router.onError((error)=>{routeError.value=error instanceof Error?error.message:'页面加载失败'})
const previousStatus=new Map<string,string>();watch(()=>store.jobs.map(j=>({id:j.id,status:j.status,label:j.label,startedAt:j.startedAt})),async jobs=>{for(const job of jobs){const before=previousStatus.get(job.id);if(before&&before!==job.status&&(job.status==='succeeded'||job.status==='failed')&&store.settings.notificationsEnabled){const elapsed=job.startedAt?Date.now()-new Date(job.startedAt).getTime():0;if(job.status==='failed'||elapsed>5000)try{await sendSystemNotification(job.status==='succeeded'?'Knitspace 任务完成':'Knitspace 任务失败',job.label)}catch{/* 通知失败不能影响任务状态和页面。 */}}previousStatus.set(job.id,job.status)}},{deep:true})
onMounted(async()=>{
  window.addEventListener('keydown',handleShortcut)
  if(desktop)try{unlisteners.push(await listenDesktopEvent('knitspace://open-markdown',()=>{void openDesktopMarkdownFiles()}))}
  catch{/* 冷启动路径仍可通过原生命令读取；监听失败不影响手动打开。 */}
  await store.hydrateVault()
  applicationHydrated=true
  if(desktop&&store.vaultReady)try{
    unlisteners.push(await listenDesktopEvent<VaultMarkdownNativeChange>('knitspace://vault-markdown-change',scheduleVaultMarkdownChange))
    await watchDesktopVaultMarkdown()
  }catch(error){ui.toast('Vault 文件监听暂不可用',error instanceof Error?error.message:'仍可在重新打开文档时读取磁盘正文。','warning')}
  workspaceHistory.value=recordWorkspaceHistory(workspaceHistory.value,{path:route.fullPath,label:historyLocationLabel(route.fullPath)})
  await openDesktopMarkdownFiles()
  // Do not compete with Vault hydration or first paint. The native command is
  // streaming and returns immediately when today's archive already exists.
  if (desktop && store.vaultReady) automaticBackupTimer=window.setTimeout(()=>{void createDesktopAutoBackup().then(path=>{if(path){const backedUpAt=new Date().toISOString();store.updateSettings({lastAutomaticBackupAt:backedUpAt});store.addActivity('backup','已创建本地 Vault 归档','保留最近 7 个每日完整备份')}}).catch(error=>{const detail=error instanceof Error?error.message:'请检查磁盘空间和资料库权限。';store.addActivity('system','每日 Vault 归档未完成',detail);ui.toast('每日 Vault 归档未完成',`${detail} 可在“设置 → 数据与备份”中重试。`,'error')})},12000)
  try { await setClipboardMonitor(store.settings.clipboardEnabled,store.settings.clipboardPaused) }
  catch (error) { if(isDesktop())ui.toast('剪贴板监听暂不可用',error instanceof Error?error.message:'桌面服务没有响应。','warning') }
  try { unlisteners.push(await listenDesktopEvent<{kind:'text'|'image';content?:string;assetPath?:string;hash:string}>('toolknit://clipboard',async payload=>{try{await store.addClipboardItem({kind:payload.kind==='text'&&looksLikeCode(payload.content||'')?'code':payload.kind,content:payload.content,assetPath:payload.assetPath,hash:payload.hash});const active=[...store.clipboardItems.map(item=>item.assetPath),...store.sources.map(source=>source.managedPath)].filter(Boolean) as string[];await cleanupClipboardAssets(active)}catch{/* 单次剪贴板记录失败不应终止后台监听。 */}})) }
  catch { /* 单个桌面事件不可用时，其他功能仍应继续初始化。 */ }
  try { unlisteners.push(await listenDesktopEvent('toolknit://tray-clipboard',async()=>{const previous=store.settings.clipboardPaused;const paused=!previous;try{await setClipboardMonitor(store.settings.clipboardEnabled,paused);store.updateSettings({clipboardPaused:paused})}catch{store.updateSettings({clipboardPaused:previous});ui.toast('无法切换监听状态','桌面服务暂时不可用。','error')}})) }
  catch { /* 托盘事件不可用不影响主窗口。 */ }
  try { unlisteners.push(await listenDesktopEvent('toolknit://tray-settings',()=>router.push('/settings'))) }
  catch { /* 托盘设置入口不可用不影响主窗口。 */ }
  if(isDesktop())try{
    const{getCurrentWindow}=await import('@tauri-apps/api/window'),appWindow=getCurrentWindow()
    windowMaximized.value=await appWindow.isMaximized()
    unlisteners.push(await appWindow.onResized(scheduleWindowStateSync))
    unlisteners.push(await appWindow.onCloseRequested(async event=>{event.preventDefault();if(documentDirty.value)closePrompt.value=true;else if(store.settings.closeBehavior==='tray')await hideMainWindow();else if(store.settings.closeBehavior==='quit')await quitDesktopApp();else closePrompt.value=true}))
  }catch(error){ui.toast('窗口行为初始化失败',error instanceof Error?error.message:'桌面服务暂时不可用。','warning')}
  void autoCheck()
})
onBeforeUnmount(()=>{store.persist();window.removeEventListener('keydown',handleShortcut);window.removeEventListener('knitspace:editor-dirty',handleDocumentDirty);if(documentSearchTimer!==undefined)window.clearTimeout(documentSearchTimer);if(automaticBackupTimer!==undefined)window.clearTimeout(automaticBackupTimer);if(windowStateTimer!==undefined)window.clearTimeout(windowStateTimer);vaultMarkdownChangeTimers.forEach(timer=>window.clearTimeout(timer));vaultMarkdownChangeTimers.clear();unlisteners.forEach(fn=>fn())})
</script>
<template>
  <main class="app-shell" :class="[appearanceClasses(store.settings), { 'has-desktop-titlebar': desktop, 'document-focus-mode': ui.documentFocusMode }]" :style="appearanceVariables(store.settings)" @click="closeShellMenus">
    <header v-if="desktop" class="desktop-titlebar" data-tauri-drag-region tabindex="0" aria-label="Knitspace 窗口标题栏；右键打开窗口菜单" @click.stop="closeShellMenus" @contextmenu.prevent.stop="openTitlebarContext" @keydown="openTitlebarContextFromKeyboard">
      <div class="desktop-titlebar__identity" data-tauri-drag-region aria-hidden="true"><span>KS</span><b>Knitspace</b><small :class="`is-${buildProfile.id}`">{{ buildProfile.badge }}</small></div>
      <div class="desktop-titlebar__route" data-tauri-drag-region><span data-tauri-drag-region>{{ title }}</span><small data-tauri-drag-region :class="{ 'is-dirty': documentDirty }">{{ documentDirty ? '● 未保存 · ' : '' }}{{ store.activeVaultName }}</small></div>
      <div class="desktop-window-controls" aria-label="窗口控制">
        <button type="button" aria-label="最小化窗口" title="最小化" @pointerdown.stop @click.stop="runWindowAction('minimize')"><span class="window-glyph window-glyph--minimize" aria-hidden="true"></span></button>
        <button type="button" :aria-label="windowMaximized ? '还原窗口' : '最大化窗口'" :title="windowMaximized ? '还原' : '最大化'" @pointerdown.stop @click.stop="runWindowAction('toggle-maximize')"><span class="window-glyph" :class="windowMaximized ? 'window-glyph--restore' : 'window-glyph--maximize'" aria-hidden="true"></span></button>
        <button type="button" class="desktop-window-controls__close" aria-label="关闭窗口" title="关闭" @pointerdown.stop @click.stop="runWindowAction('close')"><span class="window-glyph window-glyph--close" aria-hidden="true"></span></button>
      </div>
    </header>
    <a class="skip-link" href="#main-content" @click.prevent="focusMain">跳到主要内容</a>
    <AppRail @open-command="openCommand" />

    <section class="workspace" :class="`workspace--${String(route.name || route.path.slice(1) || 'dashboard').replaceAll('/', '-')}`" @contextmenu="openWorkspaceContext">
      <!-- The rail owns identity and search now, so the top bar carries only
           what changes with the route: where you are, and what is running. -->
      <header class="topbar row-between gap-4 shrink-0">
        <div class="row gap-1 min-w-0">
          <button class="btn-ghost btn-icon btn-sm" :disabled="!canNavigateBack" aria-label="后退" title="后退（Alt + ←）；右键查看历史" aria-haspopup="menu" :aria-expanded="historyMenu?.direction === -1" @click.stop="navigateWorkspaceHistory(-1)" @contextmenu.prevent.stop="openHistoryMenu($event, -1)"><AppIcon name="chevron-left" :size="16" /></button>
          <button class="btn-ghost btn-icon btn-sm rotate-180" :disabled="!canNavigateForward" aria-label="前进" title="前进（Alt + →）；右键查看历史" aria-haspopup="menu" :aria-expanded="historyMenu?.direction === 1" @click.stop="navigateWorkspaceHistory(1)" @contextmenu.prevent.stop="openHistoryMenu($event, 1)"><AppIcon name="chevron-left" :size="16" /></button>
          <h1 class="ml-2 truncate">{{ title }}</h1>
        </div>
        <div class="row gap-2 shrink-0">
          <button class="btn-ghost btn-sm" :aria-label="runningJobs.length ? `${runningJobs.length} 个任务` : '本地就绪'" @click="taskPanelOpen = !taskPanelOpen">
            <i class="w-1.5 h-1.5 rounded-full shrink-0" :class="runningJobs.length ? 'bg-accent' : 'bg-success'" aria-hidden="true"></i>
            <span>{{ runningJobs.length ? `${runningJobs.length} 个任务` : '本地就绪' }}</span>
          </button>
          <RouterLink to="/quick" class="btn-primary btn-sm" title="快速捕获（Ctrl+Shift+N）"><AppIcon name="plus" :size="15" /><span>快速处理</span></RouterLink>
        </div>
      </header>
      <div id="main-content" ref="workspaceContentElement" class="workspace-content" tabindex="-1" aria-label="主要工作区；在空白位置右键或按菜单键打开快捷菜单" @keydown="openWorkspaceContextFromKeyboard">
        <section v-if="desktop && !store.vaultReady" class="vault-bootstrap" role="status" aria-live="polite">
          <span class="vault-bootstrap__mark"><AppIcon name="book" :size="22" /></span>
          <p class="eyebrow">本地资料库 · {{ vaultBootstrapIndex + 1 }} / {{ vaultBootstrapStages.length }}</p>
          <h2>{{ vaultBootstrapCopy.label }}</h2>
          <p>{{ vaultBootstrapCopy.detail }}</p>
          <div class="vault-bootstrap__progress" role="progressbar" aria-label="本地资料库初始化进度" :aria-valuemin="1" :aria-valuemax="vaultBootstrapStages.length" :aria-valuenow="vaultBootstrapIndex + 1">
            <i v-for="(stage,index) in vaultBootstrapStages" :key="stage.id" :class="{ active:index <= vaultBootstrapIndex }"></i>
          </div>
          <small>原浏览器副本会保留到 SQLite 完整接管后；中断后可安全续接。</small>
        </section>
        <section v-else-if="routeError" class="route-error panel" role="alert">
          <b><AppIcon name="warning" :size="22" /></b>
          <div><h2>这个页面没有正确打开</h2><p>{{ routeError }}</p></div>
          <button class="primary-button" @click="recoverRoute">返回操作台</button>
        </section>
        <template v-else>
          <section v-if="visibleVaultError" class="vault-notice" role="alert" tabindex="0" aria-haspopup="menu" :aria-expanded="Boolean(vaultNoticeContext)" title="右键或 Shift+F10 查看恢复操作" style="position:sticky;z-index:18;top:10px;display:flex;align-items:center;gap:10px;margin:12px 30px 0;padding:10px 12px;border:1px solid rgba(174,104,45,.28);border-radius:11px;color:#6f4819;background:#fff6e4" @contextmenu="openVaultNoticeContext" @keydown="openVaultNoticeContextFromKeyboard">
            <span style="color:#955f21"><AppIcon name="warning" :size="17" /></span>
            <span style="display:grid;min-width:0"><b>本地数据有一项尚未完成</b><small style="overflow:hidden;color:#805b2d;text-overflow:ellipsis;white-space:nowrap">{{ visibleVaultErrorSentence }} 浏览器恢复副本仍会保留。</small></span>
            <span style="display:flex;gap:6px;margin-left:auto">
              <button class="quiet-button" style="white-space:nowrap" :disabled="store.vaultHydrating" @click.stop="retryVaultHydration"><AppIcon name="refresh" :size="14" />{{ store.vaultHydrating ? '正在重试' : '重试连接' }}</button>
              <button class="quiet-button" style="white-space:nowrap" @click.stop="openVaultRecoverySettings">数据与备份</button>
            </span>
          </section>
          <!-- Today owns the one live focus timer. Keep only this small shell
               alive so navigating to a note or tool never silently stops it. -->
          <RouterView v-slot="{ Component }">
            <KeepAlive include="DashboardView">
              <component :is="Component" />
            </KeepAlive>
          </RouterView>
        </template>
      </div>
    </section>

    <aside v-if="taskPanelOpen" class="task-drawer">
      <header><div><h3>任务中心</h3></div><button aria-label="关闭任务中心" @click="taskPanelOpen = false">×</button></header>
      <div v-if="store.jobs.length">
        <article v-for="job in store.jobs.slice(0, 8)" :key="job.id">
          <span><b>{{ job.label }}</b><small>{{ job.detail || job.inputNames?.join('、') }}</small></span>
          <i :class="job.status">{{ job.status === 'running' ? `${job.progress}%` : job.status === 'succeeded' ? '完成' : job.status === 'failed' ? '失败' : job.status === 'cancelled' ? '已取消' : '等待' }}</i>
          <button v-if="job.status === 'running' && job.kind === 'media' && typeof job.parameters?.runId === 'string'" class="task-cancel" :disabled="job.errorCode === 'MEDIA_CANCEL_REQUESTED'" @click.stop="cancelMediaJob(job)">{{ job.errorCode === 'MEDIA_CANCEL_REQUESTED' ? '停止中…' : '停止' }}</button>
          <button v-else-if="personalPackEnabled && job.status === 'running' && job.kind === 'script' && typeof job.parameters?.runId === 'string'" class="task-cancel" :disabled="job.errorCode === 'PRIVATE_TOOL_CANCEL_REQUESTED'" @click.stop="cancelPrivateToolJob(job)">{{ job.errorCode === 'PRIVATE_TOOL_CANCEL_REQUESTED' ? '停止中…' : '停止' }}</button>
          <progress v-if="job.status === 'running'" max="100" :value="job.progress"></progress>
        </article>
      </div>
      <p v-else>暂无任务。处理进度会集中显示在这里。</p>
      <RouterLink to="/history" @click="taskPanelOpen = false">查看全部历史 →</RouterLink>
    </aside>

    <div v-if="commandOpen" class="modal-backdrop command-backdrop" @click.self="closeCommand(true)">
      <section ref="commandPalette" class="command-palette" :class="{ 'command-palette--browse': commandBrowseOpen && !commandHasQuery }" role="dialog" aria-modal="true" aria-label="搜索工具与浏览全部功能" @click="closeCommandContentContext(); closeCommandToolContext()" @keydown="handleCommandDialogKeydown">
        <form class="command-search" @submit.prevent="openFirstResult">
          <span><AppIcon name="search" :size="21" /></span>
          <input ref="commandInput" v-model="commandQuery" name="tool-search" aria-label="搜索工具与全部本地内容" autocomplete="off" placeholder="搜索工具、笔记、资料或剪贴板…" @keydown.enter.prevent="openFirstResult" @keydown="handleCommandKeydown" />
          <button type="button" @click="closeCommand(true)">Esc</button>
        </form>
        <div class="command-caption" aria-live="polite">
          <span>{{ commandHasQuery ? `找到 ${commandResultCount} 个结果${commandSearchPending ? ' · 正在检索本地内容' : ''}` : commandBrowseOpen ? '全部能力按五个空间归位；右键空间标题可打开完整菜单' : commandSearchPending ? '正在载入最近项目…' : '五个空间、收藏、最近使用与最近画布' }}</span>
          <button type="button" class="command-browse-toggle" :class="{ active: commandBrowseOpen }" :aria-pressed="commandBrowseOpen" @click="toggleCommandBrowse"><AppIcon :name="commandBrowseOpen ? 'search' : 'sort'" :size="13" /><span>{{ commandBrowseOpen ? '返回最近' : '浏览全部功能' }}</span><kbd>Alt A</kbd></button>
        </div>
        <div v-if="commandBrowseOpen && !commandHasQuery" class="command-feature-map" aria-label="五空间功能地图">
          <header><div><p>功能地图</p><strong>不用记名称，也能找到每一项能力</strong></div><small>点击直接打开 · 右键查看空间菜单</small></header>
          <div class="command-feature-map__grid">
            <section v-for="group in commandFeatureGroups" :key="group.space.to" class="command-feature-group">
              <RouterLink :to="group.space.to" class="command-feature-group__heading" data-command-result aria-haspopup="menu" :aria-expanded="navContext?.item.to === group.space.to" :title="`打开${group.space.label}；右键查看该空间全部操作`" @click="closeCommand()" @contextmenu.prevent.stop="openNavContext($event, group.space)" @keydown="handleCommandResultKeydown">
                <b><AppIcon :name="group.space.icon" :size="17" /></b><span><strong>{{ group.space.label }}</strong><small>{{ group.features.length }} 项直接入口</small></span><i>→</i>
              </RouterLink>
              <nav :aria-label="`${group.space.label}功能`">
                <RouterLink v-for="feature in group.features" :key="feature.to" :to="feature.to" data-command-result @click="closeCommand()" @keydown="handleCommandResultKeydown"><AppIcon :name="feature.icon" :size="13" /><span>{{ feature.label }}</span></RouterLink>
              </nav>
            </section>
          </div>
        </div>
        <div v-else-if="commandWorkspaceResults.length || commandResults.length || favoriteContentResults.length || recentContentResults.length || visualProjectResults.length || knowledgeSearchResults.length || sourceSearchResults.length || clipboardSearchResults.length" class="command-results" :aria-busy="commandSearchPending">
          <template v-if="commandWorkspaceResults.length">
            <p class="command-result-label">{{ commandHasQuery ? '空间与操作' : '五个空间' }}</p>
            <div v-if="!commandHasQuery" class="command-space-grid" aria-label="五个主要空间">
              <RouterLink v-for="item in commandWorkspaceResults" :key="item.id" :to="item.to" class="command-space-tile" data-command-result @click="closeCommand()" @keydown="handleCommandResultKeydown">
                <b><AppIcon :name="item.icon" :size="18" /></b>
                <span><strong>{{ item.label }}</strong><small>{{ item.detail.split(' · ')[1]?.split('、').slice(0, 2).join(' · ') }}</small></span>
              </RouterLink>
            </div>
            <template v-else>
              <RouterLink v-for="item in commandWorkspaceResults" :key="item.id" :to="item.to" class="command-result-link" data-command-result @click="closeCommand()" @keydown="handleCommandResultKeydown">
                <b><AppIcon :name="item.icon" :size="18" /></b>
                <span><strong>{{ item.label }}</strong><small>{{ item.detail }}</small></span>
                <i>{{ item.kind === 'space' ? '空间' : '入口' }}</i>
              </RouterLink>
            </template>
          </template>
          <p v-if="favoriteContentResults.length" class="command-result-label">收藏内容</p>
          <RouterLink v-for="item in favoriteContentResults" :key="`favorite:${item.itemKind}:${item.itemId}`" :to="favoriteContentRoute(item)" class="command-result-link command-result-link--content" data-command-result aria-haspopup="menu" :aria-expanded="commandContentContext?.source === 'favorite' && commandContentContext.item.itemKind === item.itemKind && commandContentContext.item.itemId === item.itemId" :title="`打开“${item.title}”；右键或 Shift+F10 查看更多操作`" @click="closeCommand()" @contextmenu="openCommandContentContext($event,item,'favorite')" @keydown="handleCommandContentResultKeydown($event,item,'favorite')">
            <b><AppIcon :name="favoriteContentIcons[item.itemKind]" :size="18" /></b>
            <span><strong>{{ item.title }}</strong><small>{{ item.detail }}</small></span>
            <i>{{ favoriteContentLabels[item.itemKind] }}</i>
          </RouterLink>
          <p v-if="recentContentResults.length" class="command-result-label">最近内容</p>
          <RouterLink v-for="item in recentContentResults" :key="`recent:${item.itemKind}:${item.itemId}`" :to="favoriteContentRoute(item)" class="command-result-link command-result-link--content" data-command-result aria-haspopup="menu" :aria-expanded="commandContentContext?.source === 'recent' && commandContentContext.item.itemKind === item.itemKind && commandContentContext.item.itemId === item.itemId" :title="`打开“${item.title}”；右键或 Shift+F10 查看更多操作`" @click="closeCommand()" @contextmenu="openCommandContentContext($event,item,'recent')" @keydown="handleCommandContentResultKeydown($event,item,'recent')">
            <b><AppIcon :name="favoriteContentIcons[item.itemKind]" :size="18" /></b>
            <span><strong>{{ item.title }}</strong><small>{{ item.detail }}</small></span>
            <i>{{ favoriteContentLabels[item.itemKind] }}</i>
          </RouterLink>
          <template v-for="group in commandToolGroups" :key="group.id">
            <p v-if="!commandHasQuery" class="command-result-label">{{ group.label }}</p>
            <div v-for="item in group.tools" :key="item.id" class="command-result-row command-result-row--tool">
              <RouterLink :to="item.to" class="command-result-link command-result-link--tool" data-command-result aria-haspopup="menu" :aria-expanded="commandToolContext?.item.id === item.id" :title="`打开“${item.title}”；右键或 Shift+F10 查看更多操作`" @click="store.recordToolUsage(item.id, item.to.path); closeCommand()" @contextmenu="openCommandToolContext($event,item)" @keydown="handleCommandToolResultKeydown($event,item)">
                <b><AppIcon :name="item.icon" :size="18" /></b>
                <span><strong>{{ item.title }}</strong><small>{{ item.description }}</small></span>
                <i>{{ item.group }}</i>
              </RouterLink>
              <button class="command-favorite" :class="{ active: store.favorites.some(f => f.toolId === item.id) }" :aria-label="store.favorites.some(f => f.toolId === item.id) ? '取消收藏' : '加入收藏'" @click.stop="store.toggleFavorite(item.id)" @keydown="handleCommandResultKeydown"><AppIcon name="star" :size="14" /></button>
            </div>
          </template>
          <p v-if="visualProjectResults.length" class="command-result-label">画布项目</p>
          <RouterLink v-for="item in visualProjectResults" :key="item.id" :to="visualProjectRoute(item.id)" class="command-result-link" data-command-result @click="closeCommand()" @keydown="handleCommandResultKeydown">
            <b><AppIcon name="palette" :size="18" /></b>
            <span><strong>{{ item.title }}</strong><small>{{ item.imageCount }} 张源图 · {{ item.annotationCount }} 个标注 · 可继续编辑</small></span>
            <i>画布</i>
          </RouterLink>
          <p v-if="knowledgeSearchResults.length" class="command-result-label">知识库</p>
          <RouterLink v-for="item in knowledgeSearchResults" :key="item.id" :to="item.kind === 'word' ? { path: '/words', query: { word: item.id } } : { path: '/documents', query: { kind: item.kind, document: item.id } }" class="command-result-link command-result-link--content" data-command-result aria-haspopup="menu" :aria-expanded="commandContentContext?.source === 'search' && commandContentContext.item.itemKind === item.kind && commandContentContext.item.itemId === item.id" :title="`打开“${item.title}”；右键或 Shift+F10 查看更多操作`" @click="closeCommand()" @contextmenu="openCommandContentContext($event,vaultSearchCommandContent(item),'search')" @keydown="handleCommandContentResultKeydown($event,vaultSearchCommandContent(item),'search')">
            <b><AppIcon :name="item.kind === 'question' ? 'review' : 'book'" :size="18" /></b>
            <span><strong>{{ item.title }}</strong><small>{{ item.snippet || `${item.subject}${item.tags.length ? ` · ${item.tags.join(' · ')}` : ''}` }}</small></span>
            <i>{{ item.kind === 'question' ? '错题' : item.kind === 'word' ? '单词' : '笔记' }}</i>
          </RouterLink>
          <p v-if="sourceSearchResults.length" class="command-result-label">资料库来源</p>
          <RouterLink v-for="item in sourceSearchResults" :key="`source:${item.itemId}`" :to="favoriteContentRoute(item)" class="command-result-link command-result-link--content" data-command-result aria-haspopup="menu" :aria-expanded="commandContentContext?.source === 'search' && commandContentContext.item.itemId === item.itemId" :title="`打开“${item.title}”；右键或 Shift+F10 查看更多操作`" @click="closeCommand()" @contextmenu="openCommandContentContext($event,item,'search')" @keydown="handleCommandContentResultKeydown($event,item,'search')">
            <b><AppIcon name="inbox" :size="18" /></b><span><strong>{{ item.title }}</strong><small>{{ item.detail }}</small></span><i>资料</i>
          </RouterLink>
          <p v-if="clipboardSearchResults.length" class="command-result-label">剪贴板历史</p>
          <RouterLink v-for="item in clipboardSearchResults" :key="`clipboard:${item.id}`" :to="{ path: '/clipboard', query: { item: item.id } }" class="command-result-link" data-command-result :title="`打开这条${item.kind === 'image' ? '图片' : item.kind === 'code' ? '代码' : '文本'}剪贴板记录`" @click="closeCommand()" @keydown="handleCommandResultKeydown">
            <b><AppIcon :name="item.kind === 'code' ? 'code' : item.kind === 'image' ? 'file-image' : 'clipboard'" :size="18" /></b><span><strong>{{ item.title }}</strong><small>{{ item.detail }}</small></span><i>{{ item.pinned ? '常用' : '剪贴板' }}</i>
          </RouterLink>
        </div>
        <div v-else class="command-empty" :aria-busy="commandSearchPending"><b>{{ commandSearchPending ? '正在检索本地内容…' : '没有匹配的内容' }}</b><span>{{ commandSearchPending ? '只读取轻量摘要，不会加载画布源图或 PDF 正文。' : '试试功能名称、笔记正文、资料标签，或剪贴板中的一段原文。' }}</span></div>
        <footer class="command-footer"><span>所有文件工具默认在本地处理</span><small>↑↓ 移动 · Enter 打开 · Esc 返回</small><b v-if="runningJobs.length">{{ runningJobs.length }} 个任务执行中</b></footer>
      </section>
      <section v-if="commandContentContext" ref="commandContentContextElement" class="app-context-menu command-content-context-menu" role="menu" :aria-label="`${commandContentContext.item.title} 内容操作`" :style="{left:`${commandContentContext.x}px`,top:`${commandContentContext.y}px`}" @click.stop @contextmenu.prevent @keydown.stop="handleCommandContentContextKeydown">
        <header><span>{{ commandContentContext.source === 'recent' ? '最近打开' : commandContentContext.source === 'search' ? `${favoriteContentLabels[commandContentContext.item.itemKind]}搜索结果` : '收藏内容' }}</span><b>{{ commandContentContext.item.title }}</b></header>
        <button role="menuitem" @click="runCommandContentAction('open')"><AppIcon :name="favoriteContentIcons[commandContentContext.item.itemKind]" :size="16" /><span>打开内容</span></button>
        <button role="menuitem" @click="runCommandContentAction('favorite')"><AppIcon name="star" :size="16" /><span>{{ store.isContentFavorite(commandContentContext.item.itemKind,commandContentContext.item.itemId) ? '取消收藏' : '加入收藏' }}</span></button>
        <button v-if="commandContentContext.source === 'recent'" role="menuitem" @click="runCommandContentAction('remove-recent')"><AppIcon name="clock" :size="16" /><span>从最近打开移除</span></button>
        <button role="menuitem" @click="runCommandContentAction('copy-reference')"><AppIcon name="link" :size="16" /><span>{{ commandContentContext.item.itemKind === 'note' || commandContentContext.item.itemKind === 'question' ? '复制双链' : '复制名称' }}</span></button>
        <button role="menuitem" @click="runCommandContentAction('browse-kind')"><AppIcon name="book" :size="16" /><span>查看同类内容</span></button>
      </section>
      <section v-if="commandToolContext" ref="commandToolContextElement" class="app-context-menu command-content-context-menu" role="menu" :aria-label="`${commandToolContext.item.title} 工具操作`" :style="{left:`${commandToolContext.x}px`,top:`${commandToolContext.y}px`}" @click.stop @contextmenu.prevent @keydown.stop="handleCommandToolContextKeydown">
        <header><span>{{ commandToolContext.item.group }} · TOOL</span><b>{{ commandToolContext.item.title }}</b></header>
        <button role="menuitem" @click="runCommandToolAction('open')"><AppIcon :name="commandToolContext.item.icon" :size="16" /><span>打开工具</span></button>
        <button role="menuitem" @click="runCommandToolAction('favorite')"><AppIcon name="star" :size="16" /><span>{{ store.favorites.some(item=>item.toolId===commandToolContext?.item.id) ? '取消收藏' : '加入收藏' }}</span></button>
        <button role="menuitem" @click="runCommandToolAction('copy-description')"><AppIcon name="clipboard" :size="16" /><span>复制工具说明</span></button>
        <button role="menuitem" @click="runCommandToolAction('browse-tools')"><AppIcon name="toolbox" :size="16" /><span>在所属空间中查看</span></button>
      </section>
    </div>

    <div v-if="closePrompt" class="modal-backdrop close-backdrop">
      <section class="close-dialog">
        <p class="eyebrow">{{ documentDirty ? '未保存的本地草稿' : '窗口行为' }}</p><h3>{{ documentDirty ? '还有未保存修改' : '关闭 Knitspace？' }}</h3><p>{{ documentDirty ? `“${dirtyDocumentTitle || `当前${dirtyWorkKind}`}”的修改尚未写入本地资料库。隐藏到托盘会安全保留编辑现场；放弃并退出将丢失这些修改。` : '隐藏到托盘后，已开启的剪贴板监听会继续在本机运行。' }}</p>
        <label v-if="!documentDirty"><input v-model="rememberClose" type="checkbox" />记住我的选择，不再询问</label>
        <div><button class="quiet-button" @click="closePrompt = false">{{ documentDirty ? '返回保存' : '取消' }}</button><button class="quiet-button" @click="chooseClose('tray')">隐藏到托盘</button><button class="primary-button danger" @click="chooseClose('quit')">{{ documentDirty ? '放弃并退出' : '彻底退出' }}</button></div>
      </section>
    </div>

    <section v-if="navContext" ref="navContextElement" class="app-context-menu nav-context-menu" :class="{ 'app-context-menu--over-command': commandOpen }" role="menu" :aria-label="`${navContext.item.label} 操作菜单`" :style="{ left: `${navContext.x}px`, top: `${navContext.y}px` }" @click.stop @contextmenu.prevent @keydown.stop="handleNavContextKeydown">
      <header><span>空间操作</span><b>{{ navContext.item.label }}</b></header>
      <button v-for="action in navContext.item.menu" :key="action.label" role="menuitem" @click="runNavAction(action)"><AppIcon :name="action.icon" :size="16" /><span>{{ action.label }}</span></button>
    </section>

    <Teleport to="body">
      <section v-if="titlebarContext" ref="titlebarContextElement" class="app-context-menu titlebar-context-menu" role="menu" aria-label="窗口操作菜单" :style="{ left: `${titlebarContext.x}px`, top: `${titlebarContext.y}px` }" @click.stop @contextmenu.prevent @keydown.stop="handleTitlebarContextKeydown">
        <header><span>窗口</span><b>Knitspace</b></header>
        <button role="menuitem" @click="runWindowAction('open-markdown')"><AppIcon name="file-text" :size="15" /><span>打开 Markdown…</span><kbd>Ctrl O</kbd></button>
        <button role="menuitem" @click="runWindowAction('feature-map')"><AppIcon name="sort" :size="15" /><span>浏览全部功能</span><kbd>Ctrl ⇧ K</kbd></button>
        <button role="menuitem" @click="runWindowAction('minimize')"><span class="titlebar-menu-icon" aria-hidden="true">—</span><span>最小化</span></button>
        <button role="menuitem" @click="runWindowAction('toggle-maximize')"><span class="titlebar-menu-icon" aria-hidden="true">□</span><span>{{ windowMaximized ? '还原窗口' : '最大化' }}</span></button>
        <button role="menuitem" @click="runWindowAction('settings')"><AppIcon name="settings" :size="15" /><span>打开设置</span></button>
        <button class="danger" role="menuitem" @click="runWindowAction('close')"><span class="titlebar-menu-icon" aria-hidden="true">×</span><span>关闭 Knitspace</span></button>
      </section>
      <section v-if="historyMenu" ref="historyMenuElement" class="app-context-menu workspace-history-menu" role="menu" :aria-label="historyMenu.direction === -1 ? '后退历史' : '前进历史'" :style="{ left: `${historyMenu.x}px`, top: `${historyMenu.y}px` }" @click.stop @contextmenu.prevent @keydown.stop="handleHistoryMenuKeydown">
        <header><span>导航</span><b>{{ historyMenu.direction === -1 ? '返回最近位置' : '前往后续位置' }}</b></header>
        <button v-for="entry in historyMenuEntries" :key="`${entry.index}:${entry.path}`" role="menuitem" :title="entry.path" @click="navigateWorkspaceHistoryIndex(entry.index)"><AppIcon :name="entry.path.startsWith('/documents') ? 'file-text' : 'arrow-right'" :size="15" /><span>{{ entry.label }}</span></button>
      </section>
      <section v-if="workspaceContext" ref="workspaceContextElement" class="app-context-menu workspace-context-menu" role="menu" aria-label="工作区快捷菜单" :style="{ left: `${workspaceContext.x}px`, top: `${workspaceContext.y}px` }" @click.stop @contextmenu.prevent @keydown.stop="handleWorkspaceContextKeydown">
        <header><span>{{ activeWorkspace?.label.toLocaleUpperCase('zh-CN') }} · WORKSPACE</span><b>{{ activeWorkspace?.label }}的快捷入口</b><small>{{ workspaceContextFeatures.length + workspaceContextMoreFeatures.length }} 项本空间功能</small></header>
        <p class="workspace-context-menu__section">常用能力</p>
        <button v-for="action in workspaceContextFeatures" :key="action.to" class="workspace-context-menu__feature" role="menuitem" @click="runWorkspaceFeature(action)"><AppIcon :name="action.icon" :size="15" /><span>{{ action.label }}</span><AppIcon name="arrow-right" :size="12" /></button>
        <button v-if="workspaceContextMoreFeatures.length" class="workspace-context-menu__more-toggle" role="menuitem" :aria-expanded="workspaceContextMoreOpen" @click="toggleWorkspaceContextMore"><AppIcon name="sort" :size="15" /><span><b>{{ workspaceContextMoreOpen ? '收起更多功能' : `展开更多 ${workspaceContextMoreFeatures.length} 项` }}</b><small>{{ workspaceContextMoreOpen ? 'Esc 先收起列表' : '仍在当前空间，不打开新面板' }}</small></span><span class="workspace-context-menu__more-chevron" aria-hidden="true">{{ workspaceContextMoreOpen ? '−' : '+' }}</span></button>
        <template v-if="workspaceContextMoreOpen"><p class="workspace-context-menu__section">更多功能</p><button v-for="action in workspaceContextMoreFeatures" :key="`more:${action.to}`" class="workspace-context-menu__feature workspace-context-menu__feature--more" role="menuitem" @click="runWorkspaceFeature(action)"><AppIcon :name="action.icon" :size="15" /><span>{{ action.label }}</span><AppIcon name="arrow-right" :size="12" /></button></template>
        <p class="workspace-context-menu__section">全局入口</p>
        <button role="menuitem" @click="runWorkspaceAction('open-markdown')"><AppIcon name="file-text" :size="16" /><span><b>打开本地 Markdown</b><small>Ctrl+O · 关联并监听磁盘文件</small></span></button>
        <button role="menuitem" @click="runWorkspaceAction('clipboard')"><AppIcon name="clipboard" :size="16" /><span><b>收集当前剪贴板</b><small>文本、代码或图片仅保存在本机</small></span></button>
        <button role="menuitem" @click="runWorkspaceAction('browse')"><AppIcon name="sort" :size="16" /><span><b>浏览全部功能</b><small>按五个空间查看，不需要记住名称</small></span></button>
        <button role="menuitem" @click="runWorkspaceAction('command')"><AppIcon name="search" :size="16" /><span><b>搜索工具或资料</b><small>也可按 Ctrl / ⌘ K</small></span></button>
      </section>
      <section v-if="vaultNoticeContext" ref="vaultNoticeContextElement" class="app-context-menu vault-notice-context-menu" role="menu" aria-label="本地资料库恢复操作" :style="{ left: `${vaultNoticeContext.x}px`, top: `${vaultNoticeContext.y}px` }" @click.stop @contextmenu.prevent @keydown.stop="handleVaultNoticeContextKeydown">
        <header><span>本地资料库</span><b>恢复与诊断</b></header>
        <button role="menuitem" :disabled="store.vaultHydrating" @click="retryVaultHydration"><AppIcon name="refresh" :size="15" /><span>重试连接</span></button>
        <button role="menuitem" @click="openVaultRecoverySettings"><AppIcon name="shield" :size="15" /><span>打开数据与备份</span></button>
        <button role="menuitem" @click="copyVaultError"><AppIcon name="duplicate" :size="15" /><span>复制错误详情</span></button>
      </section>
    </Teleport>

    <AppToastHost />
    <AppConfirmDialog />
  </main>
</template>

<style scoped>
.task-drawer .task-cancel{flex:0 0 auto;min-height:25px;padding:0 8px;border:1px solid var(--danger-soft);border-radius:6px;background:var(--danger-soft);color:var(--danger);font:700 9px var(--font-ui);cursor:pointer;transition:border-color var(--duration-fast) var(--ease-out),background var(--duration-fast) var(--ease-out)}
.task-drawer .task-cancel:hover,.task-drawer .task-cancel:focus-visible{border-color:var(--danger);background:var(--danger-soft)}
.task-drawer .task-cancel:focus-visible{outline:2px solid var(--danger-soft);outline-offset:2px}
.task-drawer .task-cancel:disabled{cursor:wait;opacity:.68}
</style>
