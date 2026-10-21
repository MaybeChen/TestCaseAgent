import { it, expect } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TraceWriter } from '../../src/storage/trace-writer.js';
import type { SemanticTrace } from '../../src/domain/semantic-trace.js';
it('writes validated UTF-8 atomically and refuses overwrite', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'trace-storage-'));
  try {
    const trace: SemanticTrace = { schemaVersion: '1.0', session: { id: 'test', startUrl: 'about:blank', taskGoal: '删除用户', startedAt: new Date().toISOString() }, events: [], values: {}, warnings: [], ordering: 'node-receipt; per-document localSequence retained; not global wall-clock causality' };
    const writer = await TraceWriter.create(directory);
    await Promise.all([writer.save(trace), writer.save(trace)]);
    expect(JSON.parse(await readFile(writer.path, 'utf8')).session.taskGoal).toBe('删除用户');
    await expect(TraceWriter.create(directory)).rejects.toThrow();
    const tiny = await TraceWriter.create(join(directory, 'tiny'), 10);
    await expect(tiny.save(trace)).rejects.toThrow('size limit');
  } finally { await rm(directory, { recursive: true, force: true }); }
});
