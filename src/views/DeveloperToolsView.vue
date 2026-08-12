<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { calculateDateDifference, calculateDateOffset, convertNumberBase, convertTimestamp, decodeBase64, decodeJwt, decodeUrl, diffLines, encodeBase64, encodeUrl, generateUuids, sha256, testRegex, transformJson, type DateDifferenceResult, type DateOffsetResult, type DateOffsetUnit, type DiffLine, type RegexMatch, type TimestampResult } from '@/lib/developer-tools'
import { decodeQrImage, generateQrCode } from '@/lib/qr-tools'
import { clampMenuPosition, isContextMenuShortcut, nextMenuItemIndex } from '@/lib/desktop-menu'
import AppIcon from '@/components/AppIcon.vue'
import PageHeader from '@/components/PageHeader.vue'
import FieldRow from '@/components/FieldRow.vue'
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

/**
 * These tools are pure functions over a text box, and they run in
 * microseconds. Making people press 执行处理 to see a Base64 string was
 * asking for a decision the app could just make — and the result panel sat
 * there saying "等待处理" next to a full input box, which reads as broken.
 *
 * The two exceptions genuinely need asking. Regenerating UUIDs on every
 * keystroke would be meaningless, and decoding a QR image is a file-sized
 * amount of work that should not fire while you are still choosing.
 */
const LIVE_TOOLS = new Set<DeveloperToolId>([
  'base64', 'url', 'json', 'jwt', 'hash', 'timestamp', 'radix', 'regex', 'diff', 'datecalc',
])
const isLive = computed(() => LIVE_TOOLS.has(tool.value) || (tool.value === 'qrcode' && qrMode.value === 'generate'))
const hasInput = computed(() => {
  if (tool.value === 'datecalc') return Boolean(dateStart.value)
  if (tool.value === 'diff') return Boolean(input.value.trim() || secondaryInput.value.trim())
  if (tool.value === 'regex') return Boolean(pattern.value && input.value)
  return Boolean(input.value.trim())
})

/** The one control that changes what the active tool does. Four tools have
 *  one; the rest have none, and used to each spell out their own markup. */
type ModeOption = { id: string; label: string }
const modeGroup = computed<{ label: string; options: ModeOption[]; value: string; set: (id: string) => void } | undefined>(() => {
  switch (tool.value) {
    case 'base64':
    case 'url':
      return {
        label: '转换方向',
        options: [{ id: 'encode', label: '编码' }, { id: 'decode', label: '解码' }],
        value: direction.value,
        set: (id) => { direction.value = id as 'encode' | 'decode' },
      }
    case 'json':
      return {
        label: '输出样式',
        options: [{ id: 'pretty', label: '格式化' }, { id: 'compact', label: '压缩' }],
        value: jsonCompact.value ? 'compact' : 'pretty',
        set: (id) => { jsonCompact.value = id === 'compact' },
      }
    case 'qrcode':
      return {
        label: '二维码操作',
        options: [{ id: 'generate', label: '生成' }, { id: 'scan', label: '识别图片' }],
        value: qrMode.value,
        set: (id) => { qrMode.value = id as 'generate' | 'scan'; resetResult() },
      }
    case 'datecalc':
      return {
        label: '计算方式',
        options: [{ id: 'difference', label: '日期间隔' }, { id: 'offset', label: '日期偏移' }],
        value: dateMode.value,
        set: (id) => { dateMode.value = id as 'difference' | 'offset'; resetResult() },
      }
    default:
      return undefined
  }
})

const runLabel = computed(() => tool.value === 'uuid' ? '生成 UUID' : '识别二维码')
/** What the result panel says before there is a result. Generic copy here
 *  ("输入内容并点击执行处理") was wrong for half the tools and unhelpful for
 *  the rest. */
const emptyResultHint = computed(() => {
  switch (tool.value) {
    case 'uuid': return '选好数量后点击生成，每次都会产生一组新的 UUID v4。'
    case 'qrcode': return qrMode.value === 'generate' ? '在左侧输入网址或文字，二维码会即时生成。' : '选择一张含二维码的图片，然后点击识别。'
    case 'regex': return '先写正则表达式，再粘贴待匹配的文本。'
    case 'diff': return '左右两个输入框都填上内容，差异会逐行标出。'
    default: return '在左侧输入内容，结果会随输入即时更新。'
  }
})
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

// Debounced so a fast typist is not running SHA-256 on every keystroke, but
// short enough that the result feels attached to the input.
let liveTimer: ReturnType<typeof setTimeout> | undefined
watch(
  [input, secondaryInput, pattern, flags, jsonCompact, direction, fromBase, toBase,
    dateStart, dateEnd, dateAmount, dateUnit, dateMode, qrSize, qrMode, tool],
  () => {
    clearTimeout(liveTimer)
    if (!isLive.value) return
    if (!hasInput.value) { resetResult(); return }
    liveTimer = setTimeout(() => { void run() }, 200)
  },
  { immediate: true },
)

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
  clearTimeout(liveTimer)
  window.removeEventListener('click', closeResultMenuOnWindow)
  window.removeEventListener('blur', closeResultMenuOnWindow)
})
</script>

<template>
  <div class="page-enter mx-auto w-full max-w-320 px-8 py-6">
    <PageHeader :title="activeTool.title" :subtitle="activeTool.description">
      <template #actions>
        <!-- One segmented control, shared by the four tools that have a mode.
             The rest render nothing here rather than an empty slot. -->
        <div v-if="modeGroup" class="row gap-0.5 p-0.5 rounded-sm bg-surface-2 border border-line" :aria-label="modeGroup.label" role="group">
          <button
            v-for="option in modeGroup.options"
            :key="option.id"
            :aria-pressed="modeGroup.value === option.id"
            class="h-7 px-3 rounded-[4px] text-[12px] transition-colors"
            :class="modeGroup.value === option.id ? 'bg-surface text-fg font-medium shadow-sm' : 'text-fg-3 hover:text-fg'"
            @click="modeGroup.set(option.id)"
          >
            {{ option.label }}
          </button>
        </div>
        <button v-if="!isLive" class="btn-primary" :disabled="running" @click="run">
          {{ running ? '处理中…' : runLabel }}
        </button>
      </template>

      <template #lead>
        <div class="row gap-1 flex-wrap" role="group" aria-label="选择工具">
          <button
            v-for="item in tools"
            :key="item.id"
            :title="item.description"
            :aria-pressed="tool === item.id"
            class="row gap-1.5 h-7 px-2.5 rounded-full text-[12px] transition-colors"
            :class="tool === item.id ? 'bg-accent text-accent-fg font-medium' : 'text-fg-2 hover:bg-surface-2 hover:text-fg'"
            @click="selectTool(item.id)"
          >
            <AppIcon :name="item.icon" :size="13" />{{ item.title }}
          </button>
        </div>
      </template>
    </PageHeader>

    <!--
      Input on the left, result on the right, equal weight. A transform is a
      before-and-after, and the old stacked layout put the two halves of that
      comparison a scroll apart.
    -->
    <div class="grid gap-4 xl:grid-cols-2 min-h-[calc(100vh-var(--titlebar-h)-16rem)]">
      <!-- ── Input ──────────────────────────────────────────────────────── -->
      <section class="pane">
        <header class="pane-head">
          <p class="pane-title">
            {{ tool === 'diff' ? '原始文本'
              : tool === 'timestamp' ? '时间戳或日期'
                : tool === 'regex' ? '待匹配文本'
                  : tool === 'jwt' ? 'JWT Token'
                    : tool === 'radix' ? '待转换整数'
                      : tool === 'qrcode' ? (qrMode === 'generate' ? '二维码内容' : '二维码图片')
                        : tool === 'datecalc' ? '日期' : tool === 'uuid' ? '生成设置' : '输入' }}
          </p>
          <span v-if="input && tool !== 'uuid' && tool !== 'datecalc'" class="text-[11px] text-fg-3 tabular-nums">
            {{ input.length }} 字符
          </span>
        </header>

        <!-- Tools whose input is a set of fields rather than a body of text. -->
        <div v-if="tool === 'uuid'" class="stack gap-4 p-4">
          <FieldRow label="生成数量" hint="使用系统密码学随机数，一次最多 100 个">
            <input v-model.number="uuidCount" name="uuid-count" type="number" min="1" max="100" class="field w-full" />
          </FieldRow>
          <button class="btn-primary w-full" :disabled="running" @click="run">生成 UUID</button>
        </div>

        <div v-else-if="tool === 'datecalc'" class="stack gap-4 p-4">
          <template v-if="dateMode === 'difference'">
            <FieldRow label="开始日期"><input v-model="dateStart" type="date" class="field w-full" /></FieldRow>
            <FieldRow label="结束日期"><input v-model="dateEnd" type="date" class="field w-full" /></FieldRow>
            <p class="text-[12px] text-fg-3 leading-snug">
              按两个日期零点之间的自然日计算：不计起始日、计入到达日。8 月 1 日到 8 月 2 日算 1 天，同一天算 0 天。
            </p>
          </template>
          <template v-else>
            <FieldRow label="基准日期"><input v-model="dateStart" type="date" class="field w-full" /></FieldRow>
            <div class="grid grid-cols-2 gap-3">
              <FieldRow label="偏移数量" hint="负数向前">
                <input v-model.number="dateAmount" type="number" min="-100000" max="100000" class="field w-full" />
              </FieldRow>
              <FieldRow label="单位">
                <select v-model="dateUnit" class="field w-full">
                  <option value="days">天</option>
                  <option value="weeks">周</option>
                  <option value="months">月</option>
                  <option value="years">年</option>
                </select>
              </FieldRow>
            </div>
            <p class="text-[12px] text-fg-3 leading-snug">
              偏移 0 天仍是基准日，偏移 1 天是次日。按月或按年时会自动处理月末与闰年。
            </p>
          </template>
        </div>

        <div v-else-if="tool === 'qrcode' && qrMode === 'scan'" class="stack gap-4 p-4">
          <label class="stack items-center justify-center gap-3 flex-1 min-h-40 px-6 py-8 rounded-md border border-dashed border-line-strong bg-well text-center cursor-pointer hover:border-accent">
            <span class="center w-11 h-11 rounded-lg bg-surface-2 text-fg-3"><AppIcon name="file-image" :size="22" /></span>
            <strong class="text-[13px] text-fg">{{ qrFile?.name || '选择 PNG、JPG 或 WebP' }}</strong>
            <small class="text-[12px] text-fg-3">最大 30 MB；较大的图片会缩小后在本机识别</small>
            <input type="file" accept="image/png,image/jpeg,image/webp" class="hidden" @change="chooseQrImage" />
          </label>
          <button class="btn-primary w-full" :disabled="running || !qrFile" @click="run">识别二维码</button>
        </div>

        <!-- Everything else is a text body, optionally preceded by its own
             fields. -->
        <template v-else>
          <div v-if="tool === 'regex'" class="stack gap-3 p-3 border-b border-line">
            <FieldRow label="正则表达式">
              <div class="row gap-2">
                <input v-model="pattern" name="regex-pattern" spellcheck="false" class="field flex-1 font-mono" placeholder="(Tool\w+)" />
                <input v-model="flags" name="regex-flags" spellcheck="false" aria-label="正则标志" class="field w-20 font-mono" placeholder="gi" />
              </div>
            </FieldRow>
          </div>

          <div v-else-if="tool === 'radix'" class="grid grid-cols-2 gap-3 p-3 border-b border-line">
            <FieldRow label="源进制"><input v-model.number="fromBase" name="from-base" type="number" min="2" max="36" class="field w-full" /></FieldRow>
            <FieldRow label="目标进制"><input v-model.number="toBase" name="to-base" type="number" min="2" max="36" class="field w-full" /></FieldRow>
          </div>

          <div v-else-if="tool === 'qrcode'" class="p-3 border-b border-line">
            <FieldRow label="图片尺寸" hint="生成标准 PNG，内容只在当前窗口转换">
              <template #value>{{ qrSize }} px</template>
              <input v-model.number="qrSize" type="range" min="160" max="1200" step="20" class="w-full accent-accent" />
            </FieldRow>
          </div>

          <textarea
            v-model="input"
            :name="tool === 'qrcode' ? 'qr-content' : 'developer-input'"
            spellcheck="false"
            class="code-area"
            :placeholder="tool === 'timestamp' ? '1723046400 或 2026-08-08T12:00:00+08:00'
              : tool === 'json' ? '粘贴 JSON 内容…'
                : tool === 'jwt' ? '粘贴 eyJ… 格式的 Token'
                  : tool === 'radix' ? '65535 或 FF_FF'
                    : tool === 'qrcode' ? '网址、文字、Wi-Fi 信息或联系方式…'
                      : '粘贴或输入内容…'"
          />

          <template v-if="tool === 'diff'">
            <header class="pane-head border-t border-b-0"><p class="pane-title">修改后文本</p></header>
            <textarea v-model="secondaryInput" name="developer-secondary-input" spellcheck="false" class="code-area" placeholder="粘贴修改后的内容…" />
          </template>

          <p v-if="tool === 'jwt'" class="shrink-0 px-3 py-2 border-t border-line text-[11px] text-warn">
            这里只解码 Token，不验证签名，也不代表 Token 可信。
          </p>
        </template>
      </section>

      <!-- ── Result ─────────────────────────────────────────────────────── -->
      <section
        class="pane"
        tabindex="0"
        role="region"
        aria-label="处理结果；按右键、菜单键或 Shift 加 F10 打开结果操作"
        aria-haspopup="menu"
        :aria-expanded="Boolean(resultMenu)"
        @contextmenu.stop="openResultMenu"
        @keydown="openResultMenuFromKeyboard"
      >
        <header class="pane-head">
          <p class="pane-title row gap-1.5">
            结果
            <span v-if="isLive && hasOutput" class="chip h-5 px-1.5 text-[11px] bg-success-soft text-success">实时</span>
          </p>
          <span class="row gap-1 shrink-0">
            <button v-if="(tool === 'base64' || tool === 'url') && hasOutput" class="btn-ghost btn-sm" @click="swapTransform">
              交换并反向
            </button>
            <button v-if="resultClipboardText" class="btn-ghost btn-sm" @click="() => copyResult()">复制</button>
          </span>
        </header>

        <!-- Failure is a first-class result here, not an empty state with red
             text: a malformed JWT or an unbalanced brace is the answer. -->
        <div v-if="error" class="stack gap-2 flex-1 p-4">
          <p class="row gap-1.5 text-[12px] font-medium text-danger">
            <AppIcon name="warning" :size="14" />输入还不能处理
          </p>
          <p class="font-mono text-[12px] leading-relaxed text-danger break-words">{{ error }}</p>
        </div>

        <textarea
          v-else-if="hasOutput && ['base64', 'url', 'json', 'jwt', 'hash', 'uuid', 'radix'].includes(tool)"
          :value="output"
          readonly
          aria-label="处理结果"
          class="code-area text-fg-2"
        />

        <div v-else-if="tool === 'qrcode' && hasOutput" class="stack gap-4 p-4">
          <template v-if="qrDataUrl">
            <div class="center p-4 rounded-md bg-white">
              <img :src="qrDataUrl" alt="生成的二维码" class="max-w-64 w-full" />
            </div>
            <p class="text-[12px] text-fg-2 break-all">{{ input.trim() }}</p>
            <button class="btn-default w-full" @click="downloadQr"><AppIcon name="download" :size="15" />下载 PNG</button>
          </template>
          <template v-else>
            <p class="eyebrow">识别结果</p>
            <p class="font-mono text-[13px] text-fg break-all">{{ output }}</p>
          </template>
        </div>

        <div v-else-if="tool === 'datecalc' && hasOutput" class="stack gap-3 p-4">
          <template v-if="dateDifference">
            <div class="grid grid-cols-2 gap-px rounded-md bg-line border border-line overflow-hidden">
              <div class="stack gap-0.5 px-4 py-3 bg-surface">
                <span class="text-[12px] text-fg-3">间隔天数</span>
                <b class="text-[24px] font-semibold tabular-nums text-fg">{{ dateDifference.days }}<span class="text-[13px] font-normal text-fg-3 ml-1">天</span></b>
              </div>
              <div class="stack gap-0.5 px-4 py-3 bg-surface">
                <span class="text-[12px] text-fg-3">换算为周</span>
                <b class="text-[24px] font-semibold tabular-nums text-fg">{{ dateDifference.weeks }}<span class="text-[13px] font-normal text-fg-3 ml-1">周 + {{ dateDifference.remainingDays }} 天</span></b>
              </div>
            </div>
            <p class="text-[12px] text-fg-2">
              {{ dateDifference.direction === 'same' ? '两个日期是同一天'
                : dateDifference.direction === 'forward' ? '结束日期晚于开始日期' : '结束日期早于开始日期' }}
            </p>
            <p class="text-[11px] text-fg-3">不计起始日，计入到达日 · 同一天计 0 天</p>
          </template>
          <template v-else-if="dateOffset">
            <div class="stack gap-0.5 px-4 py-3 rounded-md bg-surface-2">
              <span class="text-[12px] text-fg-3">计算结果</span>
              <b class="text-[24px] font-semibold tabular-nums text-fg">{{ dateOffset.date }}</b>
              <span class="text-[13px] text-fg-2">{{ dateOffset.weekday }}</span>
            </div>
            <p class="text-[11px] text-fg-3">偏移 0 天 = 基准日 · 偏移 1 天 = 次日</p>
          </template>
        </div>

        <div v-else-if="timestampResult" class="grid grid-cols-2 gap-px m-4 rounded-md bg-line border border-line overflow-hidden">
          <div v-for="row in [['秒', timestampResult.seconds], ['毫秒', timestampResult.milliseconds], ['ISO 8601', timestampResult.iso], ['本地时间', timestampResult.local]]" :key="row[0]" class="stack gap-0.5 px-3 py-2.5 bg-surface">
            <span class="text-[11px] text-fg-3">{{ row[0] }}</span>
            <b class="font-mono text-[13px] font-normal text-fg break-all">{{ row[1] }}</b>
          </div>
        </div>

        <div v-else-if="tool === 'regex' && hasOutput" class="stack gap-1.5 flex-1 min-h-0 overflow-y-auto p-3">
          <p class="text-[12px] text-fg-3">{{ regexMatches.length ? `找到 ${regexMatches.length} 个匹配` : '没有找到匹配项' }}</p>
          <article v-for="(match, index) in regexMatches" :key="`${match.index}-${index}`" class="stack gap-0.5 px-3 py-2 rounded-sm bg-surface-2">
            <span class="text-[11px] text-fg-3 tabular-nums">#{{ index + 1 }} · 索引 {{ match.index }}</span>
            <b class="font-mono text-[13px] font-normal text-fg break-all">{{ match.value || '空匹配' }}</b>
            <small v-if="match.groups.length" class="text-[11px] text-fg-2">捕获组：{{ match.groups.join(' · ') }}</small>
          </article>
        </div>

        <div v-else-if="tool === 'diff' && hasOutput" class="flex-1 min-h-0 overflow-auto font-mono text-[12px] leading-relaxed">
          <div
            v-for="(line, index) in diffResult"
            :key="index"
            class="grid grid-cols-[3rem_3rem_1.25rem_minmax(0,1fr)] gap-2 px-3 py-0.5"
            :class="line.kind === 'added' ? 'bg-success-soft text-success' : line.kind === 'removed' ? 'bg-danger-soft text-danger' : 'text-fg-3'"
          >
            <span class="text-right tabular-nums opacity-60">{{ line.leftLine ?? '' }}</span>
            <span class="text-right tabular-nums opacity-60">{{ line.rightLine ?? '' }}</span>
            <b class="font-normal">{{ line.kind === 'added' ? '+' : line.kind === 'removed' ? '−' : '' }}</b>
            <code class="whitespace-pre-wrap break-words" :class="line.kind === 'same' ? 'text-fg-2' : ''">{{ line.text || ' ' }}</code>
          </div>
        </div>

        <div v-else class="flex-1 stack items-center justify-center gap-2 p-8 text-center">
          <span class="center w-11 h-11 rounded-lg bg-surface-2 text-fg-3"><AppIcon :name="activeTool.icon" :size="22" /></span>
          <strong class="text-[13px] font-medium text-fg-2">{{ activeTool.title }}</strong>
          <small class="max-w-64 text-[12px] text-fg-3 leading-snug">{{ emptyResultHint }}</small>
        </div>

        <p v-if="hasOutput || error" class="shrink-0 px-3 py-2 border-t border-line text-[11px] text-fg-3" aria-live="polite">
          右键可复制所选内容或把结果放回输入区 · 内容只在本窗口处理
        </p>
      </section>
    </div>

    <Teleport to="body">
      <div
        v-if="resultMenu"
        ref="resultMenuElement"
        class="fixed z-[120] w-54 p-1 rounded-md bg-surface border border-line-strong shadow-lg"
        role="menu"
        aria-label="结果操作"
        :style="{ left: `${resultMenu.x}px`, top: `${resultMenu.y}px` }"
        @click.stop
        @contextmenu.prevent
        @keydown.stop="handleResultMenuKeydown"
      >
        <p class="px-2.5 py-1.5 text-[11px] text-fg-3">结果操作</p>
        <button class="nav-item w-full" role="menuitem" @click="copyFromResultMenu">
          <AppIcon name="duplicate" :size="14" />{{ resultMenu.selection ? '复制所选内容' : error ? '复制错误信息' : '复制完整结果' }}
        </button>
        <button v-if="canReuseResultAsInput" class="nav-item w-full" role="menuitem" @click="reuseResultAsInput">
          <AppIcon name="arrow-right" :size="14" />将结果作为输入
        </button>
        <button class="nav-item w-full hover:bg-danger-soft hover:text-danger" role="menuitem" @click="clearResultFromMenu">
          <AppIcon name="close" :size="14" />清空结果
        </button>
      </div>
    </Teleport>
  </div>
</template>
