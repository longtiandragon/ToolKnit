<script setup lang="ts">
/**
 * The two-column shell every tool page uses.
 *
 * The old tool page was a four-step grid — pick, input, parameters, run —
 * numbered like a wizard even though nothing about it was sequential. Worse,
 * the run button and the results both lived at the bottom of that grid, so
 * finishing a job scrolled the answer off screen.
 *
 * This splits the page the way the work actually splits: the left column is
 * the thing you are looking at (files, text, progress, results), the right
 * column is how you configure it, and the right column sticks so the primary
 * action never leaves the viewport.
 */
defineProps<{
  /** Narrow the settings column for pages with only a control or two. */
  asideWidth?: 'default' | 'narrow'
}>()
</script>

<template>
  <div
    class="grid gap-5 items-start grid-cols-1"
    :class="$slots.aside && (asideWidth === 'narrow' ? 'xl:grid-cols-[minmax(0,1fr)_280px]' : 'xl:grid-cols-[minmax(0,1fr)_340px]')"
  >
    <!-- The work column claims the window even when its content is short. A
         tool page whose surface stops a third of the way down reads as
         unfinished, and a drop target the size of the work area is a better
         drop target. Anything inside that should absorb the slack says so
         with `flex-1`. -->
    <div class="stack gap-4 min-w-0 min-h-[calc(100vh-var(--titlebar-h)-15rem)]">
      <slot />
    </div>

    <aside v-if="$slots.aside" class="stack gap-4 min-w-0 xl:sticky xl:top-6">

      <slot name="aside" />
    </aside>
  </div>
</template>
