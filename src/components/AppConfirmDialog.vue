<script setup lang="ts">
import { useUiStore } from '@/stores/ui'
const ui = useUiStore()
</script>
<template>
  <!--
    This is the app's last word, so it sits one step above every other modal
    (z-150). Import dialogs and the Markdown builder are teleported to `body`,
    i.e. after `#app` in document order, and at an equal z-index the later node
    wins — the confirmation they themselves open would render *behind* their
    own scrim.
  -->
  <div v-if="ui.confirmRequest" class="fixed inset-0 z-160 center px-4 bg-[var(--scrim)] backdrop-blur-[3px]" @click.self="ui.resolveConfirm(false)">
    <section class="stack gap-2.5 w-full max-w-112 p-5 panel shadow-lg" role="alertdialog" aria-modal="true" :aria-label="ui.confirmRequest.title">
      <p class="text-[11px] font-semibold text-fg-3">请确认操作</p>
      <h3 class="text-[16px] font-semibold text-fg">{{ ui.confirmRequest.title }}</h3>
      <p class="text-[12px] leading-relaxed text-fg-2">{{ ui.confirmRequest.message }}</p>
      <footer class="row justify-end gap-2 mt-1">
        <button class="btn-default" @click="ui.resolveConfirm(false)">{{ ui.confirmRequest.cancelLabel }}</button>
        <button :class="ui.confirmRequest.danger ? 'btn-danger' : 'btn-primary'" @click="ui.resolveConfirm(true)">{{ ui.confirmRequest.confirmLabel }}</button>
      </footer>
    </section>
  </div>
</template>
