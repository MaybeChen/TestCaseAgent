import { z } from 'zod';
const text = z.string().max(1000);
export const StabilitySchema = z.enum(['stable', 'likely_dynamic', 'unknown']);
export const ElementContextSchema = z.object({
  tag: text, role: text.optional(), accessibleName: text.optional(),
  nameSource: z.enum(['aria-label', 'aria-labelledby', 'label', 'alt', 'title', 'text']).optional(),
  nameIsCandidate: z.literal(true).optional(), text: text.optional(), ariaLabel: text.optional(),
  label: text.optional(), placeholder: text.optional(), title: text.optional(), testId: text.optional(),
  id: text.optional(), type: text.optional(), sensitive: z.boolean().optional()
});
export const FieldSchema = z.object({
  name: text.optional(), value: text, index: z.number().int().nonnegative(),
  source: z.enum(['table_cell', 'form_field', 'card_text']), redacted: z.boolean().optional()
});
export const ContainerContextSchema = z.object({
  type: z.enum(['table_row', 'form', 'dialog', 'list_item', 'card', 'generic']),
  name: text.optional(), fields: z.array(FieldSchema).max(30),
  summary: text.optional(), incomplete: z.boolean(), evidence: z.array(text).max(10)
});
export const SnapshotSchema = z.object({
  url: z.string().max(4096), visibleMessages: z.array(text).max(10),
  dialogs: z.array(text).max(10), targetConnected: z.boolean().optional()
});
export const StateChangeSchema = z.object({
  eventId: z.string(), before: SnapshotSchema, after: SnapshotSchema.optional(),
  status: z.enum(['observed', 'pending', 'unknown']), detectedChanges: z.array(text),
  observation: text.optional()
});
export const IdentityCandidateSchema = z.object({
  field: text, valueRef: text, source: z.enum(['table_cell', 'form_field', 'card_text']),
  uniqueInCurrentView: z.boolean().optional(), stability: StabilitySchema
});
export const RecordedEventSchema = z.object({
  id: z.string(), sequence: z.number().int().positive(), timestamp: z.number(), receivedAt: z.number(),
  type: z.enum(['click', 'fill', 'select', 'check', 'submit', 'navigate', 'unknown']),
  pageId: z.string(), frameId: z.string(), frameUrl: z.string().max(4096),
  target: ElementContextSchema.optional(), container: ContainerContextSchema.optional(),
  containers: z.array(ContainerContextSchema).max(6).optional(), valueRef: text.optional(),
  locatorRisk: z.object({ locator: text.optional(), stability: StabilitySchema, reason: text }).optional(),
  identityCandidates: z.array(IdentityCandidateSchema), stateChange: StateChangeSchema.optional(),
  evidence: z.object({ documentId: z.string(), localSequence: z.number().int(), domEvents: z.array(text),
    trusted: z.boolean(), inputStatus: z.enum(['complete', 'incomplete']).optional() })
});
export const SemanticTraceSchema = z.object({
  schemaVersion: z.literal('1.0'),
  session: z.object({ id: z.string(), startUrl: z.string(), taskGoal: z.string().optional(), startedAt: z.string().datetime(), endedAt: z.string().datetime().optional() }),
  events: z.array(RecordedEventSchema),
  values: z.record(z.string(), z.object({ value: text, redacted: z.boolean() })),
  warnings: z.array(z.string()),
  ordering: z.literal('node-receipt; per-document localSequence retained; not global wall-clock causality')
}).superRefine((trace, ctx) => {
  const ids = new Set<string>();
  trace.events.forEach((event, index) => {
    if (event.sequence !== index + 1 || ids.has(event.id)) ctx.addIssue({ code: 'custom', message: 'Invalid sequence or duplicate event ID' });
    ids.add(event.id);
    for (const ref of [event.valueRef, ...event.identityCandidates.map(c => c.valueRef)]) {
      if (ref && !trace.values[ref]) ctx.addIssue({ code: 'custom', message: `Unresolved valueRef: ${ref}` });
    }
    if (event.stateChange && event.stateChange.eventId !== event.id) ctx.addIssue({ code: 'custom', message: 'State eventId mismatch' });
  });
});
export type SemanticTrace = z.infer<typeof SemanticTraceSchema>;
export type RecordedEvent = z.infer<typeof RecordedEventSchema>;
export type ElementContext = z.infer<typeof ElementContextSchema>;
export type ContainerContext = z.infer<typeof ContainerContextSchema>;
export type Field = z.infer<typeof FieldSchema>;
export type Snapshot = z.infer<typeof SnapshotSchema>;
