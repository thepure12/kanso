/**
 * Whether the browser is offline. False on the server and during hydration (a page
 * served from the offline cache hydrates as rendered); app/plugins/network.client.ts
 * keeps it current after that.
 */
export const useOffline = () => useState('offline', () => false)
