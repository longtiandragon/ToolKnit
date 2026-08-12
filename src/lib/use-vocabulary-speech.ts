import { ref } from 'vue'
import type { VocabularyEntry } from '@/types'
import { useUiStore } from '@/stores/ui'
import { vocabularySpeechTarget } from '@/lib/vocabulary-speech'

/** One lightweight controller per visible vocabulary workflow. Utterances are
 * created only after an explicit user action and never retained after finish. */
export function useVocabularySpeech() {
  const ui = useUiStore()
  const speakingEntryId = ref('')
  let revision = 0

  function stopVocabularySpeech(announce = true) {
    revision += 1
    speakingEntryId.value = ''
    window.speechSynthesis?.cancel()
    if (announce) ui.toast('已停止朗读', undefined, 'info')
  }

  function speakVocabularyEntry(entry: VocabularyEntry) {
    const target = vocabularySpeechTarget(entry)
    if (speakingEntryId.value === entry.id) { stopVocabularySpeech(); return }
    if (!target.text) { ui.toast('先填写单词，再朗读。', undefined, 'info'); return }
    if (!('speechSynthesis' in window) || typeof window.SpeechSynthesisUtterance !== 'function') {
      ui.toast('当前系统没有可用的朗读引擎', '可以继续保存音标，或在 Windows 中安装对应语言的语音包。', 'error')
      return
    }

    const activeRevision = ++revision
    window.speechSynthesis.cancel()
    const utterance = new window.SpeechSynthesisUtterance(target.text)
    if (target.locale) utterance.lang = target.locale
    utterance.rate = target.locale.startsWith('en') ? .86 : .92
    utterance.pitch = 1
    speakingEntryId.value = entry.id
    utterance.onend = () => { if (activeRevision === revision) speakingEntryId.value = '' }
    utterance.onerror = (event) => {
      if (activeRevision !== revision) return
      speakingEntryId.value = ''
      if (event.error !== 'canceled' && event.error !== 'interrupted') {
        ui.toast('没有完成朗读', '请检查 Windows 语音包或当前音频输出。', 'error')
      }
    }
    window.speechSynthesis.speak(utterance)
  }

  function disposeVocabularySpeech() {
    if (speakingEntryId.value) stopVocabularySpeech(false)
  }

  return { speakingEntryId, speakVocabularyEntry, stopVocabularySpeech, disposeVocabularySpeech }
}
