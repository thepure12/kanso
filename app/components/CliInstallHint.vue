<script setup lang="ts">
// The kanso CLI install command (GET /cli/install.sh) with a copy button; with `login`
// also the `kanso login` command. Next to API tokens (ApiTokenList, BotsSlideover,
// AccountBots) and in TokenCreatedPanel.
const props = defineProps<{ login?: boolean }>()
const toast = useToast()
const { t } = useI18n()

const base = basePath()
const site = computed(() => import.meta.client ? window.location.origin + base : '')
const commands = computed(() => {
  const list = [cliInstallCommand(site.value)]
  if (props.login) list.push(cliLoginCommand(site.value))
  return list.join('\n')
})

async function copy() {
  await navigator.clipboard.writeText(commands.value)
  toast.add({ title: t('tokens.cli.copied'), color: 'success' })
}
</script>

<template>
  <div class="space-y-1" data-testid="cli-install">
    <p v-if="props.login" class="text-sm font-medium">
      {{ t('tokens.cli.title') }}
    </p>
    <p class="text-sm text-muted">
      {{ props.login ? t('tokens.cli.helpLogin') : t('tokens.cli.help') }}
    </p>
    <div class="flex items-start gap-1">
      <UTextarea :model-value="commands" readonly autoresize :rows="props.login ? 2 : 1" class="flex-1 font-mono text-xs" @focus="($event.target as HTMLTextAreaElement).select()" />
      <UTooltip :text="t('tokens.cli.copy')">
        <UButton color="neutral" variant="ghost" size="sm" icon="i-lucide-copy" :aria-label="t('tokens.cli.copy')" @click="copy" />
      </UTooltip>
    </div>
  </div>
</template>
