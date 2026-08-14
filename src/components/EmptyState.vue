<script setup lang="ts">
import AppIcon from '@/components/AppIcon.vue'
defineProps<{ icon?: string; title: string; description: string; action?: string }>()
defineEmits<{ action: [] }>()
</script>
<!--
  One centred column, no decorative hatching. This renders inside panes that
  already own a border, so a second dashed box around it read as a defect
  rather than as an invitation.
-->
<template>
  <section class="stack items-center justify-center gap-2 min-h-45 px-6 py-9 text-center">
    <b class="center w-13 h-13 rounded-full bg-accent-soft text-accent"><AppIcon :name="icon || 'inbox'" :size="25" /></b>
    <h3 class="mt-1 text-[13px] font-semibold text-fg">{{ title }}</h3>
    <p class="max-w-95 text-[12px] leading-relaxed text-fg-3">{{ description }}</p>
    <button v-if="action" class="btn-default btn-sm mt-1" @click="$emit('action')">{{ action }}</button>
  </section>
</template>
