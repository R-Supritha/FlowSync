// Helpers for the text of chat messages: @mentions and FS-xxxxxx task references.

// "@raj" (a name) or "FS-13c22c" (a task reference). A name may contain dots inside, never at the end.
const TOKEN = /(@[A-Za-z0-9_.]*[A-Za-z0-9_]|\bFS-[0-9a-f]{6}\b)/gi

// Cuts a message into plain pieces, @names and references: [{ type: 'text' | 'mention' | 'ref', value }]
export function splitChatText(text) {
  const source = String(text || '')
  const parts = []
  let last = 0
  for (const m of source.matchAll(TOKEN)) {
    if (m.index > last) parts.push({ type: 'text', value: source.slice(last, m.index) })
    parts.push({ type: m[0][0] === '@' ? 'mention' : 'ref', value: m[0] })
    last = m.index + m[0].length
  }
  if (last < source.length) parts.push({ type: 'text', value: source.slice(last) })
  return parts.length ? parts : [{ type: 'text', value: source }]
}

// The distinct task references in a text, as "fs-13c22c" (lower case).
export const refsIn = (text) => [...new Set([...String(text || '').matchAll(/\bFS-([0-9a-f]{6})\b/gi)].map((m) => `fs-${m[1].toLowerCase()}`))]

// Does "@handle" name a person of the workspace? A first name, the full name without spaces, or the start of the email.
export function isPerson(handle, people) {
  const h = String(handle || '').toLowerCase()
  return Object.values(people || {}).some((p) => {
    const name = String(p.name || '').trim().toLowerCase()
    return h === name.split(/\s+/)[0] || h === name.replace(/\s+/g, '') || h === String(p.email || '').split('@')[0].toLowerCase()
  })
}

// "@Su" being typed at the end of the box: up to 5 people whose first name starts that way.
export function mentionMatches(text, people) {
  const m = /(?:^|\s)@(\w*)$/.exec(text)
  if (!m) return []
  const q = m[1].toLowerCase()
  return Object.values(people || {})
    .filter((p) => p.name && p.name.split(/\s+/)[0].toLowerCase().startsWith(q))
    .slice(0, 5)
}
