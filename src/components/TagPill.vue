<script setup lang="ts">
defineProps<{ label: string; subtle?: boolean }>()
</script>

<template>
  <span class="tag-pill" :class="{ subtle }">{{ label }}</span>
</template>
