<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { inspectDesktopInputFile, isDesktop, listenWindowFileDrops, readDesktopInputFile } from '@/lib/native'
import { acceptsDroppedFile, exceedsDroppedFileLimit, filesWithinDropBudget, formatDropFileSize } from '@/lib/file-drop-policy'
import AppIcon from '@/components/AppIcon.vue'
/**
 * `compact` collapses the empty state from a tall invitation into a single
 * row. A library that already holds files does not need to be invited to
 * accept more — but it still has to stay mounted, because this component owns
 * the desktop drag-and-drop listener, and unmounting it to save space would
 * silently turn off dropping files onto the window.
 */
const props=withDefaults(defineProps<{modelValue:File[];accept?:string;multiple?:boolean;title?:string;hint?:string;disabled?:boolean;maxFileBytes?:number;maxTotalBytes?:number;maxFiles?:number;desktopPathOnly?:boolean;compact?:boolean}>(),{accept:'*/*',multiple:true,title:'拖入文件立即开始',hint:'支持批量文件；原件保持只读',disabled:false,maxFiles:100,desktopPathOnly:false,compact:false})
const emit=defineEmits<{ 'update:modelValue':[files:File[]]; 'desktop-paths':[paths:string[]]; 'request-desktop-choose':[]; error:[message:string] }>();const input=ref<HTMLInputElement>();const active=ref(false);const loading=ref(false);const previews=ref(new Map<File,string>());let unlisten:()=>void=()=>{};let disposed=false
const files=computed(()=>props.modelValue)
function accepted(file:Pick<File,'name'|'type'>){return acceptsDroppedFile(file,props.accept)}
function update(next:File[]){if(props.disabled)return;const compatible=next.filter(accepted);const perFileValid=compatible.filter(file=>!exceedsDroppedFileLimit(file,props.maxFileBytes));const budgeted=filesWithinDropBudget(perFileValid,props.maxTotalBytes);if(compatible.length!==next.length)emit('error',`${next.length-compatible.length} 个文件类型不受当前工具支持。`);if(perFileValid.length!==compatible.length)emit('error',`${compatible.length-perFileValid.length} 个文件超过 ${formatDropFileSize(props.maxFileBytes||0)}，未载入内存。`);if(budgeted.rejected)emit('error',`${budgeted.rejected} 个文件会使本次输入超过 ${formatDropFileSize(props.maxTotalBytes||0)}，未载入内存。`);const limit=props.multiple?Math.max(1,Math.trunc(props.maxFiles)):1;if(budgeted.files.length>limit)emit('error',`一次最多选择 ${limit} 个文件，其余文件未载入。`);emit('update:modelValue',budgeted.files.slice(0,limit))}
function receive(list:FileList|File[]){if(!props.disabled)update(Array.from(list))}function dragEnter(){if(!props.disabled)active.value=true}function choose(event:Event){const target=event.target as HTMLInputElement;if(!props.disabled)receive(target.files||[]);target.value=''}function drop(event:DragEvent){active.value=false;if(props.desktopPathOnly&&isDesktop())return;if(!props.disabled&&event.dataTransfer?.files.length)receive(event.dataTransfer.files)}function remove(index:number){if(!props.disabled)update(files.value.filter((_,i)=>i!==index))}function clear(){if(!props.disabled)update([]);if(input.value)input.value.value=''}
function preview(file:File){if(!file.type.startsWith('image/'))return '';if(!previews.value.has(file))previews.value.set(file,URL.createObjectURL(file));return previews.value.get(file)!}
function chooseFiles(){if(props.desktopPathOnly&&isDesktop()){emit('request-desktop-choose');return}input.value?.click()}
const formatSize=formatDropFileSize
const totalSize=computed(()=>files.value.reduce((sum,file)=>sum+file.size,0))
function iconFor(file:File){return file.type==='application/pdf'?'file-pdf':file.type.startsWith('text/')?'file-text':file.type.startsWith('image/')?'file-image':file.type.startsWith('audio/')||file.type.startsWith('video/')?'play':'attachment'}
watch(files,current=>{for(const[file,url]of previews.value)if(!current.includes(file)){URL.revokeObjectURL(url);previews.value.delete(file)}})
onMounted(async()=>{try{const stop=await listenWindowFileDrops(async paths=>{if(props.disabled)return;loading.value=true;try{const loaded:File[]=[];const acceptedPaths:string[]=[];const acceptedMetadata:{path:string;size:number}[]=[];const limit=props.multiple?Math.max(1,Math.trunc(props.maxFiles)):1;if(paths.length>limit)emit('error',`一次最多选择 ${limit} 个文件，其余文件未载入。`);for(const path of paths.slice(0,limit)){if(props.disabled)break;const metadata=await inspectDesktopInputFile(path);const candidate={name:metadata.name,type:metadata.mime,size:metadata.size};if(!accepted(candidate)){emit('error',`“${metadata.name}”的文件类型不受当前工具支持，未载入内存。`);continue}if(exceedsDroppedFileLimit(candidate,props.maxFileBytes)){emit('error',`“${metadata.name}”超过 ${formatDropFileSize(props.maxFileBytes||0)}，未载入内存。`);continue}acceptedPaths.push(path);acceptedMetadata.push({path,size:metadata.size})}const budgeted=filesWithinDropBudget(acceptedMetadata,props.maxTotalBytes);if(budgeted.rejected)emit('error',`${budgeted.rejected} 个文件会使本次输入超过 ${formatDropFileSize(props.maxTotalBytes||0)}，未载入内存。`);const budgetPaths=new Set(budgeted.files.map(item=>item.path));if(props.desktopPathOnly){emit('desktop-paths',acceptedPaths.filter(path=>budgetPaths.has(path)));return}for(const path of acceptedPaths)if(budgetPaths.has(path))loaded.push(await readDesktopInputFile(path));update(loaded)}catch(error){emit('error',error instanceof Error?error.message:'无法读取拖入的文件。')}finally{loading.value=false}});if(disposed)stop();else unlisten=stop}catch(error){if(!disposed)emit('error',error instanceof Error?error.message:'无法启用桌面拖放。')}})
onBeforeUnmount(()=>{disposed=true;unlisten();previews.value.forEach(URL.revokeObjectURL)})
</script>
<template>
  <!--
    Two shapes, not two components: an invitation when it is empty, a manifest
    once it holds something. The empty state is allowed to be large because
    it is the only thing on screen; the filled state gives its height back to
    the file list, because by then the question is "did I pick the right
    files", not "where do I drop them".
  -->
  <section
    class="relative flex flex-col rounded-lg transition-colors duration-150"
    :class="[
      files.length ? 'bg-surface border border-line' : 'border border-dashed border-line-strong bg-well',
      active && !disabled ? 'border-solid! border-accent bg-accent-soft' : '',
      disabled ? 'opacity-60' : '',
    ]"
    :aria-busy="loading"
    :aria-disabled="disabled"
    @dragenter.prevent="dragEnter"
    @dragover.prevent
    @dragleave.prevent="active = false"
    @drop.prevent="drop"
  >
    <!-- Compact: one row at every state, so whatever sits beside it keeps the
         height. The page that asked for `compact` is showing the files itself
         in a list of its own, so repeating them here would be the same names
         twice in one column. -->
    <div v-if="compact" class="row gap-2.5 px-3 h-11">
      <AppIcon name="inbox" :size="16" class="shrink-0" :class="active && !disabled ? 'text-accent' : 'text-fg-3'" />
      <span
        class="min-w-0 flex-1 truncate text-[12px]"
        :class="active && !disabled ? 'text-accent' : 'text-fg-3'"
        :title="files.length ? `${files.length} 个文件 · ${formatSize(totalSize)}` : undefined"
      >
        {{ loading
          ? (desktopPathOnly ? '正在建立本地索引…' : '正在读取文件…')
          : active && !disabled
            ? (files.length ? '松手即可追加' : '松手即可载入')
            : files.length ? `${files.length} 个文件` : title }}
      </span>
      <button v-if="files.length" class="btn-ghost btn-sm shrink-0 text-fg-3 hover:not-disabled:text-danger" :disabled="disabled" @click="clear">清空</button>
      <button class="btn-ghost btn-sm shrink-0" :disabled="disabled || loading" @click="chooseFiles">{{ files.length ? '添加' : '选择文件' }}</button>
    </div>

    <!-- Empty: the whole surface is the target, so it reads as one. -->
    <div v-else-if="!files.length" class="flex-1 stack items-center justify-center gap-3 px-6 py-10 text-center">
      <span class="center w-11 h-11 rounded-lg bg-surface-2 text-fg-3" :class="active && !disabled ? 'text-accent' : ''">
        <AppIcon name="inbox" :size="22" />
      </span>
      <div class="stack gap-1">
        <strong class="text-[14px] font-semibold text-fg">
          {{ loading ? (desktopPathOnly ? '正在建立本地索引…' : '正在读取文件…') : active && !disabled ? '松手即可载入' : title }}
        </strong>
        <small class="text-[12px] text-fg-3 max-w-80">{{ disabled ? '任务进行中，输入已锁定' : hint }}</small>
      </div>
      <button class="btn-default btn-sm" :disabled="disabled || loading" @click="chooseFiles">选择文件</button>
    </div>

    <!-- Filled: a count you can trust, then the files themselves. -->
    <template v-else>
      <header class="row-between gap-3 px-3 h-11 border-b border-line">
        <p class="row gap-2 text-[13px] min-w-0">
          <AppIcon name="inbox" :size="16" class="text-fg-3 shrink-0" />
          <strong class="font-semibold text-fg">{{ files.length }} 个文件</strong>
          <span class="text-fg-3 tabular-nums">{{ formatSize(totalSize) }}</span>
        </p>
        <span class="row gap-1 shrink-0">
          <button class="btn-ghost btn-sm" :disabled="disabled || loading" @click="chooseFiles">添加</button>
          <button class="btn-ghost btn-sm text-fg-3 hover:text-danger" :disabled="disabled" @click="clear">清空</button>
        </span>
      </header>
      <ul class="stack flex-1 min-h-0 overflow-y-auto p-1.5 gap-0.5">
        <li
          v-for="(file, index) in files"
          :key="`${file.name}-${file.lastModified}-${index}`"
          class="group row gap-2.5 px-2 py-1.5 rounded-sm hover:bg-surface-2"
        >
          <img v-if="preview(file)" :src="preview(file)" alt="" class="w-8 h-8 rounded-sm object-cover bg-surface-2 shrink-0" />
          <span v-else class="center w-8 h-8 rounded-sm bg-surface-2 text-fg-3 shrink-0">
            <AppIcon :name="iconFor(file)" :size="16" />
          </span>
          <span class="stack min-w-0 flex-1 leading-tight">
            <strong class="text-[13px] font-normal text-fg truncate">{{ file.name }}</strong>
            <small class="text-[11px] text-fg-3 tabular-nums">{{ formatSize(file.size) }}</small>
          </span>
          <button
            class="center w-6 h-6 rounded-sm text-fg-3 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 hover:bg-surface-3 hover:text-danger"
            :disabled="disabled"
            :title="`移除 ${file.name}`"
            @click="remove(index)"
          >
            <AppIcon name="close" :size="14" />
          </button>
        </li>
      </ul>
      <!-- Dropping onto a filled zone still works; this says so without
           reserving a permanent strip for the message. -->
      <p v-if="active && !disabled" class="absolute inset-0 center rounded-lg bg-accent-soft text-[13px] font-medium text-accent backdrop-blur-[1px]">
        松手即可追加
      </p>
    </template>

    <input ref="input" class="hidden" type="file" :multiple="multiple" :accept="accept" :disabled="disabled" @change="choose" />
  </section>
</template>
