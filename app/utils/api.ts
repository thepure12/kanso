function newClientId() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return Math.random().toString(36).slice(2) + Date.now().toString(36)
}

/** Identifies this browser tab in board change notifications, so it can skip its own changes. */
export const clientId = import.meta.client ? newClientId() : ''

/** $fetch that sends the tab's client id. Use it for every board and card mutation. */
export const api = $fetch.create({ headers: clientId ? { 'x-client-id': clientId } : {} })
