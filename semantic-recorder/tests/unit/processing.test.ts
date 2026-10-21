import { describe, it, expect } from 'vitest';
import { analyzeLocator } from '../../src/processing/locator-analyzer.js';
import { extractIdentity } from '../../src/processing/identity-extractor.js';
import { correlateState } from '../../src/processing/state-correlator.js';
import { SemanticTraceSchema, type SemanticTrace, type RecordedEvent } from '../../src/domain/semantic-trace.js';
export const emptyTrace = (): SemanticTrace => ({ schemaVersion: '1.0', session: { id: 'test', startUrl: 'about:blank', startedAt: new Date().toISOString() }, events: [], values: {}, warnings: [], ordering: 'node-receipt; per-document localSequence retained; not global wall-clock causality' });
describe('locator heuristics', () => {
  it.each(['delete-1001', 'row-2058', 'user_78321', 'record_4389'])('flags record ID %s', id => expect(analyzeLocator({ tag: 'button', id })?.stability).toBe('likely_dynamic'));
  it.each(['step-1', 'tab-2', 'section-3', 'v2', 'username'])('does not infer dynamic or stable from %s', id => expect(analyzeLocator({ tag: 'button', id })?.stability).toBe('unknown'));
});
it('extracts only named business candidates without uniqueness claims', () => {
  const values: SemanticTrace['values'] = {};
  const candidates = extractIdentity([{ type: 'table_row', incomplete: false, evidence: [], fields: [
    { name: 'ID', value: '1001', index: 0, source: 'table_cell' },
    { name: '邮箱', value: 'a@example.com', index: 1, source: 'table_cell' },
    { name: '用户名', value: '[REDACTED]', redacted: true, index: 2, source: 'table_cell' }
  ] }], 'e1', values);
  expect(candidates).toHaveLength(1); expect(candidates[0]?.uniqueInCurrentView).toBeUndefined();
  expect(values[candidates[0]!.valueRef]?.value).toBe('a@example.com');
});
it('rejects broken value references and duplicate sequences', () => {
  const trace = emptyTrace();
  const event: RecordedEvent = { id: 'e1', sequence: 2, timestamp: 1, receivedAt: 1, type: 'fill', pageId: 'p1', frameId: 'f1', frameUrl: '', valueRef: 'missing', identityCandidates: [], evidence: { documentId: 'd1', localSequence: 1, domEvents: ['input'], trusted: true } };
  trace.events.push(event); expect(SemanticTraceSchema.safeParse(trace).success).toBe(false);
});
it('does not equate unchanged DOM with successful business operation', () => {
  const before = { url: 'about:blank', dialogs: [], visibleMessages: [] };
  const event = { id: 'e1', stateChange: { eventId: 'e1', before, status: 'pending', detectedChanges: [] } } as unknown as RecordedEvent;
  correlateState(event, before, false); expect(event.stateChange?.status).toBe('unknown');
  correlateState(event, { ...before, dialogs: ['确认'] }, true); expect(event.stateChange?.detectedChanges).toEqual(['dialogs_changed']);
});
