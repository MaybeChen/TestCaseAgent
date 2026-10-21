import type { RawEvent } from '../domain/recorded-event.js';
import type { RecordedEvent, SemanticTrace } from '../domain/semantic-trace.js';
import { analyzeLocator } from './locator-analyzer.js';
import { extractIdentity } from './identity-extractor.js';
export function normalizeEvent(raw: RawEvent, identity: { pageId: string; frameId: string; frameUrl: string }, trace: SemanticTrace): RecordedEvent {
  const event: RecordedEvent = {
    id: raw.id, sequence: trace.events.length + 1, timestamp: raw.timestamp, receivedAt: Date.now(), type: raw.type,
    ...identity, target: raw.target, container: raw.containers[0], containers: raw.containers,
    locatorRisk: analyzeLocator(raw.target), identityCandidates: extractIdentity(raw.containers, raw.id, trace.values),
    stateChange: { eventId: raw.id, before: raw.before, status: 'pending', detectedChanges: [] },
    evidence: { documentId: raw.documentId, localSequence: raw.localSequence, domEvents: raw.domEvents, trusted: raw.trusted, inputStatus: raw.inputStatus }
  };
  if (raw.value !== undefined) {
    event.valueRef = `${raw.id}:value`; trace.values[event.valueRef] = { value: raw.value, redacted: raw.redacted ?? false };
  }
  return event;
}
