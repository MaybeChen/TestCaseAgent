import { beforeAll, afterAll, afterEach, it, expect, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RecorderSession } from '../../src/browser/session-manager.js';
import { SemanticTraceSchema } from '../../src/domain/semantic-trace.js';
let server: Server; let base: string; let root: string;
const sessions: RecorderSession[] = [];
beforeAll(async () => {
  const fixture = await readFile(new URL('../../fixtures/dynamic-user-table.html', import.meta.url), 'utf8');
  server = createServer((req, res) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    if (req.url === '/frames') res.end('<iframe src="/child"></iframe><a href="/" target="_blank">popup</a>');
    else if (req.url === '/child') res.end('<button id="remove-321" onclick="this.remove()">Immediate delete</button>');
    else if (req.url === '/complex') res.end(`<div role="table"><div role="row"><span role="columnheader" aria-colindex="2" id="mail">邮箱</span><span role="columnheader" aria-colindex="1">用户名</span></div><div role="row"><span role="cell" aria-colindex="1">lisi</span><span role="cell" headers="mail">lisi@example.com</span><button>删除</button></div></div><table><thead><tr><th colspan="2">复杂</th></tr></thead><tbody><tr><td>one</td><td>two</td><td><button>复杂删除</button></td></tr></tbody></table>`);
    else res.end(fixture);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('No server address');
  base = `http://127.0.0.1:${address.port}`; root = await mkdtemp(join(tmpdir(), 'semantic-integration-'));
});
afterEach(async () => { await Promise.all(sessions.splice(0).map(s => s.stop())); });
afterAll(async () => { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); await rm(root, { recursive: true, force: true }); });
async function start(path = '/', extra: Partial<Parameters<typeof RecorderSession.start>[0]> = {}) {
  const s = await RecorderSession.start({ url: `${base}${path}`, output: join(root, crypto.randomUUID()), headed: false, ...extra }); sessions.push(s); return s;
}
it('captures dynamic row identity before delete, observes dialogs and preserves new ID', async () => {
  const s = await start(); const p = s.page;
  await p.locator('#delete-1001').click();
  await vi.waitFor(() => expect(s.trace.events.find(e => e.target?.id === 'delete-1001')?.stateChange?.detectedChanges).toContain('dialogs_changed'));
  await p.locator('#confirm-delete').click();
  await vi.waitFor(() => expect(s.trace.events.find(e => e.target?.id === 'confirm-delete')?.stateChange?.detectedChanges).toContain('visible_messages_changed'));
  await p.getByLabel('用户名', { exact: true }).fill('zhangsan');
  await p.getByLabel('邮箱', { exact: true }).fill('zhangsan@example.com');
  await p.getByRole('button', { name: '新增', exact: true }).click();
  await p.locator('#delete-2058').click();
  const { trace, path } = await s.stop();
  const clicks = trace.events.filter(e => /^delete-/.test(e.target?.id ?? ''));
  expect(clicks).toHaveLength(2);
  expect(clicks.map(e => e.locatorRisk?.stability)).toEqual(['likely_dynamic', 'likely_dynamic']);
  for (const click of clicks) {
    expect(click.container?.fields.map(f => f.value)).toContain('zhangsan');
    expect(click.identityCandidates.map(c => trace.values[c.valueRef]?.value)).toEqual(['zhangsan', 'zhangsan@example.com']);
    expect(click.identityCandidates.every(c => c.uniqueInCurrentView === undefined)).toBe(true);
  }
  expect(SemanticTraceSchema.parse(JSON.parse(await readFile(path, 'utf8'))).events.length).toBe(trace.events.length);
});
it('merges typing, records checks/selects and redacts passwords before bridge', async () => {
  const s = await start(); const payloads: unknown[] = [];
  // Observe transport as well as final disk output: secret must never cross binding.
  await s.page.evaluate(() => {
    const emit = (window as any).__semanticRecorderEmit;
    (window as any).__transport = [];
    (window as any).__semanticRecorderEmit = new Proxy(emit, { apply(target, thisArg, args) { (window as any).__transport.push(args[0]); return Reflect.apply(target, thisArg, args); } });
  });
  await s.page.getByLabel('用户名', { exact: true }).pressSequentially('zhangsan');
  await s.page.getByLabel('密码', { exact: true }).fill('SECRET-password-123');
  await s.page.getByLabel('接收通知').check();
  await s.page.getByRole('combobox').focus();
  await s.page.getByRole('combobox').press('ArrowDown');
  await s.page.getByRole('combobox').press('Enter');
  await s.page.evaluate(() => document.querySelector('h1')!.dispatchEvent(new MouseEvent('click', { bubbles: true })));
  await s.flush(); payloads.push(await s.page.evaluate(() => (window as any).__transport));
  const { trace } = await s.stop();
  expect(trace.events.filter(e => e.type === 'fill' && e.target?.label === '用户名')).toHaveLength(1);
  expect(trace.events.filter(e => e.type === 'check')).toHaveLength(1);
  expect(trace.events.filter(e => e.type === 'select')).toHaveLength(1);
  expect(JSON.stringify(payloads)).not.toContain('SECRET-password-123');
  expect(JSON.stringify(trace)).not.toContain('SECRET-password-123');
  expect(Object.values(trace.values).some(v => v.redacted && v.value === '[REDACTED]')).toBe(true);
  expect(trace.events.some(e => e.target?.tag === 'h1')).toBe(false);
});
it('records frames, immediate removal and popups, survives navigation', async () => {
  const s = await start('/frames');
  await s.page.frameLocator('iframe').getByRole('button').click();
  await vi.waitFor(() => expect(s.trace.events.find(e => e.target?.id === 'remove-321')?.stateChange?.detectedChanges).toContain('target_detached'));
  const popupPromise = s.context.waitForEvent('page'); await s.page.getByText('popup').click(); const popup = await popupPromise;
  await popup.waitForLoadState('domcontentloaded'); await popup.locator('#delete-1001').click();
  await s.page.goto(`${base}/`); await s.page.locator('#navigate').click();
  await s.page.getByLabel('用户名', { exact: true }).fill('after navigation');
  const { trace } = await s.stop();
  expect(new Set(trace.events.map(e => e.pageId)).size).toBe(2);
  expect(new Set(trace.events.map(e => e.frameId)).size).toBeGreaterThanOrEqual(3);
  expect(trace.events.some(e => e.type === 'navigate' && e.frameUrl.includes('view=next'))).toBe(true);
  expect(trace.events.some(e => e.type === 'fill')).toBe(true);
  expect(trace.events.map(e => e.sequence)).toEqual(trace.events.map((_, i) => i + 1));
});
it('matches ARIA column indices and explicit headers; leaves complex columns unnamed', async () => {
  const s = await start('/complex');
  await s.page.getByRole('button', { name: '删除', exact: true }).click();
  await s.page.getByRole('button', { name: '复杂删除', exact: true }).click();
  const { trace } = await s.stop();
  const row = trace.events.find(e => e.target?.text === '删除')?.container;
  expect(row?.fields.map(f => [f.name, f.value])).toEqual([['用户名', 'lisi'], ['邮箱', 'lisi@example.com']]);
  const complex = trace.events.find(e => e.target?.text === '复杂删除')?.container;
  expect(complex?.incomplete).toBe(true); expect(complex?.fields.every(f => f.name === undefined)).toBe(true);
});
it('saves on browser disconnect and warns about unflushed input', async () => {
  const s = await start(); await s.page.locator('#delete-1001').click();
  await vi.waitFor(() => expect(s.trace.events.some(e => e.target?.id === 'delete-1001')).toBe(true));
  await s.browser.close(); const result = await s.done;
  expect(SemanticTraceSchema.safeParse(JSON.parse(await readFile(result.path, 'utf8'))).success).toBe(true);
  expect(result.trace.warnings.some(w => /closed|disconnected/.test(w))).toBe(true);
});
it('enforces event budget and automatic duration stop', async () => {
  const s = await start('/', { maxEvents: 2, maxDuration: 1 });
  await s.page.locator('#delete-1001').click(); await s.page.locator('#cancel-delete').click();
  const result = await s.done;
  expect(result.trace.events.length).toBeLessThanOrEqual(2);
  expect(result.trace.warnings.some(w => w.includes('limit'))).toBe(true);
  expect(result.trace.session.endedAt).toBeDefined();
});

it('preserves a controlled input removed immediately by search', async () => {
  const s = await start();
  await s.page.evaluate(() => {
    const input = document.querySelector<HTMLInputElement>('input[name=username]')!;
    input.addEventListener('input', () => { input.value = input.value.toUpperCase(); if (input.value.length >= 3) input.remove(); });
  });
  await s.page.getByLabel('用户名', { exact: true }).fill('search');
  const { trace } = await s.stop();
  const fill = trace.events.find(e => e.type === 'fill');
  expect(fill?.target?.label).toBe('用户名');
  expect(trace.values[fill!.valueRef!]?.value).toBe('SEARCH'); // Native change/blur observes the application's final controlled value.
  expect(fill?.container?.type).toBe('form');
  expect(fill?.evidence.domEvents).toContain('input');
});
it('flushes input around navigation and captures controls inside the new document', async () => {
  const s = await start();
  await s.page.getByLabel('用户名', { exact: true }).fill('first');
  await s.page.locator('#navigate').click();
  await s.page.getByLabel('用户名', { exact: true }).fill('second');
  const { trace } = await s.stop();
  expect(trace.events.filter(e => e.type === 'fill').map(e => trace.values[e.valueRef!]?.value)).toEqual(['first', 'second']);
  expect(trace.events.filter(e => e.type === 'fill')[1]?.frameUrl).toContain('view=next');
});
it('stops with a valid bounded trace when byte budget is exhausted', async () => {
  const s = await start('/', { maxBytes: 16384 });
  await s.page.evaluate(() => {
    const form = document.querySelector('form')!;
    for (let i = 0; i < 20; i++) { const input = document.createElement('input'); input.name = 'field' + i; input.value = 'x'.repeat(900); form.append(input); }
  });
  await s.page.getByRole('button', { name: '新增', exact: true }).click().catch(() => undefined);
  const result = await s.done;
  const data = await readFile(result.path, 'utf8');
  expect(Buffer.byteLength(data)).toBeLessThanOrEqual(16384);
  expect(SemanticTraceSchema.safeParse(JSON.parse(data)).success).toBe(true);
  expect(result.trace.warnings.some(w => w.includes('byte budget'))).toBe(true);
});

it('marks a still-focused typing session incomplete at stop', async () => {
  const s = await start();
  await s.page.getByLabel('用户名', { exact: true }).pressSequentially('unfinished');
  const { trace } = await s.stop();
  const fills = trace.events.filter(e => e.type === 'fill');
  expect(fills).toHaveLength(1);
  expect(fills[0]?.evidence.inputStatus).toBe('incomplete');
  expect(trace.values[fills[0]!.valueRef!]?.value).toBe('unfinished');
});
