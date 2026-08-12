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
    <div class="document-unsaved-backdrop" @keydown.esc.prevent="emit('decision', 'stay')">
      <section class="document-unsaved-dialog" role="alertdialog" aria-modal="true" aria-labelledby="unsaved-changes-title" aria-describedby="unsaved-changes-description">
        <span class="document-unsaved-dialog__mark" aria-hidden="true"><AppIcon name="file-text" :size="20" /></span>
        <div>
          <p class="eyebrow">本地草稿</p>
          <h3 id="unsaved-changes-title">保留当前修改？</h3>
          <p id="unsaved-changes-description">“{{ itemLabel }}”还有未保存修改。{{ targetLabel }}前，请选择如何处理这份本地{{ itemKind || '内容' }}草稿。</p>
        </div>
        <footer>
          <button ref="stayButton" class="quiet-button" @click="emit('decision', 'stay')">继续编辑</button>
          <button class="quiet-button document-unsaved-dialog__discard" @click="emit('decision', 'discard')">放弃修改</button>
          <button class="primary-button" @click="emit('decision', 'save')">保存并继续</button>
        </footer>
      </section>
    </div>
  </Teleport>
</template>
