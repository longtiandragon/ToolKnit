<script setup lang="ts">
import { computed, nextTick, onMounted, ref, shallowRef } from 'vue'
import { useRouter } from 'vue-router'
import AppIcon from '@/components/AppIcon.vue'
import PageHeader from '@/components/PageHeader.vue'
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
  <div class="capability-center page-enter mx-auto w-full max-w-320 px-8 py-6" @click="closeMenu()">
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

    <section class="capability-heading"><div><p class="eyebrow">现在可用</p><h3>本机能力状态</h3></div><p>左键进入对应工作流；右键或 Shift + F10 查看诊断与快捷操作。</p></section>
    <section class="capability-grid" aria-label="本机能力状态" :aria-busy="checking">
      <RouterLink
        v-for="card in cards"
        :key="card.id"
        :to="card.to"
        class="capability-card"
        :class="[`capability-card--${card.id}`, `is-${card.status}`]"
        aria-haspopup="menu"
        :aria-expanded="menu?.target.id === card.id"
        :aria-label="`${card.title}：${card.statusLabel}；点击进入工作流，右键可打开诊断菜单`"
        @contextmenu="showMenu($event, { ...card, refreshable: card.id === 'vault' || card.id === 'media' })"
        @keydown="showMenuFromKeyboard($event, { ...card, refreshable: card.id === 'vault' || card.id === 'media' })"
      >
        <header><span><AppIcon :name="card.icon" :size="18" /></span><p>{{ card.id.toUpperCase() }}</p><i :data-status="card.status"><AppIcon :name="statusIcon(card.status)" :size="12" />{{ card.statusLabel }}</i></header>
        <div><h4>{{ card.title }}</h4><p>{{ card.description }}</p><small :title="card.detail">{{ card.detail }}</small></div>
        <footer><span>{{ card.actionLabel }}<AppIcon name="arrow-right" :size="14" /></span></footer>
      </RouterLink>
    </section>

    <section v-if="researchItems.length" class="capability-heading capability-heading--research"><div><p class="eyebrow">待研究</p><h3>尚未接入的能力</h3></div><p>这些不是可用功能。卡片只说明边界，并带你进入当前已经可靠的替代流程。</p></section>
    <section v-if="researchItems.length" class="research-grid" aria-label="尚未接入的实验能力">
      <article v-for="item in researchItems" :key="item.id" tabindex="0" aria-haspopup="menu" :aria-expanded="menu?.target.id === item.id" @contextmenu="showMenu($event, { ...item, detail: item.boundary })" @keydown="showMenuFromKeyboard($event, { ...item, detail: item.boundary })">
        <header><span><AppIcon :name="item.icon" :size="17" /></span><i>尚未接入</i></header>
        <h4>{{ item.title }}</h4><p>{{ item.description }}</p><small>{{ item.boundary }}</small>
        <button @click.stop="router.push(item.to)">{{ item.actionLabel }}<AppIcon name="arrow-right" :size="13" /></button>
      </article>
    </section>

    <Teleport to="body"><section v-if="menu" ref="menuElement" class="capability-menu" role="menu" :aria-label="`${menu.target.title}操作菜单`" :style="{ left: `${menu.x}px`, top: `${menu.y}px` }" @click.stop @contextmenu.prevent @keydown.stop="handleMenuKeydown"><header><span>本地自检</span><b>{{ menu.target.title }}</b></header><button role="menuitem" @click="openTarget(menu.target)"><AppIcon name="arrow-right" :size="15" />{{ menu.target.actionLabel }}</button><button v-if="menu.target.refreshable" role="menuitem" @click="closeMenu(); refreshChecks()"><AppIcon name="refresh" :size="15" />重新执行本机检查</button><button role="menuitem" @click="copyTarget(menu.target)"><AppIcon name="duplicate" :size="15" />复制这项诊断</button></section></Teleport>
  </div>
</template>

<style scoped>
.capability-center{width:100%;max-width:1420px;min-width:0;margin:0 auto;padding:27px 30px 58px;color:var(--text)}
.capability-hero{overflow:hidden;box-shadow:0 20px 50px var(--accent-soft)}
.capability-hero>div{position:relative;display:flex;align-items:flex-start;flex-direction:column;justify-content:center;padding:33px 40px;background-size:25px 25px}.capability-hero>div:after{display:none}.capability-hero .eyebrow{}.capability-hero h2{position:relative;z-index:1;max-width:760px;margin:10px 0 11px;font:720 clamp(29px,3.35vw,44px)/1.08 var(--font-display);letter-spacing:-.045em}.capability-hero h2 em{font-style:normal}.capability-hero>div>p:not(.eyebrow){position:relative;z-index:1;max-width:760px;font-size:12px;line-height:1.72}.capability-hero__actions{z-index:1;margin-top:18px}.capability-hero__actions button{display:inline-flex;min-height:37px;align-items:center;gap:7px}.capability-hero__actions .primary-button{}.capability-hero__actions .quiet-button{color:var(--fg);}
.capability-hero>aside{display:grid;grid-template-rows:auto 1fr auto auto;padding:22px;border-left:1px solid var(--surface-2)}.capability-hero>aside>span{display:flex;align-items:center;gap:7px;font-size:9px}.capability-hero>aside>span i{width:7px;height:7px;box-shadow:0 0 0 4px var(--accent-soft)}.capability-hero>aside>span i.attention{box-shadow:0 0 0 4px var(--warn-soft)}.capability-hero>aside strong{align-self:end;font:760 52px/1 var(--font-mono);letter-spacing:-.07em}.capability-hero>aside strong small{font-size:16px;letter-spacing:0}.capability-hero>aside p{margin:5px 0 16px;font:8px var(--font-mono);letter-spacing:.09em}.capability-hero>aside footer{padding-top:12px;border-top:1px solid var(--surface-2);font:8px var(--font-mono)}
.capability-heading{display:flex;align-items:flex-end;justify-content:space-between;gap:28px;padding:25px 2px 13px}.capability-heading h3{margin-top:5px;font:700 20px var(--font-display);letter-spacing:-.025em}.capability-heading>p{max-width:510px;color:var(--muted);font-size:9px;line-height:1.55;text-align:right}.capability-heading--research{padding-top:29px}
.capability-grid{display:grid;grid-template-columns:repeat(12,minmax(0,1fr));gap:11px}.capability-card{display:grid;min-width:0;min-height:184px;grid-column:span 4;grid-template-rows:auto 1fr auto;padding:16px;border:1px solid var(--line);border-radius:15px;background:linear-gradient(145deg,var(--surface),var(--surface-2));box-shadow:0 9px 24px var(--accent-soft);outline:0;cursor:context-menu;transition:border-color .16s ease,box-shadow .16s ease,background .16s ease}.capability-card--vault{grid-column:span 7}.capability-card--media{grid-column:span 5}.capability-card:hover,.capability-card:focus-visible{border-color:var(--accent);background:var(--surface);box-shadow:0 13px 31px var(--accent-soft)}.capability-card:focus-visible{box-shadow:0 0 0 3px color-mix(in srgb,var(--green) 15%,transparent),0 13px 31px var(--accent-soft)}.capability-card>header{display:grid;grid-template-columns:32px auto 1fr;align-items:center;gap:8px}.capability-card>header>span{display:grid;width:32px;height:32px;place-items:center;border-radius:9px;color:var(--green-strong);background:var(--green-bg)}.capability-card>header>p{color:var(--muted);font:720 8px var(--font-mono);letter-spacing:.1em}.capability-card>header>i{display:inline-flex;align-items:center;justify-self:end;gap:4px;padding:4px 6px;border-radius:999px;color:var(--muted);background:var(--surface-2);font:700 8px var(--font-ui);font-style:normal}.capability-card>header>i[data-status=ready]{color:var(--accent);background:var(--accent-soft)}.capability-card>header>i[data-status=attention]{color:var(--danger);background:var(--warn-soft)}.capability-card>header>i[data-status=checking]{color:var(--warn);background:var(--warn-soft)}.capability-card>div{align-self:center;padding:15px 0 12px}.capability-card h4{font:700 16px var(--font-display);letter-spacing:-.02em}.capability-card>div>p{margin-top:6px;color:var(--muted);font-size:10px;line-height:1.55}.capability-card>div>small{display:block;overflow:hidden;margin-top:8px;color:var(--text-secondary);font-size:9px;line-height:1.5;text-overflow:ellipsis;white-space:nowrap}.capability-card footer{padding-top:10px;border-top:1px solid var(--line-weak)}.capability-card footer button{display:flex;width:100%;align-items:center;justify-content:space-between;padding:0;border:0;color:var(--green-strong);background:transparent;font:700 9px var(--font-ui);text-align:left}
.capability-card>div,.capability-card footer{min-width:0}.capability-card>div>small{max-width:100%}
.capability-hero>div>p:not(.eyebrow){font-size:13px}
.capability-hero>aside>span{font-size:11px}.capability-hero>aside strong small{}.capability-hero>aside p{font-size:10px}.capability-hero>aside footer{font-size:10px}
.capability-heading>p{max-width:560px;font-size:11px;line-height:1.6}
.capability-card{min-height:194px;padding:17px;color:inherit;text-decoration:none;cursor:pointer}.capability-card>header>p{font-size:10px;letter-spacing:.09em}.capability-card>header>i{padding:4px 7px;font-size:10px}.capability-card h4{font-size:17px}.capability-card>div>p{margin-top:7px;font-size:12px;line-height:1.58}.capability-card>div>small{margin-top:9px;font-size:11px}.capability-card footer{padding-top:11px}.capability-card footer span{display:flex;width:100%;align-items:center;justify-content:space-between;color:var(--green-strong);font:700 11px var(--font-ui);text-align:left}
.research-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}.research-grid article{display:grid;min-height:190px;grid-template-rows:auto auto auto 1fr auto;padding:15px;border:1px solid var(--line);border-radius:14px;background:var(--surface-2);outline:0;cursor:context-menu}.research-grid article:hover,.research-grid article:focus-visible{border-color:var(--accent-soft);background:var(--surface)}.research-grid article:focus-visible{box-shadow:0 0 0 3px color-mix(in srgb,var(--green) 14%,transparent)}.research-grid header{display:flex;align-items:center;justify-content:space-between}.research-grid header>span{display:grid;width:30px;height:30px;place-items:center;border-radius:9px;color:var(--muted);background:var(--surface-2)}.research-grid header i{padding:3px 6px;border-radius:999px;color:var(--warn);background:var(--warn-soft);font:700 8px var(--font-ui);font-style:normal}.research-grid h4{margin-top:13px;font:700 14px var(--font-display)}.research-grid>article>p{margin-top:5px;color:var(--muted);font-size:9px;line-height:1.5}.research-grid>article>small{margin-top:8px;color:var(--text-secondary);font-size:8px;line-height:1.5}.research-grid>article>button{display:flex;align-items:center;justify-content:space-between;margin-top:11px;padding:9px 0 0;border:0;border-top:1px solid var(--line-weak);color:var(--green-strong);background:transparent;font:700 9px var(--font-ui)}
.research-grid article{min-height:200px;padding:16px}.research-grid header i{font-size:10px}.research-grid h4{font-size:15px}.research-grid>article>p{margin-top:6px;font-size:11px;line-height:1.55}.research-grid>article>small{font-size:10px;line-height:1.55}.research-grid>article>button{font-size:10px}
.capability-menu{position:fixed;z-index:145;width:272px;overflow:hidden;border:1px solid var(--accent-soft);border-radius:12px;background:var(--surface);box-shadow:var(--shadow-lg);animation:capability-menu-in .14s ease-out both}.capability-menu>header{display:grid;gap:3px;padding:11px 13px 9px;border-bottom:1px solid var(--line-weak);background:linear-gradient(125deg,var(--green-bg),var(--surface-2))}.capability-menu>header span{color:var(--green-strong);font:700 8px var(--font-mono);letter-spacing:.1em}.capability-menu>header b{overflow:hidden;font:700 12px var(--font-ui);text-overflow:ellipsis;white-space:nowrap}.capability-menu button{display:flex;width:100%;min-height:39px;align-items:center;gap:9px;padding:0 13px;border:0;border-bottom:1px solid var(--line-weak);color:var(--text-secondary);background:transparent;font:650 10px var(--font-ui);text-align:left}.capability-menu button:last-child{border-bottom:0}.capability-menu button:hover,.capability-menu button:focus-visible{color:var(--green-strong);background:var(--green-bg)}.capability-menu button:focus-visible{outline:2px solid color-mix(in srgb,var(--green) 48%,transparent);outline-offset:-2px}@keyframes capability-menu-in{from{opacity:0;transform:translateY(-4px) scale(.985)}to{opacity:1;transform:none}}
@media(max-width:1050px){.capability-card{grid-column:span 6}.capability-card--vault,.capability-card--media{grid-column:span 6}.research-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:800px){.capability-center{padding:22px 18px 46px}.capability-hero{}.capability-hero>aside{display:none}.capability-card,.capability-card--vault,.capability-card--media{grid-column:1/-1}.capability-heading{align-items:flex-start;flex-direction:column;gap:6px}.capability-heading>p{text-align:left}}@media(prefers-reduced-motion:reduce){.capability-menu{animation:none}}
</style>
