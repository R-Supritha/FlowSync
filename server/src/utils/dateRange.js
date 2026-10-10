// Monday-start week containing `date`.
function weekRange(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay(); // 0 = Sunday
  const diffToMonday = day === 0 ? -6 : 1 - day;
  const start = new Date(d);
  start.setDate(d.getDate() + diffToMonday);
  const end = new Date(start);
  end.setDate(start.getDate() + 7);
  return { start, end };
}

// Calendar month containing `date` (1st 00:00 to 1st of next month 00:00).
function monthRange(date) {
  const d = new Date(date);
  const start = new Date(d.getFullYear(), d.getMonth(), 1);
  const end = new Date(d.getFullYear(), d.getMonth() + 1, 1);
  return { start, end };
}

function rangeFor(view, dateStr) {
  const date = dateStr ? new Date(dateStr) : new Date();
  if (Number.isNaN(date.getTime())) return null;
  return view === 'month' ? monthRange(date) : weekRange(date);
}

module.exports = { weekRange, monthRange, rangeFor };
