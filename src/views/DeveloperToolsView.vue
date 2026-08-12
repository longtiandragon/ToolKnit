<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { calculateDateDifference, calculateDateOffset, convertNumberBase, convertTimestamp, decodeBase64, decodeJwt, decodeUrl, diffLines, encodeBase64, encodeUrl, generateUuids, sha256, testRegex, transformJson, type DateDifferenceResult, type DateOffsetResult, type DateOffsetUnit, type DiffLine, type RegexMatch, type TimestampResult } from '@/lib/developer-tools'
import { decodeQrImage, generateQrCode } from '@/lib/qr-tools'
import { clampMenuPosition, isContextMenuShortcut, nextMenuItemIndex } from '@/lib/desktop-menu'
import AppIcon from '@/components/AppIcon.vue'
import PageHeader from '@/components/PageHeader.vue'
import { useWorkbenchStore } from '@/stores/workbench'

type DeveloperToolId = 'qrcode' | 'datecalc' | 'base64' | 'url' | 'json' | 'jwt' | 'hash' | 'uuid' | 'timestamp' | 'radix' | 'regex' | 'diff'

const route = useRoute()
const router = useRouter()
const store = useWorkbenchStore()
const tools: { id: DeveloperToolId; icon: string; title: string; description: string }[] = [
  { id: 'qrcode', icon: 'qr-code', title: '二维码', description: '生成或识别二维码图片' },
  { id: 'datecalc', icon: 'calendar', title: '日期计算', description: '间隔天数与日期偏移' },
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
const input = ref(store.consumeIntakeText())
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
const qrMode = ref<'generate' | 'scan'>('generate')
const qrSize = ref(360)
const qrFile = ref<File>()
const qrDataUrl = ref('')
const dateMode = ref<'difference' | 'offset'>('difference')
const today = new Date()
const localToday = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
const dateStart = ref(localToday)
const dateEnd = ref(localToday)
const dateAmount = ref(7)
const dateUnit = ref<DateOffsetUnit>('days')
const dateDifference = ref<DateDifferenceResult>()
const dateOffset = ref<DateOffsetResult>()
const error = ref('')
const message = ref('所有内容只在当前窗口处理，不会发送到网络。')
const running = ref(false)
const processed = ref(false)
const resultMenu = ref<{ x: number; y: number; selection: string }>()
const resultMenuElement = ref<HTMLElement>()
let resultMenuTrigger: HTMLElement | undefined

const activeTool = computed(() => tools.find((item) => item.id === tool.value)!)
const hasOutput = computed(() => processed.value)
const copyValue = computed(() => {
  if (output.value) return output.value
  if (timestampResult.value) return JSON.stringify(timestampResult.value, null, 2)
  if (regexMatches.value.length) return JSON.stringify(regexMatches.value, null, 2)
  if (diffResult.value.length) return diffResult.value.map((line) => `${line.kind === 'added' ? '+' : line.kind === 'removed' ? '-' : ' '} ${line.text}`).join('\n')
  if (qrDataUrl.value) return input.value.trim()
  if (dateDifference.value) return `${dateDifference.value.start} 到 ${dateDifference.value.end}：${dateDifference.value.days} 天（${dateDifference.value.weeks} 周 ${dateDifference.value.remainingDays} 天）。口径：不计起始日，计入到达日；同一天为 0 天。`
  if (dateOffset.value) return `${dateOffset.value.date} ${dateOffset.value.weekday}。口径：偏移 0 天为基准日，偏移 1 天为次日。`
  return ''
})
const resultClipboardText = computed(() => copyValue.value || error.value)
const canReuseResultAsInput = computed(() => Boolean(output.value))

function resetResult() {
  output.value = ''
  timestampResult.value = undefined
  regexMatches.value = []
  diffResult.value = []
  qrDataUrl.value = ''
  dateDifference.value = undefined
  dateOffset.value = undefined
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
    else if (tool.value === 'diff') diffResult.value = diffLines(input.value, secondaryInput.value)
    else if (tool.value === 'qrcode') {
      if (qrMode.value === 'generate') qrDataUrl.value = await generateQrCode(input.value, { size: qrSize.value })
      else {
        if (!qrFile.value) throw new Error('请选择包含二维码的图片。')
        output.value = await decodeQrImage(qrFile.value)
      }
    } else if (dateMode.value === 'difference') dateDifference.value = calculateDateDifference(dateStart.value, dateEnd.value)
    else dateOffset.value = calculateDateOffset(dateStart.value, dateAmount.value, dateUnit.value)
    processed.value = true
    message.value = tool.value === 'regex' ? `完成：找到 ${regexMatches.value.length} 个匹配。` : tool.value === 'diff' ? `完成：比较了 ${diffResult.value.length} 行结果。` : tool.value === 'qrcode' ? (qrMode.value === 'generate' ? '二维码已生成，可以下载 PNG 或复制原始内容。' : '二维码识别完成，可以复制结果。') : '处理完成，可以复制结果。'
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : '处理失败，请检查输入。'
  } finally {
    running.value = false
  }
}

function chooseQrImage(event: Event) {
  qrFile.value = (event.target as HTMLInputElement).files?.[0]
  resetResult()
  if (qrFile.value) message.value = `已选择“${qrFile.value.name}”，点击执行后在本机识别。`
}

function downloadQr() {
  if (!qrDataUrl.value) return
  const anchor = document.createElement('a')
  anchor.href = qrDataUrl.value
  anchor.download = 'knitspace-qrcode.png'
  anchor.click()
  message.value = '二维码 PNG 已开始下载。'
}

async function copyResult(value = resultClipboardText.value) {
  if (!value) return
  try {
    await navigator.clipboard.writeText(value)
    message.value = '结果已复制到剪贴板。'
  } catch {
    error.value = '无法访问剪贴板，请手动选择结果复制。'
  }
}

function resultSelection(target: EventTarget | null) {
  if (target instanceof HTMLTextAreaElement) {
    return target.value.slice(target.selectionStart, target.selectionEnd).trim()
  }
  return window.getSelection()?.toString().trim() ?? ''
}

function closeResultMenu(restoreFocus = false) {
  resultMenu.value = undefined
  if (restoreFocus) resultMenuTrigger?.focus({ preventScroll: true })
}

function showResultMenu(trigger: HTMLElement, x: number, y: number, selection = '') {
  if (!hasOutput.value && !error.value) return
  resultMenuTrigger = trigger
  resultMenu.value = {
    selection,
    ...clampMenuPosition(x, y, { menuWidth: 214, menuHeight: canReuseResultAsInput.value ? 164 : 128 }),
  }
  void nextTick(() => resultMenuElement.value?.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')?.focus())
}

function openResultMenu(event: MouseEvent) {
  event.preventDefault()
  showResultMenu(event.currentTarget as HTMLElement, event.clientX, event.clientY, resultSelection(event.target))
}

function openResultMenuFromKeyboard(event: KeyboardEvent) {
  if (!isContextMenuShortcut(event)) return
  event.preventDefault()
  const trigger = event.currentTarget as HTMLElement
  const bounds = trigger.getBoundingClientRect()
  showResultMenu(trigger, bounds.right - 214, bounds.top + 42)
}

async function copyFromResultMenu() {
  const selection = resultMenu.value?.selection
  await copyResult(selection || resultClipboardText.value)
  closeResultMenu()
}

function reuseResultAsInput() {
  if (!output.value) return
  input.value = output.value
  resetResult()
  message.value = '已把结果放回输入区，可以继续处理。'
  closeResultMenu()
}

function clearResultFromMenu() {
  resetResult()
  message.value = '已清空本次结果，输入内容仍保留。'
  closeResultMenu()
}

function handleResultMenuKeydown(event: KeyboardEvent) {
  const items = [...(resultMenuElement.value?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? [])]
  if (event.key === 'Escape') {
    event.preventDefault()
    closeResultMenu(true)
    return
  }
  const nextIndex = nextMenuItemIndex(event.key, items.indexOf(document.activeElement as HTMLButtonElement), items.length)
  if (nextIndex === undefined) return
  event.preventDefault()
  items[nextIndex]?.focus()
}

function closeResultMenuOnWindow() { closeResultMenu() }

watch(() => route.query.tool, (requested) => {
  const next = typeof requested === 'string' && tools.some((item) => item.id === requested) ? requested as DeveloperToolId : 'base64'
  tool.value = next
  resetResult()
  message.value = `已打开${tools.find((item) => item.id === next)?.title}，内容只在本地处理。`
}, { immediate: true })

onMounted(() => {
  window.addEventListener('click', closeResultMenuOnWindow)
  window.addEventListener('blur', closeResultMenuOnWindow)
})

onBeforeUnmount(() => {
  window.removeEventListener('click', closeResultMenuOnWindow)
  window.removeEventListener('blur', closeResultMenuOnWindow)
})
</script>

<template>
  <div class="developer-tools page-enter mx-auto w-full max-w-320 px-8 py-6">
    <PageHeader
      title="开发者工具"
      subtitle="编解码、哈希、正则与结构校验,边输入边出结果"
      :stats="[{ label: '即时工具', value: tools.length }]"
    />

    <section class="developer-shell">
      <aside class="developer-nav" aria-label="开发者工具">
        <p class="eyebrow">选择工具</p>
        <button v-for="item in tools" :key="item.id" :class="{ active: tool === item.id }" @click="selectTool(item.id)">
          <b><AppIcon :name="item.icon" :size="16" /></b><span><strong>{{ item.title }}</strong><small>{{ item.description }}</small></span>
        </button>
      </aside>

      <main class="developer-workspace">
        <header>
          <div><p class="eyebrow developer-current"><AppIcon :name="activeTool.icon" :size="13" /> 当前工具</p><h3>{{ activeTool.title }}</h3><span>{{ activeTool.description }}</span></div>
          <div v-if="tool === 'base64' || tool === 'url'" class="direction-switch" aria-label="转换方向">
            <button :class="{ active: direction === 'encode' }" @click="direction = 'encode'">编码</button><button :class="{ active: direction === 'decode' }" @click="direction = 'decode'">解码</button>
          </div>
          <div v-else-if="tool === 'json'" class="direction-switch" aria-label="JSON 输出样式">
            <button :class="{ active: !jsonCompact }" @click="jsonCompact = false">格式化</button><button :class="{ active: jsonCompact }" @click="jsonCompact = true">压缩</button>
          </div>
          <div v-else-if="tool === 'qrcode'" class="direction-switch" aria-label="二维码操作">
            <button :class="{ active: qrMode === 'generate' }" @click="qrMode = 'generate'; resetResult()">生成</button><button :class="{ active: qrMode === 'scan' }" @click="qrMode = 'scan'; resetResult()">识别图片</button>
          </div>
          <div v-else-if="tool === 'datecalc'" class="direction-switch" aria-label="日期计算方式">
            <button :class="{ active: dateMode === 'difference' }" @click="dateMode = 'difference'; resetResult()">日期间隔</button><button :class="{ active: dateMode === 'offset' }" @click="dateMode = 'offset'; resetResult()">日期偏移</button>
          </div>
        </header>

        <section class="developer-inputs" :class="{ 'is-diff': tool === 'diff' }">
          <label v-if="tool === 'regex'" class="regex-pattern">正则表达式<div><input v-model="pattern" name="regex-pattern" spellcheck="false" placeholder="例如：(Tool\\w+)" /><input v-model="flags" name="regex-flags" spellcheck="false" aria-label="正则标志" placeholder="gi" /></div></label>
          <div v-if="tool === 'uuid'" class="developer-inline-fields"><label>生成数量<input v-model.number="uuidCount" name="uuid-count" type="number" min="1" max="100" /></label><p>使用系统密码学随机数生成 UUID v4，一次最多生成 100 个。</p></div>
          <div v-else-if="tool === 'radix'" class="developer-inline-fields"><label>源进制<input v-model.number="fromBase" name="from-base" type="number" min="2" max="36" /></label><label>目标进制<input v-model.number="toBase" name="to-base" type="number" min="2" max="36" /></label></div>
          <template v-else-if="tool === 'qrcode'">
            <label v-if="qrMode === 'generate'">二维码内容<textarea v-model="input" name="qr-content" maxlength="2000" spellcheck="false" placeholder="输入网址、文字、Wi-Fi 信息或联系方式…"></textarea></label>
            <div v-if="qrMode === 'generate'" class="developer-inline-fields"><label>图片尺寸<input v-model.number="qrSize" type="number" min="160" max="1200" step="20" /></label><p>生成标准 PNG，内容仅在当前窗口转换。</p></div>
            <label v-else class="qr-file-picker"><span>二维码图片</span><input type="file" accept="image/png,image/jpeg,image/webp" @change="chooseQrImage" /><b><AppIcon name="image" :size="18"/>{{ qrFile?.name || '选择 PNG、JPG 或 WebP' }}</b><small>最大 30 MB；较大的图片会缩小后在本机识别。</small></label>
          </template>
          <template v-else-if="tool === 'datecalc'">
            <div v-if="dateMode === 'difference'" class="date-fields"><label>开始日期<input v-model="dateStart" type="date" /></label><label>结束日期<input v-model="dateEnd" type="date" /></label></div>
            <div v-else class="date-fields"><label>基准日期<input v-model="dateStart" type="date" /></label><label>偏移数量<input v-model.number="dateAmount" type="number" min="-100000" max="100000" /></label><label>单位<select v-model="dateUnit"><option value="days">天</option><option value="weeks">周</option><option value="months">月</option><option value="years">年</option></select></label></div>
            <p v-if="dateMode === 'difference'" class="developer-warning"><b>计算口径：</b>按两个日期零点之间的自然日距离计算，不计起始日、计入到达日；例如 8 月 1 日到 8 月 2 日为 1 天，同一天为 0 天。</p>
            <p v-else class="developer-warning"><b>计算口径：</b>偏移 0 天仍是基准日，偏移 1 天是次日；负数向前计算，按月或按年时自动处理月末和闰年。</p>
          </template>
          <label v-if="tool !== 'uuid' && tool !== 'qrcode' && tool !== 'datecalc'">{{ tool === 'diff' ? '原始文本' : tool === 'timestamp' ? '时间戳或日期' : tool === 'regex' ? '待匹配文本' : tool === 'jwt' ? 'JWT Token' : tool === 'radix' ? '待转换整数' : '输入' }}
            <textarea v-model="input" name="developer-input" spellcheck="false" :placeholder="tool === 'timestamp' ? '例如：1723046400 或 2026-08-08T12:00:00+08:00…' : tool === 'json' ? '粘贴 JSON 内容…' : tool === 'jwt' ? '粘贴 eyJ... 格式的 Token…' : tool === 'radix' ? '例如：65535 或 FF_FF…' : '粘贴或输入内容…'"></textarea>
          </label>
          <label v-if="tool === 'diff'">修改后文本<textarea v-model="secondaryInput" name="developer-secondary-input" spellcheck="false" placeholder="粘贴修改后的内容…"></textarea></label>
          <p v-if="tool === 'jwt'" class="developer-warning">这里只解码 Token，不验证签名，也不代表 Token 可信。</p>
        </section>

        <div class="developer-runbar">
          <span aria-live="polite">{{ error || message }}</span>
          <div><button v-if="(tool === 'base64' || tool === 'url') && hasOutput" class="quiet-button" @click="swapTransform">交换并反向</button><button class="run-tool" :disabled="running" @click="run">{{ running ? '处理中…' : tool === 'uuid' ? '生成 UUID' : tool === 'qrcode' ? (qrMode === 'generate' ? '生成二维码' : '识别二维码') : tool === 'datecalc' ? '计算日期' : '执行处理' }}</button></div>
        </div>

        <section class="developer-output" :class="{ empty: !hasOutput && !error }" tabindex="0" role="region" aria-label="处理结果；按右键、菜单键或 Shift 加 F10 打开结果操作" aria-haspopup="menu" :aria-expanded="Boolean(resultMenu)" @contextmenu.stop="openResultMenu" @keydown="openResultMenuFromKeyboard">
          <header><div><h3>结果</h3></div><span class="developer-output__hint">右键操作</span><button v-if="resultClipboardText" class="quiet-button" @click="() => copyResult()">复制结果</button></header>
          <textarea v-if="hasOutput && ['base64', 'url', 'json', 'jwt', 'hash', 'uuid', 'radix'].includes(tool)" :value="output" readonly aria-label="处理结果"></textarea>
          <div v-else-if="tool === 'qrcode' && hasOutput" class="qr-result">
            <template v-if="qrDataUrl"><div><img :src="qrDataUrl" alt="生成的二维码" /></div><section><b>二维码已就绪</b><p>{{ input.trim() }}</p><button class="primary-button" @click="downloadQr"><AppIcon name="download" :size="15"/>下载 PNG</button></section></template>
            <template v-else><section><b>识别结果</b><p>{{ output }}</p></section></template>
          </div>
          <div v-else-if="tool === 'datecalc' && hasOutput" class="date-result">
            <template v-if="dateDifference"><article><span>间隔天数</span><b>{{ dateDifference.days }}</b><small>天</small></article><article><span>换算为周</span><b>{{ dateDifference.weeks }}</b><small>周 + {{ dateDifference.remainingDays }} 天</small></article><p>{{ dateDifference.direction === 'same' ? '两个日期是同一天' : dateDifference.direction === 'forward' ? '结束日期晚于开始日期' : '结束日期早于开始日期' }}</p><p class="date-boundary-note">不计起始日，计入到达日 · 同一天计 0 天</p></template>
            <template v-else-if="dateOffset"><article><span>计算结果</span><b>{{ dateOffset.date }}</b><small>{{ dateOffset.weekday }}</small></article><p class="date-boundary-note">偏移 0 天 = 基准日 · 偏移 1 天 = 次日</p></template>
          </div>
          <div v-else-if="timestampResult" class="timestamp-grid"><article><span>秒</span><b>{{ timestampResult.seconds }}</b></article><article><span>毫秒</span><b>{{ timestampResult.milliseconds }}</b></article><article><span>ISO 8601</span><b>{{ timestampResult.iso }}</b></article><article><span>本地时间</span><b>{{ timestampResult.local }}</b></article></div>
          <div v-else-if="tool === 'regex' && hasOutput" class="regex-results"><article v-for="(match, index) in regexMatches" :key="`${match.index}-${index}`"><span>#{{ index + 1 }} · 索引 {{ match.index }}</span><b>{{ match.value || '空匹配' }}</b><small v-if="match.groups.length">捕获组：{{ match.groups.join(' · ') }}</small></article><div v-if="!regexMatches.length" class="no-match">没有找到匹配项。</div></div>
          <div v-else-if="tool === 'diff' && hasOutput" class="diff-results"><div v-for="(line, index) in diffResult" :key="index" :class="line.kind"><span>{{ line.leftLine ?? '' }}</span><span>{{ line.rightLine ?? '' }}</span><b>{{ line.kind === 'added' ? '+' : line.kind === 'removed' ? '−' : ' ' }}</b><code>{{ line.text || ' ' }}</code></div></div>
          <div v-else class="developer-empty"><b>{{ error ? '输入需要调整' : '等待处理' }}</b><span>{{ error || '输入内容并点击“执行处理”，结果会显示在这里。' }}</span></div>
        </section>
      </main>
    </section>

    <div v-if="resultMenu" ref="resultMenuElement" class="developer-result-menu" role="menu" aria-label="结果操作" :style="{ left: `${resultMenu.x}px`, top: `${resultMenu.y}px` }" @click.stop @contextmenu.prevent @keydown.stop="handleResultMenuKeydown">
      <p>结果操作</p>
      <button role="menuitem" @click="copyFromResultMenu"><AppIcon name="duplicate" :size="14" />{{ resultMenu.selection ? '复制所选内容' : error ? '复制错误信息' : '复制完整结果' }}</button>
      <button v-if="canReuseResultAsInput" role="menuitem" @click="reuseResultAsInput"><AppIcon name="arrow-right" :size="14" />将结果作为输入</button>
      <button role="menuitem" class="danger" @click="clearResultFromMenu"><AppIcon name="close" :size="14" />清空结果</button>
    </div>
  </div>
</template>
