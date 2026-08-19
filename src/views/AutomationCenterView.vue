<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { open } from '@tauri-apps/plugin-dialog'
import { useRouter } from 'vue-router'
import AppIcon from '@/components/AppIcon.vue'
import PageHeader from '@/components/PageHeader.vue'
import {
  automationRecipePreviewLocation,
  duplicateAutomationRecipe,
  removeAutomationRecipe,
  renameAutomationRecipe,
} from '@/lib/automation-recipes'
import { newId } from '@/lib/id'
import { isDesktop } from '@/lib/native'
import {
  bindDesktopOrganizerRule,
  deleteDesktopOrganizerRule,
  getDesktopOrganizerReview,
  listDesktopOrganizerRuleBindings,
  listDesktopOrganizerRules,
  saveDesktopOrganizerRule,
  unbindDesktopOrganizerRule,
  type OrganizerReviewSummary,
  type OrganizerRuleBinding,
} from '@/lib/smart-organizer-native'
import { useUiStore } from '@/stores/ui'
import { useWorkbenchStore } from '@/stores/workbench'
import type { AutomationRecipeKind, OrganizerRule, OrganizerTrustLevel } from '@/types'

type CenterKind = AutomationRecipeKind | 'organizer'
type CenterFilter = 'all' | CenterKind

interface CenterItem {
  id: string
  kind: CenterKind
  title: string
  detail: string
  createdAt: string
  updatedAt: string
  lastRunAt?: string
  organizerRule?: OrganizerRule
}

const desktop = isDesktop()
const router = useRouter()
const store = useWorkbenchStore()
const ui = useUiStore()
const organizerRules = ref<OrganizerRule[]>([])
const bindings = ref<OrganizerRuleBinding[]>([])
const review = ref<OrganizerReviewSummary>()
const loading = ref(false)
const mutating = ref(false)
const search = ref('')
const filter = ref<CenterFilter>('all')
const selectedId = ref('')
const draftTitle = ref('')
const draftTrust = ref<OrganizerTrustLevel>('confirmed')
const draftEnabled = ref(true)

const kindLabels: Record<CenterKind, string> = {
  organizer: '智能整理规则',
  tool: '单工具配方',
  'text-pipeline': '文本流水线',
  'artifact-pipeline': '文件流水线',
}

const kindIcons: Record<CenterKind, string> = {
  organizer: 'rule',
  tool: 'settings',
  'text-pipeline': 'file-text',
  'artifact-pipeline': 'task',
}
const filterOptions = [
  ['all', '全部自动化', 'task'],
  ['organizer', '智能整理规则', 'rule'],
  ['tool', '单工具配方', 'settings'],
  ['text-pipeline', '文本流水线', 'file-text'],
  ['artifact-pipeline', '文件流水线', 'archive'],
] as const

const items = computed<CenterItem[]>(() => [
  ...organizerRules.value.map(rule => ({
    id: rule.id,
    kind: 'organizer' as const,
    title: rule.title,
    detail: `${rule.matcher.extensions.length || rule.matcher.kinds.length || '全部'} 类匹配 · ${rule.action.targetRelativeDirTemplate}`,
    createdAt: rule.createdAt,
    updatedAt: rule.updatedAt,
    organizerRule: rule,
  })),
  ...store.recipes.map(recipe => ({
    id: recipe.id,
    kind: 'tool' as const,
    title: recipe.title,
    detail: `${recipe.group.toUpperCase()} · ${recipe.operation}`,
    createdAt: recipe.createdAt,
    updatedAt: recipe.lastRunAt ?? recipe.createdAt,
    lastRunAt: recipe.lastRunAt,
  })),
  ...store.pipelineRecipes.map(recipe => ({
    id: recipe.id,
    kind: recipe.scope === 'artifact' ? 'artifact-pipeline' as const : 'text-pipeline' as const,
    title: recipe.title,
    detail: `${recipe.steps.length} 步 · ${recipe.steps.map(step => step.toolId).slice(0, 3).join(' → ')}`,
    createdAt: recipe.createdAt,
    updatedAt: recipe.updatedAt,
    lastRunAt: recipe.lastRunAt,
  })),
].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || right.id.localeCompare(left.id)))

const visibleItems = computed(() => {
  const needle = search.value.trim().toLocaleLowerCase('zh-CN')
  return items.value.filter(item => (filter.value === 'all' || item.kind === filter.value)
    && (!needle || `${item.title} ${item.detail} ${kindLabels[item.kind]}`.toLocaleLowerCase('zh-CN').includes(needle)))
})
const selected = computed(() => items.value.find(item => item.id === selectedId.value))
const binding = computed(() => selected.value?.kind === 'organizer'
  ? bindings.value.find(item => item.ruleId === selected.value?.id)
  : undefined)
const stats = computed(() => [
  { label: '自动化资产', value: items.value.length },
  { label: '本月手动运行', value: review.value?.runs30Days ?? 0 },
  { label: '节省操作', value: review.value?.savedOperations30Days ?? 0, tone: 'accent' as const },
  { label: '失败运行', value: review.value?.failedRuns30Days ?? 0, tone: 'danger' as const },
])

watch(selected, item => {
  draftTitle.value = item?.title ?? ''
  draftTrust.value = item?.organizerRule?.trustLevel ?? 'confirmed'
  draftEnabled.value = item?.organizerRule?.enabled ?? true
}, { immediate: true })

function displayDate(value?: string) {
  if (!value) return '尚未运行'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '时间未知' : new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(date)
}

function directoryName(path: string) {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? '已选择目录'
}

function boundTo(ruleId: string) {
  return bindings.value.find(item => item.ruleId === ruleId)
}

function selectItem(item: CenterItem) {
  selectedId.value = item.id
}

async function refreshOrganizerData() {
  if (!desktop) return
  loading.value = true
  const [rulesResult, bindingsResult, reviewResult] = await Promise.allSettled([
    listDesktopOrganizerRules(),
    listDesktopOrganizerRuleBindings(),
    getDesktopOrganizerReview(),
  ])
  if (rulesResult.status === 'fulfilled') organizerRules.value = rulesResult.value
  if (bindingsResult.status === 'fulfilled') bindings.value = bindingsResult.value
  if (reviewResult.status === 'fulfilled') review.value = reviewResult.value
  loading.value = false
}

async function preview(item: CenterItem) {
  if (item.kind === 'organizer') {
    if (!boundTo(item.id)) {
      ui.toast('规则尚未绑定目录', '先在右侧重新绑定来源目录与归档根。', 'warning')
      selectedId.value = item.id
      return
    }
    await router.push({ path: '/tools', query: { mode: 'smart-organizer', rule: item.id } })
    return
  }
  await router.push(automationRecipePreviewLocation(item.kind, item.id))
}

async function saveSelected() {
  const item = selected.value
  const title = draftTitle.value.trim()
  if (!item || !title || mutating.value) return
  mutating.value = true
  try {
    if (item.kind === 'organizer' && item.organizerRule) {
      const saved = await saveDesktopOrganizerRule({
        ...item.organizerRule,
        title,
        trustLevel: draftTrust.value,
        enabled: draftEnabled.value,
        updatedAt: new Date().toISOString(),
      })
      organizerRules.value = organizerRules.value.map(rule => rule.id === saved.id ? saved : rule)
    } else {
      await renameAutomationRecipe(store, item.id, title)
    }
    ui.toast('自动化已更新', '只保存结构化步骤与规则语义。', 'success')
  } catch (error) {
    ui.toast('自动化未更新', error instanceof Error ? error.message : '无法保存这项自动化。', 'error')
  } finally {
    mutating.value = false
  }
}

async function duplicateSelected() {
  const item = selected.value
  if (!item || mutating.value) return
  mutating.value = true
  try {
    if (item.kind === 'organizer' && item.organizerRule) {
      const now = new Date().toISOString()
      const saved = await saveDesktopOrganizerRule({
        ...item.organizerRule,
        id: newId(),
        title: `${item.title} · 副本`.slice(0, 120),
        trustLevel: 'confirmed',
        enabled: false,
        workflowSignature: undefined,
        createdAt: now,
        updatedAt: now,
      })
      organizerRules.value = [saved, ...organizerRules.value]
      selectedId.value = saved.id
      ui.toast('规则副本已创建', '副本默认停用且未绑定目录，确认后再运行。', 'success')
    } else {
      const saved = await duplicateAutomationRecipe(store, item.id)
      selectedId.value = saved.id
      ui.toast('配方副本已创建', saved.title, 'success')
    }
  } catch (error) {
    ui.toast('无法复制', error instanceof Error ? error.message : '自动化副本创建失败。', 'error')
  } finally {
    mutating.value = false
  }
}

async function chooseDirectory(title: string) {
  const selected = await open({ directory: true, multiple: false, title })
  return typeof selected === 'string' ? selected : undefined
}

async function rebindSelected() {
  const item = selected.value
  if (!desktop || item?.kind !== 'organizer' || mutating.value) return
  const source = await chooseDirectory('选择规则来源目录')
  if (!source) return
  const archive = await chooseDirectory('选择规则归档根目录')
  if (!archive) return
  mutating.value = true
  try {
    const saved = await bindDesktopOrganizerRule(item.id, source, archive)
    bindings.value = [saved, ...bindings.value.filter(value => value.ruleId !== item.id)]
    ui.toast('本机目录已重新绑定', `${directoryName(source)} → ${directoryName(archive)}`, 'success')
  } catch (error) {
    ui.toast('目录未绑定', error instanceof Error ? error.message : '无法保存本机目录绑定。', 'error')
  } finally {
    mutating.value = false
  }
}

async function clearBinding() {
  const item = selected.value
  if (item?.kind !== 'organizer' || !binding.value || mutating.value) return
  mutating.value = true
  try {
    await unbindDesktopOrganizerRule(item.id)
    bindings.value = bindings.value.filter(value => value.ruleId !== item.id)
    ui.toast('目录绑定已清除', '规则语义仍保留，可在其他设备重新绑定。', 'success')
  } catch (error) {
    ui.toast('绑定未清除', error instanceof Error ? error.message : '无法更新本机绑定。', 'error')
  } finally {
    mutating.value = false
  }
}

async function removeSelected() {
  const item = selected.value
  if (!item || mutating.value) return
  const approved = await ui.confirm({
    title: `删除“${item.title}”？`,
    message: item.kind === 'organizer' ? '只删除规则和本机目录绑定，不会改动任何文件。' : '只删除配方定义，不会删除任务历史或输出文件。',
    confirmLabel: '删除自动化',
    danger: true,
  })
  if (!approved) return
  mutating.value = true
  try {
    if (item.kind === 'organizer') {
      if (boundTo(item.id)) await unbindDesktopOrganizerRule(item.id)
      await deleteDesktopOrganizerRule(item.id)
      organizerRules.value = organizerRules.value.filter(rule => rule.id !== item.id)
      bindings.value = bindings.value.filter(value => value.ruleId !== item.id)
    } else await removeAutomationRecipe(store, item.id)
    selectedId.value = ''
    ui.toast('自动化已删除', '没有执行任何文件操作。', 'success')
  } catch (error) {
    ui.toast('自动化未删除', error instanceof Error ? error.message : '无法删除这项自动化。', 'error')
  } finally {
    mutating.value = false
  }
}

onMounted(() => { void refreshOrganizerData() })
</script>

<template>
  <div class="page-enter page-shell px-8 py-6">
    <PageHeader
      title="自动化中心"
      subtitle="集中管理工具配方、文件流水线与智能整理规则；所有运行都从只读预览开始。"
      :stats="stats"
    >
      <template #actions>
        <button class="btn-default btn-sm" :disabled="loading || !desktop" @click="refreshOrganizerData"><AppIcon name="refresh" :size="14" />刷新规则</button>
      </template>
    </PageHeader>

    <section class="mb-5 grid gap-px overflow-hidden rounded-md border border-line bg-line md:grid-cols-3" aria-label="自动化安全边界">
      <div class="row gap-3 bg-surface px-4 py-3"><span class="center size-8 rounded-sm bg-success-soft text-success"><AppIcon name="shield" :size="16" /></span><span class="stack gap-0.5"><strong class="text-[12px] font-medium">只读预览先行</strong><small class="text-[11px] text-fg-3">打开配方不会立刻修改文件</small></span></div>
      <div class="row gap-3 bg-surface px-4 py-3"><span class="center size-8 rounded-sm bg-surface-2 text-fg-2"><AppIcon name="folder" :size="16" /></span><span class="stack gap-0.5"><strong class="text-[12px] font-medium">路径单独绑定</strong><small class="text-[11px] text-fg-3">目录不进入 Vault 备份或配方定义</small></span></div>
      <div class="row gap-3 bg-surface px-4 py-3"><span class="center size-8 rounded-sm bg-warn-soft text-warn"><AppIcon name="clock" :size="16" /></span><span class="stack gap-0.5"><strong class="text-[12px] font-medium">没有后台执行</strong><small class="text-[11px] text-fg-3">无 watcher、定时器或开机自启</small></span></div>
    </section>

    <div class="grid min-h-[34rem] grid-cols-1 gap-5 lg:grid-cols-[190px_minmax(260px,1fr)_280px]">
      <aside class="panel stack gap-1 p-3">
        <p class="px-2 pb-2 text-[10px] font-semibold uppercase tracking-[.14em] text-fg-3">资产类型</p>
        <button
          v-for="option in filterOptions"
          :key="option[0]"
          class="row-between rounded-sm px-2.5 py-2 text-left text-[12px]"
          :class="filter === option[0] ? 'bg-accent-soft text-accent' : 'text-fg-2 hover:bg-surface-2'"
          @click="filter = option[0]"
        >
          <span class="row gap-2"><AppIcon :name="option[2]" :size="14" />{{ option[1] }}</span>
          <small class="tabular-nums text-[10px] text-fg-3">{{ option[0] === 'all' ? items.length : items.filter(item => item.kind === option[0]).length }}</small>
        </button>
        <div v-if="review?.repeatedWorkflows.length" class="mt-auto border-t border-line px-2 pt-3">
          <p class="text-[10px] font-semibold text-fg-3">待沉淀流程</p>
          <p class="mt-1 text-[11px] leading-relaxed text-fg-2">{{ review.repeatedWorkflows.length }} 条流程在 30 天内重复确认，可在智能整理中保存为规则。</p>
        </div>
      </aside>

      <main class="panel min-w-0 overflow-hidden">
        <div class="row gap-2 border-b border-line p-3">
          <label class="row min-w-0 flex-1 gap-2 rounded-sm border border-line bg-surface-2 px-3 py-2">
            <AppIcon name="search" :size="14" class="text-fg-3" />
            <span class="visually-hidden">搜索自动化</span>
            <input v-model="search" class="min-w-0 flex-1 bg-transparent text-[12px] outline-none" placeholder="搜索名称、工具或操作…" />
          </label>
          <span class="row px-2 text-[11px] tabular-nums text-fg-3">{{ visibleItems.length }} 项</span>
        </div>

        <div v-if="visibleItems.length" class="divide-y divide-line" role="list" aria-label="自动化列表">
          <article
            v-for="item in visibleItems"
            :key="`${item.kind}:${item.id}`"
            class="grid cursor-pointer grid-cols-[34px_minmax(0,1fr)_auto] items-center gap-3 px-4 py-3 transition-colors"
            :class="selectedId === item.id ? 'bg-accent-soft' : 'hover:bg-surface-2'"
            role="listitem"
            tabindex="0"
            @click="selectItem(item)"
            @keydown.enter="selectItem(item)"
            @keydown.space.prevent="selectItem(item)"
          >
            <span class="center size-8 rounded-sm border border-line bg-surface text-fg-2"><AppIcon :name="kindIcons[item.kind]" :size="15" /></span>
            <span class="stack min-w-0 gap-0.5"><span class="row gap-2 min-w-0"><strong class="truncate text-[12px] font-medium">{{ item.title }}</strong><small v-if="item.kind === 'organizer'" class="shrink-0 rounded-full px-1.5 py-0.5 text-[9px]" :class="boundTo(item.id) ? 'bg-success-soft text-success' : 'bg-warn-soft text-warn'">{{ boundTo(item.id) ? '已绑定' : '未绑定' }}</small></span><small class="truncate text-[11px] text-fg-3">{{ kindLabels[item.kind] }} · {{ item.detail }}</small></span>
            <span class="stack items-end gap-1"><small class="text-[10px] tabular-nums text-fg-3">{{ displayDate(item.lastRunAt || item.updatedAt) }}</small><button class="btn-ghost btn-sm" title="打开只读预览" @click.stop="preview(item)"><AppIcon name="play" :size="13" />预览</button></span>
          </article>
        </div>
        <div v-else class="center min-h-80 p-8 text-center"><span class="stack items-center gap-2"><span class="center size-10 rounded-md bg-surface-2 text-fg-3"><AppIcon name="task" :size="18" /></span><strong class="text-[13px] font-medium">没有匹配的自动化</strong><small class="max-w-72 text-[11px] leading-relaxed text-fg-3">在工具或流水线里保存一次配置，它就会出现在这里。配方只保存结构化参数。</small></span></div>
      </main>

      <aside class="panel p-4">
        <div v-if="selected" class="stack gap-4">
          <div class="row-between gap-3 border-b border-line pb-3"><span class="stack min-w-0 gap-0.5"><small class="text-[10px] font-semibold uppercase tracking-[.12em] text-fg-3">检查与编辑</small><strong class="truncate text-[13px]">{{ kindLabels[selected.kind] }}</strong></span><span class="center size-8 rounded-sm bg-surface-2 text-fg-2"><AppIcon :name="kindIcons[selected.kind]" :size="15" /></span></div>

          <label class="stack gap-1.5"><span class="text-[11px] font-medium text-fg-2">名称</span><input v-model="draftTitle" maxlength="120" class="field w-full" /></label>

          <template v-if="selected.organizerRule">
            <label class="stack gap-1.5"><span class="text-[11px] font-medium text-fg-2">信任等级</span><select v-model="draftTrust" class="field w-full"><option value="preview">仅生成预览</option><option value="confirmed">每次确认</option><option value="trusted">可信规则</option></select></label>
            <label class="row-between rounded-sm border border-line bg-surface-2 px-3 py-2"><span class="stack gap-0.5"><strong class="text-[11px] font-medium">规则启用</strong><small class="text-[10px] text-fg-3">启用也不会后台执行</small></span><input v-model="draftEnabled" type="checkbox" /></label>
            <div class="stack gap-2 rounded-sm border border-line bg-surface-2 p-3"><span class="row-between"><small class="font-medium text-fg-2">本机目录绑定</small><small class="text-[10px]" :class="binding ? 'text-success' : 'text-warn'">{{ binding ? '可预览' : '需要绑定' }}</small></span><p v-if="binding" class="text-[11px] text-fg-3"><span class="text-fg-2">{{ directoryName(binding.sourceRoot) }}</span> → <span class="text-fg-2">{{ directoryName(binding.archiveRoot) }}</span></p><p v-else class="text-[11px] leading-relaxed text-fg-3">绝对路径只保存在本机应用配置中，不跟随 Vault 备份。</p><div class="row gap-2"><button class="btn-default btn-sm flex-1" :disabled="mutating" @click="rebindSelected"><AppIcon name="folder-open" :size="13" />{{ binding ? '重新绑定' : '绑定目录' }}</button><button v-if="binding" class="btn-ghost btn-sm" :disabled="mutating" @click="clearBinding">清除</button></div></div>
          </template>
          <div v-else class="stack gap-1.5 rounded-sm border border-line bg-surface-2 p-3"><small class="font-medium text-fg-2">{{ selected.detail }}</small><p class="text-[11px] leading-relaxed text-fg-3">保存内容不含输入文件、输出路径或正文；运行时需要重新选择输入。</p></div>

          <button class="btn-primary w-full" :disabled="mutating || !draftTitle.trim()" @click="saveSelected"><AppIcon name="check" :size="14" />保存更改</button>
          <button class="btn-default w-full" :disabled="mutating || (selected.kind === 'organizer' && !binding)" @click="preview(selected)"><AppIcon name="play" :size="14" />打开手动预览</button>
          <div class="grid grid-cols-2 gap-2"><button class="btn-ghost btn-sm" :disabled="mutating" @click="duplicateSelected"><AppIcon name="duplicate" :size="13" />复制</button><button class="btn-ghost btn-sm text-danger" :disabled="mutating" @click="removeSelected"><AppIcon name="trash" :size="13" />删除</button></div>
          <dl class="grid grid-cols-2 gap-2 border-t border-line pt-3 text-[10px] text-fg-3"><div class="stack gap-0.5"><dt>创建</dt><dd class="text-fg-2">{{ displayDate(selected.createdAt) }}</dd></div><div class="stack gap-0.5"><dt>最近更新</dt><dd class="text-fg-2">{{ displayDate(selected.updatedAt) }}</dd></div></dl>
        </div>
        <div v-else class="center min-h-80 text-center"><span class="stack items-center gap-2"><AppIcon name="pointer" :size="20" class="text-fg-3" /><strong class="text-[12px] font-medium">选择一项自动化</strong><small class="max-w-52 text-[11px] leading-relaxed text-fg-3">在这里重命名、复制、绑定目录或打开手动预览。</small></span></div>
      </aside>
    </div>
  </div>
</template>
