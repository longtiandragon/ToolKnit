<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import TagPill from '@/components/TagPill.vue'
import AiAssistPanel from '@/components/AiAssistPanel.vue'
import { renderMarkdown } from '@/lib/markdown'
import type { StudyDocument } from '@/types'
import { useWorkbenchStore } from '@/stores/workbench'

const store = useWorkbenchStore()
const router = useRouter()
const query = ref('')
const selectedId = ref(store.documents[0]?.id ?? '')
const draft = ref<StudyDocument | null>(store.documents[0] ? structuredClone(store.documents[0]) : null)
const newTag = ref('')
const saved = ref(false)
const docs = computed(() => store.documents.filter((document) => `${document.title} ${document.tags.join(' ')} ${document.content}`.toLowerCase().includes(query.value.toLowerCase())))
const selected = computed(() => store.documents.find((document) => document.id === selectedId.value))
const preview = computed(() => draft.value ? renderMarkdown(draft.value.content.replace(/^---[\s\S]*?---\s*/, '')) : '')

watch(selected, (document) => { draft.value = document ? structuredClone(document) : null }, { immediate: true })

function pick(document: StudyDocument) { selectedId.value = document.id; saved.value = false }
function createQuestion() { const document = store.createQuestion(); selectedId.value = document.id }
function createNote() { const document = store.createNote(); selectedId.value = document.id }
function save() { if (draft.value) { store.saveDocument(draft.value); saved.value = true; setTimeout(() => saved.value = false, 1600) } }
function addTag() { const tag = newTag.value.trim(); if (draft.value && tag && !draft.value.tags.includes(tag)) draft.value.tags.push(tag); newTag.value = '' }
function removeTag(tag: string) { if (draft.value) draft.value.tags = draft.value.tags.filter((item) => item !== tag) }
function remove() { if (!draft.value || !confirm(`删除“${draft.value.title}”？`)) return; store.deleteDocument(draft.value.id); selectedId.value = store.documents[0]?.id ?? '' }
function insertAi(content: string) { if (!draft.value) return; draft.value.content += `\n\n---\n\n## AI 草稿（已确认）\n\n${content}\n`; save() }
</script>

<template>
  <div class="documents page-enter">
    <section class="section-heading compact"><div><p class="eyebrow">MISTAKEBOOK / MARKDOWN</p><h2>错题不是墓地，<em>是带出处的下一次机会。</em></h2></div><div class="heading-actions"><button class="quiet-button" @click="createNote">＋ 笔记</button><button class="primary-button" @click="createQuestion">＋ 错题</button></div></section>
    <div class="documents-layout">
      <aside class="document-list panel"><input v-model="query" class="search-input" placeholder="搜索标题、标签、正文…" /><button v-for="doc in docs" :key="doc.id" class="document-row" :class="{ selected: doc.id === selectedId }" @click="pick(doc)"><span>{{ doc.kind === 'question' ? '题' : '记' }}</span><div><h4>{{ doc.title }}</h4><p>{{ doc.subject }} · {{ doc.reviewEnabled ? '已加入复习' : '普通笔记' }}</p></div></button><div v-if="!docs.length" class="empty-strip">没有匹配的内容。</div></aside>
      <section v-if="draft" class="editor-shell panel">
        <header class="editor-header"><div><input v-model="draft.title" class="title-input" aria-label="标题" /><div class="metadata-row"><select v-model="draft.subject"><option>算法</option><option>数学</option><option>物理</option><option>计算机</option><option>英语</option><option>未分类</option></select><select v-if="draft.kind === 'question'" v-model="draft.difficulty"><option :value="1">难度 1</option><option :value="2">难度 2</option><option :value="3">难度 3</option><option :value="4">难度 4</option><option :value="5">难度 5</option></select><label v-if="draft.kind === 'question'" class="switch"><input v-model="draft.reviewEnabled" type="checkbox" /><span></span>加入复习</label></div></div><div class="editor-actions"><span v-if="saved" class="saved">已保存</span><button class="quiet-button danger" @click="remove">删除</button><button class="primary-button" @click="save">保存</button></div></header>
        <div class="tag-editor"><TagPill v-for="tag in draft.tags" :key="tag" :label="`${tag} ×`" @click="removeTag(tag)" /><input v-model="newTag" placeholder="添加标签后回车" @keydown.enter.prevent="addTag" /></div>
        <div v-if="draft.sourceAnchor" class="source-anchor"><span>↗ 来源仍然系着：第 {{ draft.sourceAnchor.pageIndex + 1 }} 页，区域 {{ draft.sourceAnchor.bbox.map((n) => n.toFixed(2)).join(' · ') }}</span><button @click="router.push('/library')">回到原题</button></div>
        <div class="editor-grid"><textarea v-model="draft.content" spellcheck="false" aria-label="Markdown 正文"></textarea><article class="markdown-preview" v-html="preview"></article></div>
        <AiAssistPanel :document="draft" @insert="insertAi" />
      </section>
      <section v-else class="panel detail-empty">先新建或选择一条错题。</section>
    </div>
  </div>
</template>
