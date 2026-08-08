<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { convertNumberBase, convertTimestamp, decodeBase64, decodeJwt, decodeUrl, diffLines, encodeBase64, encodeUrl, generateUuids, sha256, testRegex, transformJson, type DiffLine, type RegexMatch, type TimestampResult } from '@/lib/developer-tools'
import AppIcon from '@/components/AppIcon.vue'

type DeveloperToolId = 'base64' | 'url' | 'json' | 'jwt' | 'hash' | 'uuid' | 'timestamp' | 'radix' | 'regex' | 'diff'

const route = useRoute()
const router = useRouter()
const tools: { id: DeveloperToolId; icon: string; title: string; description: string }[] = [
  { id: 'base64', icon: 'code', title: 'Base64', description: 'Unicode 文本编码与解码' },
  { id: 'url', icon: 'link', title: 'URL 编解码', description: '处理查询参数与特殊字符' },
  { id: 'json', icon: 'json', title: 'JSON', description: '格式化、压缩与语法检查' },
  { id: 'jwt', icon: 'shield', title: 'JWT 查看器', description: '读取 Header 与 Payload' },
  { id: 'hash', icon: 'hash', title: 'SHA-256', description: '生成文本内容指纹' },
  { id: 'uuid', icon: 'fingerprint', title: 'UUID', description: '批量生成 UUID v4' },
  { id: 'timestamp', icon: 'clock', title: '时间戳', description: '秒、毫秒与日期互转' },
  { id: 'radix', icon: 'binary', title: '进制转换', description: '2 到 36 进制整数互转' },
  { id: 'regex', icon: 'regex', title: '正则测试', description: '查看匹配位置和捕获组' },
  { id: 'diff', icon: 'diff', title: '文本 Diff', description: '逐行比较两份文本' }
]

const tool = ref<DeveloperToolId>('base64')
const direction = ref<'encode' | 'decode'>('encode')
const input = ref('')
const secondaryInput = ref('')
const pattern = ref('')
const flags = ref('gi')
const jsonCompact = ref(false)
const uuidCount = ref(5)
const fromBase = ref(10)
const toBase = ref(16)
const output = ref('')
const timestampResult = ref<TimestampResult>()
const regexMatches = ref<RegexMatch[]>([])
const diffResult = ref<DiffLine[]>([])
const error = ref('')
const message = ref('所有内容只在当前窗口处理，不会发送到网络。')
const running = ref(false)
const processed = ref(false)

const activeTool = computed(() => tools.find((item) => item.id === tool.value)!)
const hasOutput = computed(() => processed.value)
const copyValue = computed(() => {
  if (output.value) return output.value
  if (timestampResult.value) return JSON.stringify(timestampResult.value, null, 2)
  if (regexMatches.value.length) return JSON.stringify(regexMatches.value, null, 2)
  if (diffResult.value.length) return diffResult.value.map((line) => `${line.kind === 'added' ? '+' : line.kind === 'removed' ? '-' : ' '} ${line.text}`).join('\n')
  return ''
})

function resetResult() {
  output.value = ''
  timestampResult.value = undefined
  regexMatches.value = []
  diffResult.value = []
  error.value = ''
  processed.value = false
}

function selectTool(id: DeveloperToolId) {
  router.push({ path: '/developer-tools', query: { tool: id } })
}

function swapTransform() {
  if (output.value) {
    input.value = output.value
    output.value = ''
  }
  direction.value = direction.value === 'encode' ? 'decode' : 'encode'
}

async function run() {
  resetResult()
  running.value = true
  try {
    if (tool.value === 'base64') output.value = direction.value === 'encode' ? encodeBase64(input.value) : decodeBase64(input.value)
    else if (tool.value === 'url') output.value = direction.value === 'encode' ? encodeUrl(input.value) : decodeUrl(input.value)
    else if (tool.value === 'json') output.value = transformJson(input.value, jsonCompact.value)
    else if (tool.value === 'jwt') output.value = JSON.stringify(decodeJwt(input.value), null, 2)
    else if (tool.value === 'hash') output.value = await sha256(input.value)
    else if (tool.value === 'uuid') output.value = generateUuids(uuidCount.value)
    else if (tool.value === 'timestamp') timestampResult.value = convertTimestamp(input.value)
    else if (tool.value === 'radix') output.value = convertNumberBase(input.value, fromBase.value, toBase.value)
    else if (tool.value === 'regex') regexMatches.value = testRegex(pattern.value, flags.value, input.value)
    else diffResult.value = diffLines(input.value, secondaryInput.value)
    processed.value = true
    message.value = tool.value === 'regex' ? `完成：找到 ${regexMatches.value.length} 个匹配。` : tool.value === 'diff' ? `完成：比较了 ${diffResult.value.length} 行结果。` : '处理完成，可以复制结果。'
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : '处理失败，请检查输入。'
  } finally {
    running.value = false
  }
}

async function copyResult() {
  if (!copyValue.value) return
  try {
    await navigator.clipboard.writeText(copyValue.value)
    message.value = '结果已复制到剪贴板。'
  } catch {
    error.value = '无法访问剪贴板，请手动选择结果复制。'
  }
}

watch(() => route.query.tool, (requested) => {
  const next = typeof requested === 'string' && tools.some((item) => item.id === requested) ? requested as DeveloperToolId : 'base64'
  tool.value = next
  resetResult()
  message.value = `已打开${tools.find((item) => item.id === next)?.title}，内容只在本地处理。`
}, { immediate: true })
</script>

<template>
  <div class="developer-tools page-enter">
    <section class="page-heading developer-heading">
      <div><p class="eyebrow">LOCAL DATA WORKBENCH</p><h2>输入一段数据，<em>立刻看见结构。</em></h2><p>编码、校验、匹配和比较都在本地完成；输入不会进入资料库或网络请求。</p></div>
      <span><b>{{ tools.length }}</b> 个即时工具</span>
    </section>

    <section class="developer-shell">
      <aside class="developer-nav" aria-label="开发者工具">
        <p class="eyebrow">选择工具</p>
        <button v-for="item in tools" :key="item.id" :class="{ active: tool === item.id }" @click="selectTool(item.id)">
          <b><AppIcon :name="item.icon" :size="16" /></b><span><strong>{{ item.title }}</strong><small>{{ item.description }}</small></span>
        </button>
      </aside>

      <main class="developer-workspace">
        <header>
          <div><p class="eyebrow developer-current"><AppIcon :name="activeTool.icon" :size="13" /> CURRENT TOOL</p><h3>{{ activeTool.title }}</h3><span>{{ activeTool.description }}</span></div>
          <div v-if="tool === 'base64' || tool === 'url'" class="direction-switch" aria-label="转换方向">
            <button :class="{ active: direction === 'encode' }" @click="direction = 'encode'">编码</button><button :class="{ active: direction === 'decode' }" @click="direction = 'decode'">解码</button>
          </div>
          <div v-else-if="tool === 'json'" class="direction-switch" aria-label="JSON 输出样式">
            <button :class="{ active: !jsonCompact }" @click="jsonCompact = false">格式化</button><button :class="{ active: jsonCompact }" @click="jsonCompact = true">压缩</button>
          </div>
        </header>

        <section class="developer-inputs" :class="{ 'is-diff': tool === 'diff' }">
          <label v-if="tool === 'regex'" class="regex-pattern">正则表达式<div><input v-model="pattern" name="regex-pattern" spellcheck="false" placeholder="例如：(Tool\\w+)" /><input v-model="flags" name="regex-flags" spellcheck="false" aria-label="正则标志" placeholder="gi" /></div></label>
          <div v-if="tool === 'uuid'" class="developer-inline-fields"><label>生成数量<input v-model.number="uuidCount" name="uuid-count" type="number" min="1" max="100" /></label><p>使用系统密码学随机数生成 UUID v4，一次最多生成 100 个。</p></div>
          <div v-else-if="tool === 'radix'" class="developer-inline-fields"><label>源进制<input v-model.number="fromBase" name="from-base" type="number" min="2" max="36" /></label><label>目标进制<input v-model.number="toBase" name="to-base" type="number" min="2" max="36" /></label></div>
          <label v-if="tool !== 'uuid'">{{ tool === 'diff' ? '原始文本' : tool === 'timestamp' ? '时间戳或日期' : tool === 'regex' ? '待匹配文本' : tool === 'jwt' ? 'JWT Token' : tool === 'radix' ? '待转换整数' : '输入' }}
            <textarea v-model="input" name="developer-input" spellcheck="false" :placeholder="tool === 'timestamp' ? '例如：1723046400 或 2026-08-08T12:00:00+08:00…' : tool === 'json' ? '粘贴 JSON 内容…' : tool === 'jwt' ? '粘贴 eyJ... 格式的 Token…' : tool === 'radix' ? '例如：65535 或 FF_FF…' : '粘贴或输入内容…'"></textarea>
          </label>
          <label v-if="tool === 'diff'">修改后文本<textarea v-model="secondaryInput" name="developer-secondary-input" spellcheck="false" placeholder="粘贴修改后的内容…"></textarea></label>
          <p v-if="tool === 'jwt'" class="developer-warning">这里只解码 Token，不验证签名，也不代表 Token 可信。</p>
        </section>

        <div class="developer-runbar">
          <span aria-live="polite">{{ error || message }}</span>
          <div><button v-if="(tool === 'base64' || tool === 'url') && hasOutput" class="quiet-button" @click="swapTransform">交换并反向</button><button class="run-tool" :disabled="running" @click="run">{{ running ? '处理中…' : tool === 'uuid' ? '生成 UUID' : '执行处理' }}</button></div>
        </div>

        <section class="developer-output" :class="{ empty: !hasOutput && !error }">
          <header><div><p class="eyebrow">RESULT</p><h3>结果</h3></div><button v-if="copyValue" class="quiet-button" @click="copyResult">复制结果</button></header>
          <textarea v-if="hasOutput && ['base64', 'url', 'json', 'jwt', 'hash', 'uuid', 'radix'].includes(tool)" :value="output" readonly aria-label="处理结果"></textarea>
          <div v-else-if="timestampResult" class="timestamp-grid"><article><span>秒</span><b>{{ timestampResult.seconds }}</b></article><article><span>毫秒</span><b>{{ timestampResult.milliseconds }}</b></article><article><span>ISO 8601</span><b>{{ timestampResult.iso }}</b></article><article><span>本地时间</span><b>{{ timestampResult.local }}</b></article></div>
          <div v-else-if="tool === 'regex' && hasOutput" class="regex-results"><article v-for="(match, index) in regexMatches" :key="`${match.index}-${index}`"><span>#{{ index + 1 }} · 索引 {{ match.index }}</span><b>{{ match.value || '空匹配' }}</b><small v-if="match.groups.length">捕获组：{{ match.groups.join(' · ') }}</small></article><div v-if="!regexMatches.length" class="no-match">没有找到匹配项。</div></div>
          <div v-else-if="tool === 'diff' && hasOutput" class="diff-results"><div v-for="(line, index) in diffResult" :key="index" :class="line.kind"><span>{{ line.leftLine ?? '' }}</span><span>{{ line.rightLine ?? '' }}</span><b>{{ line.kind === 'added' ? '+' : line.kind === 'removed' ? '−' : ' ' }}</b><code>{{ line.text || ' ' }}</code></div></div>
          <div v-else class="developer-empty"><b>{{ error ? '输入需要调整' : '等待处理' }}</b><span>{{ error || '输入内容并点击“执行处理”，结果会显示在这里。' }}</span></div>
        </section>
      </main>
    </section>
  </div>
</template>
