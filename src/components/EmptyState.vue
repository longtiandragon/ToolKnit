<script setup lang="ts">
import AppIcon from '@/components/AppIcon.vue'
defineProps<{ icon?: string; title: string; description: string; action?: string }>()
defineEmits<{ action: [] }>()
</script>
<template><section class="designed-empty"><b><AppIcon :name="icon || 'inbox'" :size="25" /></b><h3>{{ title }}</h3><p>{{ description }}</p><button v-if="action" class="quiet-button" @click="$emit('action')">{{ action }}</button></section></template>
