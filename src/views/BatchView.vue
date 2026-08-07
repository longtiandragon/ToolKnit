<script setup lang="ts">
import { ref } from 'vue'
import { PDFDocument, degrees } from 'pdf-lib'
import { useWorkbenchStore } from '@/stores/workbench'
import type { Source } from '@/types'

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

function toArrayBuffer(bytes: Uint8Array) { return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer }
function downloadPdf(name: string, bytes: Uint8Array) { const link = document.createElement('a'); link.href = URL.createObjectURL(new Blob([toArrayBuffer(bytes)], { type: 'application/pdf' })); link.download = name; link.click(); URL.revokeObjectURL(link.href) }
async function bytesOf(source: Source) { if (!source.preview) throw new Error(`“${source.name}”没有可用的浏览器副本。请重新导入。`); return fetch(source.preview).then((response) => response.arrayBuffer()) }
async function jpegOf(source: Source) {
  if (!source.preview) throw new Error(`“${source.name}”没有可用图片数据。`)
  const image = new Image(); image.src = source.preview; await image.decode()
  const canvas = document.createElement('canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight; canvas.getContext('2d')?.drawImage(image, 0, 0)
  return fetch(canvas.toDataURL('image/jpeg', .93)).then((response) => response.arrayBuffer())
}
async function appendSource(output: PDFDocument, source: Source) {
  if (source.kind === 'pdf') { const input = await PDFDocument.load(await bytesOf(source), { ignoreEncryption: false }); const pages = await output.copyPages(input, input.getPageIndices()); pages.forEach((page) => output.addPage(page)); return }
  const image = await output.embedJpg(await jpegOf(source)); const page = output.addPage([image.width, image.height]); page.drawImage(image, { x: 0, y: 0, width: image.width, height: image.height })
}
async function run() {
  if (!picked.value.length) { message.value = '先至少选择一份资料。'; return }
  running.value = true; const job = store.addJob(operation.value === 'ocr' ? 'ocr' : 'batch', `${operations.find((item) => item[0] === operation.value)?.[1]}：${picked.value.length} 份资料`)
  store.updateJob(job.id, { status: 'running', progress: 20 })
  try {
    const sources = store.sources.filter((source) => picked.value.includes(source.id))
    if (operation.value === 'dedupe') { const groups = new Map<string, Source[]>(); sources.forEach((source) => groups.set(source.sha256 ?? source.id, [...(groups.get(source.sha256 ?? source.id) ?? []), source])); const duplicates = [...groups.values()].filter((group) => group.length > 1); const report = duplicates.length ? duplicates.map((group) => group.map((source) => source.name).join('  =  ')).join('\n') : '没有发现重复资料。'; const link = document.createElement('a'); link.href = URL.createObjectURL(new Blob([report], { type: 'text/plain' })); link.download = `${outputName.value || 'toolknit'}-dedupe-report.txt`; link.click(); URL.revokeObjectURL(link.href); message.value = `去重报告已下载：${duplicates.length} 组重复项。`; }
    else if (operation.value === 'ocr') { throw new Error('批量 OCR 需要可选离线引擎包；请先在设置中安装。') }
    else if (operation.value === 'split') { for (const source of sources.filter((item) => item.kind === 'pdf')) { const input = await PDFDocument.load(await bytesOf(source)); for (const index of input.getPageIndices()) { const one = await PDFDocument.create(); const [page] = await one.copyPages(input, [index]); one.addPage(page); downloadPdf(`${source.name.replace(/\.pdf$/i, '')}-p${index + 1}.pdf`, await one.save()) } } message.value = '已按页下载拆分结果。'; }
    else { const output = await PDFDocument.create(); for (const source of sources) await appendSource(output, source); if (operation.value === 'rotate') output.getPages().forEach((page) => page.setRotation(degrees((page.getRotation().angle + 90) % 360))); downloadPdf(`${outputName.value || 'toolknit-export'}.pdf`, await output.save()); message.value = '新 PDF 已下载，原始资料未被修改。' }
    store.updateJob(job.id, { status: 'succeeded', progress: 100 })
  } catch (error) { store.updateJob(job.id, { status: 'failed', progress: 100, errorCode: 'BATCH_FAILED' }); message.value = error instanceof Error ? error.message : '批处理失败。' }
  finally { running.value = false }
}
</script>

<template>
  <div class="batch page-enter"><section class="section-heading"><div><p class="eyebrow">SAFE BATCH WORKBENCH</p><h2>批量处理，<em>原件不动。</em></h2><p>每个任务先预览输出清单，发生重名时自动追加序号。</p></div></section><p class="notice">{{ message }}</p>
    <section class="batch-layout"><div class="panel batch-steps"><p class="eyebrow">01 · 选择资料</p><label v-for="source in store.sources.filter((item) => item.kind === 'image' || item.kind === 'pdf')" :key="source.id" class="source-check"><input v-model="picked" :value="source.id" type="checkbox" /><span>{{ source.kind === 'pdf' ? 'PDF' : '图' }}</span>{{ source.name }}</label><div v-if="!store.sources.length" class="empty-strip">先到资料库导入图片或 PDF。</div></div><div class="panel batch-steps"><p class="eyebrow">02 · 选择动作</p><button v-for="item in operations" :key="item[0]" class="operation" :class="{ selected: operation === item[0] }" @click="operation = item[0]"><b>{{ item[1] }}</b><small>{{ item[2] }}</small></button></div><div class="panel batch-steps"><p class="eyebrow">03 · 输出预览</p><label>任务名称<input v-model="outputName" /></label><div class="output-preview"><span>{{ picked.length }} 个输入</span><i>→</i><strong>exports/{{ outputName || '未命名导出' }}</strong></div><button class="primary-button wide" :disabled="running" @click="run">{{ running ? '正在准备…' : '创建安全任务' }}</button></div></section>
  </div>
</template>
