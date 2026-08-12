<script setup lang="ts">
/**
 * A row of mutually exclusive choices.
 *
 * This shape was reimplemented in five places — the tool group picker, four
 * appearance fieldsets, the developer-tool mode switch — each with its own
 * markup and its own idea of how the active one should look. One of them is
 * enough, and it is the only one that gets the keyboard behaviour right.
 */
defineProps<{
  options: readonly { id: string; label: string; detail?: string }[]
  modelValue: string
  /** Announced to screen readers as the name of the choice being made. */
  label: string
  /** `detail` makes each option two lines tall; use for values like "16 px". */
  size?: 'default' | 'compact'
}>()

defineEmits<{ 'update:modelValue': [value: string] }>()
</script>

<template>
  <div
    class="row gap-0.5 p-0.5 rounded-sm bg-surface-2 border border-line"
    :class="options.some((option) => option.detail) ? 'w-full' : ''"
    role="group"
    :aria-label="label"
  >
    <button
      v-for="option in options"
      :key="option.id"
      type="button"
      :aria-pressed="modelValue === option.id"
      class="stack items-center justify-center rounded-[4px] transition-colors flex-1 min-w-0"
      :class="[
        size === 'compact' ? 'h-7 px-2.5' : 'h-9 px-3',
        modelValue === option.id ? 'bg-surface text-fg shadow-sm' : 'text-fg-3 hover:text-fg',
      ]"
      @click="$emit('update:modelValue', option.id)"
    >
      <b class="text-[12px] leading-tight" :class="modelValue === option.id ? 'font-medium' : 'font-normal'">
        {{ option.label }}
      </b>
      <small v-if="option.detail" class="text-[11px] leading-tight text-fg-3 tabular-nums">{{ option.detail }}</small>
    </button>
  </div>
</template>
