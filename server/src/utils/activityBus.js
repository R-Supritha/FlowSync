const { EventEmitter } = require('events');

// In-process pub/sub that feeds the live activity stream (FR15).
// Works for a single server process, which is what a course project runs.
const bus = new EventEmitter();
bus.setMaxListeners(0);

const channel = (projectId) => `project:${projectId}`;

function publish(activity) {
  bus.emit(channel(activity.project), activity);
}

// Returns an unsubscribe function.
function subscribe(projectId, handler) {
  const name = channel(projectId);
  bus.on(name, handler);
  return () => bus.off(name, handler);
}

module.exports = { publish, subscribe };