<script setup lang="ts">
import type { Tag } from '#shared/types/board'

const props = defineProps<{ tags: Tag[] }>()
const emit = defineEmits<{
  create: [tag: Omit<Tag, 'id'>]
  update: [tag: Tag, patch: Partial<Omit<Tag, 'id'>>]
  delete: [tag: Tag]
}>()
const open = defineModel<boolean>('open', { required: true })
const { t } = useI18n()
const confirm = useConfirm()

const randomPreset = () => colorPresets[Math.floor(Math.random() * colorPresets.length)]!
const draft = reactive({ name: '', color: randomPreset() })

// Colour being edited in a popover: an existing tag's id, or 'new' for the draft.
const picking = ref<{ id: string, color: string } | null>(null)

function setPicking(id: string, color: string, isOpen: boolean) {
  if (isOpen) {
    picking.value = { id, color }
    return
  }
  const p = picking.value
  picking.value = null
  if (!p || p.id !== id) return
  if (id === 'new') {
    draft.color = p.color
    return
  }
  const tag = props.tags.find(t => t.id === id)
  if (tag && tag.color !== p.color) emit('update', tag, { color: p.color })
}

function rename(tag: Tag, e: Event) {
  const input = e.target as HTMLInputElement
  const name = input.value.trim()
  if (!name) input.value = tag.name
  else if (name !== tag.name) emit('update', tag, { name })
}

function create() {
  const name = draft.name.trim()
  if (!name) return
  emit('create', { name, color: draft.color })
  Object.assign(draft, { name: '', color: randomPreset() })
}

async function remove(tag: Tag) {
  if (await confirm({ title: t('tags.confirmDelete', { name: tag.name }), confirmLabel: t('common.delete') })) emit('delete', tag)
}
</script>

<template>
  <UModal v-model:open="open" :title="t('tags.title')" :description="t('tags.description')">
    <template #body>
      <div class="space-y-2">
        <p v-if="!props.tags.length" class="text-sm text-muted">
          {{ t('tags.empty') }}
        </p>
        <div v-for="tag in props.tags" :key="tag.id" class="flex items-center gap-2">
          <UPopover
            :open="picking?.id === tag.id"
            @update:open="v => setPicking(tag.id, tag.color, v)"
          >
            <button
              type="button"
              class="size-8 shrink-0 rounded-md ring ring-default"
              :style="{ backgroundColor: picking?.id === tag.id ? picking.color : tag.color }"
              :aria-label="t('views.changeColour', { name: tag.name })"
            />
            <template #content>
              <div v-if="picking" class="p-4 w-72">
                <ColorField v-model="picking.color" />
              </div>
            </template>
          </UPopover>
          <UInput :key="tag.name" :default-value="tag.name" :maxlength="50" class="flex-1" @change="rename(tag, $event)" />
          <UTooltip :text="t('tags.delete', { name: tag.name })">
            <UButton icon="i-lucide-trash" color="error" variant="ghost" :aria-label="t('tags.delete', { name: tag.name })" @click="remove(tag)" />
          </UTooltip>
        </div>

        <USeparator class="my-4" />

        <form class="flex items-center gap-2" @submit.prevent="create">
          <UPopover
            :open="picking?.id === 'new'"
            @update:open="v => setPicking('new', draft.color, v)"
          >
            <button
              type="button"
              class="size-8 shrink-0 rounded-md ring ring-default"
              :style="{ backgroundColor: picking?.id === 'new' ? picking.color : draft.color }"
              :aria-label="t('tags.newColour')"
            />
            <template #content>
              <div v-if="picking" class="p-4 w-72">
                <ColorField v-model="picking.color" />
              </div>
            </template>
          </UPopover>
          <UInput v-model="draft.name" :placeholder="t('tags.newTag')" :maxlength="50" class="flex-1" />
          <UButton type="submit" icon="i-lucide-plus" :label="t('common.add')" :disabled="!draft.name.trim()" />
        </form>
      </div>
    </template>
  </UModal>
</template>
