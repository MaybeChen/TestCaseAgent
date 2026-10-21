import { z } from 'zod';
import { ContainerContextSchema, ElementContextSchema, SnapshotSchema } from './semantic-trace.js';
export const RawEventSchema = z.object({
  kind: z.literal('event'), id: z.string().max(200), timestamp: z.number(), documentId: z.string().max(100),
  localSequence: z.number().int().positive(), type: z.enum(['click', 'fill', 'select', 'check', 'submit']),
  target: ElementContextSchema, containers: z.array(ContainerContextSchema).max(6), before: SnapshotSchema,
  value: z.string().max(1000).optional(), redacted: z.boolean().optional(),
  domEvents: z.array(z.string().max(30)).max(10), trusted: z.boolean(), inputStatus: z.enum(['complete', 'incomplete']).optional()
});
export const BridgeMessageSchema = z.discriminatedUnion('kind', [
  RawEventSchema,
  z.object({ kind: z.literal('state'), id: z.string().max(200), after: SnapshotSchema, changed: z.boolean() }),
  z.object({ kind: z.literal('warning'), message: z.string().max(1000) })
]);
export type RawEvent = z.infer<typeof RawEventSchema>;
