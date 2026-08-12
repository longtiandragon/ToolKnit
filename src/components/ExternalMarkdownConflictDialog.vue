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
    <div class="external-conflict-backdrop" @keydown.esc.prevent="!busy && emit('decision', 'stay')">
      <section class="external-conflict-dialog" role="alertdialog" aria-modal="true" aria-labelledby="external-conflict-title" aria-describedby="external-conflict-description" :aria-busy="busy">
        <header>
          <span aria-hidden="true"><AppIcon name="warning" :size="19" /></span>
          <div>
            <p class="eyebrow">{{ managedVault ? '资料库 Markdown 冲突' : '外部 Markdown 冲突' }}</p>
            <h3 id="external-conflict-title">{{ preview.draftChanged ? '草稿和磁盘文件都发生了变化' : '磁盘文件已有新的修改' }}</h3>
            <p id="external-conflict-description">“{{ title }}”的{{ managedVault ? ' Vault Markdown' : `关联文件 ${fileName}` }}被其他程序修改。先比较首个变化附近，再选择如何同步；任何选项都不会静默丢弃版本。</p>
          </div>
        </header>

        <div class="external-conflict-summary" aria-label="版本摘要">
          <article :class="{ changed: preview.draftChanged }"><span>当前草稿</span><b>{{ preview.draftLines.toLocaleString('zh-CN') }} 行</b><small>{{ preview.draftCharacters.toLocaleString('zh-CN') }} 字符 · {{ preview.draftChanged ? '相对上次保存有修改' : '未修改' }}</small></article>
          <article :class="{ changed: preview.diskChanged }"><span>磁盘版本</span><b>{{ preview.diskLines.toLocaleString('zh-CN') }} 行</b><small>{{ preview.diskCharacters.toLocaleString('zh-CN') }} 字符 · {{ preview.diskChanged ? '由其他程序更新' : '与上次保存一致' }}</small></article>
          <article class="recommended"><span>安全建议</span><b>保留两份</b><small>先把当前草稿存为独立副本，再载入磁盘版本。</small></article>
        </div>

        <section class="external-conflict-diff" aria-label="首个变化附近的行差异">
          <header><div><b>第 {{ preview.firstChangedLine.toLocaleString('zh-CN') }} 行附近</b><small>{{ preview.truncated ? '有界预览 · 不加载整篇差异' : '完整差异' }}</small></div><span><i></i>草稿删除 <i></i>磁盘新增</span></header>
          <div role="list" tabindex="0">
            <p v-for="(line, index) in preview.lines" :key="`${index}:${line.leftLine}:${line.rightLine}`" :class="line.kind" role="listitem"><span>{{ line.leftLine ?? '' }}</span><span>{{ line.rightLine ?? '' }}</span><b>{{ line.kind === 'added' ? '+' : line.kind === 'removed' ? '−' : ' ' }}</b><code>{{ line.text || ' ' }}</code></p>
          </div>
        </section>

        <p v-if="error" class="external-conflict-error" role="alert"><AppIcon name="warning" :size="13" />{{ error }}</p>
        <footer>
          <button ref="stayButton" class="quiet-button" :disabled="busy" @click="emit('decision', 'stay')">继续编辑</button>
          <button class="quiet-button destructive" :disabled="busy" @click="emit('decision', 'use-disk')">使用磁盘版本</button>
          <button class="quiet-button destructive" :disabled="busy" @click="emit('decision', 'overwrite-disk')">用草稿覆盖磁盘</button>
          <button class="primary-button" :disabled="busy" @click="emit('decision', 'keep-both')">{{ busy ? '正在安全处理…' : '保留两份（推荐）' }}</button>
        </footer>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.external-conflict-backdrop{position:fixed;inset:0;z-index:var(--z-global-modal);display:grid;place-items:center;padding:20px;background:var(--line-strong);backdrop-filter:blur(3px)}
.external-conflict-dialog{display:grid;width:min(940px,calc(100vw - 40px));max-height:calc(100vh - 40px);gap:14px;overflow:hidden;padding:20px;border:1px solid var(--accent-soft);border-radius:16px;color:var(--text);background:linear-gradient(145deg,var(--surface),var(--surface-2));box-shadow:0 28px 90px var(--accent-soft)}
.external-conflict-dialog>header{display:grid;grid-template-columns:42px minmax(0,1fr);gap:13px}.external-conflict-dialog>header>span{display:grid;width:40px;height:40px;place-items:center;border:1px solid var(--warn-soft);border-radius:11px;color:var(--warn);background:var(--surface-2)}.external-conflict-dialog .eyebrow{color:var(--warn)}.external-conflict-dialog h3{margin:5px 0 0;color:var(--accent);font:720 20px/1.25 var(--font-display);letter-spacing:-.02em}.external-conflict-dialog>header p:last-child{margin-top:6px;color:var(--fg-2);font:11px/1.6 var(--font-ui)}
.external-conflict-summary{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}.external-conflict-summary article{display:grid;gap:4px;min-width:0;padding:11px 12px;border:1px solid var(--accent-soft);border-radius:10px;background:var(--surface-2)}.external-conflict-summary span{color:var(--fg-2);font:700 11px var(--font-mono);letter-spacing:.05em}.external-conflict-summary b{color:var(--fg);font:700 13px var(--font-ui)}.external-conflict-summary small{color:var(--fg-2);font:11px/1.45 var(--font-ui)}.external-conflict-summary article.changed{border-color:var(--warn-soft);background:var(--surface-2)}.external-conflict-summary article.recommended{border-color:var(--accent-soft);background:var(--surface-2)}.external-conflict-summary article.recommended b{color:var(--accent)}
.external-conflict-diff{display:grid;min-height:180px;overflow:hidden;border:1px solid var(--accent-soft);border-radius:11px;background:var(--surface)}.external-conflict-diff>header{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:9px 12px;border-bottom:1px solid var(--accent-soft);background:var(--surface-2)}.external-conflict-diff>header div{display:flex;align-items:baseline;gap:8px}.external-conflict-diff>header b{color:var(--fg);font:700 11px var(--font-ui)}.external-conflict-diff>header small,.external-conflict-diff>header span{color:var(--fg-2);font:11px var(--font-mono)}.external-conflict-diff>header span{display:flex;align-items:center;gap:5px}.external-conflict-diff>header i{width:7px;height:7px;border-radius:2px;background:var(--surface-3)}.external-conflict-diff>header i:last-of-type{margin-left:5px;background:var(--surface-2)}.external-conflict-diff>div{max-height:min(330px,42vh);overflow:auto;scrollbar-gutter:stable}.external-conflict-diff p{display:grid;min-height:24px;grid-template-columns:42px 42px 24px minmax(0,1fr);margin:0;border-bottom:1px solid var(--accent-soft);color:var(--fg);background:var(--surface);font:11px/1.55 var(--font-mono)}.external-conflict-diff p>span{padding:4px 7px;color:var(--fg-3);background:var(--surface-2);text-align:right}.external-conflict-diff p>b{padding:4px 5px;color:var(--fg-3);text-align:center}.external-conflict-diff code{overflow-wrap:anywhere;padding:4px 8px;white-space:pre-wrap}.external-conflict-diff p.removed{background:var(--surface-2)}.external-conflict-diff p.removed>b{color:var(--danger)}.external-conflict-diff p.added{background:var(--surface-2)}.external-conflict-diff p.added>b{color:var(--accent)}
.external-conflict-error{display:flex;align-items:center;gap:7px;margin:0;padding:8px 10px;border:1px solid var(--danger-soft);border-radius:8px;color:var(--danger);background:var(--danger-soft);font:11px/1.45 var(--font-ui)}
.external-conflict-dialog>footer{display:flex;flex-wrap:wrap;justify-content:flex-end;gap:7px;padding-top:13px;border-top:1px solid var(--accent-soft)}.external-conflict-dialog>footer button{min-height:35px}.external-conflict-dialog .destructive{color:var(--danger);border-color:var(--danger-soft)}.external-conflict-dialog .destructive:hover,.external-conflict-dialog .destructive:focus-visible{border-color:var(--danger);background:var(--danger-soft)}
@media(max-width:760px){.external-conflict-summary{grid-template-columns:1fr}.external-conflict-dialog{width:calc(100vw - 24px);max-height:calc(100vh - 24px);padding:14px}.external-conflict-diff>header span{display:none}.external-conflict-dialog>footer{justify-content:stretch}.external-conflict-dialog>footer button{flex:1 1 42%}}
@media(prefers-reduced-motion:reduce){.external-conflict-backdrop{backdrop-filter:none}}
</style>
