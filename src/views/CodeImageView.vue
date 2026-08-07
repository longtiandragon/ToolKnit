<script setup lang="ts">
import { computed, ref } from 'vue'
import { splitCodeForExport } from '@/lib/code-image'

const code = ref(`#include <bits/stdc++.h>
using namespace std;

bool feasible(long long x, const vector<int>& a) {
  long long used = 0;
  for (int value : a) used += (value + x - 1) / x;
  return used <= 12;
}

int main() {
  vector<int> a{7, 10, 13, 19};
  long long left = 1, right = 1e9;
  while (left < right) {
    long long mid = left + (right - left) / 2;
    if (feasible(mid, a)) right = mid;
    else left = mid + 1;
  }
  cout << left << '\\n';
}`)
const theme = ref<'forest' | 'paper'>('forest')
const fontSize = ref(16)
const showLineNumbers = ref(true)
const watermark = ref('ToolKnit')
const pages = computed(() => splitCodeForExport(code.value, 42))

function exportPage(page: string, pageNumber: number) {
  const lines = page.split('\n')
  const padding = 46, gutter = showLineNumbers.value ? 58 : 0, lineHeight = fontSize.value * 1.72
  const width = 1200, height = Math.max(190, padding * 2 + lines.length * lineHeight + 34)
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height
  const ctx = canvas.getContext('2d'); if (!ctx) return
  const dark = theme.value === 'forest'
  ctx.fillStyle = dark ? '#10231a' : '#f5efe4'; ctx.fillRect(0, 0, width, height)
  ctx.fillStyle = dark ? '#1c3a2a' : '#e4d8c3'; ctx.fillRect(0, 0, width, 32)
  ctx.fillStyle = dark ? '#dbf1dd' : '#25382a'; ctx.font = `600 ${12}px ui-monospace, Consolas`; ctx.fillText(`${watermark.value || 'ToolKnit'} · ${pageNumber}/${pages.value.length}`, padding, 21)
  ctx.font = `${fontSize.value}px ui-monospace, Consolas, monospace`; ctx.textBaseline = 'middle'
  lines.forEach((line, index) => { const y = padding + 12 + index * lineHeight; if (showLineNumbers.value) { ctx.fillStyle = dark ? '#789383' : '#9a8972'; ctx.textAlign = 'right'; ctx.fillText(String(index + 1 + (pageNumber - 1) * 42), padding + 35, y); } ctx.fillStyle = dark ? '#f2f7e9' : '#223327'; ctx.textAlign = 'left'; ctx.fillText(line || ' ', padding + gutter, y) })
  const link = document.createElement('a'); link.download = `toolknit-code-${String(pageNumber).padStart(2, '0')}.png`; link.href = canvas.toDataURL('image/png'); link.click()
}
function exportAll() { pages.value.forEach((page, index) => setTimeout(() => exportPage(page, index + 1), index * 180)) }
</script>

<template>
  <div class="code-image page-enter">
    <section class="section-heading"><div><p class="eyebrow">LONG CODE IMAGE</p><h2>长一点没关系，<em>别让思路被截断。</em></h2><p>按行自动分页导出，适合刷题记录、代码讲解和发给同学。</p></div><button class="primary-button" @click="exportAll">导出 {{ pages.length }} 张 PNG <span>↓</span></button></section>
    <section class="code-layout"><div class="code-controls panel"><label>主题<div class="segmented"><button :class="{ active: theme === 'forest' }" @click="theme = 'forest'">深林</button><button :class="{ active: theme === 'paper' }" @click="theme = 'paper'">纸页</button></div></label><label>字号 <output>{{ fontSize }} px</output><input v-model="fontSize" type="range" min="12" max="24" /></label><label class="checkline"><input v-model="showLineNumbers" type="checkbox" /> 显示行号</label><label>水印<input v-model="watermark" placeholder="ToolKnit" /></label><p class="control-note">超过 42 行会按行切分，绝不会悄悄吞掉尾部代码。</p></div><div class="code-editor panel"><textarea v-model="code" spellcheck="false" aria-label="代码"></textarea></div><div class="code-preview-wrap"><article v-for="(page, index) in pages" :key="index" class="code-export-preview" :class="`theme-${theme}`"><header><span>{{ watermark || 'ToolKnit' }}</span><span>{{ index + 1 }} / {{ pages.length }}</span></header><pre><code><span v-for="(line, lineIndex) in page.split('\n')" :key="lineIndex"><i v-if="showLineNumbers">{{ String(lineIndex + 1 + index * 42).padStart(3, ' ') }}</i>{{ line || ' ' }}
</span></code></pre><button @click="exportPage(page, index + 1)">导出本页</button></article></div></section>
  </div>
</template>
