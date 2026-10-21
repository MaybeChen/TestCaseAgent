#!/usr/bin/env node
import { Command, InvalidArgumentError } from 'commander';
import { RecorderSession } from '../browser/session-manager.js';
const positive = (text: string) => { const n = Number(text); if (!Number.isFinite(n) || n <= 0) throw new InvalidArgumentError('Expected positive seconds'); return n; };
const cli = new Command().name('semantic-recorder').description('Record browser actions with bounded semantic DOM evidence')
  .requiredOption('--url <url>', 'Target URL').requiredOption('--output <directory>', 'New recording directory')
  .option('--goal <text>', 'Task goal').option('--headed', 'Show browser (default)', true)
  .option('--no-headed', 'Run headlessly').option('--max-duration <seconds>', 'Stop automatically', positive);
await cli.parseAsync();
let session: RecorderSession | undefined;
let requestedStop = false;
const stop = () => { requestedStop = true; if (session) void session.stop().catch(error => { console.error(String(error)); process.exitCode = 1; }); };
process.on('SIGINT', stop); process.on('SIGTERM', stop); process.on('SIGHUP', stop);
try {
  const options = cli.opts<{url: string; output: string; goal?: string; headed: boolean; maxDuration?: number}>();
  session = await RecorderSession.start(options);
  console.log('Recording. Press Ctrl+C or close the browser to save.');
  if (requestedStop) void session.stop();
  const result = await session.done;
  console.log(`Saved ${result.trace.events.length} events: ${result.path}`);
  for (const warning of result.trace.warnings) console.warn(`Warning: ${warning}`);
} catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; }
finally { process.off('SIGINT', stop); process.off('SIGTERM', stop); process.off('SIGHUP', stop); }
