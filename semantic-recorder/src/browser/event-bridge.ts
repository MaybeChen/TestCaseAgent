import type { BrowserContext, Frame, Page } from 'playwright';
import { BridgeMessageSchema } from '../domain/recorded-event.js';
import type { SemanticTrace } from '../domain/semantic-trace.js';
import { normalizeEvent } from '../processing/event-normalizer.js';
import { correlateState } from '../processing/state-correlator.js';
export class EventBridge {
  private pageIds = new WeakMap<Page, string>(); private frameIds = new WeakMap<Frame, string>();
  private pages = 0; private frames = 0; private closed = false;
  private queue: Promise<void> = Promise.resolve();
  private ids = new Set<string>();
  constructor(readonly trace: SemanticTrace, private checkpoint: () => Promise<void>, readonly maxEvents = 10000) {}
  warn(message: string) { if (!this.trace.warnings.includes(message) && this.trace.warnings.length < 100) this.trace.warnings.push(message); }
  identity(page: Page, frame: Frame) {
    if (!this.pageIds.has(page)) this.pageIds.set(page, `page-${++this.pages}`);
    if (!this.frameIds.has(frame)) this.frameIds.set(frame, `frame-${++this.frames}`);
    return { pageId: this.pageIds.get(page)!, frameId: this.frameIds.get(frame)!, frameUrl: frame.url().slice(0, 4096) };
  }
  async install(context: BrowserContext) {
    await context.exposeBinding('__semanticRecorderEmit', (source, payload: unknown) => {
      if (this.closed) return;
      const identity = this.identity(source.page, source.frame);
      const process = async () => {
        let bytes: number;
        try { bytes = Buffer.byteLength(JSON.stringify(payload)); } catch { this.warn('Non-JSON bridge payload rejected.'); return; }
        if (bytes > 65536) { this.warn('Oversized bridge payload dropped.'); return; }
        const result = BridgeMessageSchema.safeParse(payload);
        if (!result.success) { this.warn('Invalid bridge payload dropped.'); return; }
        const message = result.data;
        if (message.kind === 'warning') this.warn(message.message);
        else if (message.kind === 'state') {
          const event = this.trace.events.find(e => e.id === message.id && e.frameId === identity.frameId);
          if (event) correlateState(event, message.after, message.changed);
        } else {
          if (this.ids.has(message.id)) { this.warn('Duplicate event ID dropped.'); return; }
          if (this.trace.events.length >= this.maxEvents) { this.warn(`Event limit ${this.maxEvents} reached; subsequent actions dropped.`); return; }
          const previous = this.trace.events.at(-1);
          if (previous && previous.frameId !== identity.frameId) this.warn('Cross-frame/page order uses Node receipt order, not a synchronized user timeline.');
          const event = normalizeEvent(message, identity, this.trace);
          this.trace.events.push(event); this.ids.add(message.id);
          if (message.inputStatus === 'incomplete') this.warn('An input session ended at stop/unload; final input boundary is incomplete.');
          if (message.containers.some(c => c.incomplete)) this.warn('Some container evidence is incomplete; inspect per-container flags.');
        }
        await this.checkpoint();
      };
      const task = this.queue.then(process);
      this.queue = task.catch(error => this.warn(`Checkpoint or bridge processing failed: ${error instanceof Error ? error.message : 'unknown error'}`));
      return this.queue;
    });
  }
  navigation(page: Page, frame: Frame) {
    if (this.closed || frame.url() === 'about:blank') return;
    const identity = this.identity(page, frame);
    this.queue = this.queue.then(async () => {
      for (const event of this.trace.events.filter(e => e.frameId === identity.frameId && e.stateChange?.status === 'pending')) {
        const before = event.stateChange!.before;
        if (before.url !== frame.url()) event.stateChange = { eventId: event.id, before, after: { url: frame.url().slice(0, 4096), visibleMessages: [], dialogs: [] }, status: 'observed', detectedChanges: ['url_changed'], observation: 'Frame navigation observed; DOM after-state unavailable at commit.' };
      }
      if (this.trace.events.length < this.maxEvents) {
        const id = `navigation:${identity.frameId}:${this.trace.events.length + 1}`;
        this.trace.events.push({ ...identity, id, sequence: this.trace.events.length + 1, timestamp: Date.now(), receivedAt: Date.now(), type: 'navigate', identityCandidates: [], evidence: { documentId: 'playwright-navigation', localSequence: 0, domEvents: ['framenavigated'], trusted: false } });
      }
      await this.checkpoint();
    }).catch(error => this.warn(`Navigation checkpoint failed: ${String(error)}`));
  }
  async drain() { await this.queue; }
  async close() { this.closed = true; await this.drain(); }
}
