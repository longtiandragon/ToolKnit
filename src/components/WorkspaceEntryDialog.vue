<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import AppIcon from '@/components/AppIcon.vue'

type WorkspaceEntryMode = 'create-markdown' | 'create-directory' | 'rename-markdown' | 'rename-directory'

const props = withDefaults(defineProps<{
  mode: WorkspaceEntryMode
  initialName?: string
  parentLabel?: string
  busy?: boolean
  serverError?: string
}>(), { initialName: '', parentLabel: '工作区根目录', busy: false, serverError: '' })
const emit = defineEmits<{
  (event: 'cancel'): void
  (event: 'submit', name: string): void
  (event: 'change'): void
}>()

const inputElement = ref<HTMLInputElement>()
const dialogElement = ref<HTMLFormElement>()
const name = ref('')
const touched = ref(false)
const isMarkdown = computed(() => props.mode.endsWith('markdown'))
const isRename = computed(() => props.mode.startsWith('rename'))
const title = computed(() => isRename.value ? `重命名${isMarkdown.value ? ' Markdown' : '资料夹'}` : `新建${isMarkdown.value ? ' Markdown' : '资料夹'}`)
const description = computed(() => isRename.value
  ? '只更改当前项目的名称，不移动它所在的资料夹。'
  : `将创建在“${props.parentLabel || '工作区根目录'}”中。`)
const validationError = computed(() => {
  const value = name.value.trim()
  if (!value) return '请输入名称。'
  if (value === '.' || value === '..' || value.startsWith('.') || /[\0/\\<>:"|?*]/.test(value) || /[. ]$/.test(value)) return '名称不能包含路径、隐藏前缀或 Windows 不支持的字符。'
  const stem = value.split('.')[0]?.toUpperCase() ?? ''
  if (/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/.test(stem)) return '这是 Windows 保留名称，请换一个名称。'
  if (isMarkdown.value && value.includes('.') && !/\.(md|mdx|markdown|mkd)$/i.test(value)) return '请使用 .md、.mdx、.markdown 或 .mkd 扩展名。'
  return ''
})
const visibleError = computed(() => props.serverError || (touched.value ? validationError.value : ''))

function submit() {
  touched.value = true
  if (validationError.value || props.busy) return
  emit('submit', name.value.trim())
}

function cancel() {
  if (!props.busy) emit('cancel')
}

function handleInput() {
  touched.value = true
  emit('change')
}

function handleKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') { event.preventDefault(); cancel() }
  if (event.key !== 'Tab') return
  const controls = [...(dialogElement.value?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled)') ?? [])]
  if (!controls.length) return
  const current = controls.indexOf(document.activeElement as HTMLElement)
  if (event.shiftKey && current <= 0) { event.preventDefault(); controls.at(-1)?.focus() }
  else if (!event.shiftKey && current === controls.length - 1) { event.preventDefault(); controls[0]?.focus() }
}

watch(() => [props.mode, props.initialName] as const, ([mode, initialName]) => {
  name.value = initialName
  touched.value = false
  void nextTick(() => {
    const input = inputElement.value
    if (!input) return
    input.focus()
    const extensionIndex = mode === 'rename-markdown' ? initialName.lastIndexOf('.') : -1
    input.setSelectionRange(0, extensionIndex > 0 ? extensionIndex : initialName.length)
  })
}, { immediate: true })
</script>

<template>
  <Teleport to="body">
    <div class="fixed inset-0 z-150 center px-4 bg-[var(--scrim)] backdrop-blur-[3px]" @click.self="cancel" @keydown="handleKeydown">
      <form ref="dialogElement" class="stack gap-2.5 w-full max-w-112 p-5 panel shadow-lg" role="dialog" aria-modal="true" :aria-labelledby="`workspace-entry-title-${mode}`" @submit.prevent="submit">
        <header class="row-between gap-3">
          <span class="center w-9 h-9 shrink-0 rounded-sm bg-accent-soft text-accent"><AppIcon :name="isRename ? 'rename' : isMarkdown ? 'file-text' : 'folder'" :size="18" /></span>
          <div class="stack gap-0.5 min-w-0 flex-1">
            <p class="text-[11px] font-semibold text-fg-3">{{ isRename ? 'WORKSPACE RENAME' : 'WORKSPACE CREATE' }}</p>
            <h3 :id="`workspace-entry-title-${mode}`" class="text-[15px] font-semibold text-fg">{{ title }}</h3>
          </div>
          <button type="button" class="btn-ghost btn-icon w-8 h-8 shrink-0" aria-label="关闭" :disabled="busy" @click="cancel"><AppIcon name="close" :size="16" /></button>
        </header>
        <p class="text-[12px] leading-relaxed text-fg-2">{{ description }}</p>
        <label class="stack gap-1.5">
          <span class="text-[12px] font-medium text-fg-2">名称</span>
          <input ref="inputElement" v-model="name" class="field w-full" :placeholder="isMarkdown ? '例如：二分查找.md' : '例如：算法'" :aria-invalid="Boolean(visibleError)" aria-describedby="workspace-entry-error" @blur="touched = true" @input="handleInput" />
        </label>
        <!-- The hint line never leaves: it holds its row whether it is telling
             you the extension will be filled in or that the name is invalid,
             so the buttons do not jump when validation turns on. -->
        <p id="workspace-entry-error" class="min-h-4 text-[11px] leading-snug" :class="visibleError ? 'text-danger' : 'text-fg-3'" role="status" aria-live="polite">{{ visibleError || (isMarkdown ? '未填写扩展名时会自动补全 .md' : '名称只作用于当前工作区。') }}</p>
        <footer class="row justify-end gap-2 mt-1">
          <button type="button" class="btn-default" :disabled="busy" @click="cancel">取消</button>
          <button type="submit" class="btn-primary" :disabled="busy || Boolean(validationError)">{{ busy ? '正在处理…' : isRename ? '确认重命名' : '立即创建' }}</button>
        </footer>
      </form>
    </div>
  </Teleport>
</template>
