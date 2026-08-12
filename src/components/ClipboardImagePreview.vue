<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
import { isDesktop, localAssetUrl, readDesktopInputFile } from '@/lib/native'

const props = defineProps<{
  assetPath?: string
  preview?: string
  alt: string
}>()

const source = ref('')
const failed = ref(false)
let objectUrl = ''
let fallbackAttempted = false

function revokeObjectUrl() {
  if (!objectUrl) return
  URL.revokeObjectURL(objectUrl)
  objectUrl = ''
}

function resetSource() {
  revokeObjectUrl()
  failed.value = false
  fallbackAttempted = false
  source.value = props.preview || localAssetUrl(props.assetPath)
}

async function handleLoadError() {
  if (!props.assetPath || !isDesktop() || fallbackAttempted) {
    failed.value = true
    source.value = ''
    return
  }

  fallbackAttempted = true
  try {
    const file = await readDesktopInputFile(props.assetPath)
    objectUrl = URL.createObjectURL(file)
    source.value = objectUrl
  } catch {
    failed.value = true
    source.value = ''
  }
}

watch(() => [props.assetPath, props.preview], resetSource, { immediate: true })
onBeforeUnmount(revokeObjectUrl)
</script>

<template>
  <div class="clipboard-image-preview" :class="{ failed }">
    <img v-if="source" :src="source" :alt="alt" loading="lazy" @error="handleLoadError" />
    <div v-else role="img" :aria-label="`${alt}不可用`">
      <strong>图片预览不可用</strong>
      <span>本地文件可能已经移动或被清理。</span>
    </div>
  </div>
</template>

<style scoped>
.clipboard-image-preview {
  display: grid;
  width: 100%;
  height: 180px;
  margin: 11px 0;
  overflow: hidden;
  place-items: center;
  border: 1px solid var(--line);
  border-radius: 8px;
  background-color: var(--accent-fg);
  background: var(--surface-2);
  background-position: 0 0, 0 10px, 10px -10px, -10px 0;
  background-size: 20px 20px;
}

.clipboard-image-preview img {
  display: block;
  width: 100%;
  height: 100%;
  padding: 8px;
  object-fit: contain;
}

.clipboard-image-preview > div {
  display: grid;
  gap: 5px;
  place-items: center;
  padding: 18px;
  color: var(--muted);
  text-align: center;
}

.clipboard-image-preview strong {
  color: var(--text-secondary);
  font-size: 11px;
}

.clipboard-image-preview span {
  font-size: 9px;
}
</style>
