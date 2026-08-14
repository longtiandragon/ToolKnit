<script setup lang="ts">
import AppIcon from '@/components/AppIcon.vue'
import { formatCrashDraftTime } from '@/lib/editor-crash-draft'

defineProps<{ savedAt: string; itemKind: string; busy?: boolean }>()
defineEmits<{ restore: []; discard: [] }>()
</script>

<!--
  A full-width strip between the toolbar and the editor body, shaped like the
  managed-vault alert that can appear two rows below it. The old banner floated
  inside its own margins with a shadow, which made two adjacent warnings about
  the same document look like two unrelated systems talking.
-->
<template>
  <section class="row gap-2.5 shrink-0 px-3 py-2 bg-warn-soft border-b border-line" role="status" aria-live="polite">
    <span class="center w-7 h-7 shrink-0 rounded-sm bg-surface text-warn" aria-hidden="true"><AppIcon name="clock" :size="15" /></span>
    <div class="stack gap-0.5 min-w-0 flex-1">
      <b class="text-[12px] font-medium text-fg">找到 {{ formatCrashDraftTime(savedAt) }} 的未完成{{ itemKind }}</b>
      <small class="text-[11px] leading-relaxed text-fg-2">这是异常退出前留下的恢复点；先恢复为未保存修改，再决定是否正式保存。</small>
    </div>
    <div class="row gap-2 shrink-0">
      <button class="btn-default btn-sm" type="button" :disabled="busy" @click="$emit('discard')">放弃恢复点</button>
      <button class="btn-primary btn-sm" type="button" :disabled="busy" @click="$emit('restore')">{{ busy ? '正在恢复…' : '恢复草稿' }}</button>
    </div>
  </section>
</template>
