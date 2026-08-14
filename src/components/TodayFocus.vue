<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import AppIcon from '@/components/AppIcon.vue'
import { clampMenuPosition, isContextMenuShortcut, nextMenuItemIndex } from '@/lib/desktop-menu'
import { buildFocusLedger } from '@/lib/focus-ledger'
import { deleteDesktopEvent, isDesktop, listDesktopPersonalEvents, saveDesktopEvent } from '@/lib/native'
import { newId } from '@/lib/id'
import type { TimelineEvent } from '@/types'

const BROWSER_EVENTS_KEY = 'knitspace:today-events:v1'
const FOCUS_SESSION_KEY = 'knitspace:focus-session:v1'
const PERSONAL_EVENT_LIMIT = 120
const route = useRoute()
type FocusSessionDraft = {
  durationMinutes: number
  focusTitle: string
  secondsLeft: number
  phase: 'running' | 'paused'
  endsAt: number | null
  startedAt: string
}
const durationMinutes = ref(25)
const focusTitle = ref('算法练习')
const secondsLeft = ref(durationMinutes.value * 60)
const phase = ref<'idle' | 'running' | 'paused'>('idle')
const endsAt = ref<number | null>(null)
const startedAt = ref('')
const events = ref<TimelineEvent[]>([])
const loading = ref(true)
const notice = ref('选择时长后开始；完成记录会保存在本机资料库。')
const anniversaryTitle = ref('')
const anniversaryDate = ref('')
const editingAnniversaryId = ref('')
const menu = ref<{ id: string; x: number; y: number } | null>(null)
const menuElement = ref<HTMLElement>()
const anniversaryTitleInput = ref<HTMLInputElement>()
const focusEntryTitleInput = ref<HTMLInputElement>()
const focusHistoryOpen = ref(false)
const focusHistoryExpanded = ref(false)
const focusEntryOpen = ref(false)
const editingFocusId = ref('')
const focusEntryTitle = ref('')
const focusEntryMinutes = ref(25)
const focusEntryAt = ref('')
let timer: number | undefined
let menuTrigger: HTMLElement | undefined

const elapsedSeconds = computed(() => Math.max(0, durationMinutes.value * 60 - secondsLeft.value))
const timerText = computed(() => `${String(Math.floor(secondsLeft.value / 60)).padStart(2, '0')}:${String(secondsLeft.value % 60).padStart(2, '0')}`)
const timerStatus = computed(() => phase.value === 'running' ? '专注中' : phase.value === 'paused' ? '已暂停' : '准备开始')
const focusSessions = computed(() => events.value.filter((event) => event.type === 'pomodoro'))
const todayFocusSessions = computed(() => focusSessions.value.filter((event) => new Date(event.startsAt).toDateString() === new Date().toDateString()))
const pomodorosToday = computed(() => todayFocusSessions.value.length)
const focusMinutesToday = computed(() => todayFocusSessions.value.reduce((total, event) => total + minutesOf(event), 0))
const visibleFocusSessions = computed(() => focusHistoryExpanded.value ? focusSessions.value : focusSessions.value.slice(0, 4))
const focusLedger = computed(() => buildFocusLedger(focusSessions.value))
const anniversaries = computed(() => events.value
  .filter((event) => event.type === 'anniversary')
  .map((event) => ({ event, title: titleOf(event), days: daysUntil(event.startsAt) }))
  .sort((left, right) => left.days - right.days))
const anniversaryCountLabel = computed(() => `${anniversaries.value.length}${anniversaries.value.length >= PERSONAL_EVENT_LIMIT ? '+' : ''} 项`)
const menuEvent = computed(() => menu.value ? events.value.find((event) => event.id === menu.value?.id) : undefined)

function titleOf(event: TimelineEvent) {
  return typeof event.payload.title === 'string' && event.payload.title.trim() ? event.payload.title : event.type === 'pomodoro' ? '专注记录' : '未命名纪念日'
}

function minutesOf(event: TimelineEvent) {
  const value = Number(event.payload.actualMinutes)
  return Number.isFinite(value) ? Math.max(1, Math.round(value)) : 0
}

function timeOf(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '刚刚' : date.toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function dateInputValue(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function dateTimeInputValue(value = new Date().toISOString()) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}T${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

function daysUntil(value: string) {
  const source = new Date(value)
  if (Number.isNaN(source.getTime())) return 0
  const now = new Date()
  const target = new Date(now.getFullYear(), source.getMonth(), source.getDate())
  target.setHours(0, 0, 0, 0)
  const today = new Date(now)
  today.setHours(0, 0, 0, 0)
  if (target < today) target.setFullYear(target.getFullYear() + 1)
  return Math.round((target.getTime() - today.getTime()) / 86_400_000)
}

function clearTimer() {
  if (timer !== undefined) window.clearInterval(timer)
  timer = undefined
}

function readFocusSession(): FocusSessionDraft | null {
  try {
    const value = JSON.parse(localStorage.getItem(FOCUS_SESSION_KEY) ?? 'null')
    if (!value || !['running', 'paused'].includes(value.phase) || typeof value.startedAt !== 'string') return null
    const duration = Math.max(1, Math.min(180, Math.round(Number(value.durationMinutes))))
    const seconds = Math.max(0, Math.min(duration * 60, Math.round(Number(value.secondsLeft))))
    const ends = value.endsAt === null ? null : Number(value.endsAt)
    if (!Number.isFinite(duration) || !Number.isFinite(seconds) || (ends !== null && !Number.isFinite(ends))) return null
    return { durationMinutes: duration, focusTitle: typeof value.focusTitle === 'string' ? value.focusTitle.slice(0, 80) : '专注', secondsLeft: seconds, phase: value.phase, endsAt: ends, startedAt: value.startedAt }
  } catch { return null }
}

// Persist only interaction boundaries, never each one-second tick. On a
// slower machine this keeps the timer reliable without turning it into I/O.
function writeFocusSession() {
  try {
    if (phase.value === 'idle') localStorage.removeItem(FOCUS_SESSION_KEY)
    else localStorage.setItem(FOCUS_SESSION_KEY, JSON.stringify({ durationMinutes: durationMinutes.value, focusTitle: focusTitle.value, secondsLeft: secondsLeft.value, phase: phase.value, endsAt: endsAt.value, startedAt: startedAt.value } satisfies FocusSessionDraft))
  } catch { /* local browser storage is an optional recovery layer */ }
}

function tick() {
  if (!endsAt.value) return
  secondsLeft.value = Math.max(0, Math.ceil((endsAt.value - Date.now()) / 1000))
  if (secondsLeft.value === 0) {
    clearTimer()
    phase.value = 'idle'
    endsAt.value = null
    void recordPomodoro('completed')
  }
}

function begin() {
  if (phase.value === 'running') return
  if (secondsLeft.value <= 0) secondsLeft.value = durationMinutes.value * 60
  if (!startedAt.value) startedAt.value = new Date().toISOString()
  endsAt.value = Date.now() + secondsLeft.value * 1000
  phase.value = 'running'
  clearTimer()
  timer = window.setInterval(tick, 1000)
  writeFocusSession()
  notice.value = '计时正在本机运行；切换页面后会根据实际结束时间校准。'
}

function pause() {
  if (phase.value !== 'running') return
  tick()
  clearTimer()
  endsAt.value = null
  phase.value = 'paused'
  writeFocusSession()
  notice.value = '已暂停，剩余时间不会继续减少。'
}

function reset(silent = false) {
  clearTimer()
  phase.value = 'idle'
  endsAt.value = null
  startedAt.value = ''
  secondsLeft.value = durationMinutes.value * 60
  writeFocusSession()
  if (!silent) notice.value = '已重置，尚未产生专注记录。'
}

function readBrowserEvents() {
  try {
    const parsed = JSON.parse(localStorage.getItem(BROWSER_EVENTS_KEY) ?? '[]')
    if (!Array.isArray(parsed)) return [] as TimelineEvent[]
    return parsed.filter((event): event is TimelineEvent => event && typeof event.id === 'string' && ['pomodoro', 'anniversary', 'activity'].includes(event.type) && typeof event.startsAt === 'string' && event.payload !== null && typeof event.payload === 'object' && !Array.isArray(event.payload))
  } catch { return [] }
}

function writeBrowserEvents() {
  localStorage.setItem(BROWSER_EVENTS_KEY, JSON.stringify(events.value.slice(0, 80)))
}

async function saveEvent(event: TimelineEvent) {
  if (isDesktop()) await saveDesktopEvent(event)
  const index = events.value.findIndex((item) => item.id === event.id)
  if (index >= 0) events.value.splice(index, 1, event)
  else events.value.unshift(event)
  events.value.sort((left, right) => right.startsAt.localeCompare(left.startsAt))
  if (!isDesktop()) writeBrowserEvents()
}

async function recordPomodoro(status: 'completed' | 'stopped') {
  const minutes = Math.max(1, Math.round((status === 'completed' ? durationMinutes.value * 60 : elapsedSeconds.value) / 60))
  const createdAt = new Date().toISOString()
  const event: TimelineEvent = {
    id: newId(), type: 'pomodoro', startsAt: startedAt.value || createdAt,
    payload: { title: focusTitle.value.trim() || '专注', plannedMinutes: durationMinutes.value, actualMinutes: minutes, status, completedAt: createdAt },
    createdAt, updatedAt: createdAt,
  }
  try {
    await saveEvent(event)
    notice.value = status === 'completed' ? `完成 ${minutes} 分钟专注，已写入本机记录。` : `已记录 ${minutes} 分钟专注。`
  } catch (error) {
    notice.value = error instanceof Error ? error.message : '专注记录暂未保存。'
  } finally {
    reset(true)
  }
}

async function stopAndRecord() {
  if (!startedAt.value || elapsedSeconds.value < 10) { reset(); return }
  clearTimer()
  phase.value = 'idle'
  endsAt.value = null
  await recordPomodoro('stopped')
}

async function addAnniversary() {
  const title = anniversaryTitle.value.trim()
  if (!title || !anniversaryDate.value) { notice.value = '请填写纪念日名称和日期。'; return }
  const createdAt = new Date().toISOString()
  const previous = editingAnniversaryId.value ? events.value.find((event) => event.id === editingAnniversaryId.value) : undefined
  try {
    await saveEvent({
      id: previous?.id ?? newId(), type: 'anniversary', startsAt: new Date(`${anniversaryDate.value}T12:00:00`).toISOString(), payload: { title, recurring: true },
      createdAt: previous?.createdAt ?? createdAt, updatedAt: createdAt,
    })
    const wasEditing = Boolean(previous)
    editingAnniversaryId.value = ''
    anniversaryTitle.value = ''
    anniversaryDate.value = ''
    notice.value = wasEditing ? '纪念日已更新，会继续按每年循环计算。' : '纪念日已写入本机资料库，会按每年循环计算。'
  } catch (error) { notice.value = error instanceof Error ? error.message : '纪念日暂未保存。' }
}

function cancelAnniversaryEdit() {
  editingAnniversaryId.value = ''
  anniversaryTitle.value = ''
  anniversaryDate.value = ''
  notice.value = '已取消编辑。'
}

function editAnniversary(event: TimelineEvent | undefined = menuEvent.value) {
  if (!event || event.type !== 'anniversary') return
  editingAnniversaryId.value = event.id
  anniversaryTitle.value = titleOf(event)
  anniversaryDate.value = dateInputValue(event.startsAt)
  closeMenu()
  notice.value = '正在编辑纪念日；保存后会原位更新本机记录。'
  void nextTick(() => anniversaryTitleInput.value?.focus())
}

function repeatFocusSession(event: TimelineEvent | undefined = menuEvent.value) {
  if (!event || event.type !== 'pomodoro') return
  if (phase.value !== 'idle') {
    notice.value = '请先结束当前专注，再复用历史记录。'
    closeMenu(true)
    return
  }
  focusTitle.value = titleOf(event)
  durationMinutes.value = Math.max(1, Math.min(180, minutesOf(event) || 25))
  secondsLeft.value = durationMinutes.value * 60
  startedAt.value = ''
  closeMenu()
  begin()
  notice.value = `已按“${focusTitle.value}”开始 ${durationMinutes.value} 分钟专注。`
}

function openFocusEntryEditor(event?: TimelineEvent) {
  if (event?.type === 'pomodoro') {
    editingFocusId.value = event.id
    focusEntryTitle.value = titleOf(event)
    focusEntryMinutes.value = minutesOf(event) || 25
    focusEntryAt.value = dateTimeInputValue(event.startsAt)
    notice.value = '正在修改这条时间记录；保存后会原位更新。'
  } else {
    editingFocusId.value = ''
    focusEntryTitle.value = focusTitle.value.trim() || '学习'
    focusEntryMinutes.value = 25
    focusEntryAt.value = dateTimeInputValue()
    notice.value = '补记只保存你确认的名称、开始时间和分钟数。'
  }
  focusHistoryOpen.value = true
  focusEntryOpen.value = true
  closeMenu()
  void nextTick(() => focusEntryTitleInput.value?.focus())
}

function closeFocusEntryEditor() {
  focusEntryOpen.value = false
  editingFocusId.value = ''
}

async function saveFocusEntry() {
  const title = focusEntryTitle.value.trim()
  const minutes = Math.round(Number(focusEntryMinutes.value))
  const started = new Date(focusEntryAt.value)
  if (!title) { notice.value = '请填写这段时间做了什么。'; return }
  if (!Number.isFinite(minutes) || minutes < 1 || minutes > 1_440) { notice.value = '记录时长需要在 1 分钟到 24 小时之间。'; return }
  if (Number.isNaN(started.getTime())) { notice.value = '请选择有效的开始时间。'; return }
  if (started.getTime() > Date.now() + 5 * 60_000) { notice.value = '开始时间不能晚于现在。'; return }

  const previous = editingFocusId.value ? events.value.find((event) => event.id === editingFocusId.value && event.type === 'pomodoro') : undefined
  const updatedAt = new Date().toISOString()
  try {
    await saveEvent({
      id: previous?.id ?? newId(),
      type: 'pomodoro',
      startsAt: started.toISOString(),
      payload: {
        ...previous?.payload,
        title,
        plannedMinutes: previous ? previous.payload.plannedMinutes : minutes,
        actualMinutes: minutes,
        status: previous?.payload.status ?? 'manual',
        completedAt: previous?.payload.completedAt ?? updatedAt,
        manuallyRecorded: previous?.payload.manuallyRecorded ?? !previous,
      },
      createdAt: previous?.createdAt ?? updatedAt,
      updatedAt,
    })
    notice.value = previous ? '时间记录已更新。' : `已补记“${title}”${minutes} 分钟。`
    closeFocusEntryEditor()
  } catch (error) { notice.value = error instanceof Error ? error.message : '时间记录暂未保存。' }
}

async function removeEvent(id: string) {
  try {
    if (isDesktop()) await deleteDesktopEvent(id)
    events.value = events.value.filter((event) => event.id !== id)
    if (!isDesktop()) writeBrowserEvents()
    notice.value = '记录已删除。'
  } catch (error) { notice.value = error instanceof Error ? error.message : '删除失败。' }
  menu.value = null
}

function showMenu(id: string, x: number, y: number, trigger: HTMLElement) {
  const event = events.value.find((item) => item.id === id)
  if (!event) return
  menuTrigger = trigger
  menu.value = { id, ...clampMenuPosition(x, y, { menuWidth: 208, menuHeight: event.type === 'pomodoro' ? 164 : 126 }) }
  void nextTick(() => menuElement.value?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus())
}

function openMenu(event: MouseEvent, id: string) {
  event.preventDefault()
  showMenu(id, event.clientX, event.clientY, event.currentTarget as HTMLElement)
}

function openMenuFromKeyboard(id: string, trigger: HTMLElement) {
  const bounds = trigger.getBoundingClientRect()
  showMenu(id, bounds.right + 6, bounds.top + 6, trigger)
}

function handleRecordKeydown(event: KeyboardEvent, id: string) {
  if (!isContextMenuShortcut(event) && event.key !== 'Enter' && event.key !== ' ') return
  event.preventDefault()
  openMenuFromKeyboard(id, event.currentTarget as HTMLElement)
}

function toggleFocusHistory() {
  focusHistoryOpen.value = !focusHistoryOpen.value
  if (!focusHistoryOpen.value) focusHistoryExpanded.value = false
}

function syncFocusAnchor(hash: string) {
  if (hash !== '#today-focus-ledger') return
  focusHistoryOpen.value = true
  if (route.query.action === 'log-time' && !focusEntryOpen.value) openFocusEntryEditor()
  void nextTick(() => document.getElementById('today-focus-ledger')?.scrollIntoView({ block: 'start', behavior: 'auto' }))
}

function updateDuration() {
  durationMinutes.value = Math.max(1, Math.min(180, Math.round(durationMinutes.value || 25)))
  if (phase.value === 'idle') secondsLeft.value = durationMinutes.value * 60
}

function closeMenu(restoreFocus = false) {
  menu.value = null
  if (restoreFocus) menuTrigger?.focus({ preventScroll: true })
}

function handleMenuKeydown(event: KeyboardEvent) {
  const menuItems = [...(menuElement.value?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [])]
  if (event.key === 'Escape') {
    event.preventDefault()
    closeMenu(true)
    return
  }
  const nextIndex = nextMenuItemIndex(event.key, menuItems.indexOf(document.activeElement as HTMLButtonElement), menuItems.length)
  if (nextIndex === undefined) return
  event.preventDefault()
  menuItems[nextIndex]?.focus()
}

function restoreFocusSession() {
  const draft = readFocusSession()
  if (!draft) return
  durationMinutes.value = draft.durationMinutes
  focusTitle.value = draft.focusTitle
  secondsLeft.value = draft.secondsLeft
  phase.value = draft.phase
  endsAt.value = draft.endsAt
  startedAt.value = draft.startedAt
  if (draft.phase === 'running' && draft.endsAt !== null) {
    if (draft.endsAt <= Date.now()) {
      secondsLeft.value = 0
      phase.value = 'idle'
      endsAt.value = null
      void recordPomodoro('completed')
      return
    }
    tick()
    clearTimer()
    timer = window.setInterval(tick, 1000)
    notice.value = '已恢复进行中的专注；时间已按真实结束时间校准。'
    return
  }
  phase.value = 'paused'
  endsAt.value = null
  notice.value = '已恢复暂停中的专注。'
}

function closeMenuOnOutsideClick() { closeMenu() }
watch(durationMinutes, updateDuration)
watch(() => route.fullPath, () => syncFocusAnchor(route.hash), { immediate: true })
onMounted(async () => {
  try { events.value = isDesktop() ? await listDesktopPersonalEvents(PERSONAL_EVENT_LIMIT) : readBrowserEvents() }
  catch (error) { notice.value = error instanceof Error ? error.message : '时间记录暂时不可读取。' }
  finally { loading.value = false; restoreFocusSession(); syncFocusAnchor(route.hash) }
  window.addEventListener('click', closeMenuOnOutsideClick)
})
onBeforeUnmount(() => { clearTimer(); window.removeEventListener('click', closeMenuOnOutsideClick) })
</script>

<template>
  <!-- Two panels behind one hairline frame: the seams are grid gaps painted
       over `--line`, so the shorter column still reaches the bottom of the row
       instead of leaving the divider hanging. -->
  <section
    class="mt-4 grid grid-cols-1 gap-px overflow-hidden rounded-lg border border-line bg-line lg:grid-cols-[minmax(0,1.32fr)_minmax(300px,0.68fr)]"
    aria-label="专注与纪念日"
    @click="menu = null"
  >
    <!-- ── The timer, and everything the timer produces ──────────────────── -->
    <!-- Four things used to sit in this card at the same visual weight: the
         countdown, a seven-day chart, the session list and the anniversaries.
         Only the countdown is needed every time the page opens, so the ledger
         and its history now live behind one disclosure and the anniversaries
         keep their own column. -->
    <article id="today-focus-timer" class="stack min-w-0 bg-surface">
      <header class="row-between gap-3 px-4 pt-3.5 pb-3">
        <div class="stack gap-0.5 min-w-0">
          <p class="eyebrow">专注时段</p>
          <h3 class="font-display text-[16px] font-semibold tracking-tight text-fg">把下一段时间留给一件事</h3>
        </div>
        <!-- The state is carried by the dot, not by tinting the label: at
             11–12px a coloured word on a coloured pill is the first thing to
             fall under 4.5:1 in light mode. -->
        <span class="chip shrink-0 gap-1.5">
          <i class="block w-1.5 h-1.5 rounded-full" :class="phase === 'running' ? 'bg-success' : phase === 'paused' ? 'bg-warn' : 'bg-fg-3'"></i>{{ timerStatus }}
        </span>
      </header>

      <div class="grid gap-x-5 gap-y-3 px-4 pb-4 grid-cols-1 sm:grid-cols-[auto_minmax(0,1fr)] sm:items-end">
        <div class="stack gap-1 min-w-0">
          <strong
            class="text-[46px] font-semibold leading-none tracking-tight tabular-nums"
            :class="phase === 'running' ? 'text-success' : phase === 'paused' ? 'text-warn' : 'text-fg'"
          >{{ timerText }}</strong>
          <small class="text-[12px] text-fg-3 tabular-nums">今日 {{ pomodorosToday }} 次 · {{ focusMinutesToday }} 分钟</small>
        </div>
        <!-- The minutes box used to be 72px wide with a spin button inside it,
             which cropped "25" to "2". The unit moved into the label instead. -->
        <div class="grid gap-2 grid-cols-[minmax(0,1fr)_96px] items-end">
          <label class="stack gap-1 min-w-0">
            <span class="text-[11px] text-fg-3">这一段做什么</span>
            <input v-model="focusTitle" maxlength="80" placeholder="例如：完成一道动态规划" :disabled="phase !== 'idle'" class="field h-8 w-full min-w-0 text-[12px]" />
          </label>
          <label class="stack gap-1 min-w-0">
            <span class="text-[11px] text-fg-3">时长（分钟）</span>
            <input v-model.number="durationMinutes" type="number" min="1" max="180" :disabled="phase !== 'idle'" class="field h-8 w-full min-w-0 px-2 text-[12px] tabular-nums" />
          </label>
        </div>
      </div>

      <footer class="row gap-2 flex-wrap px-4 py-3 border-t border-line">
        <button class="btn-default" :disabled="phase === 'idle'" @click.stop="reset()">重置</button>
        <button v-if="phase === 'running'" class="btn-default" @click.stop="pause"><AppIcon name="pause" :size="15" />暂停</button>
        <button v-else class="btn-primary" @click.stop="begin"><AppIcon name="play" :size="15" />{{ phase === 'paused' ? '继续' : '开始专注' }}</button>
        <button v-if="phase !== 'idle'" class="btn-default ml-auto" @click.stop="stopAndRecord">结束并记录</button>
      </footer>

      <!-- The ledger toggle was a bare underlined link tucked under the clock.
           It is a disclosure for everything below it, so it sits on the seam
           between the two and keeps the week's total visible while closed. -->
      <button
        class="row-between gap-3 w-full shrink-0 mt-auto px-4 h-9 border-t border-line text-left transition-colors duration-120 hover:bg-surface-2"
        :class="focusHistoryOpen ? 'bg-surface-2' : ''"
        :aria-expanded="focusHistoryOpen"
        @click.stop="toggleFocusHistory"
      >
        <span class="row gap-2 min-w-0">
          <AppIcon name="clock" :size="14" class="shrink-0 text-fg-3" />
          <b class="shrink-0 text-[12px] font-medium text-fg-2">时间账本</b>
          <small class="text-[11px] text-fg-3 tabular-nums truncate">本周 {{ focusLedger.totalMinutes }} 分钟 · {{ focusLedger.sessionCount }} 段</small>
        </span>
        <AppIcon name="chevron" :size="13" class="shrink-0 text-fg-3 transition-transform duration-150" :class="focusHistoryOpen ? 'rotate-90' : ''" />
      </button>

      <section v-if="focusHistoryOpen" id="today-focus-ledger" class="stack gap-3 shrink-0 px-4 py-3 border-t border-line bg-surface-2" aria-label="最近七天时间账本">
        <header class="row-between gap-3">
          <div class="flex items-baseline gap-2 min-w-0">
            <b class="shrink-0 text-[13px] font-medium text-fg">最近 7 天</b>
            <small class="text-[11px] text-fg-3 tabular-nums truncate">{{ focusLedger.sessionCount }} 段 · {{ focusLedger.totalMinutes }} 分钟</small>
          </div>
          <button type="button" class="btn-default btn-sm shrink-0" @click.stop="openFocusEntryEditor()"><AppIcon name="plus" :size="13" />补记时间</button>
        </header>

        <!-- Each day is a recessed track with the bar drawn inside it, so a
             zero-minute day still reads as a day rather than as missing data.
             The height stays on the inline style — it is the datum. -->
        <div class="grid grid-cols-7 gap-1.5" role="list" aria-label="最近七天专注分钟数">
          <span v-for="day in focusLedger.days" :key="day.key" role="listitem" class="stack items-center gap-1 min-w-0" :aria-label="`${day.fullLabel}，${day.minutes} 分钟`">
            <i class="flex items-end w-full max-w-14 h-16 rounded-sm overflow-hidden bg-well border" :class="day.isToday ? 'border-accent' : 'border-line'">
              <b class="block w-full rounded-sm bg-accent transition-[height] duration-200" :style="{ height: `${day.percent}%` }"></b>
            </i>
            <small class="w-full text-[11px] text-center truncate" :class="day.isToday ? 'font-semibold text-accent' : 'text-fg-3'">{{ day.label }}</small>
            <em class="text-[11px] not-italic tabular-nums" :class="day.minutes ? 'text-fg-2' : 'text-fg-3'">{{ day.minutes || '·' }}</em>
          </span>
        </div>

        <form
          v-if="focusEntryOpen"
          class="grid gap-2 p-2.5 rounded-md bg-surface border sm:grid-cols-[minmax(120px,1fr)_76px_minmax(176px,0.9fr)_auto] sm:items-end"
          :class="editingFocusId ? 'border-accent' : 'border-line'"
          @submit.prevent="saveFocusEntry"
        >
          <label class="stack gap-1 min-w-0"><span class="text-[11px] text-fg-3">做了什么</span><input ref="focusEntryTitleInput" v-model="focusEntryTitle" maxlength="80" placeholder="例如：整理操作系统笔记" class="field h-8 w-full min-w-0 text-[12px]" /></label>
          <label class="stack gap-1 min-w-0"><span class="text-[11px] text-fg-3">分钟</span><input v-model.number="focusEntryMinutes" type="number" min="1" max="1440" inputmode="numeric" class="field h-8 w-full min-w-0 px-2 text-[12px] tabular-nums" /></label>
          <label class="stack gap-1 min-w-0"><span class="text-[11px] text-fg-3">开始时间</span><input v-model="focusEntryAt" type="datetime-local" class="field h-8 w-full min-w-0 px-2 text-[12px]" /></label>
          <div class="row gap-1.5"><button type="button" class="btn-default btn-sm" @click="closeFocusEntryEditor">取消</button><button type="submit" class="btn-primary btn-sm">{{ editingFocusId ? '保存修改' : '写入账本' }}</button></div>
        </form>
      </section>

      <ul v-if="focusHistoryOpen && focusSessions.length" class="stack shrink-0 m-0 px-0 max-h-60 overflow-y-auto border-t border-line bg-surface-2" aria-label="最近专注记录">
        <li v-for="event in visibleFocusSessions" :key="event.id" v-memo="[event.id, event.startsAt, event.updatedAt, event.payload]" tabindex="0" role="button" aria-haspopup="menu" :aria-expanded="menu?.id === event.id" :aria-label="`${titleOf(event)}，${minutesOf(event)} 分钟。按菜单键打开操作。`" class="row-between gap-3 shrink-0 h-8.5 px-4 border-b border-line last:border-b-0 cursor-context-menu transition-colors duration-120 hover:bg-surface-3" @contextmenu.stop="openMenu($event, event.id)" @keydown="handleRecordKeydown($event, event.id)"><span class="flex items-baseline gap-2 min-w-0"><b class="text-[12px] font-medium text-fg-2 truncate">{{ titleOf(event) }}</b><small class="shrink-0 text-[11px] text-fg-3">{{ timeOf(event.startsAt) }}</small></span><strong class="shrink-0 text-[12px] font-medium text-fg tabular-nums">{{ minutesOf(event) }} 分钟</strong></li>
      </ul>
      <p v-else-if="focusHistoryOpen" class="shrink-0 px-4 py-3 border-t border-line bg-surface-2 text-[12px] leading-relaxed text-fg-3">还没有时间记录。开始一次专注，或补记刚完成的学习。</p>
      <button v-if="focusHistoryOpen && focusSessions.length > 4" class="center w-full shrink-0 h-8 px-4 border-t border-line bg-surface-2 text-[12px] text-fg-2 transition-colors duration-120 hover:bg-surface-3 hover:text-fg" :aria-expanded="focusHistoryExpanded" @click.stop="focusHistoryExpanded = !focusHistoryExpanded">{{ focusHistoryExpanded ? '只看最近 4 条' : `查看更早记录 · ${focusSessions.length - 4}${focusSessions.length >= PERSONAL_EVENT_LIMIT ? '+' : ''}` }}</button>
    </article>

    <!-- ── Anniversaries ─────────────────────────────────────────────────── -->
    <article id="today-anniversaries" class="stack min-w-0 bg-surface">
      <header class="row-between gap-3 px-4 pt-3.5 pb-3">
        <div class="stack gap-0.5 min-w-0">
          <p class="eyebrow">纪念日</p>
          <h3 class="font-display text-[16px] font-semibold tracking-tight text-fg">每年循环的重要日期</h3>
        </div>
        <span class="shrink-0 text-[11px] text-fg-3 tabular-nums">{{ loading ? '读取中' : anniversaryCountLabel }}</span>
      </header>

      <!-- Name over date rather than three cells in a row: this column can be
           300px wide, and a 125px date input next to a 34px icon button left
           the name with barely enough room for four characters. -->
      <form class="stack gap-2 shrink-0 px-4 pb-3" @submit.prevent="addAnniversary">
        <input ref="anniversaryTitleInput" v-model="anniversaryTitle" maxlength="80" aria-label="纪念日名称" :placeholder="editingAnniversaryId ? '修改纪念日名称' : '例如：开始学算法'" class="field h-8 w-full min-w-0 text-[12px]" :class="editingAnniversaryId ? 'border-accent' : ''" />
        <div class="row gap-2">
          <input v-model="anniversaryDate" type="date" aria-label="纪念日日期" class="field h-8 flex-1 min-w-0 px-2 text-[12px]" :class="editingAnniversaryId ? 'border-accent' : ''" />
          <button v-if="editingAnniversaryId" class="btn-default btn-sm shrink-0" type="button" @click="cancelAnniversaryEdit">取消</button>
          <button class="btn-primary btn-sm shrink-0" :aria-label="editingAnniversaryId ? '保存纪念日修改' : '添加纪念日'" :title="editingAnniversaryId ? '保存修改' : '添加纪念日'"><AppIcon :name="editingAnniversaryId ? 'calendar' : 'plus'" :size="14" />{{ editingAnniversaryId ? '保存' : '添加' }}</button>
        </div>
      </form>

      <ul v-if="anniversaries.length" class="stack gap-0.5 flex-1 min-h-0 m-0 px-2.5 pb-3 overflow-y-auto">
        <li v-for="item in anniversaries" :key="item.event.id" v-memo="[item.event.id, item.event.startsAt, item.event.updatedAt, item.event.payload]" tabindex="0" role="button" aria-haspopup="menu" :aria-expanded="menu?.id === item.event.id" :aria-label="`${item.title}，${item.days === 0 ? '今天' : `${item.days} 天后`}。按菜单键打开操作。`" class="row-between gap-2.5 shrink-0 min-h-10 px-1.5 py-1 rounded-sm cursor-context-menu transition-colors duration-120 hover:bg-surface-2" @contextmenu.stop="openMenu($event, item.event.id)" @keydown="handleRecordKeydown($event, item.event.id)"><div class="stack gap-0.5 min-w-0"><b class="text-[13px] font-medium text-fg truncate">{{ item.title }}</b><small class="text-[11px] text-fg-3 tabular-nums">{{ dateInputValue(item.event.startsAt) }} · 每年</small></div><strong class="shrink-0 text-[12px] font-medium tabular-nums" :class="item.days === 0 ? 'text-accent' : 'text-fg-2'">{{ item.days === 0 ? '今天' : `${item.days} 天后` }}</strong></li>
      </ul>
      <p v-else class="px-4 pb-4 text-[12px] leading-relaxed text-fg-3">在这里记住对你重要的日期。</p>
    </article>

    <p class="row gap-2 px-4 py-2.5 bg-surface-2 text-[12px] leading-relaxed text-fg-2 lg:col-span-2">
      <AppIcon name="shield" :size="14" class="shrink-0 text-accent" />{{ notice }}
    </p>

    <!-- The workspace column clips its overflow, so a menu positioned against
         the viewport has to leave the card to be seen at all. -->
    <Teleport to="body">
      <menu v-if="menu && menuEvent" ref="menuElement" class="menu-panel w-52 m-0 px-0 list-none" role="menu" :aria-label="`${menuEvent.type === 'pomodoro' ? '专注记录' : '纪念日'}操作`" :style="{ left: `${menu.x}px`, top: `${menu.y}px` }" @click.stop @contextmenu.prevent @keydown.stop="handleMenuKeydown">
        <p class="menu-title">{{ menuEvent.type === 'pomodoro' ? '专注记录' : '纪念日' }}</p>
        <button v-if="menuEvent.type === 'pomodoro'" class="menu-item" role="menuitem" @click="repeatFocusSession()">用相同配置再专注一次</button>
        <button v-if="menuEvent.type === 'pomodoro'" class="menu-item" role="menuitem" @click="openFocusEntryEditor(menuEvent)">修改名称、时间和时长</button>
        <button v-else class="menu-item" role="menuitem" @click="editAnniversary()">编辑纪念日</button>
        <button role="menuitem" class="menu-item menu-item-danger" @click="removeEvent(menuEvent.id)">删除这条记录</button>
      </menu>
    </Teleport>
  </section>
</template>
