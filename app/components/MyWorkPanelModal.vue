<script setup lang="ts">
import type { MyWorkOptions, MyWorkPanel } from '#shared/types/myWork'
import { emptyMyWorkPanelConfig, MY_WORK_PANEL_NAME_MAX, myWorkBuckets, myWorkPeople, type MyWorkPanelConfig } from '#shared/myWork'
import { priorities } from '#shared/types/board'

// Add or edit a My work panel (opened through useOverlay). Closes with the
// name and query, or null when cancelled.
const props = defineProps<{ panel?: MyWorkPanel, options: MyWorkOptions }>()
const emit = defineEmits<{ close: [{ name: string, config: MyWorkPanelConfig } | null] }>()
const { t } = useI18n()

const name = ref(props.panel?.name ?? '')
const form = reactive<MyWorkPanelConfig>(structuredClone(toRaw(props.panel?.config) ?? emptyMyWorkPanelConfig()))
const nameError = ref<string>()

const peopleItems = computed(() => myWorkPeople.map(p => ({ label: t(`myWork.people.${p}`), value: p })))
const personItems = computed(() => props.options.people.map(p => ({ label: p.name, value: p.id, ...personItem(p, t('bots.badge')) })))
// Typed names stay selectable even when no board has them (yet).
const columnItems = ref([...new Set([...props.options.columns, ...form.columns])])
const tagItems = computed(() => {
  const known = new Map(props.options.tags.map(tag => [tag.name.toLowerCase(), tag]))
  const extra = form.tags.filter(n => !known.has(n.toLowerCase())).map(n => ({ name: n, color: '#94a3b8' }))
  return [...props.options.tags, ...extra]
})
const boardItems = computed(() => props.options.boards.map(b => ({ label: b.name, value: b.id })))
const priorityItems = computed(() => [...priorities, 'none' as const].map(p => ({ label: p === 'none' ? t('myWork.panels.noPriority') : t(`priority.${p}`), value: p })))
const dueItems = computed(() => myWorkBuckets.map(b => ({ label: t(`myWork.buckets.${b}`), value: b })))

function addColumn(title: string) {
  const v = title.trim()
  if (!v) return
  if (!columnItems.value.some(c => c.toLowerCase() === v.toLowerCase())) columnItems.value.push(v)
  if (!form.columns.some(c => c.toLowerCase() === v.toLowerCase())) form.columns.push(v)
}
function addTag(tagName: string) {
  const v = tagName.trim()
  if (v && !form.tags.some(n => n.toLowerCase() === v.toLowerCase())) form.tags.push(v)
}

const peopleMissing = computed(() => form.people === 'people' && !form.userIds.length)

function submit() {
  nameError.value = name.value.trim() ? undefined : t('myWork.panels.nameRequired')
  if (nameError.value || peopleMissing.value) return
  emit('close', { name: name.value.trim(), config: { ...toRaw(form), userIds: form.people === 'people' ? [...form.userIds] : [] } })
}
</script>

<template>
  <UModal
    :title="props.panel ? t('myWork.panels.editTitle') : t('myWork.panels.addTitle')"
    :description="t('myWork.panels.hint')"
    :close="false"
    @update:open="(open: boolean) => { if (!open) emit('close', null) }"
  >
    <template #body>
      <form id="my-work-panel-form" class="space-y-4" @submit.prevent="submit">
        <UFormField :label="t('myWork.panels.name')" :error="nameError" required>
          <UInput v-model="name" class="w-full" autofocus :maxlength="MY_WORK_PANEL_NAME_MAX" @update:model-value="nameError = undefined" />
        </UFormField>
        <UFormField :label="t('myWork.panels.whose')">
          <USelect v-model="form.people" :items="peopleItems" value-key="value" class="w-full" />
        </UFormField>
        <UFormField v-if="form.people === 'people'" :label="t('myWork.panels.assignedTo')" :error="peopleMissing ? t('myWork.panels.pickPeople') : undefined">
          <USelectMenu v-model="form.userIds" :items="personItems" value-key="value" multiple icon="i-lucide-user" class="w-full" />
        </UFormField>
        <UFormField :label="t('myWork.panels.columns')" :hint="t('myWork.panels.byName')">
          <USelectMenu v-model="form.columns" :items="columnItems" multiple create-item icon="i-lucide-columns-3" :placeholder="t('myWork.panels.anyColumn')" class="w-full" @create="addColumn">
            <template #create-item-label="{ item }">
              {{ t('myWork.panels.useName', { name: item }) }}
            </template>
          </USelectMenu>
        </UFormField>
        <UFormField :label="t('myWork.panels.tags')" :hint="t('myWork.panels.byName')">
          <USelectMenu v-model="form.tags" :items="tagItems" value-key="name" label-key="name" multiple create-item icon="i-lucide-tag" :placeholder="t('myWork.panels.anyTag')" class="w-full" @create="addTag">
            <template #item-leading="{ item }">
              <span class="size-3 rounded-full shrink-0 self-center" :style="{ backgroundColor: item.color }" />
            </template>
            <template #create-item-label="{ item }">
              {{ t('myWork.panels.useName', { name: item }) }}
            </template>
          </USelectMenu>
        </UFormField>
        <UFormField :label="t('myWork.panels.boards')">
          <USelectMenu v-model="form.boardIds" :items="boardItems" value-key="value" multiple icon="i-lucide-kanban" :placeholder="t('myWork.panels.anyBoard')" class="w-full" />
        </UFormField>
        <div class="grid gap-4 sm:grid-cols-2">
          <UFormField :label="t('myWork.panels.priority')">
            <USelectMenu v-model="form.priorities" :items="priorityItems" value-key="value" multiple :search-input="false" icon="i-lucide-flag" :placeholder="t('myWork.panels.any')" class="w-full" />
          </UFormField>
          <UFormField :label="t('myWork.panels.due')">
            <USelectMenu v-model="form.due" :items="dueItems" value-key="value" multiple :search-input="false" icon="i-lucide-calendar" :placeholder="t('myWork.panels.any')" class="w-full" />
          </UFormField>
        </div>
        <USwitch v-model="form.showDone" :label="t('myWork.showDone')" />
      </form>
    </template>
    <template #footer>
      <div class="flex justify-end gap-2 w-full">
        <UButton color="neutral" variant="ghost" :label="t('common.cancel')" @click="emit('close', null)" />
        <UButton type="submit" form="my-work-panel-form" :label="t('common.save')" />
      </div>
    </template>
  </UModal>
</template>
