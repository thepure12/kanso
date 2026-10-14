<script setup lang="ts">
import type { TeamSummary } from '#shared/types/board'

const props = defineProps<{ boardId: string, boardName: string, teamId: string | null }>()
const open = defineModel<boolean>('open', { required: true })
const showError = useApiError()
const { t } = useI18n()

const { data: teams } = useFetch<TeamSummary[]>('/api/teams', { default: () => [], lazy: true, server: false })
const teamItems = computed(() => [
  { label: t('copyBoard.personal'), value: null },
  ...teams.value.filter(t => t.role === 'owner' || t.role === 'editor').map(t => ({ label: t.name, value: t.id })),
])

const form = reactive({ name: '', teamId: null as string | null, withCards: true })
watch(open, (isOpen) => {
  if (isOpen) Object.assign(form, { name: t('copyBoard.defaultName', { name: props.boardName }), teamId: props.teamId, withCards: true })
}, { immediate: true })

const copying = ref(false)
async function copy() {
  if (!form.name.trim()) return
  copying.value = true
  try {
    const board = await api<{ id: string }>(`/api/boards/${props.boardId}/copy`, { method: 'POST', body: { ...form, name: form.name.trim() } })
    open.value = false
    await navigateTo(`/boards/${board.id}`)
  }
  catch (err) { showError(err, t('copyBoard.failed')) }
  finally { copying.value = false }
}
</script>

<template>
  <UModal v-model:open="open" :title="t('copyBoard.title')" :description="t('copyBoard.description')">
    <template #body>
      <form class="space-y-4" @submit.prevent="copy">
        <UFormField :label="t('common.name')" required>
          <UInput v-model="form.name" class="w-full" autofocus />
        </UFormField>
        <UFormField :label="t('copyBoard.team')">
          <USelect v-model="form.teamId" :items="teamItems" class="w-full" />
        </UFormField>
        <UCheckbox v-model="form.withCards" :label="t('copyBoard.withCards')" :description="t('copyBoard.withCardsDescription')" />
        <div class="flex justify-end gap-2">
          <UButton color="neutral" variant="ghost" :label="t('common.cancel')" @click="open = false" />
          <UButton type="submit" :label="t('copyBoard.copy')" :loading="copying" />
        </div>
      </form>
    </template>
  </UModal>
</template>
