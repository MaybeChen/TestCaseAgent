import { z } from 'zod';
import { writeFile, mkdir } from 'node:fs/promises';
import { SemanticTraceSchema } from '../src/domain/semantic-trace.js';
await mkdir('dist/schema', { recursive: true });
await mkdir('schema', { recursive: true });
const json = JSON.stringify(z.toJSONSchema(SemanticTraceSchema), null, 2) + '\n';
await writeFile('schema/semantic-trace-1.0.schema.json', json);
await writeFile('dist/schema/semantic-trace-1.0.schema.json', json);
