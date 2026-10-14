/** Pages for signed-out users; signed-in users go to the board list. */
const GUEST = ['/login', '/login/2fa', '/register', '/forgot-password']
/** Pages anyone can open (a reset link works whether or not you are signed in). */
const OPEN = ['/reset-password']

export default defineNuxtRouteMiddleware((to) => {
  if (OPEN.includes(to.path)) return
  const { loggedIn } = useUserSession()
  if (!loggedIn.value && !GUEST.includes(to.path)) return navigateTo('/login')
  if (loggedIn.value && GUEST.includes(to.path)) return navigateTo('/')
})
