<script setup lang="ts">
/**
 * A titled block of content.
 *
 * Today alone had eight of these, each with its own header markup and its own
 * eyebrow-plus-heading pair that said the same thing twice — "从这里开始 /
 * 从一件小事开始", "最近运行 / 最近任务". One title is enough; the second line
 * was there to fill a slot, not to inform.
 */
defineProps<{
  title: string
  /** Only when it adds something the title does not already say. */
  hint?: string
  /** Where "see all of these" goes. */
  to?: string
  linkLabel?: string
  /** Remove the body padding for edge-to-edge lists and tables. */
  flush?: boolean
}>()
</script>

<template>
  <section class="panel stack overflow-hidden">
    <header class="row-between gap-3 px-4 h-12 shrink-0" :class="$slots.default ? 'border-b border-line' : ''">
      <div class="row gap-2 min-w-0">
        <h3 class="text-[14px] font-semibold text-fg truncate">{{ title }}</h3>
        <span v-if="hint" class="text-[12px] text-fg-3 truncate">{{ hint }}</span>
      </div>
      <div class="row gap-1 shrink-0">
        <slot name="actions" />
        <RouterLink v-if="to" class="btn-ghost btn-sm" :to="to">{{ linkLabel ?? '查看全部' }}</RouterLink>
      </div>
    </header>
    <div v-if="$slots.default" :class="flush ? '' : 'p-3'">
      <slot />
    </div>
  </section>
</template>
