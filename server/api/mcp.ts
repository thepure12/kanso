import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'

/** JSON-RPC bodies are small; the largest tool input is a 10 000 character description or comment. */
const MAX_BODY = 256 * 1024

/**
 * MCP endpoint for AI agents (Streamable HTTP, stateless, JSON responses).
 * Authenticated by a personal API token only, never the session cookie, so a
 * web page cannot drive it with the user's browser session. Read-only tokens
 * see the read tools only. See createMcpServer for how tools reach the API.
 */
export default defineEventHandler(async (event) => {
  if (event.method !== 'POST') {
    // Stateless server: no server-initiated stream (GET) and no session to end (DELETE).
    setResponseHeader(event, 'allow', 'POST')
    throw createError({ statusCode: 405, statusMessage: 'Method not allowed' })
  }

  const authorization = getHeader(event, 'authorization')
  const token = bearerToken(authorization)
  if (!token) {
    setResponseHeader(event, 'www-authenticate', 'Bearer')
    throw createError({ statusCode: 401, statusMessage: 'An API token is required (Authorization: Bearer kb_...)' })
  }
  let scopes: string[]
  try {
    ({ scopes } = await resolveTokenUser(event, token))
  }
  catch (err) {
    if ((err as { statusCode?: number }).statusCode === 401) setResponseHeader(event, 'www-authenticate', 'Bearer error="invalid_token"')
    throw err
  }

  const server = createMcpServer({
    authorization: authorization!,
    ip: getRequestIP(event, { xForwardedFor: true }) ?? '',
    canWrite: scopes.includes('write'),
  })
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
    maxRequestBodySize: MAX_BODY,
  })
  try {
    await server.connect(transport)
    return await transport.handleRequest(toWebRequest(event))
  }
  finally {
    await server.close()
  }
})
