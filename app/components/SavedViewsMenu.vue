<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui'
import type { SavedViewConfig } from '#shared/savedViews'
import type { SavedView } from '#shared/types/board'

const props = defineProps<{
  views: SavedView[]
  /** The board's current view, grouping, column group and filter. */
  current: SavedViewConfig
  /** May manage shared views (editor, board not archived, online). */
  canShare: boolean
  offline: boolean
  create: (input: { name: string, shared: boolean, config: SavedViewConfig }) => Promise<SavedView>
  update: (view: SavedView, patch: { name?: string, config?: SavedViewConfig }) => Promise<SavedView>
  remove: (view: SavedView) => Promise<unknown>
}>()
const emit = defineEmits<{ apply: [view: SavedView] }>()
const { t } = useI18n()
const confirm = useConfirm()
const showError = useApiError()
const toast = useToast()

/** The saved view matching what the board shows now, if any (the user's own first). */
const active = computed(() => {
  const matches = props.views.filter(v => sameViewConfig(v.config, props.current))
  return matches.find(v => !v.shared) ?? matches[0] ?? null
})

const canChange = (v: SavedView) => !props.offline && (!v.shared || props.canShare)

const items = computed<DropdownMenuItem[][]>(() => {
  const entry = (v: SavedView): DropdownMenuItem => ({
    label: v.name,
    icon: v.shared ? 'i-lucide-users' : 'i-lucide-user',
    color: active.value?.id === v.id ? 'primary' : undefined,
    trailingIcon: active.value?.id === v.id ? 'i-lucide-check' : undefined,
    onSelect: () => emit('apply', v),
  })
  const shared = props.views.filter(v => v.shared)
  const personal = props.views.filter(v => !v.shared)
  const groups: DropdownMenuItem[][] = []
  if (shared.length) groups.push([{ type: 'label', label: t('savedViews.shared') }, ...shared.map(entry)])
  if (personal.length) groups.push([{ type: 'label', label: t('savedViews.personal') }, ...personal.map(entry)])
  const actions: DropdownMenuItem[] = [
    { label: t('savedViews.saveCurrent'), icon: 'i-lucide-bookmark-plus', disabled: props.offline, onSelect: openSave },
  ]
  if (props.views.length) actions.push({ label: t('savedViews.manage'), icon: 'i-lucide-settings-2', onSelect: () => { manageOpen.value = true } })
  groups.push(actions)
  return groups
})

// Save dialog.
const saveOpen = ref(false)
const draft = reactive({ name: '', shared: false })
const nameError = ref<string | null>(null)
const saving = ref(false)
function openSave() {
  Object.assign(draft, { name: '', shared: false })
  nameError.value = null
  saveOpen.value = true
}
const isConflict = (err: unknown) => (err as { statusCode?: number })?.statusCode === 409
async function save() {
  const name = draft.name.trim()
  if (!name || saving.value) return
  saving.value = true
  try {
    await props.create({ name, shared: draft.shared && props.canShare, config: props.current })
    saveOpen.value = false
    toast.add({ title: t('savedViews.saved', { name }), color: 'success' })
  }
  catch (err) {
    if (isConflict(err)) nameError.value = t('savedViews.nameTaken')
    else showError(err, t('savedViews.errors.save'))
  }
  finally {
    saving.value = false
  }
}

// Manage dialog.
const manageOpen = ref(false)
async function rename(view: SavedView, e: Event) {
  const input = e.target as HTMLInputElement
  const name = input.value.trim()
  if (!name || name === view.name) {
    input.value = view.name
    return
  }
  try {
    await props.update(view, { name })
  }
  catch (err) {
    input.value = view.name
    showError(err, isConflict(err) ? t('savedViews.nameTaken') : t('savedViews.errors.save'))
  }
}
async function overwrite(view: SavedView) {
  try {
    await props.update(view, { config: props.current })
    toast.add({ title: t('savedViews.updated', { name: view.name }), color: 'success' })
  }
  catch (err) {
    showError(err, t('savedViews.errors.save'))
  }
}
async function removeView(view: SavedView) {
  if (await confirm({ title: t('savedViews.confirmDelete', { name: view.name }), confirmLabel: t('common.delete') })) await props.remove(view)
}
</script>

<template>
  <UDropdownMenu :items="items" :content="{ align: 'start' }" :ui="{ content: 'min-w-56 max-w-80' }">
    <UButton
      color="neutral"
      variant="outline"
      :icon="active ? 'i-lucide-bookmark-check' : 'i-lucide-bookmark'"
      class="shrink-0 max-w-48 max-sm:h-8"
      :aria-label="active ? t('savedViews.activeLabel', { name: active.name }) : t('savedViews.label')"
    >
      <span class="hidden sm:inline group-data-c2/tb:hidden truncate">{{ active?.name ?? t('savedViews.label') }}</span>
    </UButton>
  </UDropdownMenu>

  <UModal v-model:open="saveOpen" :title="t('savedViews.saveTitle')" :description="t('savedViews.saveDescription')">
    <template #body>
      <form id="saved-view-form" class="space-y-4" @submit.prevent="save">
        <UFormField :label="t('savedViews.name')" :error="nameError ?? undefined">
          <UInput v-model="draft.name" :maxlength="50" autofocus class="w-full" @update:model-value="nameError = null" />
        </UFormField>
        <USwitch
          v-if="canShare"
          v-model="draft.shared"
          :label="t('savedViews.shareWithBoard')"
          :description="t('savedViews.shareHint')"
        />
      </form>
    </template>
    <template #footer>
      <div class="flex justify-end gap-2 w-full">
        <UButton color="neutral" variant="ghost" :label="t('common.cancel')" @click="saveOpen = false" />
        <UButton type="submit" form="saved-view-form" :label="t('common.save')" :loading="saving" :disabled="!draft.name.trim()" />
      </div>
    </template>
  </UModal>

  <UModal v-model:open="manageOpen" :title="t('savedViews.manageTitle')" :description="t('savedViews.manageDescription')">
    <template #body>
      <p v-if="!views.length" class="text-sm text-muted">
        {{ t('savedViews.empty') }}
      </p>
      <ul class="space-y-3">
        <li v-for="v in views" :key="v.id" class="flex flex-wrap items-center gap-2">
          <UTooltip :text="v.shared ? t('savedViews.sharedHint') : t('savedViews.personalHint')">
            <UIcon :name="v.shared ? 'i-lucide-users' : 'i-lucide-user'" class="size-4 text-muted shrink-0" />
          </UTooltip>
          <UInput
            :key="v.name"
            :default-value="v.name"
            :maxlength="50"
            :disabled="!canChange(v)"
            class="flex-1 min-w-32"
            :aria-label="t('savedViews.nameOf', { name: v.name })"
            @change="rename(v, $event)"
          />
          <UTooltip :text="t('savedViews.overwrite')">
            <UButton
              icon="i-lucide-refresh-cw"
              color="neutral"
              variant="ghost"
              :disabled="!canChange(v) || sameViewConfig(v.config, current)"
              :aria-label="t('savedViews.overwriteOf', { name: v.name })"
              @click="overwrite(v)"
            />
          </UTooltip>
          <UTooltip :text="t('savedViews.delete', { name: v.name })">
            <UButton
              icon="i-lucide-trash"
              color="error"
              variant="ghost"
              :disabled="!canChange(v)"
              :aria-label="t('savedViews.delete', { name: v.name })"
              @click="removeView(v)"
            />
          </UTooltip>
        </li>
      </ul>
    </template>
  </UModal>
</template>
