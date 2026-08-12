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
    <div class="vault-restore-review-backdrop" @keydown.esc.prevent="!busy && emit('cancel')">
      <section class="vault-restore-review" role="alertdialog" aria-modal="true" aria-labelledby="vault-restore-review-title" aria-describedby="vault-restore-review-description" :aria-busy="busy">
        <header>
          <span aria-hidden="true"><AppIcon name="shield" :size="20" /></span>
          <div><p>恢复前确认</p><h3 id="vault-restore-review-title">归档已通过只读检查</h3><small id="vault-restore-review-description">确认内容规模与版本后再替换当前资料库。此页面尚未修改任何 Vault 文件。</small></div>
          <b>可恢复</b>
        </header>

        <section class="vault-restore-review__archive" aria-label="所选归档">
          <div><span>所选归档</span><b :title="inspection.archiveName">{{ inspection.archiveName }}</b><small>{{ inspection.modifiedAt ? new Date(inspection.modifiedAt).toLocaleString('zh-CN') : '修改时间不可用' }}</small></div>
          <dl><div><dt>ZIP 大小</dt><dd>{{ formatBytes(inspection.archiveSize) }}</dd></div><div><dt>展开大小</dt><dd>{{ formatBytes(inspection.uncompressedSize) }}</dd></div><div><dt>文件</dt><dd>{{ inspection.fileCount.toLocaleString('zh-CN') }}</dd></div><div><dt>Schema</dt><dd>v{{ inspection.schemaVersion }}</dd></div></dl>
        </section>

        <div class="vault-restore-review__comparison">
          <article class="current">
            <header><span>当前 Vault</span><small>将被替换</small></header>
            <strong>{{ current?.documentCount.toLocaleString('zh-CN') ?? '—' }}<small>篇文档</small></strong>
            <p v-if="current">{{ current.noteCount }} 笔记 · {{ current.questionCount }} 题目</p><p v-else>当前计数尚不可用</p>
            <p v-if="current">{{ current.vocabularyCount }} 单词 · {{ current.sourceCount }} 资料</p><p v-else>恢复前仍会创建安全归档</p>
          </article>
          <span aria-hidden="true">→</span>
          <article>
            <header><span>归档内容</span><small>恢复后</small></header>
            <strong>{{ inspection.documentCount.toLocaleString('zh-CN') }}<small>篇文档</small></strong>
            <p>{{ inspection.noteCount }} 笔记 · {{ inspection.questionCount }} 题目</p>
            <p>{{ inspection.vocabularyCount }} 单词 · {{ inspection.sourceCount }} 资料</p>
          </article>
        </div>

        <p v-if="fewerContent" class="vault-restore-review__warning" role="alert"><AppIcon name="warning" :size="15" /><span><b>归档内容少于当前资料库</b><small>文档 {{ signed(documentDelta) }}，结构化内容 {{ signed(structuredDelta) }}。确认这是你希望回到的时间点。</small></span></p>

        <section class="vault-restore-review__checks" aria-label="归档检查结果">
          <p><i></i><span><b>SQLite 完整性正常</b><small>quick_check = {{ inspection.integrity }}</small></span></p>
          <p><i></i><span><b>Markdown 正文齐全</b><small>{{ inspection.documentCount }} 条索引均找到对应文件</small></span></p>
          <p><i></i><span><b>版本可兼容</b><small>归档 v{{ inspection.schemaVersion }} · 当前支持 v{{ inspection.latestSchemaVersion }}</small></span></p>
          <p><i></i><span><b>恢复前仍会留后路</b><small>当前 Vault 会先另存为独立安全归档</small></span></p>
        </section>

        <p v-if="error" class="vault-restore-review__error" role="alert"><AppIcon name="warning" :size="14" />{{ error }}</p>

        <footer><button ref="cancelButton" class="quiet-button" :disabled="busy" @click="emit('cancel')">取消，保持当前资料</button><button class="primary-button destructive" :disabled="busy" @click="emit('confirm')">{{ busy ? '正在安全恢复…' : '确认替换并重新载入' }}</button></footer>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.vault-restore-review-backdrop{position:fixed;inset:0;z-index:var(--z-global-modal);display:grid;place-items:center;padding:20px;background:var(--line-strong);backdrop-filter:blur(3px)}
.vault-restore-review{display:grid;width:min(820px,calc(100vw - 40px));max-height:calc(100vh - 40px);gap:13px;overflow:auto;padding:20px;border:1px solid var(--accent-soft);border-radius:16px;color:var(--text);background:linear-gradient(145deg,var(--surface),var(--surface-2));box-shadow:0 28px 90px var(--accent-soft)}
.vault-restore-review>header{display:grid;grid-template-columns:42px minmax(0,1fr) auto;align-items:start;gap:13px}.vault-restore-review>header>span{display:grid;width:40px;height:40px;place-items:center;border:1px solid var(--accent-soft);border-radius:11px;color:var(--accent);background:var(--surface-2)}.vault-restore-review>header p,.vault-restore-review__archive span{color:var(--fg-2);font:700 9px var(--font-mono);letter-spacing:.08em}.vault-restore-review h3{margin:4px 0 0;color:var(--accent);font:720 20px/1.25 var(--font-display);letter-spacing:-.02em}.vault-restore-review>header small{display:block;margin-top:5px;color:var(--fg-2);font:10px/1.55 var(--font-ui)}.vault-restore-review>header>b{padding:5px 8px;border:1px solid var(--accent-soft);border-radius:999px;color:var(--accent);background:var(--surface-2);font:700 9px var(--font-ui)}
.vault-restore-review__archive{display:grid;grid-template-columns:minmax(0,1.4fr) minmax(330px,1fr);align-items:center;gap:14px;padding:11px 12px;border:1px solid var(--accent-soft);border-radius:11px;background:var(--surface-2)}.vault-restore-review__archive>div{display:grid;min-width:0;gap:3px}.vault-restore-review__archive b{overflow:hidden;color:var(--fg);font:700 12px var(--font-ui);text-overflow:ellipsis;white-space:nowrap}.vault-restore-review__archive small{color:var(--fg-2);font:9px var(--font-ui)}.vault-restore-review__archive dl{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:6px;margin:0}.vault-restore-review__archive dl>div{display:grid;gap:3px}.vault-restore-review__archive dt{color:var(--fg-3);font:8px var(--font-mono)}.vault-restore-review__archive dd{margin:0;color:var(--fg);font:700 10px var(--font-ui)}
.vault-restore-review__comparison{display:grid;grid-template-columns:minmax(0,1fr) 28px minmax(0,1fr);align-items:center;gap:8px}.vault-restore-review__comparison>span{color:var(--fg-3);text-align:center}.vault-restore-review__comparison article{display:grid;gap:4px;padding:12px;border:1px solid var(--accent-soft);border-radius:11px;background:var(--surface-2)}.vault-restore-review__comparison article.current{border-color:var(--warn-soft);background:var(--surface-2)}.vault-restore-review__comparison article header{display:flex;justify-content:space-between}.vault-restore-review__comparison article header span{color:var(--fg);font:700 10px var(--font-ui)}.vault-restore-review__comparison article header small,.vault-restore-review__comparison article p{color:var(--fg-2);font:9px/1.4 var(--font-ui)}.vault-restore-review__comparison strong{color:var(--accent);font:760 22px var(--font-display)}.vault-restore-review__comparison article.current strong{color:var(--warn)}.vault-restore-review__comparison strong small{margin-left:5px;font:600 9px var(--font-ui)}.vault-restore-review__comparison p{margin:0}
.vault-restore-review__warning{display:flex;align-items:center;gap:9px;margin:0;padding:9px 10px;border:1px solid var(--danger-soft);border-radius:9px;color:var(--danger);background:var(--surface-2)}.vault-restore-review__warning span{display:grid;gap:2px}.vault-restore-review__warning b{font:700 10px var(--font-ui)}.vault-restore-review__warning small{font:9px/1.4 var(--font-ui)}
.vault-restore-review__checks{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px}.vault-restore-review__checks p{display:grid;grid-template-columns:9px minmax(0,1fr);gap:8px;margin:0;padding:9px 10px;border:1px solid var(--accent-soft);border-radius:9px;background:var(--surface-2)}.vault-restore-review__checks i{width:7px;height:7px;margin-top:3px;border-radius:50%;background:var(--accent);box-shadow:0 0 0 3px var(--accent-soft)}.vault-restore-review__checks span{display:grid;gap:2px}.vault-restore-review__checks b{color:var(--fg);font:700 9.5px var(--font-ui)}.vault-restore-review__checks small{color:var(--fg-2);font:8.5px/1.4 var(--font-ui)}
.vault-restore-review__error{display:flex;align-items:center;gap:8px;margin:0;padding:9px 10px;border:1px solid var(--danger-soft);border-radius:9px;color:var(--danger);background:var(--surface-2);font:10px/1.45 var(--font-ui)}
.vault-restore-review>footer{display:flex;justify-content:flex-end;gap:7px;padding-top:12px;border-top:1px solid var(--accent-soft)}.vault-restore-review>footer button{min-height:36px}.vault-restore-review .destructive{border-color:var(--danger);background:var(--danger)}.vault-restore-review .destructive:hover,.vault-restore-review .destructive:focus-visible{border-color:var(--danger);background:var(--danger)}
@media(max-width:700px){.vault-restore-review{width:calc(100vw - 24px);max-height:calc(100vh - 24px);padding:14px}.vault-restore-review__archive{grid-template-columns:1fr}.vault-restore-review__archive dl{grid-template-columns:repeat(2,1fr)}.vault-restore-review__comparison{grid-template-columns:1fr}.vault-restore-review__comparison>span{transform:rotate(90deg)}.vault-restore-review__checks{grid-template-columns:1fr}.vault-restore-review>footer{flex-wrap:wrap}.vault-restore-review>footer button{flex:1 1 45%}}
@media(prefers-reduced-motion:reduce){.vault-restore-review-backdrop{backdrop-filter:none}}
</style>
