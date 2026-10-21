import { it, expect } from 'vitest';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SemanticTraceSchema } from '../../src/domain/semantic-trace.js';
it.each(['SIGINT', 'SIGTERM'] as const)('CLI flushes and exits successfully on %s', async signal => {
  const directory = await mkdtemp(join(tmpdir(), 'semantic-cli-test-'));
  const child = spawn(process.execPath, [fileURLToPath(new URL('../../dist/cli/index.js', import.meta.url)), '--url', 'about:blank', '--output', directory, '--no-headed'], { cwd: tmpdir(), env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = ''; let stderr = '';
  child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
  const closed = new Promise<number | null>((resolve, reject) => { child.once('error', reject); child.once('close', resolve); });
  const ready = new Promise<void>((resolve, reject) => {
    child.stdout.on('data', (text: string) => { stdout += text; if (stdout.includes('Recording.')) resolve(); });
    child.stderr.on('data', (text: string) => { stderr += text; });
    child.once('exit', () => { if (!stdout.includes('Recording.')) reject(new Error(`CLI exited before startup: ${stderr}`)); });
  });
  try {
    await ready; child.kill(signal);
    expect(await closed, stderr).toBe(0);
    expect(stdout).toContain('Saved');
    const trace = SemanticTraceSchema.parse(JSON.parse(await readFile(join(directory, 'semantic-trace.json'), 'utf8')));
    expect(trace.session.endedAt).toBeDefined();
  } finally { if (child.exitCode === null && child.signalCode === null) { child.kill('SIGTERM'); await closed; } await rm(directory, { recursive: true, force: true }); }
});
