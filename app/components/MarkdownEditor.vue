<script setup lang="ts">
import type { Attachment, Member } from '#shared/types/board'

/**
 * With `members`, typing `@` suggests people and inserts mention tokens (app/utils/mentions.ts).
 * With `upload`, images and files pasted, dropped or picked with the Image button become
 * card attachments, linked at the caret as `attachment:<id>` (app/utils/attachmentLinks.ts).
 */
const props = defineProps<{
  placeholder?: string
  rows?: number
  disabled?: boolean
  members?: Member[]
  upload?: (files: File[]) => Promise<Attachment[]>
}>()
const model = defineModel<string>({ required: true })
const preview = ref(false)
const { t } = useI18n()
const toast = useToast()

const textarea = useTemplateRef<{ textareaRef: HTMLTextAreaElement | null }>('textarea')
const mention = ref<{ start: number, query: string } | null>(null)
const highlighted = ref(0)

const suggestions = computed(() => {
  if (!mention.value || !props.members?.length) return []
  const q = mention.value.query.toLowerCase()
  return props.members
    .filter(m => m.name.toLowerCase().includes(q) || m.email.toLowerCase().startsWith(q))
    .slice(0, 6)
})

function updateMention() {
  const el = textarea.value?.textareaRef
  if (!props.members?.length || !el || el.selectionStart !== el.selectionEnd) {
    mention.value = null
    return
  }
  // The textarea's own value: on `input` the model has not caught up with the keystroke yet.
  mention.value = mentionQuery(el.value, el.selectionStart)
  highlighted.value = 0
}

async function pick(m: Member) {
  const el = textarea.value?.textareaRef
  const at = mention.value
  if (!el || !at) return
  const token = `${mentionToken(m)} `
  const caret = at.start + 1 + at.query.length
  model.value = el.value.slice(0, at.start) + token + el.value.slice(caret)
  mention.value = null
  await nextTick()
  el.focus()
  el.setSelectionRange(at.start + token.length, at.start + token.length)
}

let uploads = 0

// A placeholder marks the spot while the files upload, so typing on meanwhile keeps its place.
async function insertFiles(files: File[]) {
  const el = textarea.value?.textareaRef
  if (!props.upload || !el) return
  const tooBig = files.filter(f => f.size > ATTACHMENT_MAX_BYTES)
  if (tooBig.length) toast.add({ title: t('attachments.tooBig'), description: tooBig.map(f => f.name).join(', '), color: 'error' })
  const ok = files.filter(f => f.size <= ATTACHMENT_MAX_BYTES)
  if (!ok.length) return

  const marker = `[${t('editor.uploading', { name: ok.map(f => f.name).join(', ') })}](uploading:${++uploads})`
  const { selectionStart: start, selectionEnd: end } = el
  model.value = el.value.slice(0, start) + marker + el.value.slice(end)
  await nextTick()
  el.focus()
  el.setSelectionRange(start + marker.length, start + marker.length)

  const added: Attachment[] = []
  for (let i = 0; i < ok.length; i += 5) added.push(...await props.upload(ok.slice(i, i + 5)))
  model.value = model.value.replace(marker, added.map(attachmentMarkdown).join('\n'))
}

// preventDefault also tells CardAttachments' document listener to leave the paste alone.
function onPaste(e: ClipboardEvent) {
  if (!props.upload) return
  const files = pastedFiles(e.clipboardData, true)
  if (!files.length) return
  e.preventDefault()
  insertFiles(files)
}

const fileInput = useTemplateRef<HTMLInputElement>('fileInput')
async function pickFiles() {
  preview.value = false
  await nextTick()
  fileInput.value?.click()
}
function onPick(e: Event) {
  const el = e.target as HTMLInputElement
  insertFiles([...el.files ?? []])
  el.value = ''
}

const dragOver = ref(false)
const hasFiles = (e: DragEvent) => !!props.upload && !!e.dataTransfer?.types.includes('Files')
function onDragOver(e: DragEvent) {
  if (!hasFiles(e)) return
  e.preventDefault()
  dragOver.value = true
}
function onDrop(e: DragEvent) {
  dragOver.value = false
  if (!hasFiles(e)) return
  e.preventDefault()
  e.stopPropagation()
  insertFiles([...e.dataTransfer!.files])
}

const hint = computed(() => {
  if (props.upload) return props.members?.length ? t('editor.markdownMentionsFiles') : t('editor.markdownFiles')
  return props.members?.length ? t('editor.markdownMentions') : t('editor.markdown')
})

function onKeydown(e: KeyboardEvent) {
  if (!suggestions.value.length) return
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault()
    const n = suggestions.value.length
    highlighted.value = (highlighted.value + (e.key === 'ArrowDown' ? 1 : n - 1)) % n
  }
  else if (e.key === 'Enter' || e.key === 'Tab') {
    e.preventDefault()
    pick(suggestions.value[highlighted.value]!)
  }
  else if (e.key === 'Escape') {
    e.stopPropagation()
    mention.value = null
  }
}
</script>

<template>
  <div class="space-y-1">
    <div class="flex gap-1">
      <UButton size="xs" :variant="preview ? 'ghost' : 'soft'" color="neutral" :label="t('editor.write')" @click="preview = false" />
      <UButton size="xs" :variant="preview ? 'soft' : 'ghost'" color="neutral" :label="t('editor.preview')" @click="preview = true" />
      <UTooltip v-if="props.upload" :text="t('editor.addImageHint')">
        <UButton
          size="xs"
          variant="ghost"
          color="neutral"
          icon="i-lucide-image-plus"
          :aria-label="t('editor.addImage')"
          :disabled="props.disabled"
          @click="pickFiles"
        >
          <span class="hidden sm:inline">{{ t('editor.addImage') }}</span>
        </UButton>
      </UTooltip>
      <input ref="fileInput" type="file" accept="image/*" multiple class="hidden" @change="onPick">
      <span class="ms-auto text-xs text-dimmed self-center text-end">{{ hint }}</span>
    </div>
    <div v-if="preview" class="min-h-20 rounded-md ring ring-default p-3">
      <MarkdownText v-if="model.trim()" :text="model" />
      <p v-else class="text-sm text-muted">
        {{ t('editor.nothingToPreview') }}
      </p>
    </div>
    <div
      v-else
      class="relative rounded-md"
      :class="dragOver && 'ring-2 ring-primary'"
      @dragover="onDragOver"
      @dragleave="dragOver = false"
      @drop="onDrop"
    >
      <UTextarea
        ref="textarea"
        v-model="model"
        class="w-full"
        :rows="props.rows ?? 6"
        autoresize
        :placeholder="props.placeholder"
        :disabled="props.disabled"
        @input="updateMention"
        @click="updateMention"
        @keyup.left.right="updateMention"
        @keydown="onKeydown"
        @blur="mention = null"
        @paste="onPaste"
      />
      <ul
        v-if="suggestions.length"
        role="listbox"
        :aria-label="t('editor.mention')"
        class="absolute inset-x-0 top-full z-10 mt-1 max-w-xs rounded-md bg-default p-1 shadow-lg ring ring-default"
      >
        <li
          v-for="(m, i) in suggestions"
          :key="m.userId"
          role="option"
          :aria-selected="i === highlighted"
          class="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm"
          :class="i === highlighted ? 'bg-elevated' : ''"
          @mousedown.prevent="pick(m)"
          @mouseenter="highlighted = i"
        >
          <UAvatar :src="m.avatarUrl ?? undefined" :alt="m.name" size="2xs" />
          <span class="truncate">{{ m.name }}</span>
          <span class="truncate text-xs text-muted">{{ m.email }}</span>
        </li>
      </ul>
    </div>
  </div>
</template>
