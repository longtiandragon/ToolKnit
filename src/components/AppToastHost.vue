<script setup lang="ts">
import { useUiStore } from '@/stores/ui'
import AppIcon from '@/components/AppIcon.vue'
const ui = useUiStore()
</script>
<template>
  <div class="toast-host" aria-live="polite" aria-relevant="additions">
    <article v-for="item in ui.toasts" :key="item.id" class="app-toast" :class="item.tone">
      <b><AppIcon :name="item.tone === 'success' ? 'review' : item.tone === 'error' ? 'shield' : 'sparkle'" :size="16" /></b>
      <span><strong>{{ item.title }}</strong><small v-if="item.detail">{{ item.detail }}</small></span>
      <button v-if="item.actionLabel" @click="ui.runAction(item)">{{ item.actionLabel }}</button>
      <button class="toast-close" aria-label="关闭通知" @click="ui.dismiss(item.id)">×</button>
    </article>
  </div>
</template>
