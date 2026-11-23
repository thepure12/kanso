/** One server-sent event: its `event` name (default "message") and `data` (lines joined by \n). */
export interface ServerEvent {
  event: string
  data: string
}

/**
 * Splits a text/event-stream body into events (the subset of the spec Kanso sends:
 * `event:` and `data:` fields, comments and `id:`/`retry:` ignored). `onChunk` is
 * called for every chunk read, so callers can notice a stalled connection.
 */
export async function* readServerEvents(body: ReadableStream<Uint8Array>, onChunk: () => void = () => {}): AsyncGenerator<ServerEvent> {
  const decoder = new TextDecoder()
  let buffer = ''
  let event = ''
  let data: string[] = []
  for await (const chunk of body as unknown as AsyncIterable<Uint8Array>) {
    onChunk()
    buffer += decoder.decode(chunk, { stream: true })
    let nl: number
    while ((nl = buffer.search(/\r\n|\r|\n/)) >= 0) {
      const line = buffer.slice(0, nl)
      buffer = buffer.slice(nl + (buffer.startsWith('\r\n', nl) ? 2 : 1))
      if (line === '') {
        if (event || data.length) yield { event: event || 'message', data: data.join('\n') }
        event = ''
        data = []
        continue
      }
      if (line.startsWith(':')) continue
      const colon = line.indexOf(':')
      const field = colon < 0 ? line : line.slice(0, colon)
      let value = colon < 0 ? '' : line.slice(colon + 1)
      if (value.startsWith(' ')) value = value.slice(1)
      if (field === 'event') event = value
      else if (field === 'data') data.push(value)
    }
  }
}
