// Extracts @handle tokens from comment text (e.g. "@sunitha nice work" -> ["sunitha"]).
function extractMentionHandles(text) {
  const matches = String(text || '').match(/@([a-zA-Z0-9_.]+)/g) || [];
  return [...new Set(matches.map((m) => m.slice(1).toLowerCase()))];
}

// Resolves handles against a list of candidate users ({ _id, name, email }).
// A handle matches a user's first name, their full name with spaces removed,
// or their email's local part - whichever the person actually typed after the @.
// If a handle is ambiguous (matches more than one user the same way), it's skipped
// rather than guessed, so a mention never reaches the wrong person.
function resolveMentions(handles, candidateUsers) {
  if (!handles.length) return [];
  const byHandle = new Map(); // handle -> user, or 'AMBIGUOUS'
  const add = (key, u) => {
    if (!key) return;
    if (byHandle.has(key) && byHandle.get(key) !== 'AMBIGUOUS' && byHandle.get(key)._id !== u._id) {
      byHandle.set(key, 'AMBIGUOUS');
    } else if (!byHandle.has(key)) {
      byHandle.set(key, u);
    }
  };
  for (const u of candidateUsers) {
    const name = String(u.name || '').trim().toLowerCase();
    const firstName = name.split(/\s+/)[0];
    const fullNoSpaces = name.replace(/\s+/g, '');
    const emailHandle = String(u.email || '').split('@')[0].toLowerCase();
    add(firstName, u);
    add(fullNoSpaces, u);
    add(emailHandle, u);
  }
  const resolved = [];
  for (const h of handles) {
    const user = byHandle.get(h);
    if (user && user !== 'AMBIGUOUS') resolved.push(user);
  }
  return resolved;
}

module.exports = { extractMentionHandles, resolveMentions };
