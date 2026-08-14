<script setup lang="ts">
import { computed, nextTick, onMounted, ref, shallowRef } from 'vue'
import { useRouter } from 'vue-router'
import AppIcon from '@/components/AppIcon.vue'
import PageHeader from '@/components/PageHeader.vue'
import SectionCard from '@/components/SectionCard.vue'
import { clampMenuPosition, isContextMenuShortcut, nextMenuItemIndex } from '@/lib/desktop-menu'
import { buildLabCapabilityCards, type LabCapabilityCard } from '@/lib/lab-capabilities'
import { getDesktopVaultHealth, getDesktopVaultStorageSpace, getMediaEngineStatus, isDesktop, probeDesktopOcr, type DesktopOcrCapability, type DesktopStorageSpace, type DesktopVaultHealth, type MediaEngineStatus } from '@/lib/native'
import { useUiStore } from '@/stores/ui'
import { useWorkbenchStore } from '@/stores/workbench'

type ResearchItem = {
  id: string
  icon: string
  title: string
  description: string
  boundary: string
  to: string
  actionLabel: string
}
type MenuTarget = { id: string; title: string; detail: string; to: string; actionLabel: string; refreshable?: boolean }

const desktop = isDesktop()
const router = useRouter()
const store = useWorkbenchStore()
const ui = useUiStore()
const vaultHealth = shallowRef<DesktopVaultHealth>()
const storageSpace = shallowRef<DesktopStorageSpace>()
const mediaStatus = shallowRef<MediaEngineStatus>()
const ocrStatus = shallowRef<DesktopOcrCapability>()
const vaultError = ref('')
const storageError = ref('')
const mediaError = ref('')
const ocrError = ref('')
const checking = ref(false)
const checkedAt = ref<Date>()
const menu = ref<{ target: MenuTarget; x: number; y: number } | null>(null)
const menuElement = ref<HTMLElement>()
let menuTrigger: HTMLElement | undefined

const cards = computed(() => buildLabCapabilityCards({
  desktop,
  vault: vaultHealth.value,
  vaultError: vaultError.value,
  storage: storageSpace.value,
  storageError: storageError.value,
  media: mediaStatus.value,
  mediaError: mediaError.value,
  ocr: ocrStatus.value ? { available: ocrStatus.value.available, languageCount: ocrStatus.value.languages.length, defaultLanguage: ocrStatus.value.defaultLanguage, detail: ocrStatus.value.detail } : undefined,
  ocrError: ocrError.value,
  outputDirectory: store.settings.outputDirectory,
  transcriptionConfigured: Boolean(store.settings.transcriptionExecutablePath && store.settings.transcriptionModelPath),
  aiProfileCount: store.aiProfiles.length,
  clipboardEnabled: store.settings.clipboardEnabled,
  clipboardPaused: store.settings.clipboardPaused,
}))
const readyCount = computed(() => cards.value.filter((card) => card.status === 'ready').length)
const attentionCount = computed(() => cards.value.filter((card) => card.status === 'attention').length)
const statusSummary = computed(() => checking.value ? '正在检查本机能力' : attentionCount.value ? `${attentionCount.value} 项需要处理` : '本机能力状态正常')
const checkedAtLabel = computed(() => checkedAt.value ? `最近检查 ${checkedAt.value.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}` : '打开页面后只检查一次')

const researchItems: ResearchItem[] = []

async function refreshChecks() {
  if (checking.value) return
  if (!desktop) {
    vaultError.value = '本机诊断仅在 Knitspace 桌面版运行。'
    storageError.value = '磁盘空间探针仅在 Knitspace 桌面版运行。'
    mediaError.value = '本机媒体探针仅在桌面版运行。'
    ocrError.value = 'Windows OCR 探针仅在桌面版运行。'
    checkedAt.value = new Date()
    return
  }
  checking.value = true
  vaultError.value = ''
  storageError.value = ''
  mediaError.value = ''
  ocrError.value = ''
  const [vault, storage, media, ocr] = await Promise.allSettled([getDesktopVaultHealth(), getDesktopVaultStorageSpace(), getMediaEngineStatus(), probeDesktopOcr()])
  if (vault.status === 'fulfilled' && vault.value) vaultHealth.value = vault.value
  else {
    vaultHealth.value = undefined
    vaultError.value = vault.status === 'rejected' && vault.reason instanceof Error ? vault.reason.message : '无法读取 Vault 健康状态。'
  }
  if (storage.status === 'fulfilled' && storage.value) storageSpace.value = storage.value
  else {
    storageSpace.value = undefined
    storageError.value = storage.status === 'rejected' && storage.reason instanceof Error ? storage.reason.message : '无法读取 Vault 磁盘空间。'
  }
  if (media.status === 'fulfilled') mediaStatus.value = media.value
  else {
    mediaStatus.value = undefined
    mediaError.value = media.reason instanceof Error ? media.reason.message : '无法检查本机媒体引擎。'
  }
  if (ocr.status === 'fulfilled') ocrStatus.value = ocr.value
  else {
    ocrStatus.value = undefined
    ocrError.value = ocr.reason instanceof Error ? ocr.reason.message : '无法检查 Windows OCR。'
  }
  checkedAt.value = new Date()
  checking.value = false
}

function statusIcon(status: LabCapabilityCard['status']) {
  return status === 'ready' ? 'shield' : status === 'checking' ? 'refresh' : status === 'attention' ? 'warning' : 'pause'
}
function closeMenu(restoreFocus = false) {
  menu.value = null
  if (restoreFocus) void nextTick(() => menuTrigger?.focus({ preventScroll: true }))
}
function showMenu(event: MouseEvent | KeyboardEvent, target: MenuTarget) {
  event.preventDefault()
  event.stopPropagation()
  menuTrigger = event.currentTarget instanceof HTMLElement ? event.currentTarget : undefined
  const bounds = menuTrigger?.getBoundingClientRect()
  const x = 'clientX' in event && event.clientX ? event.clientX : (bounds?.left ?? 16) + 42
  const y = 'clientY' in event && event.clientY ? event.clientY : (bounds?.top ?? 16) + 42
  menu.value = { target, ...clampMenuPosition(x, y, { menuWidth: 272, menuHeight: target.refreshable ? 162 : 126, margin: 12 }) }
  void nextTick(() => menuElement.value?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus())
}
function showMenuFromKeyboard(event: KeyboardEvent, target: MenuTarget) {
  if (isContextMenuShortcut(event)) showMenu(event, target)
}
function handleMenuKeydown(event: KeyboardEvent) {
  const items = [...(menuElement.value?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [])]
  if (event.key === 'Escape') { event.preventDefault(); closeMenu(true); return }
  const index = nextMenuItemIndex(event.key, items.indexOf(document.activeElement as HTMLButtonElement), items.length)
  if (index === undefined) return
  event.preventDefault()
  items[index]?.focus({ preventScroll: true })
}
async function openTarget(target: MenuTarget) {
  closeMenu()
  await router.push(target.to)
}
async function copyTarget(target: MenuTarget) {
  try {
    await navigator.clipboard.writeText(`${target.title}\n${target.detail}`)
    ui.toast('诊断信息已复制', target.title, 'success')
  } catch (error) {
    ui.toast('复制失败', error instanceof Error ? error.message : '系统剪贴板暂时不可用。', 'error')
  }
  closeMenu()
}
async function copyAllDiagnostics() {
  try {
    const text = [`Knitspace 本机能力 · ${new Date().toLocaleString('zh-CN')}`, ...cards.value.map((card) => `${card.title}：${card.statusLabel}｜${card.detail}`)].join('\n')
    await navigator.clipboard.writeText(text)
    ui.toast('本机能力摘要已复制', '只包含当前页面显示的诊断，不包含笔记正文或密钥。', 'success')
  } catch (error) {
    ui.toast('复制失败', error instanceof Error ? error.message : '系统剪贴板暂时不可用。', 'error')
  }
}

onMounted(() => { void refreshChecks() })
</script>

<template>
  <div class="page-enter mx-auto w-full max-w-320 px-8 py-6" @click="closeMenu()">
    <PageHeader
      title="本机能力"
      subtitle="看看这台机器上哪些能力已经就绪,哪些还需要装东西"
      :stats="[
        { label: '已就绪', value: `${readyCount} / ${cards.length}` },
        { label: '需要处理', value: attentionCount, tone: attentionCount ? 'warn' : undefined },
        { label: '上次检查', value: checkedAtLabel },
      ]"
    >
      <template #actions>
        <button class="btn-primary" :disabled="checking" @click.stop="refreshChecks">
          <AppIcon name="refresh" :size="15" />{{ checking ? '检查中…' : '重新检查' }}
        </button>
      </template>
    </PageHeader>

    <!-- Left click enters the workflow, right click explains why it is or is
         not ready. Both are stated once here instead of on every card. -->
    <SectionCard title="本机能力状态" hint="左键进入工作流 · 右键或 Shift+F10 查看诊断">
      <div class="grid gap-2.5 grid-cols-1 sm:grid-cols-2 xl:grid-cols-3" aria-label="本机能力状态" :aria-busy="checking">
        <RouterLink
          v-for="card in cards"
          :key="card.id"
          :to="card.to"
          class="group stack gap-3 p-4 rounded-md border bg-surface-2 transition-colors"
          :class="card.status === 'attention' ? 'border-warn' : 'border-line hover:border-accent'"
          aria-haspopup="menu"
          :aria-expanded="menu?.target.id === card.id"
          :aria-label="`${card.title}：${card.statusLabel}；点击进入工作流，右键可打开诊断菜单`"
          @contextmenu="showMenu($event, { ...card, refreshable: card.id === 'vault' || card.id === 'media' })"
          @keydown="showMenuFromKeyboard($event, { ...card, refreshable: card.id === 'vault' || card.id === 'media' })"
        >
          <header class="row-between gap-2">
            <span class="center w-9 h-9 rounded-sm bg-surface text-fg-2 shrink-0 group-hover:text-accent">
              <AppIcon :name="card.icon" :size="18" />
            </span>
            <i
              class="row gap-1 h-6 px-2 rounded-full text-[11px] not-italic shrink-0"
              :class="card.status === 'ready' ? 'bg-success-soft text-success'
                : card.status === 'attention' ? 'bg-danger-soft text-danger'
                  : 'bg-warn-soft text-warn'"
            >
              <AppIcon :name="statusIcon(card.status)" :size="12" />{{ card.statusLabel }}
            </i>
          </header>
          <div class="stack gap-1 flex-1">
            <h4 class="text-[15px] font-semibold text-fg">{{ card.title }}</h4>
            <p class="text-[12px] leading-snug text-fg-3">{{ card.description }}</p>
            <small class="text-[11px] text-fg-2 truncate" :title="card.detail">{{ card.detail }}</small>
          </div>
          <footer class="row-between gap-2 pt-2.5 border-t border-line text-[12px] text-fg-2 group-hover:text-accent">
            {{ card.actionLabel }}<AppIcon name="arrow-right" :size="14" />
          </footer>
        </RouterLink>
      </div>
    </SectionCard>

    <SectionCard
      v-if="researchItems.length"
      class="mt-4"
      title="尚未接入的能力"
      hint="卡片只说明边界，并带你去当前可靠的替代流程"
    >
      <div class="grid gap-2.5 grid-cols-1 sm:grid-cols-2 xl:grid-cols-3" aria-label="尚未接入的实验能力">
        <article
          v-for="item in researchItems"
          :key="item.id"
          tabindex="0"
          class="stack gap-2 p-4 rounded-md border border-dashed border-line-strong bg-surface-2"
          aria-haspopup="menu"
          :aria-expanded="menu?.target.id === item.id"
          @contextmenu="showMenu($event, { ...item, detail: item.boundary })"
          @keydown="showMenuFromKeyboard($event, { ...item, detail: item.boundary })"
        >
          <header class="row-between gap-2">
            <span class="center w-8 h-8 rounded-sm bg-surface text-fg-3 shrink-0"><AppIcon :name="item.icon" :size="17" /></span>
            <i class="h-6 px-2 row rounded-full bg-warn-soft text-[11px] not-italic text-warn shrink-0">尚未接入</i>
          </header>
          <h4 class="text-[14px] font-semibold text-fg">{{ item.title }}</h4>
          <p class="text-[12px] leading-snug text-fg-3">{{ item.description }}</p>
          <small class="text-[11px] leading-snug text-fg-2">{{ item.boundary }}</small>
          <button class="row-between gap-2 mt-1 pt-2.5 border-t border-line text-[12px] text-fg-2 hover:text-accent" @click.stop="router.push(item.to)">
            {{ item.actionLabel }}<AppIcon name="arrow-right" :size="13" />
          </button>
        </article>
      </div>
    </SectionCard>

    <Teleport to="body">
      <div
        v-if="menu"
        ref="menuElement"
        class="fixed z-[145] w-68 p-1 rounded-md bg-surface border border-line-strong shadow-lg"
        role="menu"
        :aria-label="`${menu.target.title}操作菜单`"
        :style="{ left: `${menu.x}px`, top: `${menu.y}px` }"
        @click.stop
        @contextmenu.prevent
        @keydown.stop="handleMenuKeydown"
      >
        <p class="px-2.5 py-1.5 text-[11px] text-fg-3 truncate">本地自检 · {{ menu.target.title }}</p>
        <button class="nav-item w-full" role="menuitem" @click="openTarget(menu.target)"><AppIcon name="arrow-right" :size="15" />{{ menu.target.actionLabel }}</button>
        <button v-if="menu.target.refreshable" class="nav-item w-full" role="menuitem" @click="closeMenu(); refreshChecks()"><AppIcon name="refresh" :size="15" />重新执行本机检查</button>
        <button class="nav-item w-full" role="menuitem" @click="copyTarget(menu.target)"><AppIcon name="duplicate" :size="15" />复制这项诊断</button>
      </div>
    </Teleport>
  </div>
</template>
