import { useEffect, useRef, useState } from 'react'
import { useSelector } from 'react-redux'
import { chatApi } from '../api/endpoints'

const RETRY_MS = 5000

// Live chat events for a workspace. Reads Server-Sent Events over fetch() (so the JWT stays in the
// Authorization header), reconnects by itself, and tells the caller whether the stream is live.
// onEvent receives { type: 'message' | 'message_edited' | 'message_deleted' | 'channel', ... }.
export default function useChatStream(workspaceId, onEvent) {
  const token = useSelector((s) => s.auth.token)
  const [live, setLive] = useState(false)
  const handler = useRef(onEvent)
  useEffect(() => {
    handler.current = onEvent
  })

  useEffect(() => {
    if (!workspaceId || !token) return undefined
    let stopped = false
    let controller = null
    let retry = null

    async function connect() {
      controller = new AbortController()
      try {
        const res = await fetch(chatApi.streamUrl(workspaceId), {
          headers: { Authorization: `Bearer ${token}` },
          signal: controller.signal,
        })
        if (!res.ok || !res.body) throw new Error(`Stream failed (${res.status})`)
        if (!stopped) setLive(true)
        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          const chunks = buffer.split('\n\n')
          buffer = chunks.pop() || ''
          for (const chunk of chunks) {
            const line = chunk.split('\n').find((l) => l.startsWith('data: '))
            if (!line) continue
            try {
              const event = JSON.parse(line.slice(6))
              if (event && event.type) handler.current(event)
            } catch {
              /* ignore malformed frames */
            }
          }
        }
      } catch {
        /* closed or unavailable: fall through to the retry below */
      }
      if (stopped) return
      setLive(false)
      retry = setTimeout(connect, RETRY_MS)
    }

    connect()
    return () => {
      stopped = true
      clearTimeout(retry)
      if (controller) controller.abort()
    }
  }, [workspaceId, token])

  return live
}
