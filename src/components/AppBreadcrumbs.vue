<script setup lang="ts">
defineProps<{ items: Array<{ label: string; to?: string }> }>()
</script>
<template><nav class="breadcrumbs" aria-label="面包屑"><template v-for="(item,index) in items" :key="`${item.label}-${index}`"><RouterLink v-if="item.to" :to="item.to" class="tap">{{ item.label }}</RouterLink><span v-else>{{ item.label }}</span><i v-if="index < items.length - 1">/</i></template></nav></template>
