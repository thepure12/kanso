<script setup lang="ts">
import type { Attachment } from '#shared/types/board'
import type { CardDetailApi } from '~/composables/useCardDetail'

const props = defineProps<{ items: Attachment[] | null, canEdit: boolean, cd: CardDetailApi, coverId: string | null }>()
const emit = defineEmits<{ cover: [attachmentId: string | null] }>()
const toast = useToast()
const { t, locale } = useI18n()
const confirm = useConfirm()

const input = ref<HTMLInputElement>()
const uploading = ref(false)

const isImage = (a: Attachment) => ['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(a.contentType)

async function upload(files: File[]) {
  const tooBig = files.filter(f => f.size > ATTACHMENT_MAX_BYTES)
  if (tooBig.length) {
    toast.add({ title: t('attachments.tooBig'), description: tooBig.map(f => f.name).join(', '), color: 'error' })
    files = files.filter(f => f.size <= ATTACHMENT_MAX_BYTES)
  }
  if (!files.length) return
  uploading.value = true
  try {
    // The server takes at most 5 files per request.
    for (let i = 0; i < files.length; i += 5) await props.cd.upload(files.slice(i, i + 5))
  }
  finally { uploading.value = false }
}

function onPick(e: Event) {
  const el = e.target as HTMLInputElement
  upload([...el.files ?? []])
  el.value = ''
}

const dragOver = ref(false)
function onDrop(e: DragEvent) {
  dragOver.value = false
  if (props.canEdit) upload([...e.dataTransfer?.files ?? []])
}

// Pasting files or a screenshot anywhere in the open card attaches them
// (MarkdownEditor handles pastes into comments and the description itself).
function onPaste(e: ClipboardEvent) {
  if (e.defaultPrevented || !props.canEdit || !props.items) return
  const files = pastedFiles(e.clipboardData, isTextField(e.target))
  if (!files.length) return
  e.preventDefault()
  upload(files)
}
onMounted(() => document.addEventListener('paste', onPaste))
onBeforeUnmount(() => document.removeEventListener('paste', onPaste))

async function remove(a: Attachment) {
  if (await confirm({ title: t('attachments.confirmDelete', { name: a.name }), confirmLabel: t('common.delete') })) props.cd.deleteAttachment(a)
}
</script>

<template>
  <section
    v-if="props.items && (props.items.length || props.canEdit)"
    class="space-y-2 rounded-md"
    :class="dragOver && 'ring-2 ring-primary'"
    @dragover.prevent="dragOver = props.canEdit"
    @dragleave="dragOver = false"
    @drop.prevent="onDrop"
  >
    <div class="flex items-center gap-2">
      <UIcon name="i-lucide-paperclip" class="size-4 text-dimmed" />
      <h3 class="text-sm font-medium">
        {{ t('attachments.title') }}
      </h3>
      <UButton
        v-if="props.canEdit"
        size="xs"
        color="neutral"
        variant="ghost"
        icon="i-lucide-upload"
        :label="t('attachments.upload')"
        class="ms-auto"
        :loading="uploading"
        @click="input?.click()"
      />
      <input ref="input" type="file" multiple class="hidden" @change="onPick">
    </div>
    <p v-if="!props.items.length" class="text-xs text-muted">
      {{ t('attachments.empty') }}
    </p>
    <ul class="space-y-1">
      <li v-for="a in props.items" :key="a.id" class="group flex items-center gap-2 text-sm">
        <img v-if="isImage(a)" :src="appUrl(`/api/attachments/${a.id}`)" alt="" class="size-8 rounded object-cover shrink-0" loading="lazy">
        <UIcon v-else name="i-lucide-file" class="size-8 p-1.5 text-dimmed shrink-0" />
        <a :href="appUrl(`/api/attachments/${a.id}`)" target="_blank" rel="noopener" class="truncate hover:underline">{{ a.name }}</a>
        <span class="text-xs text-muted shrink-0">{{ formatBytes(a.size, locale) }}</span>
        <UBadge v-if="a.id === props.coverId" color="neutral" variant="subtle" size="sm" :label="t('attachments.cover')" class="shrink-0" />
        <UTooltip v-if="props.canEdit && isImage(a)" :text="a.id === props.coverId ? t('attachments.removeCover') : t('attachments.setCover')">
          <UButton
            :icon="a.id === props.coverId ? 'i-lucide-image-off' : 'i-lucide-image'"
            size="xs"
            color="neutral"
            variant="ghost"
            :aria-label="a.id === props.coverId ? t('attachments.removeCover') : t('attachments.setCover')"
            class="ms-auto"
            @click="emit('cover', a.id === props.coverId ? null : a.id)"
          />
        </UTooltip>
        <UTooltip :text="t('attachments.download')">
          <UButton
            :to="appUrl(`/api/attachments/${a.id}?download`)"
            external
            download
            icon="i-lucide-download"
            size="xs"
            color="neutral"
            variant="ghost"
            :aria-label="t('attachments.download')"
            :class="!(props.canEdit && isImage(a)) && 'ms-auto'"
          />
        </UTooltip>
        <UTooltip v-if="props.canEdit" :text="t('attachments.delete')">
          <UButton
            icon="i-lucide-trash"
            size="xs"
            color="error"
            variant="ghost"
            :aria-label="t('attachments.delete')"
            @click="remove(a)"
          />
        </UTooltip>
      </li>
    </ul>
  </section>
</template>
