// Returns true if making `taskId` depend on `newDependencyIds` would create a
// cycle (A blocked by B blocked by ... blocked by A).
// `getDependencies(id)` must resolve to an array of dependency id strings.
async function wouldCreateCycle(taskId, newDependencyIds, getDependencies) {
  const target = String(taskId);
  const visited = new Set();
  const stack = newDependencyIds.map(String);

  while (stack.length) {
    const current = stack.pop();
    if (current === target) return true;
    if (visited.has(current)) continue;
    visited.add(current);
    const deps = await getDependencies(current);
    for (const dep of deps) stack.push(String(dep));
  }
  return false;
}

module.exports = { wouldCreateCycle };
