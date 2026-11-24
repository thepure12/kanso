<script setup lang="ts">
import type { BoardNotificationLevel } from '#shared/notificationSettings'
import type { BoardSettingsSection } from '~/utils/boardSettings'

// Board settings page (the board page with ?settings): every board setting in labelled
// sections with a short description and a count, next to the board menu that lists the
// same items. General (name, notifications) is edited here; the other items open the
// dialogs the board page already has, so both ways share one code path.
const props = defineProps<{
  board: { id: string, name: string, notificationLevel: BoardNotificationLevel, team: { id: string, name: string } | null }
  sections: BoardSettingsSection[]
  /** Owners of an unarchived board rename it here. */
  canRename: boolean
  rename: (name: string) => Promise<unknown> | unknown
}>()
const emit = defineEmits<{ close: [] }>()

const { t } = useI18n()

const name = ref(props.board.name)
watch(() => props.board.name, (v) => { name.value = v })
const trimmed = computed(() => name.value.trim())
const nameChanged = computed(() => !!trimmed.value && trimmed.value !== props.board.name)
const saving = ref(false)
async function saveName() {
  if (!nameChanged.value || saving.value) return
  saving.value = true
  try { await props.rename(trimmed.value) }
  finally { saving.value = false }
}

const nav = computed(() => [
  { key: 'general', label: t('boardSettings.general') },
  ...props.sections.map(s => ({ key: s.key, label: s.label })),
])
function jump(key: string) {
  document.getElementById(`board-settings-${key}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}
</script>

<template>
  <div class="flex-1 min-h-0 px-3 sm:px-6 py-4 sm:py-6">
    <div class="mx-auto max-w-5xl flex gap-8">
      <nav class="hidden md:block w-48 shrink-0" :aria-label="t('boardSettings.title')">
        <ul class="sticky top-[calc(var(--ui-header-height)+6rem)] space-y-0.5">
          <li v-for="item in nav" :key="item.key">
            <UButton :label="item.label" color="neutral" variant="ghost" block class="justify-start" @click="jump(item.key)" />
          </li>
        </ul>
      </nav>

      <div class="flex-1 min-w-0 space-y-6">
        <div class="flex items-center gap-2">
          <h2 class="text-xl font-semibold flex-1">
            {{ t('boardSettings.title') }}
          </h2>
          <UButton icon="i-lucide-arrow-left" color="neutral" variant="outline" :label="t('boardSettings.back')" @click="emit('close')" />
        </div>

        <section id="board-settings-general" class="scroll-mt-40 rounded-lg border border-default bg-default">
          <h3 class="px-4 py-3 font-semibold border-b border-default">
            {{ t('boardSettings.general') }}
          </h3>
          <div class="divide-y divide-default">
            <form class="px-4 py-3 flex flex-wrap items-end gap-2" @submit.prevent="saveName">
              <UFormField :label="t('board.menu.namePrompt')" class="flex-1 min-w-48">
                <UInput v-model="name" :disabled="!canRename" maxlength="100" class="w-full" data-testid="board-settings-name" />
              </UFormField>
              <UButton v-if="canRename" type="submit" :label="t('common.save')" :disabled="!nameChanged" :loading="saving" />
            </form>
            <div v-if="board.team" class="px-4 py-3 flex items-center gap-3">
              <UIcon name="i-lucide-users-round" class="size-5 text-muted shrink-0" />
              <div class="flex-1 min-w-0">
                <div class="font-medium">
                  {{ t('boardSettings.team') }}
                </div>
                <div class="text-sm text-muted">
                  {{ t('boardSettings.teamDescription') }}
                </div>
              </div>
              <ULink :to="`/teams/${board.team.id}`" class="hover:underline truncate">
                {{ board.team.name }}
              </ULink>
            </div>
            <div class="px-4 py-3 flex items-center gap-3">
              <UIcon name="i-lucide-bell" class="size-5 text-muted shrink-0" />
              <div class="flex-1 min-w-0">
                <div class="font-medium">
                  {{ t('board.notifications') }}
                </div>
                <div class="text-sm text-muted">
                  {{ t(`board.notify${board.notificationLevel === 'all' ? 'All' : board.notificationLevel === 'direct' ? 'Direct' : 'None'}Description`) }}
                </div>
              </div>
              <BoardNotificationMenu :board="board" />
            </div>
          </div>
        </section>

        <section
          v-for="section in sections"
          :id="`board-settings-${section.key}`"
          :key="section.key"
          class="scroll-mt-40 rounded-lg border bg-default"
          :class="section.danger ? 'border-error/50' : 'border-default'"
          :data-testid="`board-settings-${section.key}`"
        >
          <h3 class="px-4 py-3 font-semibold border-b" :class="section.danger ? 'border-error/50 text-error' : 'border-default'">
            {{ section.label }}
          </h3>
          <ul class="divide-y divide-default">
            <li v-for="item in section.items" :key="item.key" class="px-4 py-3 flex items-center gap-3">
              <UIcon :name="item.icon" class="size-5 shrink-0" :class="item.color === 'error' ? 'text-error' : 'text-muted'" />
              <div class="flex-1 min-w-0">
                <div class="font-medium flex items-center gap-2">
                  {{ item.label }}
                  <UBadge v-if="item.count !== undefined" color="neutral" variant="soft" size="sm" :label="String(item.count)" />
                </div>
                <div v-if="item.description" class="text-sm text-muted">
                  {{ item.description }}
                </div>
              </div>
              <USwitch
                v-if="item.type === 'checkbox'"
                :model-value="item.checked"
                :aria-label="item.label"
                @update:model-value="(v: boolean) => item.onUpdateChecked?.(v)"
              />
              <UButton
                v-else-if="item.to"
                :to="item.to"
                :external="item.external"
                :download="item.download"
                color="neutral"
                variant="outline"
                icon="i-lucide-download"
                :label="t('boardSettings.download')"
              />
              <UButton
                v-else
                :color="item.color === 'error' ? 'error' : 'neutral'"
                variant="outline"
                :label="item.action ?? t('boardSettings.open')"
                :trailing-icon="item.action ? undefined : 'i-lucide-chevron-right'"
                :aria-label="item.action ? undefined : `${t('boardSettings.open')}: ${item.label}`"
                @click="item.onSelect?.()"
              />
            </li>
          </ul>
        </section>
      </div>
    </div>
  </div>
</template>
