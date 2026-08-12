<script setup lang="ts">
import AppIcon from '@/components/AppIcon.vue'
import { formatCrashDraftTime } from '@/lib/editor-crash-draft'

defineProps<{ savedAt: string; itemKind: string; busy?: boolean }>()
defineEmits<{ restore: []; discard: [] }>()
</script>

<template>
  <section class="editor-recovery-banner" role="status" aria-live="polite">
    <span class="editor-recovery-banner__icon" aria-hidden="true"><AppIcon name="clock" :size="15" /></span>
    <div>
      <b>找到 {{ formatCrashDraftTime(savedAt) }} 的未完成{{ itemKind }}</b>
      <small>这是异常退出前留下的恢复点；先恢复为未保存修改，再决定是否正式保存。</small>
    </div>
    <div class="editor-recovery-banner__actions">
      <button class="quiet-button" type="button" :disabled="busy" @click="$emit('discard')">放弃恢复点</button>
      <button class="primary-button" type="button" :disabled="busy" @click="$emit('restore')">{{ busy ? '正在恢复…' : '恢复草稿' }}</button>
    </div>
  </section>
</template>
