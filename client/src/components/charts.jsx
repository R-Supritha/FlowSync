// Small charts drawn with plain HTML and SVG, so no chart library is needed.

export function BarChart({ data, label, valueLabel = (v) => v }) {
  const max = Math.max(1, ...data.map((d) => d.value))
  return (
    <div role="img" aria-label={label} className="bars">
      {data.map((d) => (
        <div key={d.label} className="bar-col" title={`${d.label}: ${valueLabel(d.value)}`}>
          <span className="bar-value">{valueLabel(d.value)}</span>
          <div className="bar" style={{ height: `${(d.value / max) * 100}%` }} />
          <span className="bar-label">{d.label}</span>
        </div>
      ))}
    </div>
  )
}

const COLORS = ['var(--accent)', 'var(--ok)', 'var(--warn)', 'var(--fg-muted)']

export function LineChart({ series, label }) {
  const W = 560
  const H = 180
  const pad = 24
  const longest = Math.max(2, ...series.map((s) => s.points.length))
  const max = Math.max(1, ...series.flatMap((s) => s.points))
  const x = (i) => pad + (i / (longest - 1)) * (W - pad * 2)
  const y = (v) => H - pad - (v / max) * (H - pad * 2)
  return (
    <figure style={{ margin: 0 }}>
      <svg role="img" aria-label={label} viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', maxWidth: W }}>
        <line x1={pad} y1={H - pad} x2={W - pad} y2={H - pad} stroke="var(--border)" />
        <line x1={pad} y1={pad} x2={pad} y2={H - pad} stroke="var(--border)" />
        <text x={4} y={pad + 4} fontSize="10" fill="var(--fg-muted)">{max}</text>
        <text x={4} y={H - pad + 4} fontSize="10" fill="var(--fg-muted)">0</text>
        {series.map((s, n) => (
          <polyline key={s.name} fill="none" stroke={COLORS[n % COLORS.length]} strokeWidth="2" strokeDasharray={s.dashed ? '5 4' : undefined}
            points={s.points.map((v, i) => `${x(i)},${y(v)}`).join(' ')} />
        ))}
      </svg>
      <figcaption className="fs-row fs-muted" style={{ fontSize: '0.8em', gap: 12, flexWrap: 'wrap' }}>
        {series.map((s, n) => <span key={s.name}><span style={{ color: COLORS[n % COLORS.length] }}>■</span> {s.name}</span>)}
      </figcaption>
    </figure>
  )
}
