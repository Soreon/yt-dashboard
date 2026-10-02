// Static file server for the end-to-end tests, without dependency: node tests/e2e/server.js [port]

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';

const root = resolve(import.meta.dirname, '..', '..');
const port = Number(process.argv[2]) || 4173;

const CONTENT_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.json': 'application/json',
    '.webmanifest': 'application/manifest+json'
};

createServer(async (request, response) => {
    const path = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    const file = normalize(join(root, path === '/' ? 'index.html' : path));

    if (file !== root && !file.startsWith(root + sep)) {
        response.writeHead(403).end();
        return;
    }

    try {
        const body = await readFile(file);
        response.writeHead(200, {
            'Content-Type': CONTENT_TYPES[extname(file)] || 'application/octet-stream',
            'Cache-Control': 'no-store'
        });
        response.end(body);
    } catch {
        response.writeHead(404).end('Not found');
    }
}).listen(port, '127.0.0.1', () => {
    console.log(`Serving ${root} on http://127.0.0.1:${port}`);
});
