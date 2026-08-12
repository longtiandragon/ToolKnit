<script setup lang="ts">
import { useUiStore } from '@/stores/ui'
const ui = useUiStore()
</script>
<template>
  <div v-if="ui.confirmRequest" class="modal-backdrop confirm-backdrop" @click.self="ui.resolveConfirm(false)">
    <section class="confirm-dialog" role="alertdialog" aria-modal="true" :aria-label="ui.confirmRequest.title">
      <p class="eyebrow">请确认操作</p><h3>{{ ui.confirmRequest.title }}</h3><p>{{ ui.confirmRequest.message }}</p>
      <footer><button class="quiet-button" @click="ui.resolveConfirm(false)">{{ ui.confirmRequest.cancelLabel }}</button><button class="primary-button" :class="{ danger: ui.confirmRequest.danger }" @click="ui.resolveConfirm(true)">{{ ui.confirmRequest.confirmLabel }}</button></footer>
    </section>
  </div>
</template>
