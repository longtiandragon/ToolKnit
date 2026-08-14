<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue'
import AppIcon from '@/components/AppIcon.vue'
import type { DesktopVaultBackupInspection, DesktopVaultHealth } from '@/lib/native'

const props = defineProps<{
  inspection: DesktopVaultBackupInspection
  current?: DesktopVaultHealth
  busy?: boolean
  error?: string
}>()
const emit = defineEmits<{ cancel: []; confirm: [] }>()
const cancelButton = ref<HTMLButtonElement>()
const documentDelta = computed(() => props.current ? props.inspection.documentCount - props.current.documentCount : 0)
const structuredDelta = computed(() => props.current
  ? props.inspection.vocabularyCount + props.inspection.sourceCount - props.current.vocabularyCount - props.current.sourceCount
  : 0)
const fewerContent = computed(() => documentDelta.value < 0 || structuredDelta.value < 0)

function formatBytes(value: number) {
  if (!Number.isFinite(value) || value <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const index = Math.min(units.length - 1, Math.floor(Math.log(value) / Math.log(1024)))
  return `${(value / 1024 ** index).toFixed(index ? 1 : 0)} ${units[index]}`
}
function signed(value: number) { return value > 0 ? `+${value}` : String(value) }

onMounted(() => { void nextTick(() => cancelButton.value?.focus({ preventScroll: true })) })
</script>

<template>
  <Teleport to="body">
    <div class="fixed inset-0 z-150 center px-4 bg-[var(--scrim)] backdrop-blur-[3px]" @keydown.esc.prevent="!busy && emit('cancel')">
      <section class="stack gap-3 w-full max-w-200 max-h-[86vh] p-5 panel shadow-lg" role="alertdialog" aria-modal="true" aria-labelledby="vault-restore-review-title" aria-describedby="vault-restore-review-description" :aria-busy="busy">
        <header class="row items-start gap-3 shrink-0">
          <span class="center w-9 h-9 shrink-0 rounded-sm bg-accent-soft text-accent" aria-hidden="true"><AppIcon name="shield" :size="20" /></span>
          <div class="stack gap-1 min-w-0 flex-1">
            <p class="text-[11px] font-semibold text-fg-3">恢复前确认</p>
            <h3 id="vault-restore-review-title" class="text-[16px] font-semibold text-fg">归档已通过只读检查</h3>
            <small id="vault-restore-review-description" class="text-[12px] leading-relaxed text-fg-2">确认内容规模与版本后再替换当前资料库。此页面尚未修改任何 Vault 文件。</small>
          </div>
          <b class="row shrink-0 h-6 px-2.5 rounded-full bg-success-soft text-[11px] font-semibold text-success">可恢复</b>
        </header>

        <div class="stack gap-3 min-h-0 flex-1 overflow-y-auto">
          <section class="grid gap-3 items-center px-3 py-2.5 rounded-md bg-surface-2 border border-line grid-cols-1 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]" aria-label="所选归档">
            <div class="stack gap-0.5 min-w-0">
              <span class="text-[11px] font-medium text-fg-3">所选归档</span>
              <b class="text-[12px] font-semibold text-fg truncate" :title="inspection.archiveName">{{ inspection.archiveName }}</b>
              <small class="text-[11px] text-fg-3">{{ inspection.modifiedAt ? new Date(inspection.modifiedAt).toLocaleString('zh-CN') : '修改时间不可用' }}</small>
            </div>
            <dl class="grid gap-2 grid-cols-4">
              <div class="stack gap-0.5 min-w-0"><dt class="font-mono text-[11px] text-fg-3">ZIP 大小</dt><dd class="text-[11px] font-semibold text-fg tabular-nums whitespace-nowrap">{{ formatBytes(inspection.archiveSize) }}</dd></div>
              <div class="stack gap-0.5 min-w-0"><dt class="font-mono text-[11px] text-fg-3">展开大小</dt><dd class="text-[11px] font-semibold text-fg tabular-nums whitespace-nowrap">{{ formatBytes(inspection.uncompressedSize) }}</dd></div>
              <div class="stack gap-0.5 min-w-0"><dt class="font-mono text-[11px] text-fg-3">文件</dt><dd class="text-[11px] font-semibold text-fg tabular-nums whitespace-nowrap">{{ inspection.fileCount.toLocaleString('zh-CN') }}</dd></div>
              <div class="stack gap-0.5 min-w-0"><dt class="font-mono text-[11px] text-fg-3">Schema</dt><dd class="text-[11px] font-semibold text-fg tabular-nums whitespace-nowrap">v{{ inspection.schemaVersion }}</dd></div>
            </dl>
          </section>

          <!-- The whole decision in one line: this many items now, that many
               after. The arrow is the verb. -->
          <div class="grid gap-2 items-center grid-cols-1 lg:grid-cols-[minmax(0,1fr)_24px_minmax(0,1fr)]">
            <article class="stack gap-1 p-3 rounded-md bg-warn-soft border border-warn">
              <header class="row-between gap-2"><span class="text-[11px] font-semibold text-fg">当前 Vault</span><small class="text-[11px] text-fg-2">将被替换</small></header>
              <strong class="row items-baseline gap-1.5 text-[22px] font-semibold text-warn tabular-nums">{{ current?.documentCount.toLocaleString('zh-CN') ?? '—' }}<small class="text-[11px] font-medium text-fg-2">篇文档</small></strong>
              <p v-if="current" class="text-[11px] leading-snug text-fg-2">{{ current.noteCount }} 笔记 · {{ current.questionCount }} 题目</p><p v-else class="text-[11px] leading-snug text-fg-2">当前计数尚不可用</p>
              <p v-if="current" class="text-[11px] leading-snug text-fg-2">{{ current.vocabularyCount }} 单词 · {{ current.sourceCount }} 资料</p><p v-else class="text-[11px] leading-snug text-fg-2">恢复前仍会创建安全归档</p>
            </article>
            <span class="center text-fg-3" aria-hidden="true">→</span>
            <article class="stack gap-1 p-3 rounded-md bg-surface-2 border border-line">
              <header class="row-between gap-2"><span class="text-[11px] font-semibold text-fg">归档内容</span><small class="text-[11px] text-fg-2">恢复后</small></header>
              <strong class="row items-baseline gap-1.5 text-[22px] font-semibold text-accent tabular-nums">{{ inspection.documentCount.toLocaleString('zh-CN') }}<small class="text-[11px] font-medium text-fg-2">篇文档</small></strong>
              <p class="text-[11px] leading-snug text-fg-2">{{ inspection.noteCount }} 笔记 · {{ inspection.questionCount }} 题目</p>
              <p class="text-[11px] leading-snug text-fg-2">{{ inspection.vocabularyCount }} 单词 · {{ inspection.sourceCount }} 资料</p>
            </article>
          </div>

          <p v-if="fewerContent" class="row gap-2.5 px-3 py-2.5 rounded-md bg-danger-soft border border-danger text-danger" role="alert">
            <AppIcon name="warning" :size="15" class="shrink-0" />
            <span class="stack gap-0.5 min-w-0"><b class="text-[12px] font-semibold">归档内容少于当前资料库</b><small class="text-[11px] leading-snug">文档 {{ signed(documentDelta) }}，结构化内容 {{ signed(structuredDelta) }}。确认这是你希望回到的时间点。</small></span>
          </p>

          <section class="grid gap-2 grid-cols-1 sm:grid-cols-2" aria-label="归档检查结果">
            <p class="row items-start gap-2.5 px-3 py-2.5 rounded-md bg-surface-2 border border-line"><i class="shrink-0 mt-1.5 w-1.5 h-1.5 rounded-full bg-success ring-3 ring-[var(--success-soft)]"></i><span class="stack gap-0.5 min-w-0"><b class="text-[12px] font-medium text-fg">SQLite 完整性正常</b><small class="text-[11px] leading-snug text-fg-3">quick_check = {{ inspection.integrity }}</small></span></p>
            <p class="row items-start gap-2.5 px-3 py-2.5 rounded-md bg-surface-2 border border-line"><i class="shrink-0 mt-1.5 w-1.5 h-1.5 rounded-full bg-success ring-3 ring-[var(--success-soft)]"></i><span class="stack gap-0.5 min-w-0"><b class="text-[12px] font-medium text-fg">Markdown 正文齐全</b><small class="text-[11px] leading-snug text-fg-3">{{ inspection.documentCount }} 条索引均找到对应文件</small></span></p>
            <p class="row items-start gap-2.5 px-3 py-2.5 rounded-md bg-surface-2 border border-line"><i class="shrink-0 mt-1.5 w-1.5 h-1.5 rounded-full bg-success ring-3 ring-[var(--success-soft)]"></i><span class="stack gap-0.5 min-w-0"><b class="text-[12px] font-medium text-fg">版本可兼容</b><small class="text-[11px] leading-snug text-fg-3">归档 v{{ inspection.schemaVersion }} · 当前支持 v{{ inspection.latestSchemaVersion }}</small></span></p>
            <p class="row items-start gap-2.5 px-3 py-2.5 rounded-md bg-surface-2 border border-line"><i class="shrink-0 mt-1.5 w-1.5 h-1.5 rounded-full bg-success ring-3 ring-[var(--success-soft)]"></i><span class="stack gap-0.5 min-w-0"><b class="text-[12px] font-medium text-fg">恢复前仍会留后路</b><small class="text-[11px] leading-snug text-fg-3">当前 Vault 会先另存为独立安全归档</small></span></p>
          </section>

          <p v-if="error" class="row gap-2 px-3 py-2 rounded-md bg-danger-soft border border-danger text-[11px] leading-snug text-danger" role="alert"><AppIcon name="warning" :size="14" class="shrink-0" />{{ error }}</p>
        </div>

        <footer class="row justify-end gap-2 shrink-0 pt-3 border-t border-line">
          <button ref="cancelButton" class="btn-default" :disabled="busy" @click="emit('cancel')">取消，保持当前资料</button>
          <button class="btn-danger" :disabled="busy" @click="emit('confirm')">{{ busy ? '正在安全恢复…' : '确认替换并重新载入' }}</button>
        </footer>
      </section>
    </div>
  </Teleport>
</template>
