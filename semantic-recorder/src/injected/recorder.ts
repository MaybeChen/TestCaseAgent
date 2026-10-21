import type { RawEvent } from '../domain/recorded-event.js';
import { inspect, readValue } from './element-inspector.js';
import { resolveContainers } from './container-resolver.js';
import { observeAfter, snapshot } from './state-observer.js';

declare global { interface Window {
  __semanticRecorderEmit?: (message: unknown) => Promise<void>;
  __semanticRecorderFlush?: () => Promise<void>;
} }
// Browser-world state is not a trust boundary; sites can spoof or tamper with evidence.
const documentId = crypto.randomUUID();
let localSequence = 0;
let stopped = false;
const outstanding = new Set<Promise<void>>();
const observers = new Set<() => void>();
function emit(message: unknown) {
  try {
    const payload = JSON.parse(JSON.stringify(message));
    const promise = Promise.resolve(window.__semanticRecorderEmit?.(payload)).catch(() => undefined);
    outstanding.add(promise); void promise.finally(() => outstanding.delete(promise));
  } catch { /* never interfere with the application */ }
}
function record(type: RawEvent['type'], target: Element, domEvents: string[], trusted: boolean, extra: Partial<RawEvent> = {}) {
  const sequence = ++localSequence;
  const id = `${documentId}:${sequence}`;
  const before = extra.before ?? snapshot(target);
  emit({ kind: 'event', id, timestamp: Date.now(), documentId, localSequence: sequence, type,
    target: inspect(target), containers: resolveContainers(target), before, domEvents, trusted, ...extra });
  const finish = observeAfter(id, target, before, emit);
  const cleanup = () => { finish(); observers.delete(cleanup); };
  observers.add(cleanup);
  setTimeout(() => observers.delete(cleanup), 850);
}
interface InputSession { target: Element; value: string; redacted: boolean; dirty: boolean; trusted: boolean; sources: Set<string>; captured: Pick<RawEvent, 'target' | 'containers' | 'before' | 'timestamp'> }
const sessions = new Map<Element, InputSession>();
const isText = (el: Element) => el.matches('textarea,input:not([type=checkbox]):not([type=radio]):not([type=button]):not([type=submit]):not([type=reset]):not([type=file]),[contenteditable=true]');
function begin(target: Element, trusted: boolean): InputSession {
  let session = sessions.get(target);
  if (!session) { session = { target, ...readValue(target), dirty: false, trusted, sources: new Set(['focusin']), captured: { target: inspect(target), containers: resolveContainers(target), before: snapshot(target), timestamp: Date.now() } }; sessions.set(target, session); }
  return session;
}
function flush(target: Element, incomplete = false) {
  const s = sessions.get(target); if (!s) return;
  sessions.delete(target);
  if (target.isConnected) Object.assign(s, readValue(target));
  if (s.dirty) record('fill', target, [...s.sources], s.trusted, { ...s.captured, value: s.value, redacted: s.redacted, inputStatus: incomplete ? 'incomplete' : 'complete' });
}
function flushAll(incomplete = false) { for (const el of sessions.keys()) flush(el, incomplete); }
function collect(event: Event) {
  if (stopped || !event.isTrusted) return;
  try {
    const original = event.composedPath()[0];
    if (!(original instanceof Element)) return;
    let target = original;
    if (event.type === 'click') {
      for (const el of sessions.keys()) if (el !== target) flush(el);
      target = target.closest('button,a,input,select,textarea,[role=button],[role=checkbox]') ?? target;
      // Native controls produce one semantic check/select/fill via input/change, not duplicate clicks.
      if (target.matches('input,select,textarea') || target.closest('label')?.querySelector('input')) return;
      record('click', target, ['click'], event.isTrusted);
    } else if (event.type === 'focusin' && isText(target)) begin(target, true);
    else if (event.type === 'input' && isText(target)) {
      const s = begin(target, true); Object.assign(s, readValue(target)); s.dirty = true; s.sources.add('input'); s.captured.containers = resolveContainers(target);
    } else if (event.type === 'change') {
      if (target.matches('input[type=checkbox],input[type=radio]')) record('check', target, ['change'], true, readValue(target));
      else if (target.matches('select')) record('select', target, ['change'], true, readValue(target));
      else if (isText(target)) { const s = begin(target, true); Object.assign(s, readValue(target)); s.dirty = true; s.sources.add('change'); flush(target); }
    } else if (event.type === 'focusout') { const s = sessions.get(target); s?.sources.add('focusout'); flush(target); }
    else if (event.type === 'submit') { flushAll(); record('submit', target, ['submit'], true); }
  } catch { emit({ kind: 'warning', message: 'Injected collector failed to inspect an event; capture may be incomplete.' }); }
}
for (const name of ['click', 'input', 'change', 'focusin', 'focusout', 'submit']) document.addEventListener(name, collect, true);
window.addEventListener('pagehide', () => { flushAll(true); for (const finish of observers) finish(); emit({ kind: 'warning', message: 'Document unloaded: last in-flight binding messages may be lost.' }); }, true);
window.__semanticRecorderFlush = async () => { flushAll(true); stopped = true; for (const finish of observers) finish(); await Promise.all([...outstanding]); };
emit({ kind: 'warning', message: 'MVP: DOM evidence and candidate accessible names are partial; closed shadow roots, file inputs, canvas and native browser dialogs are not captured. isTrusted is an auxiliary signal, not a security guarantee.' });
