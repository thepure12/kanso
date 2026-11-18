<script setup lang="ts">
import type { Invite } from '#shared/types/board'
import type { PanelMember } from './MembersPanel.vue'

const props = defineProps<{
  title: string
  description?: string
  /** Base URL of the members API, e.g. /api/teams/:id/members */
  endpoint: string
  members: PanelMember[]
  /** Pending invites for emails without an account. */
  invites: Invite[]
  /** Base URL of the invites API, e.g. /api/teams/:id/invites */
  invitesEndpoint: string
  canManage: boolean
  limitedIds?: string[]
  canLimit?: (m: PanelMember) => boolean
}>()
const emit = defineEmits<{ changed: [], left: [], limit: [userId: string] }>()
const open = defineModel<boolean>('open', { required: true })
</script>

<template>
  <USlideover v-model:open="open" :title="props.title" :description="props.description">
    <template #body>
      <MembersPanel
        :endpoint="props.endpoint"
        :members="props.members"
        :invites="props.invites"
        :invites-endpoint="props.invitesEndpoint"
        :can-manage="props.canManage"
        :limited-ids="props.limitedIds"
        :can-limit="props.canLimit"
        @limit="userId => emit('limit', userId)"
        @changed="emit('changed')"
        @left="emit('left')"
      />
    </template>
  </USlideover>
</template>
