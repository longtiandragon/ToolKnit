<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import StatCard from '@/components/StatCard.vue'
import TagPill from '@/components/TagPill.vue'
import { readClipboardPayload } from '@/lib/clipboard'
import { useWorkbenchStore } from '@/stores/workbench'

const router = useRouter()
const store = useWorkbenchStore()
const pasting = ref(false)
const today = new Intl.DateTimeFormat('zh-CN', { weekday: 'long', month: 'long', day: 'numeric' }).format(new Date())
const latest = computed(() => store.documents.slice(0, 4))

async function pasteToInbox() {
  pasting.value = true
  const payload = await readClipboardPayload()
  pasting.value = false
  if (!payload) return
  await store.addSource({ name: payload.name, kind: payload.kind, mime: payload.kind === 'image' ? 'image/png' : 'text/plain', size: (payload.content ?? payload.preview ?? '').length, content: payload.content, preview: payload.preview })
  router.push('/library')
}
</script>

<template>
  <div class="dashboard page-enter">
    <section class="hero">
      <div class="hero-copy">
        <p class="eyebrow">{{ today }} · 本机资料，不出本地</p>
        <h2>把每一次卡住，<br><em>织成下一次会的东西。</em></h2>
        <p class="hero-description">ToolKnit 把截图、PDF、代码和错题留在同一条学习线里：收进来，想明白，按时再见。</p>
        <div class="hero-actions">
          <button class="primary-button" :disabled="pasting" @click="pasteToInbox">{{ pasting ? '正在读取剪贴板…' : '从剪贴板收集' }} <span>↗</span></button>
          <RouterLink class="quiet-button" to="/library">打开资料库</RouterLink>
        </div>
      </div>
      <div class="hero-weave" aria-hidden="true">
        <span class="thread t1"></span><span class="thread t2"></span><span class="thread t3"></span>
        <div class="weave-card one">原题</div><div class="weave-card two">错因</div><div class="weave-card three">复习</div>
      </div>
    </section>

    <section class="stats-grid">
      <StatCard label="今天待复习" :value="store.dueDocuments.length" hint="从最该复习的一题开始" tone="amber" />
      <StatCard label="已收集资料" :value="store.sources.length" hint="每份都保留原始出处" tone="mint" />
      <StatCard label="错题与笔记" :value="store.documents.length" hint="Markdown 可在外部继续编辑" tone="ink" />
    </section>

    <section class="dashboard-grid">
      <article class="panel review-panel">
        <div class="panel-heading"><div><p class="eyebrow">REVIEW QUEUE</p><h3>今天先织哪一针</h3></div><RouterLink to="/review">进入复习 →</RouterLink></div>
        <div v-if="store.dueDocuments.length" class="review-preview">
          <span class="queue-number">01</span>
          <div><p>{{ store.dueDocuments[0].subject }} · 难度 {{ store.dueDocuments[0].difficulty }}</p><h4>{{ store.dueDocuments[0].title }}</h4><div><TagPill v-for="tag in store.dueDocuments[0].tags" :key="tag" :label="tag" /></div></div>
          <RouterLink class="circle-arrow" to="/review">→</RouterLink>
        </div>
        <div v-else class="empty-strip">今天没有到期卡片。现在收一题，给未来的自己留个入口。</div>
      </article>

      <article class="panel knowledge-panel">
        <div class="panel-heading"><div><p class="eyebrow">KNOWLEDGE WEATHER</p><h3>需要多晒晒的知识点</h3></div><RouterLink to="/documents">查看全部</RouterLink></div>
        <div v-if="store.weakTags.length" class="weather-list"><div v-for="item in store.weakTags" :key="item.tag"><span>{{ item.tag }}</span><i><b :style="{ width: `${Math.min(100, item.score * 14)}%` }"></b></i><em>{{ item.score }}</em></div></div>
        <div v-else class="empty-strip">给错题加上知识点标签，这里会慢慢显出你的薄弱地图。</div>
      </article>
    </section>

    <section class="panel recent-panel">
      <div class="panel-heading"><div><p class="eyebrow">RECENT THREADS</p><h3>最近留下的线头</h3></div><RouterLink to="/documents">所有内容 →</RouterLink></div>
      <div class="recent-list"><RouterLink v-for="doc in latest" :key="doc.id" to="/documents" class="recent-row"><span class="doc-kind">{{ doc.kind === 'question' ? '题' : '记' }}</span><div><h4>{{ doc.title }}</h4><p>{{ doc.subject }} · {{ new Date(doc.updatedAt).toLocaleDateString('zh-CN') }}</p></div><div class="row-tags"><TagPill v-for="tag in doc.tags.slice(0, 2)" :key="tag" :label="tag" subtle /></div></RouterLink></div>
    </section>
  </div>
</template>
