<script setup lang="ts">
import { nextTick, onMounted, ref } from 'vue'
import AppIcon from '@/components/AppIcon.vue'
import type { ExternalMarkdownConflictPreview } from '@/lib/external-markdown-conflict'

defineProps<{
  title: string
  fileName: string
  preview: ExternalMarkdownConflictPreview
  busy?: boolean
  error?: string
  managedVault?: boolean
}>()

const emit = defineEmits<{
  decision: [value: 'stay' | 'keep-both' | 'use-disk' | 'overwrite-disk']
}>()
const stayButton = ref<HTMLButtonElement>()

onMounted(() => { void nextTick(() => stayButton.value?.focus({ preventScroll: true })) })
</script>

<template>
  <Teleport to="body">
    <div class="fixed inset-0 z-150 center px-4 bg-[var(--scrim)] backdrop-blur-[3px]" @keydown.esc.prevent="!busy && emit('decision', 'stay')">
      <section class="stack gap-3 w-full max-w-200 max-h-[86vh] p-5 panel shadow-lg" role="alertdialog" aria-modal="true" aria-labelledby="external-conflict-title" aria-describedby="external-conflict-description" :aria-busy="busy">
        <header class="row items-start gap-3 shrink-0">
          <span class="center w-9 h-9 shrink-0 rounded-sm bg-warn-soft text-warn" aria-hidden="true"><AppIcon name="warning" :size="19" /></span>
          <div class="stack gap-1 min-w-0">
            <p class="text-[11px] font-semibold text-warn">{{ managedVault ? '资料库 Markdown 冲突' : '外部 Markdown 冲突' }}</p>
            <h3 id="external-conflict-title" class="text-[16px] font-semibold text-fg">{{ preview.draftChanged ? '草稿和磁盘文件都发生了变化' : '磁盘文件已有新的修改' }}</h3>
            <p id="external-conflict-description" class="text-[12px] leading-relaxed text-fg-2">“{{ title }}”的{{ managedVault ? ' Vault Markdown' : `关联文件 ${fileName}` }}被其他程序修改。先比较首个变化附近，再选择如何同步；任何选项都不会静默丢弃版本。</p>
          </div>
        </header>

        <!-- Three states side by side: what you have, what the disk has, and
             the one option that loses nothing. The recommended card carries
             the accent so the safe route is legible before the diff is read. -->
        <div class="grid gap-2 shrink-0 grid-cols-1 sm:grid-cols-3" aria-label="版本摘要">
          <article class="stack gap-1 min-w-0 px-3 py-2.5 rounded-md bg-surface-2 border" :class="preview.draftChanged ? 'border-warn' : 'border-line'">
            <span class="text-[11px] font-medium text-fg-3">当前草稿</span>
            <b class="text-[13px] font-semibold text-fg">{{ preview.draftLines.toLocaleString('zh-CN') }} 行</b>
            <small class="text-[11px] leading-snug text-fg-3">{{ preview.draftCharacters.toLocaleString('zh-CN') }} 字符 · {{ preview.draftChanged ? '相对上次保存有修改' : '未修改' }}</small>
          </article>
          <article class="stack gap-1 min-w-0 px-3 py-2.5 rounded-md bg-surface-2 border" :class="preview.diskChanged ? 'border-warn' : 'border-line'">
            <span class="text-[11px] font-medium text-fg-3">磁盘版本</span>
            <b class="text-[13px] font-semibold text-fg">{{ preview.diskLines.toLocaleString('zh-CN') }} 行</b>
            <small class="text-[11px] leading-snug text-fg-3">{{ preview.diskCharacters.toLocaleString('zh-CN') }} 字符 · {{ preview.diskChanged ? '由其他程序更新' : '与上次保存一致' }}</small>
          </article>
          <article class="stack gap-1 min-w-0 px-3 py-2.5 rounded-md bg-accent-soft border border-accent">
            <span class="text-[11px] font-medium text-fg-3">安全建议</span>
            <b class="text-[13px] font-semibold text-accent">保留两份</b>
            <small class="text-[11px] leading-snug text-fg-2">先把当前草稿存为独立副本，再载入磁盘版本。</small>
          </article>
        </div>

        <!-- The diff is the evidence, so it takes whatever height the summary
             and the actions leave, and recesses into a well rather than
             repeating the dialog's own surface. -->
        <section class="stack min-w-0 min-h-40 flex-1 overflow-hidden rounded-lg border border-line bg-well" aria-label="首个变化附近的行差异">
          <header class="row-between gap-3 shrink-0 px-3 h-9 border-b border-line bg-surface-2">
            <div class="row items-baseline gap-2 min-w-0">
              <b class="text-[12px] font-medium text-fg">第 {{ preview.firstChangedLine.toLocaleString('zh-CN') }} 行附近</b>
              <small class="text-[11px] text-fg-3 truncate">{{ preview.truncated ? '有界预览 · 不加载整篇差异' : '完整差异' }}</small>
            </div>
            <span class="row gap-1.5 shrink-0 text-[11px] text-fg-3"><i class="w-1.5 h-1.5 rounded-[2px] bg-danger"></i>草稿删除 <i class="w-1.5 h-1.5 ml-1.5 rounded-[2px] bg-success"></i>磁盘新增</span>
          </header>
          <div class="flex-1 min-h-0 overflow-auto [scrollbar-gutter:stable] focus-visible:outline-none" role="list" tabindex="0">
            <p
              v-for="(line, index) in preview.lines"
              :key="`${index}:${line.leftLine}:${line.rightLine}`"
              class="grid grid-cols-[40px_40px_22px_minmax(0,1fr)] min-h-6 border-b border-line font-mono text-[11px] leading-relaxed"
              :class="line.kind === 'added' ? 'bg-success-soft' : line.kind === 'removed' ? 'bg-danger-soft' : ''"
              role="listitem"
            >
              <!-- The gutter needs a rule, not just a tint: in light mode
                   `surface-2` and `well` are four values apart and the two
                   number columns would dissolve into the code. -->
              <span class="px-1.5 py-1 bg-surface-2 text-right text-fg-3">{{ line.leftLine ?? '' }}</span>
              <span class="px-1.5 py-1 bg-surface-2 border-r border-line text-right text-fg-3">{{ line.rightLine ?? '' }}</span>
              <b class="py-1 text-center" :class="line.kind === 'added' ? 'text-success' : line.kind === 'removed' ? 'text-danger' : 'text-fg-3'">{{ line.kind === 'added' ? '+' : line.kind === 'removed' ? '−' : ' ' }}</b>
              <code class="px-2 py-1 text-fg whitespace-pre-wrap [overflow-wrap:anywhere]">{{ line.text || ' ' }}</code>
            </p>
          </div>
        </section>

        <p v-if="error" class="row gap-2 shrink-0 px-3 py-2 rounded-md bg-danger-soft border border-danger text-[11px] leading-snug text-danger" role="alert"><AppIcon name="warning" :size="13" class="shrink-0" />{{ error }}</p>
        <footer class="row flex-wrap justify-end gap-2 shrink-0 pt-3 border-t border-line">
          <button ref="stayButton" class="btn-default" :disabled="busy" @click="emit('decision', 'stay')">继续编辑</button>
          <button class="btn-danger" :disabled="busy" @click="emit('decision', 'use-disk')">使用磁盘版本</button>
          <button class="btn-danger" :disabled="busy" @click="emit('decision', 'overwrite-disk')">用草稿覆盖磁盘</button>
          <button class="btn-primary" :disabled="busy" @click="emit('decision', 'keep-both')">{{ busy ? '正在安全处理…' : '保留两份（推荐）' }}</button>
        </footer>
      </section>
    </div>
  </Teleport>
</template>
