import { ref } from 'vue'
import { defineStore } from 'pinia'
import { newId } from '@/lib/id'

export type ToastTone = 'success' | 'error' | 'info' | 'warning'
export interface AppToast { id: string; title: string; detail?: string; tone: ToastTone; actionLabel?: string; action?: () => void }
export interface ConfirmRequest { title: string; message: string; confirmLabel: string; cancelLabel: string; danger: boolean }

export const useUiStore = defineStore('ui', () => {
  const toasts = ref<AppToast[]>([])
  const confirmRequest = ref<ConfirmRequest>()
  const documentFocusMode = ref(false)
  let confirmResolver: ((value: boolean) => void) | undefined

  function toast(title: string, detail?: string, tone: ToastTone = 'info', actionLabel?: string, action?: () => void) {
    const item: AppToast = { id: newId(), title, detail, tone, actionLabel, action }
    toasts.value.push(item)
    window.setTimeout(() => dismiss(item.id), tone === 'error' ? 7000 : 4200)
    return item.id
  }
  function dismiss(id: string) { toasts.value = toasts.value.filter((item) => item.id !== id) }
  function runAction(item: AppToast) { item.action?.(); dismiss(item.id) }
  function confirm(options: Partial<ConfirmRequest> & Pick<ConfirmRequest, 'title' | 'message'>) {
    confirmRequest.value = { confirmLabel: '确认', cancelLabel: '取消', danger: false, ...options }
    return new Promise<boolean>((resolve) => { confirmResolver = resolve })
  }
  function resolveConfirm(value: boolean) { confirmResolver?.(value); confirmResolver = undefined; confirmRequest.value = undefined }
  function setDocumentFocusMode(value: boolean) { documentFocusMode.value = value }

  return { toasts, confirmRequest, documentFocusMode, toast, dismiss, runAction, confirm, resolveConfirm, setDocumentFocusMode }
})
