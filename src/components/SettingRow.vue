<script setup lang="ts">
/**
 * One decision: what it is on the left, how to change it on the right.
 *
 * The settings page had four different markups for this — `.setting-control`,
 * `.setting-toggle`, `.local-engine-path`, and a bare `<label>` — which is why
 * its rows never quite lined up with each other.
 *
 * Rendered as a `<label>` when the control is a single form element, so the
 * whole row is a click target; as a `<div>` when it holds buttons, because a
 * label wrapping a button steals the button's clicks.
 */
defineProps<{
  title: string
  /** The consequence of the setting, not a restatement of its name. */
  description?: string
  /** True when the control is a button, a group, or anything clickable. */
  interactive?: boolean
  /** Dim the row and say why. Desktop-only settings use this in the browser. */
  disabledNote?: string
}>()
</script>

<template>
  <component
    :is="interactive ? 'div' : 'label'"
    class="row-between gap-4 py-3 border-b border-line last:border-b-0"
    :class="[interactive ? '' : 'cursor-pointer', disabledNote ? 'opacity-60' : '']"
  >
    <span class="stack gap-0.5 min-w-0">
      <b class="text-[13px] font-medium text-fg">{{ title }}</b>
      <small v-if="description" class="text-[12px] leading-snug text-fg-3">{{ description }}</small>
      <small v-if="disabledNote" class="text-[12px] leading-snug text-warn">{{ disabledNote }}</small>
    </span>
    <span class="shrink-0">
      <slot />
    </span>
  </component>
</template>
