import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
const html = await readFile(new URL('../fixtures/dynamic-user-table.html', import.meta.url));
createServer((_request, response) => { response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); response.end(html); }).listen(4173, '127.0.0.1', () => console.log('Fixture listening on port 4173'));
