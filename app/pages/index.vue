<script setup lang="ts">
import type { BoardSummary, TeamSummary } from '#shared/types/board'
import { boardTemplates } from '#shared/boardTemplates'
import { csvHasIssueKeys, detectImportFormat, slimTrelloExport, type ImportFormat } from '#shared/import'

const [{ data: boards, refresh: refreshBoards }, { data: teams, refresh: refreshTeams }] = await Promise.all([
  useFetch<BoardSummary[]>('/api/boards', { default: () => [] }),
  useFetch<TeamSummary[]>('/api/teams', { default: () => [] }),
])
const refresh = () => Promise.all([refreshBoards(), refreshTeams()])
const showError = useApiError()
const { t } = useI18n()
const ask = usePrompt()

// Archived boards are listed only in their own section (toggle).
const activeBoards = computed(() => boards.value.filter(b => !b.archivedAt))
const starredBoards = computed(() => activeBoards.value.filter(b => b.starred))
const archivedBoards = computed(() => boards.value.filter(b => b.archivedAt))
const showArchived = ref(false)
const personalBoards = computed(() => activeBoards.value.filter(b => !b.teamId))
const teamBoards = (teamId: string) => activeBoards.value.filter(b => b.teamId === teamId)
const toggleStar = useBoardStar()
const canCreateIn = (team: TeamSummary) => team.role === 'owner' || team.role === 'editor'

// New board
const boardOpen = ref(false)
const boardName = ref('')
const boardTeamId = ref<string | null>(null)
const boardTemplate = ref('basic')
// The same dialog creates a board from a template or imports one from a file.
const importMode = ref(false)
const templateItems = computed(() => boardTemplates.map(b => ({ label: t(`boardTemplates.${b.key}.label`), value: b.key, description: t(`boardTemplates.${b.key}.description`) })))
const creatingBoard = ref(false)
const toast = useToast()

// Import: the file is converted and checked by the server; a dry run of the
// import fills the preview, and runs again when anything that changes the
// outcome (team, format, issue keys) does.
interface ImportResult {
  id: string | null
  skipped: Record<string, number>
  unmatched: string[]
  ignoredColumns: string[]
  counts: { columns: number, cards: number, tags: number }
}
const MAX_IMPORT_BYTES = 5 * 1024 * 1024
const formatLabels: Record<ImportFormat, string> = { kanban: 'Kanso JSON', trello: 'Trello JSON', csv: 'CSV' }
const importFormatItems = computed(() => [{ label: t('home.import.detect'), value: 'auto' }, ...Object.entries(formatLabels).map(([value, label]) => ({ label, value }))])
const importFormat = ref<'auto' | ImportFormat>('auto')
const importFile = ref<{ text: string, json: unknown } | null>(null)
const importIssueKeys = ref(false)
const importPreview = ref<ImportResult | null>(null)
const importError = ref('')
const previewing = ref(false)
const detectedFormat = computed(() => importFile.value && detectImportFormat(importFile.value.json ?? importFile.value.text))
const effectiveFormat = computed(() => importFormat.value === 'auto' ? detectedFormat.value : importFormat.value)
const hasIssueKeys = computed(() => effectiveFormat.value === 'csv' && !!importFile.value && csvHasIssueKeys(importFile.value.text))

async function onImportFile(file: File | null | undefined) {
  importFile.value = null
  importPreview.value = null
  importError.value = ''
  if (!file) return
  const text = await file.text()
  let json: unknown
  if (!file.name.toLowerCase().endsWith('.csv')) {
    try { json = JSON.parse(text) }
    catch { /* CSV, or broken JSON (reported if a JSON format is chosen) */ }
  }
  importFile.value = { text, json }
  if (!boardName.value.trim()) {
    const named = json && typeof json === 'object' && 'name' in json && typeof json.name === 'string' ? json.name : ''
    boardName.value = (named || file.name.replace(/\.[^.]+$/, '')).slice(0, 100)
  }
}

/** The request body for the chosen format, or an error message. */
function importBody(dryRun: boolean) {
  const file = importFile.value!
  const format = effectiveFormat.value!
  if (format !== 'csv' && file.json === undefined) return t('home.import.invalidJson')
  const data = format === 'csv' ? file.text : format === 'trello' ? slimTrelloExport(file.json as Record<string, unknown>) : file.json
  const body = { name: boardName.value.trim() || t('home.import.defaultName'), teamId: boardTeamId.value, format, data, issueKeys: importIssueKeys.value, dryRun }
  if (new Blob([JSON.stringify(body)]).size > MAX_IMPORT_BYTES) return t('home.import.tooLarge')
  return body
}

async function previewImport() {
  importPreview.value = null
  importError.value = ''
  if (!importFile.value) return
  const body = importBody(true)
  if (typeof body === 'string') {
    importError.value = body
    return
  }
  previewing.value = true
  try { importPreview.value = await $fetch<ImportResult>('/api/boards/import', { method: 'POST', body }) }
  catch (err) { importError.value = (err as { data?: { statusMessage?: string, message?: string } }).data?.statusMessage ?? t('home.import.failed') }
  finally { previewing.value = false }
}
watch([importFile, importFormat, importIssueKeys, boardTeamId], previewImport)

/** What the import left out, one phrase per kind (the preview lists unmatched people by name instead). */
function importGaps(skipped: Record<string, number>, omitAssignees = false) {
  const { assignees = 0, rules = 0, links = 0, fieldValues = 0, cards = 0, comments = 0, attachments = 0, fields = 0, invalidValues = 0 } = skipped
  return [
    !omitAssignees && assignees && t('home.import.gaps.assignees', {}, assignees),
    cards && t('home.import.gaps.cards', {}, cards),
    comments && t('home.import.gaps.comments', {}, comments),
    attachments && t('home.import.gaps.attachments', {}, attachments),
    fields && t('home.import.gaps.fields', {}, fields),
    invalidValues && t('home.import.gaps.invalidValues', {}, invalidValues),
    rules && t('home.import.gaps.rules', {}, rules),
    links && t('home.import.gaps.links', {}, links),
    fieldValues && t('home.import.gaps.fieldValues', {}, fieldValues),
  ].filter(Boolean) as string[]
}
const teamItems = computed(() => [
  { label: t('home.personalTeam'), value: null },
  ...teams.value.filter(canCreateIn).map(team => ({ label: team.name, value: team.id })),
])

function newBoard(teamId: string | null = null, importing = false) {
  boardTeamId.value = teamId
  importMode.value = importing
  boardOpen.value = true
}

// ?new=board (the command palette's "New board"; &team=<id> from the team page)
// opens the dialog; the query is dropped once read.
const route = useRoute()
function openNewFromQuery() {
  if (route.query.new !== 'board') return
  const team = route.query.team
  newBoard(typeof team === 'string' && teams.value.some(x => x.id === team && canCreateIn(x)) ? team : null)
  const { new: _, team: __, ...query } = route.query
  navigateTo({ query }, { replace: true })
}
onMounted(openNewFromQuery)
watch(() => route.query.new, openNewFromQuery)

async function createBoard() {
  if (!boardName.value.trim()) return
  const importing = importMode.value
  if (importing && !importPreview.value) return
  creatingBoard.value = true
  try {
    let id: string
    if (importing) {
      const body = importBody(false)
      if (typeof body === 'string') throw new Error(body)
      const res = await $fetch<ImportResult>('/api/boards/import', { method: 'POST', body })
      id = res.id!
      const gaps = importGaps(res.skipped)
      if (gaps.length) toast.add({ title: t('home.import.withGaps'), description: gaps.join('. '), color: 'warning' })
    }
    else {
      const board = await $fetch('/api/boards', { method: 'POST', body: { name: boardName.value, teamId: boardTeamId.value, template: boardTemplate.value } })
      id = board!.id
    }
    boardOpen.value = false
    boardName.value = ''
    boardTemplate.value = 'basic'
    importFile.value = null
    await navigateTo(`/boards/${id}`)
  }
  catch (err) { showError(err, t('home.createFailed')) }
  finally { creatingBoard.value = false }
}

// New team
const teamOpen = ref(false)
const teamName = ref('')
const creatingTeam = ref(false)

async function createTeam() {
  if (!teamName.value.trim()) return
  creatingTeam.value = true
  try {
    await $fetch('/api/teams', { method: 'POST', body: { name: teamName.value } })
    teamOpen.value = false
    teamName.value = ''
    await refresh()
  }
  catch (err) { showError(err, t('home.createTeamFailed')) }
  finally { creatingTeam.value = false }
}

const roleColor = { owner: 'primary', editor: 'success', viewer: 'neutral' } as const

// Team members / settings
const membersTeamId = ref<string | null>(null)
const membersTeam = computed(() => teams.value.find(x => x.id === membersTeamId.value))
const membersOpen = computed({
  get: () => !!membersTeam.value,
  set: (v) => { if (!v) membersTeamId.value = null },
})

const deleteTeamId = ref<string | null>(null)
const deleteTeam = computed(() => teams.value.find(x => x.id === deleteTeamId.value))
const deleteOpen = computed({
  get: () => !!deleteTeam.value,
  set: (v) => { if (!v) deleteTeamId.value = null },
})

function teamMenu(team: TeamSummary) {
  return [[
    { label: t('home.renameTeam'), icon: 'i-lucide-pencil', onSelect: async () => {
      const name = (await ask({ title: t('home.renameTeam'), label: t('home.teamNamePrompt'), initial: team.name }))?.trim()
      if (!name) return
      try {
        await $fetch(`/api/teams/${team.id}`, { method: 'PATCH', body: { name } })
        await refresh()
      }
      catch (err) { showError(err, t('home.renameTeamFailed')) }
    } },
    { label: t('home.deleteTeam'), icon: 'i-lucide-trash', color: 'error' as const, onSelect: () => { deleteTeamId.value = team.id } },
  ]]
}

async function confirmDeleteTeam() {
  try {
    await $fetch(`/api/teams/${deleteTeamId.value}`, { method: 'DELETE' })
    deleteTeamId.value = null
    await refresh()
  }
  catch (err) { showError(err, t('home.deleteTeamFailed')) }
}

async function onLeftTeam() {
  membersTeamId.value = null
  await refresh()
}

</script>

<template>
  <UContainer class="py-8 space-y-10">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <h1 class="text-2xl font-semibold">
        {{ t('home.title') }}
      </h1>
      <div class="flex gap-2">
        <UButton icon="i-lucide-users" color="neutral" variant="outline" :label="t('home.newTeam')" @click="teamOpen = true" />
        <UButton icon="i-lucide-upload" color="neutral" variant="outline" :label="t('home.import.label')" @click="newBoard(null, true)" />
        <UButton icon="i-lucide-plus" :label="t('home.newBoard')" @click="newBoard()" />
      </div>
    </div>

    <section v-if="starredBoards.length">
      <h2 class="text-lg font-semibold mb-4 flex items-center gap-2">
        <UIcon name="i-lucide-star" mode="svg" class="size-5 text-warning [&_*]:fill-current" />
        {{ t('home.starred') }}
      </h2>
      <BoardGrid :boards="starredBoards" @star="toggleStar" />
    </section>

    <section v-for="team in teams" :key="team.id">
      <div class="flex flex-wrap items-center gap-3 mb-4">
        <UIcon name="i-lucide-users" class="size-5 text-muted" />
        <h2 class="text-lg font-semibold">
          <ULink :to="`/teams/${team.id}`" class="text-highlighted hover:underline">
            {{ team.name }}
          </ULink>
        </h2>
        <UBadge :color="roleColor[team.role]" variant="subtle" :label="t(`members.roles.${team.role}`)" />
        <div class="ms-auto flex items-center gap-2">
          <UAvatarGroup :max="5" size="xs">
            <UAvatar v-for="m in team.members" :key="m.userId" :src="m.avatarUrl ?? undefined" :alt="m.name" />
          </UAvatarGroup>
          <UButton size="sm" color="neutral" variant="outline" icon="i-lucide-user-cog" :label="t('home.members')" @click="membersTeamId = team.id" />
          <UButton v-if="canCreateIn(team)" size="sm" color="neutral" variant="ghost" icon="i-lucide-plus" :label="t('home.board')" @click="newBoard(team.id)" />
          <UDropdownMenu v-if="team.role === 'owner'" :items="teamMenu(team)">
            <UButton size="sm" icon="i-lucide-ellipsis" color="neutral" variant="ghost" :aria-label="t('home.teamActions')" />
          </UDropdownMenu>
        </div>
      </div>
      <BoardGrid v-if="teamBoards(team.id).length" :boards="teamBoards(team.id)" @star="toggleStar" />
      <p v-else class="text-sm text-muted">
        {{ t('home.noTeamBoards') }}
      </p>
    </section>

    <section v-if="personalBoards.length || !teams.length">
      <h2 v-if="teams.length" class="text-lg font-semibold mb-4">
        {{ t('home.personal') }}
      </h2>
      <BoardGrid v-if="personalBoards.length" :boards="personalBoards" @star="toggleStar" />
      <UEmpty v-else icon="i-lucide-kanban" :title="t('home.emptyTitle')" :description="t('home.emptyDescription')" />
    </section>

    <section v-if="archivedBoards.length">
      <UButton
        color="neutral"
        variant="ghost"
        icon="i-lucide-archive"
        :trailing-icon="showArchived ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'"
        :label="t('home.archived', { count: archivedBoards.length })"
        @click="showArchived = !showArchived"
      />
      <BoardGrid v-if="showArchived" :boards="archivedBoards" class="mt-4" @star="toggleStar" />
    </section>

    <UModal v-model:open="boardOpen" :title="importMode ? t('home.import.label') : t('home.newBoard')" :description="importMode ? t('home.import.description') : undefined">
      <template #body>
        <form class="space-y-4" @submit.prevent="createBoard">
          <UFormField :label="t('home.form.name')">
            <UInput v-model="boardName" :placeholder="t('home.form.namePlaceholder')" class="w-full" autofocus />
          </UFormField>
          <UFormField :label="t('home.form.team')" :description="boardTeamId ? t('home.form.teamAccess') : t('home.form.personalAccess')">
            <USelect v-model="boardTeamId" :items="teamItems" class="w-full" />
          </UFormField>
          <UFormField v-if="!importMode" :label="t('home.form.template')" :description="templateItems.find(i => i.value === boardTemplate)?.description">
            <USelect v-model="boardTemplate" :items="templateItems" class="w-full" />
          </UFormField>
          <template v-else>
            <UFormField :label="t('home.form.format')" :description="importFormat === 'auto' && detectedFormat ? t('home.form.detected', { format: formatLabels[detectedFormat] }) : undefined">
              <USelect v-model="importFormat" :items="importFormatItems" class="w-full" />
            </UFormField>
            <UFormField :label="t('home.form.file')" :error="importError || undefined">
              <UFileUpload accept="application/json,text/csv,.json,.csv" class="w-full min-h-24" :label="t('home.form.drop')" @update:model-value="onImportFile" />
            </UFormField>
            <UCheckbox v-if="hasIssueKeys" v-model="importIssueKeys" :label="t('home.form.issueKeys')" />
            <div v-if="previewing" class="text-sm text-muted">{{ t('home.form.checking') }}</div>
            <div v-else-if="importPreview" class="space-y-1 text-sm" data-testid="import-preview">
              <p class="font-medium">
                {{ t('home.import.columns', {}, importPreview.counts.columns) }}, {{ t('home.import.cards', {}, importPreview.counts.cards) }}, {{ t('home.import.tags', {}, importPreview.counts.tags) }}
              </p>
              <p v-if="importPreview.unmatched.length" class="text-warning">
                {{ t('home.import.unmatched', { names: importPreview.unmatched.join(', ') }) }}
              </p>
              <p v-for="gap in importGaps(importPreview.skipped, true)" :key="gap" class="text-muted">
                {{ gap }}
              </p>
              <p v-if="importPreview.ignoredColumns.length" class="text-muted">
                {{ t('home.import.ignoredColumns', { names: importPreview.ignoredColumns.join(', ') }) }}
              </p>
            </div>
          </template>
          <div class="flex justify-end">
            <UButton type="submit" :label="importMode ? t('home.form.import') : t('home.form.create')" :loading="creatingBoard" :disabled="importMode && (!importPreview || previewing)" />
          </div>
        </form>
      </template>
    </UModal>

    <UModal v-model:open="teamOpen" :title="t('home.newTeamDialog.title')" :description="t('home.newTeamDialog.description')">
      <template #body>
        <form class="flex gap-2" @submit.prevent="createTeam">
          <UInput v-model="teamName" :placeholder="t('home.newTeamDialog.placeholder')" class="flex-1" autofocus />
          <UButton type="submit" :label="t('home.newTeamDialog.create')" :loading="creatingTeam" />
        </form>
      </template>
    </UModal>

    <MembersSlideover
      v-if="membersTeam"
      v-model:open="membersOpen"
      :title="t('home.teamMembers', { team: membersTeam.name })"
      :description="t('home.teamRolesHelp')"
      :endpoint="`/api/teams/${membersTeam.id}/members`"
      :members="membersTeam.members"
      :invites="membersTeam.invites"
      :invites-endpoint="`/api/teams/${membersTeam.id}/invites`"
      :can-manage="membersTeam.role === 'owner'"
      @changed="refresh"
      @left="onLeftTeam"
    />

    <UModal v-model:open="deleteOpen" :title="t('home.deleteTitle', { team: deleteTeam?.name })" :description="t('home.deleteDescription')">
      <template #footer>
        <div class="flex justify-end gap-2 w-full">
          <UButton color="neutral" variant="ghost" :label="t('common.cancel')" @click="deleteTeamId = null" />
          <UButton color="error" :label="t('home.deleteTeam')" @click="confirmDeleteTeam" />
        </div>
      </template>
    </UModal>
  </UContainer>
</template>
