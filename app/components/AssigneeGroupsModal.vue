<script setup lang="ts">
import type { AssigneeGroup, Member } from '#shared/types/board'

const props = defineProps<{ groups: AssigneeGroup[], members: Member[] }>()
const emit = defineEmits<{
  create: [group: Pick<AssigneeGroup, 'name' | 'userIds'>]
  update: [group: AssigneeGroup, patch: Partial<Pick<AssigneeGroup, 'name' | 'userIds'>>]
  delete: [group: AssigneeGroup]
}>()
const open = defineModel<boolean>('open', { required: true })
const { t } = useI18n()
const confirm = useConfirm()

const memberItems = computed(() => props.members.map(m => ({ label: m.name, value: m.userId, ...personItem(m, t('bots.badge')) })))

const draft = reactive({ name: '', userIds: [] as string[] })

function create() {
  const name = draft.name.trim()
  if (!name) return
  emit('create', { name, userIds: draft.userIds })
  Object.assign(draft, { name: '', userIds: [] })
}

function rename(group: AssigneeGroup, e: Event) {
  const input = e.target as HTMLInputElement
  const name = input.value.trim()
  if (!name) input.value = group.name
  else if (name !== group.name) emit('update', group, { name })
}

async function remove(group: AssigneeGroup) {
  if (await confirm({ title: t('assigneeGroups.confirmDelete', { name: group.name }), confirmLabel: t('common.delete') })) emit('delete', group)
}
</script>

<template>
  <UModal v-model:open="open" :title="t('assigneeGroups.title')" :description="t('assigneeGroups.description')">
    <template #body>
      <div class="space-y-3">
        <p v-if="!props.groups.length" class="text-sm text-muted">
          {{ t('assigneeGroups.empty') }}
        </p>
        <div v-for="group in props.groups" :key="group.id" class="flex flex-wrap items-center gap-2">
          <UIcon name="i-lucide-users" class="size-4 text-dimmed shrink-0" />
          <UInput :key="group.name" :default-value="group.name" :maxlength="50" class="flex-1 min-w-32" :aria-label="t('assigneeGroups.nameOf', { name: group.name })" @change="rename(group, $event)" />
          <USelectMenu
            :model-value="group.userIds"
            :items="memberItems"
            value-key="value"
            multiple
            :placeholder="t('assigneeGroups.pickPeople')"
            class="w-48"
            :aria-label="t('assigneeGroups.peopleOf', { name: group.name })"
            @update:model-value="(ids: string[]) => emit('update', group, { userIds: ids })"
          >
            <template #default>
              <span v-if="group.userIds.length" class="truncate">{{ t('assigneeGroups.memberCount', { count: group.userIds.length }, group.userIds.length) }}</span>
              <span v-else class="text-dimmed truncate">{{ t('assigneeGroups.pickPeople') }}</span>
            </template>
          </USelectMenu>
          <UTooltip :text="t('assigneeGroups.delete', { name: group.name })">
            <UButton icon="i-lucide-trash" color="error" variant="ghost" :aria-label="t('assigneeGroups.delete', { name: group.name })" @click="remove(group)" />
          </UTooltip>
        </div>

        <USeparator class="my-4" />

        <form class="flex flex-wrap items-center gap-2" @submit.prevent="create">
          <UInput v-model="draft.name" :placeholder="t('assigneeGroups.newGroup')" :maxlength="50" class="flex-1 min-w-32" />
          <USelectMenu
            v-model="draft.userIds"
            :items="memberItems"
            value-key="value"
            multiple
            :placeholder="t('assigneeGroups.pickPeople')"
            class="w-48"
            :aria-label="t('assigneeGroups.newPeople')"
          >
            <template #default>
              <span v-if="draft.userIds.length" class="truncate">{{ t('assigneeGroups.memberCount', { count: draft.userIds.length }, draft.userIds.length) }}</span>
              <span v-else class="text-dimmed truncate">{{ t('assigneeGroups.pickPeople') }}</span>
            </template>
          </USelectMenu>
          <UButton type="submit" icon="i-lucide-plus" :label="t('common.add')" :disabled="!draft.name.trim()" />
        </form>
      </div>
    </template>
  </UModal>
</template>
