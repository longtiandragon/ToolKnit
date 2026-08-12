<script setup lang="ts">
/**
 * A labelled control.
 *
 * Legacy markup wrote `<label>透明度 {{n}}%<input type="range"></label>`, which
 * put the live value inside the label text and left its position to whatever
 * the stylesheet happened to do. Here the label is on the left and the current
 * value is right-aligned against it, so a column of sliders lines up and the
 * numbers can be read down the edge.
 */
defineProps<{
  label: string
  /** One short line under the control. Explains consequence, not syntax. */
  hint?: string
}>()
</script>

<template>
  <label class="stack gap-1.5">
    <span class="row-between gap-2 leading-none">
      <span class="text-[12px] font-medium text-fg-2">{{ label }}</span>
      <span v-if="$slots.value" class="text-[12px] tabular-nums text-fg-3">
        <slot name="value" />
      </span>
    </span>
    <slot />
    <span v-if="hint" class="text-[11px] leading-snug text-fg-3">{{ hint }}</span>
  </label>
</template>
