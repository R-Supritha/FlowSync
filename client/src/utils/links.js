// Where a notification should take the person when they click it.
export function notificationTarget(n) {
  const l = n.link || {}
  if (l.project && l.task) return `/projects/${l.project}/board?task=${l.task}`
  if (l.project) return `/projects/${l.project}/board`
  return '/notifications'
}
