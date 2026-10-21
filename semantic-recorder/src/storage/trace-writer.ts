import { mkdir, open, rename, unlink, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { SemanticTraceSchema, type SemanticTrace } from '../domain/semantic-trace.js';
export class TraceWriter {
  readonly path: string;
  private queue = Promise.resolve();
  private constructor(directory: string, readonly maxBytes: number) { this.path = join(resolve(directory), 'semantic-trace.json'); }
  static async create(directory: string, maxBytes = 10 * 1024 * 1024) {
    const writer = new TraceWriter(directory, maxBytes);
    await mkdir(resolve(directory), { recursive: true });
    // Reserve the final filename atomically: an existing recording is never replaced.
    const file = await open(writer.path, 'wx'); await file.close();
    await mkdir(join(resolve(directory), 'artifacts'), { recursive: true });
    return writer;
  }
  save(trace: SemanticTrace): Promise<void> {
    const data = JSON.stringify(SemanticTraceSchema.parse(trace), null, 2) + '\n';
    if (Buffer.byteLength(data) > this.maxBytes) return Promise.reject(new Error('Trace size limit exceeded'));
    const operation = async () => {
      const temporary = `${this.path}.${randomUUID()}.tmp`;
      try { await writeFile(temporary, data, { encoding: 'utf8', flag: 'wx', mode: 0o600 }); await rename(temporary, this.path); }
      finally { await unlink(temporary).catch(() => undefined); }
    };
    const result = this.queue.then(operation); this.queue = result.catch(() => undefined); return result;
  }
}
