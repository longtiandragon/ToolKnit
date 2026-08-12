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
    <div class="workspace-entry-dialog-backdrop" @click.self="cancel" @keydown="handleKeydown">
      <form ref="dialogElement" class="workspace-entry-dialog" role="dialog" aria-modal="true" :aria-labelledby="`workspace-entry-title-${mode}`" @submit.prevent="submit">
        <header>
          <span><AppIcon :name="isRename ? 'rename' : isMarkdown ? 'file-text' : 'folder'" :size="18" /></span>
          <div><p>{{ isRename ? 'WORKSPACE RENAME' : 'WORKSPACE CREATE' }}</p><h3 :id="`workspace-entry-title-${mode}`">{{ title }}</h3></div>
          <button type="button" aria-label="关闭" :disabled="busy" @click="cancel"><AppIcon name="close" :size="16" /></button>
        </header>
        <p class="workspace-entry-dialog__description">{{ description }}</p>
        <label>
          <span>名称</span>
          <input ref="inputElement" v-model="name" :placeholder="isMarkdown ? '例如：二分查找.md' : '例如：算法'" :aria-invalid="Boolean(visibleError)" aria-describedby="workspace-entry-error" @blur="touched = true" @input="handleInput" />
        </label>
        <p id="workspace-entry-error" class="workspace-entry-dialog__error" :class="{ visible: visibleError }" role="status" aria-live="polite">{{ visibleError || (isMarkdown ? '未填写扩展名时会自动补全 .md' : '名称只作用于当前工作区。') }}</p>
        <footer><button type="button" class="quiet-button" :disabled="busy" @click="cancel">取消</button><button type="submit" class="primary-button" :disabled="busy || Boolean(validationError)">{{ busy ? '正在处理…' : isRename ? '确认重命名' : '立即创建' }}</button></footer>
      </form>
    </div>
  </Teleport>
</template>
