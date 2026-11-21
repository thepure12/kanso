/**
 * Keeps the bell and the inbox page in step within one tab: marking read or
 * deleting sends no server event, so whoever changed something calls
 * `changed()` and every other user of this composable runs `reload`.
 */
export function useNotificationSync(reload: () => unknown) {
  const version = useState('notifications:sync', () => 0)
  let mine = version.value
  const stop = watch(version, (v) => {
    if (v !== mine) {
      mine = v
      reload()
    }
  })
  onScopeDispose(stop)
  return {
    changed() {
      mine = ++version.value
    },
  }
}
