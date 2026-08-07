<script setup lang="ts">
import { computed, ref } from 'vue'
import TagPill from '@/components/TagPill.vue'
import type { ReviewRating } from '@/types'
import { renderMarkdown } from '@/lib/markdown'
import { useWorkbenchStore } from '@/stores/workbench'

const store = useWorkbenchStore()
const index = ref(0)
const revealed = ref(false)
const queue = computed(() => store.dueDocuments)
const current = computed(() => queue.value[index.value])
const front = computed(() => current.value?.content.split('## 正确解法')[0] ?? '')
const back = computed(() => current.value?.content.includes('## 正确解法') ? `## 正确解法${current.value.content.split('## 正确解法')[1]}` : '')
function rate(rating: ReviewRating) { if (!current.value) return; store.gradeDocument(current.value.id, rating); revealed.value = false; if (index.value >= queue.value.length - 1) index.value = 0 }
</script>

<template>
  <div class="review page-enter">
    <section class="review-head"><div><p class="eyebrow">TODAY'S REVIEW</p><h2>不是做完，<em>是恰好在忘掉前再遇见。</em></h2></div><div class="review-count"><b>{{ queue.length }}</b><span>张到期卡</span></div></section>
    <section v-if="current" class="review-card panel"><header><div><p>{{ current.subject }} · 难度 {{ current.difficulty }}</p><h3>{{ current.title }}</h3><div><TagPill v-for="tag in current.tags" :key="tag" :label="tag" /></div></div><span class="card-number">{{ String(index + 1).padStart(2, '0') }}</span></header><article class="review-content" v-html="renderMarkdown(front.replace(/^---[\s\S]*?---\s*/, ''))"></article><div v-if="revealed" class="answer-reveal"><p class="eyebrow">REVEAL</p><article v-html="renderMarkdown(back)"></article></div><footer><button v-if="!revealed" class="primary-button wide" @click="revealed = true">先想一想，再看解法 <span>↓</span></button><template v-else><p>这题现在有多熟？</p><div class="rating-row"><button v-for="item in [['Again','重来'],['Hard','费劲'],['Good','刚好'],['Easy','轻松']] as const" :key="item[0]" :class="`rating-${item[0].toLowerCase()}`" @click="rate(item[0])"><b>{{ item[1] }}</b><small>{{ item[0] }}</small></button></div></template></footer></section>
    <section v-else class="review-finished panel"><span>✓</span><h3>今天的线已经织完了。</h3><p>可以收一份新资料，或者放心地合上 ToolKnit。</p><RouterLink class="primary-button" to="/library">去收集资料</RouterLink></section>
  </div>
</template>
