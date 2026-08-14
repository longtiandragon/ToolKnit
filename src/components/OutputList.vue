<script setup lang="ts">
/**
 * The files a job just produced.
 *
 * This used to live at the bottom of the tool page, below the drop zone, the
 * parameter panel and the execution bar — which meant finishing a job put its
 * result off screen. It is a component now so it can sit where the work is,
 * and so every tool that writes files reports the same way.
 *
 * The desktop actions (reveal, save-as, copy path) only exist when the output
 * has a real path. In the browser build the file has already gone to the
 * download folder and there is nothing left to point at.
 */
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { RouterLink } from 'vue-router'
import type { FileReference } from '@/types'
import { revealDesktopFile, saveOutputAs } from '@/lib/native'
import { clampMenuPosition, isContextMenuShortcut, nextMenuItemIndex } from '@/lib/desktop-menu'
import { useUiStore } from '@/stores/ui'
import AppIcon from '@/components/AppIcon.vue'

const props = withDefaults(
  defineProps<{
    outputs: FileReference[]
    /** How many rows before the rest is summarised as a count. */
    limit?: number
    title?: string
  }>(),
  { limit: 12, title: '本次生成' },
)

const emit = defineEmits<{ remove: [output: FileReference] }>()

const ui = useUiStore()
const menu = ref<{ output: FileReference; x: number; y: number }>()
const menuElement = ref<HTMLElement>()
let menuTrigger: HTMLElement | undefined

function formatSize(value?: number) {
  if (value === undefined) return '大小由系统管理'
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  return `${(value / (1024 * 1024)).toFixed(1)} MB`
}

function close(restoreFocus = false) {
  menu.value = undefined
  if (restoreFocus) void nextTick(() => menuTrigger?.focus({ preventScroll: true }))
}

function open(output: FileReference, x: number, y: number, trigger: HTMLElement) {
  menuTrigger = trigger
  menu.value = {
    output,
    ...clampMenuPosition(x, y, { menuWidth: 224, menuHeight: output.path ? 192 : 120, margin: 12 }),
  }
  void nextTick(() => menuElement.value?.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')?.focus())
}

function openFromPointer(event: MouseEvent, output: FileReference) {
  open(output, event.clientX, event.clientY, event.currentTarget as HTMLElement)
}

function openFromKeyboard(event: KeyboardEvent, output: FileReference) {
  if (!isContextMenuShortcut(event)) return
  event.preventDefault()
  const trigger = event.currentTarget as HTMLElement
  const bounds = trigger.getBoundingClientRect()
  open(output, bounds.right - 16, bounds.top + 20, trigger)
}

function onMenuKeydown(event: KeyboardEvent) {
  const items = [...(menuElement.value?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? [])]
  if (event.key === 'Escape') {
    event.preventDefault()
    close(true)
    return
  }
  const next = nextMenuItemIndex(event.key, items.indexOf(document.activeElement as HTMLButtonElement), items.length)
  if (next === undefined) return
  event.preventDefault()
  items[next]?.focus()
}

async function reveal(output: FileReference) {
  if (!output.path) return
  try {
    await revealDesktopFile(output.path)
  } catch (error) {
    ui.toast('无法打开输出位置', error instanceof Error ? error.message : '输出文件可能已移动。', 'error')
  }
}

async function saveAs(output: FileReference) {
  if (!output.path) return
  try {
    const saved = await saveOutputAs(output.path, output.name)
    if (saved) ui.toast('已另存输出', saved, 'success')
  } catch (error) {
    ui.toast('另存失败', error instanceof Error ? error.message : '无法复制当前输出。', 'error')
  }
}

async function copyPath(output: FileReference) {
  if (!output.path) return
  try {
    await navigator.clipboard.writeText(output.path)
    ui.toast('输出路径已复制', output.path, 'success')
  } catch (error) {
    ui.toast('复制路径失败', error instanceof Error ? error.message : '系统剪贴板暂时不可用。', 'error')
  }
}

// Each of these closes the menu first so the action never runs against a
// stale reference if the list changes underneath it.
async function runReveal() { const output = menu.value?.output; close(); if (output) await reveal(output) }
async function runSaveAs() { const output = menu.value?.output; close(); if (output) await saveAs(output) }
async function runCopyPath() { const output = menu.value?.output; close(); if (output) await copyPath(output) }
function runRemove() { const output = menu.value?.output; close(true); if (output) emit('remove', output) }

function closeOnOutsideClick() { close() }
onMounted(() => window.addEventListener('click', closeOnOutsideClick))
onBeforeUnmount(() => window.removeEventListener('click', closeOnOutsideClick))
</script>

<template>
  <section class="panel overflow-hidden" aria-label="本次处理结果">
    <header class="row-between gap-3 px-4 h-12 border-b border-line">
      <div class="row gap-2 min-w-0">
        <span class="center w-5 h-5 rounded-full bg-success-soft text-success shrink-0">
          <AppIcon name="check" :size="13" />
        </span>
        <strong class="text-[14px] font-semibold text-fg">{{ title }}</strong>
        <span class="text-[12px] text-fg-3">{{ props.outputs.length }} 个输出</span>
      </div>
      <RouterLink class="btn-ghost btn-sm shrink-0" to="/history">处理历史</RouterLink>
    </header>

    <ul class="stack p-1.5 gap-0.5">
      <li v-for="output in props.outputs.slice(0, props.limit)" :key="`${output.path ?? output.name}:${output.size ?? 0}`">
        <button
          v-memo="[output.name, output.path, output.size]"
          class="group w-full row gap-2.5 px-2 py-2 rounded-sm text-left hover:bg-surface-2"
          :title="output.path ? '打开所在位置；右键查看更多操作' : '浏览器下载已开始；右键可移除此记录'"
          :aria-label="`${output.name}，${formatSize(output.size)}；右键或 Shift 加 F10 打开操作`"
          aria-haspopup="menu"
          :aria-expanded="menu?.output === output"
          @click="reveal(output)"
          @contextmenu.prevent.stop="openFromPointer($event, output)"
          @keydown="openFromKeyboard($event, output)"
        >
          <span class="center w-8 h-8 rounded-sm bg-surface-2 text-fg-3 shrink-0">
            <AppIcon name="file-text" :size="16" />
          </span>
          <span class="stack min-w-0 flex-1 leading-tight">
            <strong class="text-[13px] font-normal text-fg truncate">{{ output.name }}</strong>
            <small class="text-[11px] text-fg-3 tabular-nums">{{ formatSize(output.size) }}</small>
          </span>
          <span class="text-[12px] text-fg-3 shrink-0 opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100">
            {{ output.path ? '打开位置' : '已下载' }}
          </span>
        </button>
      </li>
    </ul>

    <p v-if="props.outputs.length > props.limit" class="px-4 py-2.5 border-t border-line text-[12px] text-fg-3">
      另外 {{ props.outputs.length - props.limit }} 个输出已记录在处理历史中。
    </p>

    <Teleport to="body">
      <div
        v-if="menu"
        ref="menuElement"
        class="fixed z-[120] w-56 p-1 rounded-md bg-surface border border-line-strong shadow-lg"
        role="menu"
        :aria-label="`${menu.output.name} 操作`"
        :style="{ left: `${menu.x}px`, top: `${menu.y}px` }"
        @click.stop
        @contextmenu.prevent
        @keydown.stop="onMenuKeydown"
      >
        <p class="px-2.5 py-1.5 text-[11px] text-fg-3 truncate">{{ menu.output.name }}</p>
        <button v-if="menu.output.path" class="nav-item w-full" role="menuitem" @click="runReveal">打开文件位置</button>
        <button v-if="menu.output.path" class="nav-item w-full" role="menuitem" @click="runSaveAs">另存为…</button>
        <button v-if="menu.output.path" class="nav-item w-full" role="menuitem" @click="runCopyPath">复制输出路径</button>
        <button class="nav-item w-full hover:bg-danger-soft hover:text-danger" role="menuitem" @click="runRemove">
          从本次结果移除
        </button>
      </div>
    </Teleport>
  </section>
</template>
