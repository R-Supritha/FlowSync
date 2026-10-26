// The dependency graph (tasks as boxes, "must finish first" as arrows). The thinking lives here as plain functions,
// so it can be tested without a screen. A task's `dependencies` are the tasks it WAITS FOR.
export const DONE = 'Done'

const idOf = (d) => String(d && d._id ? d._id : d)
export const isDone = (task) => task.status === DONE

// tasks -> graph. Unknown tasks, a task waiting for itself and repeated entries are ignored.
//   deps:       task id -> the ids it waits for        dependents: task id -> the ids waiting for it
export function buildGraph(tasks) {
  const byId = new Map()
  for (const t of tasks) byId.set(String(t._id), t)
  const deps = new Map()
  const dependents = new Map()
  for (const id of byId.keys()) {
    deps.set(id, [])
    dependents.set(id, [])
  }
  for (const [id, t] of byId) {
    const seen = new Set()
    for (const raw of t.dependencies || []) {
      const d = idOf(raw)
      if (d === id || !byId.has(d) || seen.has(d)) continue
      seen.add(d)
      deps.get(id).push(d)
      dependents.get(d).push(id)
    }
  }
  return { byId, deps, dependents, ids: [...byId.keys()] }
}

// Boxes in rows, top to bottom: a task sits one row below the lowest task it waits for, so every arrow points down.
// Tasks with no links at all are kept out (the page lists them separately). Safe even when there is a loop.
export function layoutGraph(graph, { nodeW = 210, nodeH = 74, gapX = 36, gapY = 64, pad = 16 } = {}) {
  const linked = graph.ids.filter((id) => graph.deps.get(id).length > 0 || graph.dependents.get(id).length > 0)
  const isolated = graph.ids.filter((id) => !linked.includes(id))

  const level = new Map()
  const visiting = new Set()
  const levelOf = (id) => {
    if (level.has(id)) return level.get(id)
    if (visiting.has(id)) return 0
    visiting.add(id)
    let l = 0
    for (const d of graph.deps.get(id)) l = Math.max(l, levelOf(d) + 1)
    visiting.delete(id)
    level.set(id, l)
    return l
  }
  linked.forEach(levelOf)

  const sparse = []
  linked.forEach((id) => {
    const l = level.get(id)
    sparse[l] = sparse[l] || []
    sparse[l].push(id)
  })
  // With a circular dependency a row can be empty; close such gaps so every size and position stays a real number.
  const rows = sparse.filter(Boolean)

  // Order each row by where its prerequisites are, to keep the arrows from crossing needlessly.
  const index = new Map()
  const order = new Map(linked.map((id, i) => [id, i]))
  rows.forEach((row, r) => {
    if (r > 0) {
      const center = (id) => {
        const known = graph.deps.get(id).filter((d) => index.has(d))
        return known.length ? known.reduce((sum, d) => sum + index.get(d), 0) / known.length : order.get(id)
      }
      row.sort((a, b) => center(a) - center(b) || order.get(a) - order.get(b))
    }
    row.forEach((id, i) => index.set(id, i))
  })

  const widest = Math.max(0, ...rows.map((row) => row.length))
  const full = widest * nodeW + Math.max(0, widest - 1) * gapX
  const nodes = new Map()
  rows.forEach((row, r) => {
    const width = row.length * nodeW + (row.length - 1) * gapX
    const start = pad + (full - width) / 2
    row.forEach((id, i) => nodes.set(id, { x: start + i * (nodeW + gapX), y: pad + r * (nodeH + gapY), row: r }))
  })

  return { nodes, isolated, nodeW, nodeH, gapY, width: full + pad * 2, height: rows.length ? rows.length * (nodeH + gapY) - gapY + pad * 2 : 0 }
}

// One curved arrow per dependency: from the bottom of the task that must finish first to the top of the one that waits.
export function edgePaths(graph, layout) {
  const edges = []
  for (const [id, prerequisites] of graph.deps) {
    const to = layout.nodes.get(id)
    if (!to) continue
    for (const d of prerequisites) {
      const from = layout.nodes.get(d)
      if (!from) continue
      const x1 = from.x + layout.nodeW / 2
      const y1 = from.y + layout.nodeH
      const x2 = to.x + layout.nodeW / 2
      const y2 = to.y
      const k = Math.max(20, (y2 - y1) * 0.5)
      edges.push({ from: d, to: id, d: `M ${x1} ${y1} C ${x1} ${y1 + k}, ${x2} ${y2 - k}, ${x2} ${y2}` })
    }
  }
  return edges
}
