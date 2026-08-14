<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useUiStore } from '@/stores/ui'

const ui = useUiStore()
const panel = ref<HTMLElement>()
const cancelButton = ref<HTMLButtonElement>()
let returnFocusTo: HTMLElement | undefined

/* Every other modal in the product — the two import dialogs, the Markdown
   builder — focuses itself, keeps Tab inside, closes on Escape and hands focus
   back. This one did none of it, and it is the one that matters most: it is
   the only thing between the user and 删除单词, 清空剪贴板历史 and 确认恢复.
   Tab walked straight out through the scrim into the rail, where Enter
   navigated the route while the confirm was still floating over a page that
   no longer existed. */
watch(() => ui.confirmRequest, async (request) => {
  if (!request) {
    window.removeEventListener('keydown', handleKeydown)
    returnFocusTo?.focus()
    returnFocusTo = undefined
    return
  }
  returnFocusTo = document.activeElement instanceof HTMLElement ? document.activeElement : undefined
  // On `window`, like the import dialogs: a handler bound to the panel only
  // hears the keyboard once the keyboard is already inside it.
  window.addEventListener('keydown', handleKeydown)
  await nextTick()
  // Cancel, not confirm: the safe choice is the one under the finger when a
  // dialog you did not expect takes the keyboard.
  cancelButton.value?.focus()
})

onBeforeUnmount(() => window.removeEventListener('keydown', handleKeydown))

function handleKeydown(event: KeyboardEvent) {
  if (!ui.confirmRequest) return
  if (event.key === 'Escape') {
    event.preventDefault()
    ui.resolveConfirm(false)
    return
  }
  if (event.key !== 'Tab') return
  const focusable = [...(panel.value?.querySelectorAll<HTMLElement>('button:not([disabled])') ?? [])]
  const first = focusable[0]
  const last = focusable.at(-1)
  if (!first || !last) return
  const inside = panel.value?.contains(document.activeElement)
  if (event.shiftKey && (document.activeElement === first || !inside)) { event.preventDefault(); last.focus(); return }
  if (!event.shiftKey && (document.activeElement === last || !inside)) { event.preventDefault(); first.focus() }
}
</script>
<template>
  <!--
    This is the app's last word, so it sits one step above every other modal
    (z-160). Import dialogs and the Markdown builder are teleported to `body`,
    i.e. after `#app` in document order, and at an equal z-index the later node
    wins — the confirmation they themselves open would render *behind* their
    own scrim.
  -->
  <div
    v-if="ui.confirmRequest"
    class="fixed inset-0 z-160 center px-4 bg-[var(--scrim)] backdrop-blur-[3px]"
    @click.self="ui.resolveConfirm(false)"
  >
    <section ref="panel" class="stack gap-2.5 w-full max-w-112 p-5 panel shadow-lg" role="alertdialog" aria-modal="true" :aria-label="ui.confirmRequest.title" tabindex="-1">
      <p class="text-[11px] font-semibold text-fg-3">请确认操作</p>
      <h3 class="text-[16px] font-semibold text-fg">{{ ui.confirmRequest.title }}</h3>
      <p class="text-[12px] leading-relaxed text-fg-2">{{ ui.confirmRequest.message }}</p>
      <footer class="row justify-end gap-2 mt-1">
        <button ref="cancelButton" class="btn-default" @click="ui.resolveConfirm(false)">{{ ui.confirmRequest.cancelLabel }}</button>
        <button :class="ui.confirmRequest.danger ? 'btn-danger' : 'btn-primary'" @click="ui.resolveConfirm(true)">{{ ui.confirmRequest.confirmLabel }}</button>
      </footer>
    </section>
  </div>
</template>
