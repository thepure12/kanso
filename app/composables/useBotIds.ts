import type { InjectionKey, Ref } from 'vue'

/** Ids of the board's bot members (BoardDetail.members[].isBot), provided by useBoard. */
export const boardBotIdsKey: InjectionKey<Ref<ReadonlySet<string>>> = Symbol('boardBotIds')

const none: Ref<ReadonlySet<string>> = computed(() => new Set<string>())

/** The open board's bot ids; empty outside a board page. */
export function useBotIds(): Ref<ReadonlySet<string>> {
  return inject(boardBotIdsKey, none)
}
