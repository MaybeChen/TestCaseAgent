import type { ElementContext, RecordedEvent } from '../domain/semantic-trace.js';
export function analyzeLocator(target: ElementContext): RecordedEvent['locatorRisk'] {
  const id = target.id;
  if (!id) return { stability: target.testId ? 'stable' : 'unknown', reason: target.testId ? 'Explicit test ID convention; stability still depends on application contract' : 'No ID evidence' };
  if (/^(delete|row|user|record|order|edit|remove)[-_]\d+$/i.test(id) || /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i.test(id)) return { locator: `[id=${JSON.stringify(id)}]`, stability: 'likely_dynamic', reason: 'ID contains a likely record number or UUID; static heuristic only' };
  return { locator: `[id=${JSON.stringify(id)}]`, stability: 'unknown', reason: /^(step|tab|section)[-_]\d+$/i.test(id) ? 'Ordinal UI ID may be stable; insufficient evidence' : 'Static observation cannot establish ID stability' };
}
