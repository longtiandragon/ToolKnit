<script setup lang="ts">
/**
 * An on/off setting.
 *
 * A bare checkbox reads as "tick this to submit a form later"; these settings
 * take effect the moment they change, and a switch is the control that says
 * so. It is still an `<input type="checkbox">` underneath, so keyboard,
 * screen-reader and form semantics are the platform's rather than ours.
 */
defineProps<{ modelValue: boolean; label?: string; disabled?: boolean }>()
defineEmits<{ 'update:modelValue': [value: boolean] }>()
</script>

<template>
  <span class="relative inline-flex shrink-0">
    <input
      type="checkbox"
      class="peer absolute inset-0 w-full h-full m-0 opacity-0 cursor-pointer disabled:cursor-not-allowed"
      :checked="modelValue"
      :disabled="disabled"
      :aria-label="label"
      @change="$emit('update:modelValue', ($event.target as HTMLInputElement).checked)"
    />
    <span
      class="w-9 h-5 rounded-full transition-colors duration-150 peer-disabled:opacity-45
             peer-focus-visible:ring-3 peer-focus-visible:ring-[var(--accent-ring)]"
      :class="modelValue ? 'bg-accent-solid' : 'bg-surface-3'"
      aria-hidden="true"
    >
      <span
        class="block w-4 h-4 mt-0.5 rounded-full bg-white shadow-sm transition-transform duration-150"
        :class="modelValue ? 'translate-x-4.5' : 'translate-x-0.5'"
      />
    </span>
  </span>
</template>
