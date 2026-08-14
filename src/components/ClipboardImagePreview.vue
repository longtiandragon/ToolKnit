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
  <!-- CONTENT PLANE. The mat behind the picture is deliberately unthemed: a
       clipboard image is the user's own pixels and has to look the same in
       both themes, and a PNG with an alpha channel has to read as
       transparent rather than as "white" in light mode and "black" in dark.
       So this is a fixed slate checker, like the crop overlay in /visual —
       the `clipboard-image-preview` class name survives only as the marker
       that says so. The fallback card on top of it is chrome and brings its
       own opaque surface, so it stays readable against the mat either way.
       (The old rule set `background-color` and then a `background`
       shorthand that wiped it, so the checker had not actually been drawn
       for a while.) -->
  <div
    class="clipboard-image-preview grid place-items-center w-full h-45 overflow-hidden"
    :class="{ failed }"
    style="background-color: #858e9b; background-image: linear-gradient(45deg, rgb(255 255 255 / 0.09) 25%, transparent 25%, transparent 75%, rgb(255 255 255 / 0.09) 75%), linear-gradient(45deg, rgb(255 255 255 / 0.09) 25%, transparent 25%, transparent 75%, rgb(255 255 255 / 0.09) 75%); background-position: 0 0, 10px 10px; background-size: 20px 20px"
  >
    <img v-if="source" :src="source" :alt="alt" loading="lazy" class="block w-full h-full p-2 object-contain" @error="handleLoadError" />
    <div v-else role="img" :aria-label="`${alt}不可用`" class="stack items-center gap-1 max-w-[85%] px-4 py-3 rounded-md bg-surface border border-line text-center">
      <strong class="text-[11px] font-semibold text-fg-2">图片预览不可用</strong>
      <span class="text-[11px] leading-snug text-fg-3">本地文件可能已经移动或被清理。</span>
    </div>
  </div>
</template>
