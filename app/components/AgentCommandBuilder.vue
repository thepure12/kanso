<script setup lang="ts">
// Builds the commands that set up `kanso agent install` for a bot (helpers in
// app/utils/agentCommand.ts): install the CLI, log in with the bot's token under
// a profile, install the agent service. Nothing runs here; it only builds text to
// copy. Used in BoardAgentRulesModal ("Run these rules") and BotsSlideover ("Run as agent").
import {
  agentActivityKinds, agentCommandProblems, agentCommentModes, agentInstallCommand, agentLoginCommand, agentPermissionModes, agentSlug,
  type AgentCommandOptions, defaultAgentCommandOptions,
} from '~/utils/agentCommand'

const props = defineProps<{
  bots: { id: string, name: string }[]
  /** The board to follow; null = notifications only. */
  boardId: string | null
  columns: { id: string, title: string }[]
  /** Tokens created just now, by bot id: filled into `kanso login`. */
  tokens?: Record<string, string>
}>()
const { t } = useI18n()
const toast = useToast()

const base = basePath()
const siteUrl = useRuntimeConfig().public.siteUrl as string | undefined
const site = computed(() => siteUrl ? siteUrl.replace(/\/+$/, '') : import.meta.client ? window.location.origin + base : base)

const botId = ref(props.bots[0]?.id ?? '')
const bot = computed(() => props.bots.find(b => b.id === botId.value) ?? null)
const options = ref<AgentCommandOptions>(defaultAgentCommandOptions(site.value, bot.value?.name ?? '', props.boardId))
watch(bot, (b) => {
  const slug = agentSlug(b?.name ?? '')
  options.value.profile = slug
  options.value.name = slug
})
watch(site, (s) => { options.value.site = s })

const token = computed(() => props.tokens?.[botId.value] ?? null)
const problems = computed(() => agentCommandProblems(options.value))
const login = computed(() => agentLoginCommand(options.value.site, options.value.profile, token.value))
const install = computed(() => agentInstallCommand(options.value))
const rules = computed(() => options.value.trigger === 'rules')

const timeout = computed({
  get: () => options.value.timeout ?? undefined,
  set: (v: number | undefined | null) => { options.value.timeout = v === undefined || v === null || Number.isNaN(v) ? null : v },
})

const settle = computed({
  get: () => options.value.settle ?? undefined,
  set: (v: number | undefined | null) => { options.value.settle = v === undefined || v === null || Number.isNaN(v) ? null : v },
})

const botItems = computed(() => props.bots.map(b => ({ label: b.name, value: b.id })))
const triggerItems = computed(() => [
  ...props.boardId ? [
    { label: t('agentCommand.triggers.rules'), value: 'rules', description: t('agentCommand.triggers.rulesHelp') },
    { label: t('agentCommand.triggers.activity'), value: 'activity', description: t('agentCommand.triggers.activityHelp') },
  ] : [],
  { label: t('agentCommand.triggers.notifications'), value: 'notifications', description: t('agentCommand.triggers.notificationsHelp') },
])
const runnerItems = computed(() => [
  { label: t('agentCommand.runners.claude'), value: 'claude' },
  { label: t('agentCommand.runners.cmd'), value: 'cmd' },
])
const columnItems = computed(() => props.columns.map(c => ({ label: c.title, value: c.id })))
const kindItems = computed(() => agentActivityKinds.map(k => ({ label: t(`agentCommand.kinds.${k}`), value: k as string })))
const permissionItems = computed(() => agentPermissionModes.map(m => ({ label: t(`agentCommand.permissionModes.${m || 'board'}`), value: m || 'board' })))
const permissionMode = computed({
  get: () => options.value.permissionMode || 'board',
  set: (v: string) => { options.value.permissionMode = v === 'board' ? '' : v as AgentCommandOptions['permissionMode'] },
})
const commentItems = computed(() => agentCommentModes.map(c => ({ label: t(`agentRules.comments.${c}`), value: c })))

async function copy(text: string) {
  await navigator.clipboard.writeText(text)
  toast.add({ title: t('agentCommand.copied'), color: 'success' })
}
</script>

<template>
  <div class="space-y-4" data-testid="agent-command-builder">
    <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
      <UFormField v-if="props.bots.length > 1" :label="t('agentCommand.bot')">
        <USelect v-model="botId" :items="botItems" class="w-full" />
      </UFormField>
      <UFormField :label="t('agentCommand.trigger')" class="sm:col-span-2">
        <URadioGroup v-model="options.trigger" :items="triggerItems" />
      </UFormField>
    </div>

    <div v-if="options.trigger === 'activity'" class="grid grid-cols-1 sm:grid-cols-2 gap-3">
      <UFormField :label="t('agentCommand.columns')" :help="t('agentCommand.columnsHelp')">
        <USelectMenu v-model="options.columnIds" :items="columnItems" value-key="value" multiple :placeholder="t('agentCommand.anyColumn')" class="w-full" />
      </UFormField>
      <UFormField :label="t('agentCommand.activity')" :help="t('agentCommand.activityHelp')">
        <USelectMenu v-model="options.activity" :items="kindItems" value-key="value" multiple :placeholder="t('agentCommand.defaultActivity')" class="w-full" />
      </UFormField>
    </div>

    <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
      <UFormField :label="t('agentCommand.runner')">
        <USelect v-model="options.runner" :items="runnerItems" class="w-full" />
      </UFormField>
      <UFormField v-if="options.runner === 'claude'" :label="t('agentCommand.permissionMode')" :help="t('agentCommand.permissionModeHelp')">
        <USelect v-model="permissionMode" :items="permissionItems" class="w-full" />
      </UFormField>
      <UFormField v-else :label="t('agentCommand.cmd')" :help="t('agentCommand.cmdHelp')">
        <UInput v-model="options.cmd" class="w-full font-mono" data-testid="agent-cmd" />
      </UFormField>
    </div>

    <template v-if="options.runner === 'claude'">
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <UFormField :label="t('agentCommand.worktree')" :help="t('agentCommand.worktreeHelp')">
          <UInput v-model="options.worktree" placeholder="~/code/project" class="w-full font-mono" />
        </UFormField>
        <UFormField :label="t('agentCommand.setup')" :help="t('agentCommand.setupHelp')">
          <UInput v-model="options.setup" placeholder="pnpm install" class="w-full font-mono" />
        </UFormField>
      </div>
      <UFormField v-if="!rules" :label="t('agentCommand.prompt')" :help="t('agentCommand.promptHelp')">
        <UTextarea v-model="options.prompt" :rows="2" autoresize class="w-full" />
      </UFormField>
      <UCheckbox v-model="options.logTime" :label="t('agentCommand.logTime')" />
    </template>

    <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
      <UFormField :label="t('agentCommand.concurrency')">
        <UInputNumber v-model="options.concurrency" :min="1" :max="32" class="w-full" />
      </UFormField>
      <UFormField :label="t('agentCommand.timeout')">
        <UInputNumber v-model="timeout" :min="1" :placeholder="t('agentCommand.noTimeout')" class="w-full" />
      </UFormField>
      <UFormField :label="t('agentCommand.settle')" :help="rules ? t('agentCommand.settleRulesHelp') : t('agentCommand.settleHelp')">
        <UInputNumber v-model="settle" :min="0" :max="3600" :placeholder="rules ? t('agentCommand.settleRuleDefault') : '0'" class="w-full" data-testid="agent-settle" />
      </UFormField>
      <UFormField v-if="!rules" :label="t('agentCommand.comment')" class="col-span-2">
        <USelect v-model="options.comment" :items="commentItems" class="w-full" />
      </UFormField>
    </div>

    <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
      <UFormField :label="t('agentCommand.profile')" :help="t('agentCommand.profileHelp')">
        <UInput v-model="options.profile" class="w-full font-mono" />
      </UFormField>
      <UFormField :label="t('agentCommand.name')" :help="t('agentCommand.nameHelp')">
        <UInput v-model="options.name" class="w-full font-mono" />
      </UFormField>
      <UFormField :label="t('agentCommand.workdir')" :help="t('agentCommand.workdirHelp')">
        <UInput v-model="options.workdir" class="w-full font-mono" />
      </UFormField>
    </div>

    <USeparator />

    <CliInstallHint />

    <div class="space-y-1">
      <p class="text-sm font-medium">
        {{ t('agentCommand.loginTitle') }}
      </p>
      <p class="text-sm text-muted">
        {{ token ? t('agentCommand.loginWithToken') : t('agentCommand.loginHelp', { bot: bot?.name ?? '' }) }}
      </p>
      <div class="flex items-start gap-1">
        <UTextarea :model-value="login" readonly autoresize :rows="1" class="flex-1 font-mono text-xs" data-testid="agent-login" @focus="($event.target as HTMLTextAreaElement).select()" />
        <UTooltip :text="t('agentCommand.copy')">
          <UButton color="neutral" variant="ghost" size="sm" icon="i-lucide-copy" :aria-label="t('agentCommand.copy')" @click="copy(login)" />
        </UTooltip>
      </div>
    </div>

    <div class="space-y-1">
      <p class="text-sm font-medium">
        {{ t('agentCommand.installTitle') }}
      </p>
      <p class="text-sm text-muted">
        {{ t('agentCommand.installHelp') }}
      </p>
      <ul v-if="problems.length" class="text-sm text-error list-disc ps-5" data-testid="agent-problems">
        <li v-for="p in problems" :key="p">
          {{ t(`agentCommand.problems.${p}`) }}
        </li>
      </ul>
      <div v-else class="flex items-start gap-1">
        <UTextarea :model-value="install" readonly autoresize :rows="2" class="flex-1 font-mono text-xs" data-testid="agent-install" @focus="($event.target as HTMLTextAreaElement).select()" />
        <UTooltip :text="t('agentCommand.copy')">
          <UButton color="neutral" variant="ghost" size="sm" icon="i-lucide-copy" :aria-label="t('agentCommand.copy')" @click="copy(install)" />
        </UTooltip>
      </div>
    </div>
  </div>
</template>
