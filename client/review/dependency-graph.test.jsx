import { describe, expect, it } from 'vitest'
import { buildGraph, edgePaths, layoutGraph } from '../src/utils/dependencyGraph'

const task = (id, deps = [], over = {}) => ({ _id: id, title: `Task ${id}`, status: 'To Do', dependencies: deps, ...over })

describe('buildGraph', () => {
  it('keeps real dependencies and ignores unknown tasks, itself and repeats; accepts populated objects too', () => {
    const g = buildGraph([task('a'), task('b', ['a', 'a', 'zzz', 'b']), task('c', [{ _id: 'b', title: 'Task b' }])])
    expect(g.deps.get('b')).toEqual(['a'])
    expect(g.deps.get('c')).toEqual(['b'])
    expect(g.dependents.get('a')).toEqual(['b'])
    expect(g.dependents.get('b')).toEqual(['c'])
  })
  it('handles no tasks and tasks without a dependencies field', () => {
    expect(buildGraph([]).ids).toEqual([])
    expect(buildGraph([{ _id: 'a', title: 'x', status: 'To Do' }]).deps.get('a')).toEqual([])
  })
})

describe('layoutGraph and edgePaths', () => {
  const chain = buildGraph([task('a'), task('b', ['a']), task('c', ['b']), task('d', ['c', 'e']), task('e'), task('lonely')])

  it('puts every task below the ones it waits for, and arrows point downwards', () => {
    const l = layoutGraph(chain)
    for (const [id, deps] of chain.deps) for (const d of deps) expect(l.nodes.get(id).y).toBeGreaterThan(l.nodes.get(d).y)
    for (const e of edgePaths(chain, l)) {
      const nums = e.d.match(/-?\d+(\.\d+)?/g).map(Number)          // M x1 y1 C ... x2 y2
      expect(nums.at(-1)).toBeGreaterThan(nums[1])
    }
  })
  it('keeps tasks without any link out of the picture and lists them separately', () => {
    const l = layoutGraph(chain)
    expect(l.isolated).toEqual(['lonely'])
    expect(l.nodes.has('lonely')).toBe(false)
    expect(l.nodes.size).toBe(5)
  })
  it('never lets two boxes overlap, and the picture is big enough for all of them', () => {
    const g = buildGraph([task('a'), task('b'), task('c'), task('d', ['a', 'b', 'c']), task('e', ['d'])])
    const l = layoutGraph(g)
    const boxes = [...l.nodes.values()]
    for (let i = 0; i < boxes.length; i += 1) {
      expect(boxes[i].x).toBeGreaterThanOrEqual(0)
      expect(boxes[i].x + l.nodeW).toBeLessThanOrEqual(l.width)
      expect(boxes[i].y + l.nodeH).toBeLessThanOrEqual(l.height)
      for (let j = i + 1; j < boxes.length; j += 1) {
        const apart = boxes[i].x + l.nodeW <= boxes[j].x || boxes[j].x + l.nodeW <= boxes[i].x || boxes[i].y + l.nodeH <= boxes[j].y || boxes[j].y + l.nodeH <= boxes[i].y
        expect(apart).toBe(true)
      }
    }
  })
  it('draws one arrow for each dependency, from the bottom of the first task to the top of the waiting one', () => {
    const l = layoutGraph(chain)
    const edges = edgePaths(chain, l)
    expect(edges.map((e) => `${e.from}>${e.to}`).sort()).toEqual(['a>b', 'b>c', 'c>d', 'e>d'])
    const ab = edges.find((e) => e.from === 'a' && e.to === 'b')
    expect(ab.d.startsWith(`M ${l.nodes.get('a').x + l.nodeW / 2} ${l.nodes.get('a').y + l.nodeH} `)).toBe(true)
    expect(ab.d.endsWith(`${l.nodes.get('b').x + l.nodeW / 2} ${l.nodes.get('b').y}`)).toBe(true)
  })
  it('still places every task when there is a circular dependency, and handles an empty project', () => {
    const loop = buildGraph([task('a', ['c']), task('b', ['a']), task('c', ['b'])])
    const l = layoutGraph(loop)
    expect(l.nodes.size).toBe(3)
    for (const n of l.nodes.values()) { expect(Number.isFinite(n.x)).toBe(true); expect(Number.isFinite(n.y)).toBe(true) }
    expect(Number.isFinite(l.width) && Number.isFinite(l.height)).toBe(true)
    const none = layoutGraph(buildGraph([]))
    expect(none.nodes.size).toBe(0)
    expect(none.height).toBe(0)
  })
})
