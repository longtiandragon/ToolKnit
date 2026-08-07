<script setup lang="ts">
import { ref } from 'vue'
import { useWorkbenchStore } from '@/stores/workbench'

const store = useWorkbenchStore()
const picked = ref<string[]>([])
const outputName = ref('ToolKnit 导出')
const operation = ref('merge')
const running = ref(false)
const message = ref('选择资料，再决定输出方式。原件永远不会被覆盖。')
const operations = [
  ['merge', 'PDF 合并', '按选择顺序拼接为新文件'], ['split', 'PDF 拆分', '每页或指定区间生成新文件'],
  ['rotate', 'PDF 旋转', '以 90° 为单位生成副本'], ['image-pdf', '图片转 PDF', '按文件顺序组装学习讲义'], ['ocr', '批量 OCR', '输出 Markdown / TXT 草稿'], ['dedupe', '哈希去重', '只列出重复项，不删除原件']
]

function run() {
  if (!picked.value.length) { message.value = '先至少选择一份资料。'; return }
  running.value = true; const job = store.addJob(operation.value === 'ocr' ? 'ocr' : 'batch', `${operations.find((item) => item[0] === operation.value)?.[1]}：${picked.value.length} 份资料`)
  store.updateJob(job.id, { status: 'running', progress: 20 })
  window.setTimeout(() => { store.updateJob(job.id, { status: 'succeeded', progress: 100 }); running.value = false; message.value = `已生成预览任务“${outputName.value}”。桌面端后端接入后会写入资料库 exports 目录。` }, 800)
}
</script>

<template>
  <div class="batch page-enter"><section class="section-heading"><div><p class="eyebrow">SAFE BATCH WORKBENCH</p><h2>批量处理，<em>原件不动。</em></h2><p>每个任务先预览输出清单，发生重名时自动追加序号。</p></div></section><p class="notice">{{ message }}</p>
    <section class="batch-layout"><div class="panel batch-steps"><p class="eyebrow">01 · 选择资料</p><label v-for="source in store.sources.filter((item) => item.kind === 'image' || item.kind === 'pdf')" :key="source.id" class="source-check"><input v-model="picked" :value="source.id" type="checkbox" /><span>{{ source.kind === 'pdf' ? 'PDF' : '图' }}</span>{{ source.name }}</label><div v-if="!store.sources.length" class="empty-strip">先到资料库导入图片或 PDF。</div></div><div class="panel batch-steps"><p class="eyebrow">02 · 选择动作</p><button v-for="item in operations" :key="item[0]" class="operation" :class="{ selected: operation === item[0] }" @click="operation = item[0]"><b>{{ item[1] }}</b><small>{{ item[2] }}</small></button></div><div class="panel batch-steps"><p class="eyebrow">03 · 输出预览</p><label>任务名称<input v-model="outputName" /></label><div class="output-preview"><span>{{ picked.length }} 个输入</span><i>→</i><strong>exports/{{ outputName || '未命名导出' }}</strong></div><button class="primary-button wide" :disabled="running" @click="run">{{ running ? '正在准备…' : '创建安全任务' }}</button></div></section>
  </div>
</template>
