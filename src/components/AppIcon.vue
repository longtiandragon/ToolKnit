<script setup lang="ts">
withDefaults(defineProps<{ name: string; size?: number; label?: string }>(), { size: 18, label: '' })
</script>

<template>
  <svg class="app-icon" :width="size" :height="size" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" :role="label ? 'img' : undefined" :aria-label="label || undefined" :aria-hidden="label ? undefined : 'true'">
    <use :href="`/icons/toolknit-icons.svg#icon-${name}`" />
  </svg>
</template>
