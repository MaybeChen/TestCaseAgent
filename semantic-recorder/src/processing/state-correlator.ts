import type { RecordedEvent, Snapshot } from '../domain/semantic-trace.js';
export function correlateState(event: RecordedEvent, after: Snapshot, changed: boolean): void {
  if (!event.stateChange) return;
  const before = event.stateChange.before;
  const changes: string[] = [];
  if (before.url !== after.url) changes.push('url_changed');
  if (JSON.stringify(before.dialogs) !== JSON.stringify(after.dialogs)) changes.push('dialogs_changed');
  if (JSON.stringify(before.visibleMessages) !== JSON.stringify(after.visibleMessages)) changes.push('visible_messages_changed');
  if (before.targetConnected && after.targetConnected === false) changes.push('target_detached');
  event.stateChange = { eventId: event.id, before, after, status: changed && changes.length ? 'observed' : 'unknown', detectedChanges: changes, observation: 'Bounded DOM observation; temporal association is not proof of causation or business success.' };
}
