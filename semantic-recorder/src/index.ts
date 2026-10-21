export { RecorderSession, type RecorderOptions, type RecordingResult } from './browser/session-manager.js';
export { SemanticTraceSchema, RecordedEventSchema, type SemanticTrace, type RecordedEvent, type ElementContext, type ContainerContext } from './domain/semantic-trace.js';
export { analyzeLocator } from './processing/locator-analyzer.js';
export { TraceWriter } from './storage/trace-writer.js';
