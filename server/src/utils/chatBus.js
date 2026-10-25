const { EventEmitter } = require('events');

// In-process pub/sub that feeds the live chat stream (FR27), one topic per workspace.
// Like the activity feed (FR15) it works for a single server process, which is what a course project runs.
const bus = new EventEmitter();
bus.setMaxListeners(0);

const topic = (workspaceId) => `chat:${workspaceId}`;

// event: { type: 'message' | 'message_edited' | 'message_deleted' | 'channel', ... }
function publish(workspaceId, event) {
  bus.emit(topic(workspaceId), event);
}

// Returns an unsubscribe function.
function subscribe(workspaceId, handler) {
  const name = topic(workspaceId);
  bus.on(name, handler);
  return () => bus.off(name, handler);
}

const listenerCount = (workspaceId) => bus.listenerCount(topic(workspaceId));

module.exports = { publish, subscribe, listenerCount };
