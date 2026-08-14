<script setup lang="ts">
/**
 * The standard page header.
 *
 * Every route used to open with a hero: a 40px headline, a paragraph of
 * positioning copy, and a floating stat card pinned to the right. That reads
 * once and then costs a third of the window forever. This is the replacement —
 * a title, one line of orientation, actions on the right, and an optional row
 * of counts that are worth glancing at.
 */
import { computed } from 'vue'

const props = defineProps<{
  title: string
  /** One line. If the page's purpose needs a paragraph, the page is unclear. */
  subtitle?: string
  /** Small counts shown as a single strip under the title. */
  stats?: { label: string; value: string | number; tone?: 'accent' | 'warn' | 'danger' }[]
}>()

/**
 * A counter reading zero is not news. On a fresh workspace these strips were
 * four numbers of which three were 0 — 90px of nothing, above everything, on
 * exactly the pages a new user opens first. Whatever a zero would have said
 * ("no sources yet") the page's own empty state says better and in words.
 *
 * So the strip carries only the counts that have something to report, and
 * disappears entirely when none do. It grows back as the workspace fills.
 * A value that is a string — "6 / 6", a date — is never a zero and always
 * shows.
 */
const visibleStats = computed(() => (props.stats ?? []).filter((stat) => stat.value !== 0 && stat.value !== '0'))

const toneClass = {
  accent: 'text-accent',
  warn: 'text-warn',
  danger: 'text-danger',
} as const
</script>

<template>
  <header class="stack gap-4 mb-6">
    <div class="row-between gap-4 flex-wrap">
      <div class="stack gap-0.5 min-w-0">
        <h2 class="text-[20px] font-semibold tracking-tight font-display">{{ title }}</h2>
        <p v-if="subtitle" class="text-[13px] text-fg-3">{{ subtitle }}</p>
      </div>
      <div v-if="$slots.actions" class="row gap-2 shrink-0">
        <slot name="actions" />
      </div>
    </div>

    <slot name="lead" />

    <dl
      v-if="visibleStats.length"
      class="grid gap-px rounded-md bg-line border border-line overflow-hidden"
      :style="{ gridTemplateColumns: `repeat(${visibleStats.length}, minmax(0, 1fr))` }"
    >
      <div v-for="stat in visibleStats" :key="stat.label" class="stack gap-0.5 px-4 py-3 bg-surface">
        <dt class="text-[12px] text-fg-3">{{ stat.label }}</dt>
        <dd class="text-[20px] font-semibold tabular-nums" :class="stat.tone && toneClass[stat.tone]">{{ stat.value }}</dd>
      </div>
    </dl>
  </header>
</template>
