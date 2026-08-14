<script setup lang="ts">
import { useUiStore } from '@/stores/ui'
import AppIcon from '@/components/AppIcon.vue'
const ui = useUiStore()
</script>
<!--
  Toasts land over whatever page is open, so they cannot borrow their legibility
  from what is behind them: an opaque surface, a hairline and a shadow, in both
  themes. Tone is carried by the icon tile rather than by a coloured card —
  a red card under 11px muted detail text is the combination that stops being
  readable in light mode.
-->
<template>
  <div class="fixed right-4 bottom-4 z-200 stack gap-2 w-[min(23.75rem,calc(100vw_-_2.25rem))]" aria-live="polite" aria-relevant="additions">
    <article
      v-for="item in ui.toasts"
      :key="item.id"
      class="row gap-2.5 p-2.5 rounded-md bg-surface border border-line-strong shadow-lg"
    >
      <b
        class="center w-8 h-8 shrink-0 rounded-sm"
        :class="item.tone === 'success' ? 'bg-success-soft text-success'
          : item.tone === 'error' ? 'bg-danger-soft text-danger'
            : item.tone === 'warning' ? 'bg-warn-soft text-warn'
              : 'bg-accent-soft text-accent'"
      ><AppIcon :name="item.tone === 'success' ? 'review' : item.tone === 'error' ? 'shield' : 'sparkle'" :size="16" /></b>
      <span class="stack gap-0.5 min-w-0 flex-1"><strong class="text-[13px] font-medium text-fg">{{ item.title }}</strong><small v-if="item.detail" class="text-[11px] leading-relaxed text-fg-2">{{ item.detail }}</small></span>
      <button v-if="item.actionLabel" class="btn-ghost btn-sm shrink-0 text-accent hover:not-disabled:bg-accent-soft hover:not-disabled:text-accent" @click="ui.runAction(item)">{{ item.actionLabel }}</button>
      <button class="center w-7 h-7 shrink-0 rounded-sm text-fg-3 hover:bg-surface-2 hover:text-fg" aria-label="关闭通知" @click="ui.dismiss(item.id)"><AppIcon name="close" :size="14" /></button>
    </article>
  </div>
</template>
