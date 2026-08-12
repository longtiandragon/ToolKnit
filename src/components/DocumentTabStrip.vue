<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref } from 'vue'
import AppIcon from '@/components/AppIcon.vue'
import { clampMenuPosition, isContextMenuShortcut, nextMenuItemIndex } from '@/lib/desktop-menu'
import type { DocumentWorkspaceTab } from '@/lib/document-workspace-tabs'
import type { StudyDocument } from '@/types'

const props = defineProps<{ tabs: DocumentWorkspaceTab[]; documents: StudyDocument[]; activeId: string; activeTitle?: string; dirtyId?: string }>()
const emit = defineEmits<{
  activate: [id: string]
  close: [id: string]
  closeOthers: [id: string]
  closeRight: [id: string]
  togglePin: [id: string]
  copyLink: [id: string]
}>()

const menu = ref<{ tab: DocumentWorkspaceTab; document: StudyDocument; x: number; y: number }>()
const menuElement = ref<HTMLElement>()
let menuTrigger: HTMLElement | undefined
const visibleTabs = computed(() => props.tabs.flatMap((tab) => {
  const document = props.documents.find((item) => item.id === tab.id)
  return document ? [{ tab, document }] : []
}))
function displayTitle(item: { tab: DocumentWorkspaceTab; document: StudyDocument }) {
  return item.tab.id === props.activeId && props.activeTitle?.trim() ? props.activeTitle.trim() : item.document.title
}

function closeMenu(restoreFocus = false) {
  menu.value = undefined
  if (restoreFocus) menuTrigger?.focus({ preventScroll: true })
}
function showMenu(tab: DocumentWorkspaceTab, document: StudyDocument, x: number, y: number, trigger: HTMLElement) {
  menuTrigger = trigger
  menu.value = { tab, document, ...clampMenuPosition(x, y, { menuWidth: 224, menuHeight: 274, margin: 10 }) }
  void nextTick(() => menuElement.value?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus())
}
function openMenu(event: MouseEvent, tab: DocumentWorkspaceTab, document: StudyDocument) {
  event.preventDefault()
  event.stopPropagation()
  showMenu(tab, document, event.clientX, event.clientY, event.currentTarget as HTMLElement)
}
function openMenuFromKeyboard(event: KeyboardEvent, tab: DocumentWorkspaceTab, document: StudyDocument) {
  if (!isContextMenuShortcut(event)) return
  event.preventDefault()
  event.stopPropagation()
  const trigger = event.currentTarget as HTMLElement
  const bounds = trigger.getBoundingClientRect()
  showMenu(tab, document, bounds.left + 18, bounds.bottom + 4, trigger)
}
function handleMenuKeydown(event: KeyboardEvent) {
  const element = menuElement.value
  if (!element) return
  if (event.key === 'Escape') { event.preventDefault(); closeMenu(true); return }
  const items = [...element.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')]
  const index = nextMenuItemIndex(event.key, items.indexOf(document.activeElement as HTMLButtonElement), items.length)
  if (index === undefined) return
  event.preventDefault()
  items[index]?.focus()
}
function run(action: 'close' | 'closeOthers' | 'closeRight' | 'togglePin' | 'copyLink') {
  const id = menu.value?.tab.id
  if (!id) return
  closeMenu()
  if (action === 'close') emit('close', id)
  else if (action === 'closeOthers') emit('closeOthers', id)
  else if (action === 'closeRight') emit('closeRight', id)
  else if (action === 'togglePin') emit('togglePin', id)
  else emit('copyLink', id)
}
function handleTabKeydown(event: KeyboardEvent, id: string) {
  if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
  const items = [...(event.currentTarget as HTMLElement).parentElement?.parentElement?.querySelectorAll<HTMLElement>('[role="tab"]') ?? []]
  const current = items.indexOf(event.currentTarget as HTMLElement)
  if (current < 0 || !items.length) return
  event.preventDefault()
  const next = items[(current + (event.key === 'ArrowRight' ? 1 : -1) + items.length) % items.length]
  next?.focus({ preventScroll: true })
  const nextId = next?.dataset.documentId
  if (nextId && nextId !== id) emit('activate', nextId)
}
function closeFromButton(event: MouseEvent, id: string) {
  event.stopPropagation()
  emit('close', id)
}
function closeOnMiddle(event: MouseEvent, id: string) {
  if (event.button !== 1) return
  event.preventDefault()
  emit('close', id)
}
function closeAllMenus() { closeMenu() }
window.addEventListener('knitspace:close-context-menus', closeAllMenus)
onBeforeUnmount(() => window.removeEventListener('knitspace:close-context-menus', closeAllMenus))
</script>

<template>
  <div class="document-tab-strip" role="tablist" aria-label="已打开文档" @click="closeMenu()">
    <div v-for="item in visibleTabs" :key="item.tab.id" class="document-workspace-tab" :class="{ active: item.tab.id === activeId, pinned: item.tab.pinned, dirty: item.tab.id === dirtyId }" @contextmenu="openMenu($event, item.tab, item.document)" @keydown="openMenuFromKeyboard($event, item.tab, item.document)">
      <button role="tab" :data-document-id="item.tab.id" :aria-selected="item.tab.id === activeId" :tabindex="item.tab.id === activeId ? 0 : -1" :title="`${displayTitle(item)} · ${item.document.kind === 'question' ? '错题' : '笔记'}${item.tab.pinned ? ' · 已固定' : ''}`" @click.stop="emit('activate', item.tab.id)" @keydown="handleTabKeydown($event, item.tab.id)" @mousedown.middle="closeOnMiddle($event, item.tab.id)">
        <AppIcon v-if="item.tab.pinned" name="star" :size="10" />
        <i v-else aria-hidden="true"></i>
        <span>{{ displayTitle(item) }}</span>
        <small v-if="item.tab.id === dirtyId">未保存</small>
      </button>
      <button class="document-workspace-tab__close" :aria-label="`关闭“${displayTitle(item)}”`" title="关闭标签（中键也可关闭）" @click="closeFromButton($event, item.tab.id)"><AppIcon name="close" :size="12" /></button>
    </div>
  </div>
  <Teleport to="body">
    <section v-if="menu" ref="menuElement" class="document-tab-context-menu" role="menu" :style="{ left: `${menu.x}px`, top: `${menu.y}px` }" @click.stop @contextmenu.prevent @keydown.stop="handleMenuKeydown">
      <p>{{ menu.document.title }}<small>{{ menu.document.kind === 'question' ? '错题' : '笔记' }}</small></p>
      <button role="menuitem" @click="run('togglePin')">{{ menu.tab.pinned ? '取消固定标签' : '固定标签' }}</button>
      <button role="menuitem" @click="run('copyLink')">复制文档双链</button>
      <button class="separator" role="menuitem" @click="run('close')">关闭标签 <kbd>Ctrl+W</kbd></button>
      <button role="menuitem" @click="run('closeOthers')">关闭其他标签</button>
      <button role="menuitem" @click="run('closeRight')">关闭右侧标签</button>
    </section>
  </Teleport>
</template>
