<script setup lang="ts">
import { nextTick, onMounted, ref } from 'vue'
import AppIcon from '@/components/AppIcon.vue'
import type { UnsavedDocumentDecision } from '@/lib/document-transition'

defineProps<{
  itemLabel: string
  targetLabel: string
  itemKind?: string
}>()

const emit = defineEmits<{ decision: [value: UnsavedDocumentDecision] }>()
const stayButton = ref<HTMLButtonElement>()

onMounted(() => { void nextTick(() => stayButton.value?.focus({ preventScroll: true })) })
</script>

<template>
  <Teleport to="body">
    <div class="fixed inset-0 z-150 center px-4 bg-[var(--scrim)] backdrop-blur-[3px]" @keydown.esc.prevent="emit('decision', 'stay')">
      <section class="stack gap-2.5 w-full max-w-112 p-5 panel shadow-lg" role="alertdialog" aria-modal="true" aria-labelledby="unsaved-changes-title" aria-describedby="unsaved-changes-description">
        <span class="center w-9 h-9 rounded-sm bg-warn-soft text-warn" aria-hidden="true"><AppIcon name="file-text" :size="20" /></span>
        <div class="stack gap-1.5">
          <p class="text-[11px] font-semibold text-fg-3">本地草稿</p>
          <h3 id="unsaved-changes-title" class="text-[16px] font-semibold text-fg">保留当前修改？</h3>
          <p id="unsaved-changes-description" class="text-[12px] leading-relaxed text-fg-2">“{{ itemLabel }}”还有未保存修改。{{ targetLabel }}前，请选择如何处理这份本地{{ itemKind || '内容' }}草稿。</p>
        </div>
        <footer class="row justify-end gap-2 mt-1">
          <button ref="stayButton" class="btn-default" @click="emit('decision', 'stay')">继续编辑</button>
          <button class="btn-danger" @click="emit('decision', 'discard')">放弃修改</button>
          <button class="btn-primary" @click="emit('decision', 'save')">保存并继续</button>
        </footer>
      </section>
    </div>
  </Teleport>
</template>
