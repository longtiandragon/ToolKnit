<script setup lang="ts">
import { computed } from 'vue'
import type { Component } from 'vue'
import {
  Binary,
  Bold,
  Archive,
  ArrowRight,
  Blocks,
  BookOpenText,
  Braces,
  Clock3,
  CalendarDays,
  Camera,
  Check,
  CirclePlay,
  Clipboard,
  CodeXml,
  Code2,
  Combine,
  Copy,
  Crop,
  Download,
  FileCode,
  FileImage,
  FileOutput,
  FilePenLine,
  FileText,
  Folder,
  FolderOpen,
  FingerprintPattern,
  FlaskConical,
  GitCompareArrows,
  Hash,
  Images,
  Italic,
  Inbox,
  Link2,
  List,
  ListOrdered,
  Palette,
  Pause,
  Paperclip,
  Plus,
  QrCode,
  Quote,
  Regex,
  RotateCcw,
  RotateCw,
  RefreshCw,
  ChevronRight,
  ChevronLeft,
  Scaling,
  Search,
  Settings2,
  Scissors,
  Heading2,
  ShieldCheck,
  Sparkles,
  Split,
  SquareTerminal,
  Star,
  Stamp,
  Table2,
  Trash2,
  TriangleAlert,
  X,
  ListChecks,
  Minus,
  Minimize2,
  Sigma,
  MousePointer2,
  Square,
  MoreHorizontal,
} from '@lucide/vue'

const props = withDefaults(defineProps<{ name: string; size?: number; label?: string }>(), {
  size: 18,
  label: '',
})

const icons: Record<string, Component> = {
  dashboard: Blocks,
  inbox: Inbox,
  toolbox: Blocks,
  code: CodeXml,
  image: Images,
  sparkle: Sparkles,
  book: BookOpenText,
  review: RotateCcw,
  flask: FlaskConical,
  settings: Settings2,
  search: Search,
  plus: Plus,
  close: X,
  merge: Combine,
  split: Split,
  resize: Scaling,
  crop: Crop,
  rotate: RotateCw,
  extract: FileOutput,
  sort: ListOrdered,
  watermark: Stamp,
  number: Hash,
  'file-pdf': FileText,
  'file-image': FileImage,
  'file-text': FileText,
  'file-code': FileCode,
  folder: Folder,
  'folder-open': FolderOpen,
  refresh: RefreshCw,
  chevron: ChevronRight,
  'chevron-left': ChevronLeft,
  json: Braces,
  link: Link2,
  shield: ShieldCheck,
  hash: Hash,
  fingerprint: FingerprintPattern,
  clock: Clock3,
  calendar: CalendarDays,
  camera: Camera,
  check: Check,
  play: CirclePlay,
  pause: Pause,
  attachment: Paperclip,
  binary: Binary,
  bold: Bold,
  italic: Italic,
  heading: Heading2,
  list: List,
  quote: Quote,
  'inline-code': Code2,
  regex: Regex,
  diff: GitCompareArrows,
  rename: FilePenLine,
  duplicate: Copy,
  palette: Palette,
  terminal: SquareTerminal,
  star: Star,
  warning: TriangleAlert,
  archive: Archive,
  clipboard: Clipboard,
  cut: Scissors,
  trash: Trash2,
  task: ListChecks,
  table: Table2,
  rule: Minus,
  pointer: MousePointer2,
  more: MoreHorizontal,
  square: Square,
  minimize: Minimize2,
  math: Sigma,
  download: Download,
  'qr-code': QrCode,
  'arrow-right': ArrowRight,
}

const icon = computed(() => icons[props.name])
</script>

<template>
  <component
    :is="icon"
    v-if="icon"
    class="app-icon"
    :size="size"
    :stroke-width="1.85"
    :aria-label="label || undefined"
    :aria-hidden="label ? undefined : 'true'"
  />
  <svg
    v-else
    class="app-icon"
    :width="size"
    :height="size"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.85"
    stroke-linecap="round"
    stroke-linejoin="round"
    :role="label ? 'img' : undefined"
    :aria-label="label || undefined"
    :aria-hidden="label ? undefined : 'true'"
  >
    <use :href="`/icons/toolknit-icons.svg#icon-${name}`" />
  </svg>
</template>
