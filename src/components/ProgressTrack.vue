<script setup lang="ts">
/**
 * What a running job looks like.
 *
 * Driving the old page through a real conversion showed the gap: starting a
 * job greyed out every control and put a red "停止任务" button in the corner,
 * and that was the entire feedback. The work area — the part you are actually
 * looking at — said nothing at all. So this occupies that space: what is
 * running, how far along, which step, and what has already landed.
 */
import AppIcon from '@/components/AppIcon.vue'

defineProps<{
  label: string
  /** 0–100. */
  value: number
  /** The current step, in the app's own words. Changes often; announced. */
  detail?: string
  /** Names of outputs already written, newest last. */
  done?: string[]
  /** Cancellation is in flight — the button is spent but the job is not. */
  stopping?: boolean
}>()

defineEmits<{ cancel: [] }>()
</script>

<template>
  <section class="panel p-5 stack gap-4" role="status" aria-live="polite">
    <div class="row-between gap-4">
      <div class="row gap-2.5 min-w-0">
        <!-- The only spinner in the product. If something spins, work is
             happening; nothing else is allowed to imply that. -->
        <span
          class="w-4 h-4 shrink-0 rounded-full border-2 border-line-strong border-t-accent animate-spin"
          :class="stopping ? 'border-t-warn' : ''"
        />
        <strong class="text-[14px] font-semibold text-fg truncate">
          {{ stopping ? '正在停止…' : label }}
        </strong>
      </div>
      <span class="text-[13px] font-semibold tabular-nums text-fg-2 shrink-0">{{ Math.round(value) }}%</span>
    </div>

    <div
      class="h-1.5 rounded-full bg-surface-3 overflow-hidden"
      role="progressbar"
      :aria-valuenow="Math.round(value)"
      aria-valuemin="0"
      aria-valuemax="100"
      :aria-label="label"
    >
      <span
        class="block h-full rounded-full transition-[width] duration-300 ease-out"
        :class="stopping ? 'bg-warn' : 'bg-accent'"
        :style="{ width: `${Math.max(2, Math.min(100, value))}%` }"
      />
    </div>

    <p v-if="detail" class="text-[12px] text-fg-2 leading-snug">{{ detail }}</p>

    <!-- Outputs stream in while the job runs. Seeing the first file appear is
         what tells you the pipeline is real and not just a moving bar. -->
    <ul v-if="done?.length" class="stack gap-1 pt-1 border-t border-line">
      <li v-for="name in done" :key="name" class="row gap-2 text-[12px] text-fg-2 pt-1.5">
        <AppIcon name="check" :size="14" class="text-success shrink-0" />
        <span class="truncate">{{ name }}</span>
      </li>
    </ul>

    <div class="row justify-end">
      <button class="btn-default btn-sm" :disabled="stopping" @click="$emit('cancel')">
        {{ stopping ? '正在停止…' : '停止任务' }}
      </button>
    </div>
  </section>
</template>
