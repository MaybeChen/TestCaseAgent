import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import type { Browser, BrowserContext, Page } from 'playwright';
import { SemanticTraceSchema, type SemanticTrace } from '../domain/semantic-trace.js';
import { TraceWriter } from '../storage/trace-writer.js';
import { EventBridge } from './event-bridge.js';
import { launchBrowser } from './browser-manager.js';
export interface RecorderOptions {
  url: string; output: string; goal?: string; headed?: boolean; maxDuration?: number;
  maxEvents?: number; maxBytes?: number;
}
export interface RecordingResult { path: string; trace: SemanticTrace }
export class RecorderSession {
  readonly trace: SemanticTrace;
  readonly done: Promise<RecordingResult>;
  private resolveDone!: (value: RecordingResult) => void;
  private rejectDone!: (error: unknown) => void;
  private bridge: EventBridge;
  private stopping?: Promise<RecordingResult>;
  private timer?: ReturnType<typeof setTimeout>;
  private constructor(readonly browser: Browser, readonly context: BrowserContext, readonly page: Page, private writer: TraceWriter, options: RecorderOptions) {
    this.trace = { schemaVersion: '1.0', session: { id: randomUUID(), startUrl: options.url, taskGoal: options.goal, startedAt: new Date().toISOString() }, events: [], values: {}, warnings: ['Capture is bounded and best-effort. Abrupt process termination, document unload and browser crash can lose in-flight events.'], ordering: 'node-receipt; per-document localSequence retained; not global wall-clock causality' };
    this.bridge = new EventBridge(this.trace, () => this.checkpoint(), options.maxEvents);
    this.done = new Promise((resolve, reject) => { this.resolveDone = resolve; this.rejectDone = reject; });
    // Avoid unhandled rejection before library consumers await done.
    void this.done.catch(() => undefined);
  }
  private async checkpoint() {
    // Leave headroom for terminal warnings and metadata.
    if (Buffer.byteLength(JSON.stringify(this.trace, null, 2)) > this.writer.maxBytes - 8192) {
      this.bridge.warn('Trace byte budget reached; newest events dropped to preserve a bounded valid trace.');
      while (this.trace.events.length && Buffer.byteLength(JSON.stringify(this.trace, null, 2)) > this.writer.maxBytes - 8192) {
        const removed = this.trace.events.pop()!;
        for (const ref of [removed.valueRef, ...removed.identityCandidates.map(c => c.valueRef)]) if (ref) delete this.trace.values[ref];
      }
      void this.stop('size-limit').catch(() => undefined);
    }
    await this.writer.save(this.trace);
  }
  static async start(options: RecorderOptions): Promise<RecorderSession> {
    const url = new URL(options.url);
    if (!['http:', 'https:', 'file:', 'about:'].includes(url.protocol)) throw new Error('Unsupported URL protocol');
    if (options.maxDuration !== undefined && (!Number.isFinite(options.maxDuration) || options.maxDuration <= 0)) throw new Error('maxDuration must be positive seconds');
    if (options.maxEvents !== undefined && (!Number.isInteger(options.maxEvents) || options.maxEvents < 1)) throw new Error('maxEvents must be a positive integer');
    if (options.maxBytes !== undefined && options.maxBytes < 16384) throw new Error('maxBytes must be at least 16384');
    const writer = await TraceWriter.create(options.output, options.maxBytes);
    let browser: Browser | undefined;
    let session: RecorderSession | undefined;
    try {
      browser = await launchBrowser(options.headed ?? true);
      const context = await browser.newContext();
      // No page navigation occurs until the binding and init script are installed.
      const page = await context.newPage();
      session = new RecorderSession(browser, context, page, writer, options);
      await writer.save(session.trace);
      await session.bridge.install(context);
      await context.addInitScript({ path: fileURLToPath(new URL('../../dist/injected/recorder.js', import.meta.url)) });
      const observe = (p: Page) => {
        p.on('framenavigated', frame => session!.bridge.navigation(p, frame));
        p.on('crash', () => session!.bridge.warn('Page crashed; pending events may be lost.'));
        p.on('close', () => { if (!session!.stopping && !context.pages().length) void session!.stop('last-page-closed').catch(() => undefined); });
      };
      observe(page); context.on('page', observe);
      browser.on('disconnected', () => { if (session!.stopping) return; session!.bridge.warn('Browser disconnected; unflushed document input may be lost.'); void session!.stop('browser-disconnected').catch(() => undefined); });
      if (options.maxDuration) session.timer = setTimeout(() => { void session!.stop('max-duration').catch(() => undefined); }, options.maxDuration * 1000);
      await page.goto(options.url, { waitUntil: 'domcontentloaded' });
      return session;
    } catch (error) {
      if (session) { session.bridge.warn('Startup/navigation failed; recording terminated early.'); await session.stop('startup-failed').catch(() => undefined); }
      else { await browser?.close(); await writer.save({ schemaVersion: '1.0', session: { id: randomUUID(), startUrl: options.url, startedAt: new Date().toISOString(), endedAt: new Date().toISOString() }, events: [], values: {}, warnings: ['Browser startup failed; no actions captured.'], ordering: 'node-receipt; per-document localSequence retained; not global wall-clock causality' }); }
      throw error;
    }
  }
  async flush(): Promise<void> {
    for (const p of this.context.pages()) for (const frame of p.frames()) {
      let timeout: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          frame.evaluate(async () => { await (window as Window & { __semanticRecorderFlush?: () => Promise<void> }).__semanticRecorderFlush?.(); }),
          new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new Error('Frame flush deadline')), 3000); })
        ]);
      } catch { this.bridge.warn('A frame could not flush (closed, navigating or timed out); pending input may be lost.'); }
      finally { clearTimeout(timeout); }
    }
    await this.bridge.drain();
  }
  stop(reason = 'requested'): Promise<RecordingResult> {
    if (this.stopping) return this.stopping;
    this.stopping = (async () => {
      clearTimeout(this.timer);
      try {
        if (reason !== 'requested') this.bridge.warn(`Recording ended: ${reason}`);
        if (this.browser.isConnected()) await this.flush();
        await this.bridge.close();
        for (const event of this.trace.events) if (event.stateChange?.status === 'pending') {
          event.stateChange.status = 'unknown'; event.stateChange.observation = 'Recording ended before after-state was observed.';
        }
        this.trace.session.endedAt = new Date().toISOString();
        await this.writer.save(this.trace);
        const result = { path: this.writer.path, trace: SemanticTraceSchema.parse(this.trace) };
        await this.browser.close().catch(() => undefined);
        this.resolveDone(result); return result;
      } catch (error) { this.rejectDone(error); throw error; }
      finally { await this.browser.close().catch(() => undefined); }
    })();
    return this.stopping;
  }
}
