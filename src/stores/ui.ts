import { ref } from 'vue'
import { defineStore } from 'pinia'
import { newId } from '@/lib/id'

export type ToastTone = 'success' | 'error' | 'info' | 'warning'
export interface AppToast { id: string; title: string; detail?: string; tone: ToastTone; actionLabel?: string; action?: () => void; repeats: number }
export interface ConfirmRequest { title: string; message: string; confirmLabel: string; cancelLabel: string; danger: boolean }

/* The most toasts that can be on screen at once. The stack grows upward from
   the bottom-right corner, so an uncapped queue does not overflow visibly — it
   walks off the top of the window. Twenty in a row (clicking 新建单词 twenty
   times) put seven cards entirely above the viewport, invisible, with their
   own dismiss buttons out of reach, while the twelve that fit covered the
   editor they were reporting on. */
const MAX_TOASTS = 4

export const useUiStore = defineStore('ui', () => {
  const toasts = ref<AppToast[]>([])
  const confirmRequest = ref<ConfirmRequest>()
  const documentFocusMode = ref(false)
  let confirmResolver: ((value: boolean) => void) | undefined
  const timers = new Map<string, number>()

  function schedule(item: AppToast) {
    window.clearTimeout(timers.get(item.id))
    timers.set(item.id, window.setTimeout(() => dismiss(item.id), item.tone === 'error' ? 7000 : 4200))
  }

  function toast(title: string, detail?: string, tone: ToastTone = 'info', actionLabel?: string, action?: () => void) {
    /* The same sentence five times is one thing that happened five times, not
       five things. Counting it keeps the information and the stack short. */
    const same = toasts.value.find((item) => item.title === title && item.detail === detail && item.tone === tone)
    if (same) {
      same.repeats += 1
      schedule(same)
      return same.id
    }
    const item: AppToast = { id: newId(), title, detail, tone, actionLabel, action, repeats: 1 }
    toasts.value.push(item)
    // Drop the oldest, not the newest: the most recent thing is the one the
    // user is waiting to hear about.
    while (toasts.value.length > MAX_TOASTS) dismiss(toasts.value[0]!.id)
    schedule(item)
    return item.id
  }
  function dismiss(id: string) {
    window.clearTimeout(timers.get(id))
    timers.delete(id)
    toasts.value = toasts.value.filter((item) => item.id !== id)
  }
  function runAction(item: AppToast) { item.action?.(); dismiss(item.id) }
  function confirm(options: Partial<ConfirmRequest> & Pick<ConfirmRequest, 'title' | 'message'>) {
    confirmRequest.value = { confirmLabel: '确认', cancelLabel: '取消', danger: false, ...options }
    return new Promise<boolean>((resolve) => { confirmResolver = resolve })
  }
  function resolveConfirm(value: boolean) { confirmResolver?.(value); confirmResolver = undefined; confirmRequest.value = undefined }
  function setDocumentFocusMode(value: boolean) { documentFocusMode.value = value }

  return { toasts, confirmRequest, documentFocusMode, toast, dismiss, runAction, confirm, resolveConfirm, setDocumentFocusMode }
})
