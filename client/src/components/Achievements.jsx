import { Award } from 'lucide-react'

// FR21: badges worked out from real activity. Earned ones are highlighted; the others show how far along they are.
export default function Achievements({ achievements, hidden = false, name }) {
  if (!achievements) {
    return (
      <section className="panel" style={{ marginTop: 24 }} aria-label="Achievements">
        <div className="panel-head"><h3 style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Award size={15} aria-hidden="true" /> Achievements</h3></div>
        <p className="fs-muted" style={{ margin: 0 }}>
          {hidden ? `${name || 'This person'} keeps their achievements private.` : 'Achievements are not available right now.'}
        </p>
      </section>
    )
  }
  return (
    <section className="panel" style={{ marginTop: 24 }} aria-label="Achievements">
      <div className="panel-head"><h3 style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Award size={15} aria-hidden="true" /> Achievements ({achievements.earned} of {achievements.total})</h3></div>
      <ul className="badge-grid">
        {achievements.badges.map((b) => (
          <li key={b.id} className={`badge-card ${b.earned ? 'earned' : 'locked'}`} aria-label={`${b.title}: ${b.earned ? 'earned' : `${b.current} of ${b.target}`}`}>
            <strong>{b.title}</strong>
            <span className="fs-muted">{b.description}</span>
            {b.earned ? (
              <span className="badge-status">Earned</span>
            ) : (
              <>
                <div className="progress" role="progressbar" aria-label={`Progress for ${b.title}`} aria-valuenow={b.current} aria-valuemin={0} aria-valuemax={b.target}>
                  <span style={{ width: `${(b.current / b.target) * 100}%` }} />
                </div>
                <span className="fs-muted">{b.current} / {b.target}</span>
              </>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}
