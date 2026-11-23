<script setup lang="ts">
// A new API token, shown once: the token with a copy button, the MCP URL and a
// `claude mcp add` command, and how to install the kanso CLI and log in with it. Used by ApiTokenList (personal) and BotsSlideover (bots).
const props = defineProps<{
  token: string
  /** Who the token acts as, for the warning; defaults to the personal wording. */
  warning?: string
}>()
const toast = useToast()
const { t } = useI18n()

/** MCP endpoint for AI agents, and the Claude Code command that adds it with the new token. */
const mcpUrl = computed(() => import.meta.client ? window.location.origin + appUrl('/api/mcp') : '')
const mcpCommand = computed(() => `claude mcp add --transport http kanso ${mcpUrl.value} --header "Authorization: Bearer ${props.token}"`)

async function copy() {
  await navigator.clipboard.writeText(props.token)
  toast.add({ title: t('tokens.copied'), color: 'success' })
}

async function copyMcpCommand() {
  await navigator.clipboard.writeText(mcpCommand.value)
  toast.add({ title: t('tokens.mcpCopied'), color: 'success' })
}
</script>

<template>
  <div class="space-y-3">
    <UAlert
      color="warning"
      variant="subtle"
      icon="i-lucide-triangle-alert"
      :title="t('tokens.onlyOnce')"
      :description="props.warning ?? t('tokens.onlyOnceDescription')"
    />
    <UInput :model-value="props.token" readonly class="w-full font-mono" data-testid="new-token" @focus="($event.target as HTMLInputElement).select()">
      <template #trailing>
        <UTooltip :text="t('tokens.copy')">
          <UButton color="neutral" variant="link" size="sm" icon="i-lucide-copy" :aria-label="t('tokens.copy')" @click="copy" />
        </UTooltip>
      </template>
    </UInput>
    <div class="space-y-1">
      <p class="text-sm font-medium">
        {{ t('tokens.mcpTitle') }}
      </p>
      <i18n-t keypath="tokens.mcpHelp" tag="p" class="text-sm text-muted" scope="global">
        <template #url>
          <code class="break-all">{{ mcpUrl }}</code>
        </template>
      </i18n-t>
      <div class="flex items-start gap-1">
        <UTextarea :model-value="mcpCommand" data-testid="mcp-command" readonly autoresize :rows="2" class="flex-1 font-mono text-xs" @focus="($event.target as HTMLTextAreaElement).select()" />
        <UTooltip :text="t('tokens.mcpCopy')">
          <UButton color="neutral" variant="ghost" size="sm" icon="i-lucide-copy" :aria-label="t('tokens.mcpCopy')" @click="copyMcpCommand" />
        </UTooltip>
      </div>
    </div>
    <CliInstallHint login />
  </div>
</template>
