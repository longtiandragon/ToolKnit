<script setup lang="ts">
defineProps<{ label: string; value: string | number; hint: string; tone?: 'mint' | 'amber' | 'ink' }>()
</script>

<template>
  <article class="stat-card" :class="`tone-${tone ?? 'ink'}`">
    <p>{{ label }}</p><strong>{{ value }}</strong><small>{{ hint }}</small>
  </article>
</template>
