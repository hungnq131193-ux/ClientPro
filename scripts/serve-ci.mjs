#!/usr/bin/env node

import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const brotli = promisify(zlib.brotliCompress);
const gzip = promisify(zlib.gzip);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HOST = process.env.HOST || '127.0.0.1';
const PORT = Number(process.env.PORT || 8080);

const MIME = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.webmanifest', 'application/manifest+json; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.webp', 'image/webp'],
  ['.ico', 'image/x-icon'],
  ['.woff2', 'font/woff2'],
  ['.pdf', 'application/pdf'],
  ['.zip', 'application/zip'],
]);

const TEXT_TYPES = /^(?:text\/|application\/(?:javascript|json|manifest\+json)|image\/svg\+xml)/;
const encodedCache = new Map();

function safeFilePath(requestUrl) {
  const parsed = new URL(requestUrl, `http://${HOST}:${PORT}`);
  let pathname = decodeURIComponent(parsed.pathname);
  if (pathname.endsWith('/')) pathname += 'index.html';
  const resolved = path.resolve(ROOT, '.' + pathname);
  if (resolved !== ROOT && !resolved.startsWith(ROOT + path.sep)) return null;
  return { resolved, parsed };
}

function cacheControl(filePath, parsed) {
  const base = path.basename(filePath);
  if (base === 'index.html' || base === 'manifest.json' || base === 'sw.js') {
    return 'no-cache';
  }
  if (parsed.searchParams.has('v') || /\.(?:woff2|png|webp|svg|ico)$/.test(base)) {
    return 'public, max-age=31536000, immutable';
  }
  return 'public, max-age=3600';
}

async function encodedBody(filePath, raw, encoding, mime) {
  if (!TEXT_TYPES.test(mime) || raw.length < 1024 || encoding === 'identity') {
    return { body: raw, encoding: null };
  }
  const stat = await fs.stat(filePath);
  const key = `${filePath}:${stat.mtimeMs}:${encoding}`;
  if (encodedCache.has(key)) return encodedCache.get(key);

  let body;
  if (encoding === 'br') {
    body = await brotli(raw, {
      params: {
        [zlib.constants.BROTLI_PARAM_QUALITY]: 5,
        [zlib.constants.BROTLI_PARAM_MODE]: zlib.constants.BROTLI_MODE_TEXT,
      },
    });
  } else {
    body = await gzip(raw, { level: 6 });
  }
  const result = { body, encoding };
  encodedCache.set(key, result);
  return result;
}

function preferredEncoding(header) {
  const value = String(header || '').toLowerCase();
  if (/\bbr\b/.test(value)) return 'br';
  if (/\bgzip\b/.test(value)) return 'gzip';
  return 'identity';
}

const server = http.createServer(async (req, res) => {
  try {
    const target = safeFilePath(req.url || '/');
    if (!target) {
      res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('Bad request');
      return;
    }

    let filePath = target.resolved;
    let stat;
    try {
      stat = await fs.stat(filePath);
      if (stat.isDirectory()) {
        filePath = path.join(filePath, 'index.html');
        stat = await fs.stat(filePath);
      }
    } catch {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }

    if (!stat.isFile()) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const mime = MIME.get(ext) || 'application/octet-stream';
    const raw = await fs.readFile(filePath);
    const requestedEncoding = preferredEncoding(req.headers['accept-encoding']);
    const encoded = await encodedBody(filePath, raw, requestedEncoding, mime);

    const headers = {
      'content-type': mime,
      'content-length': String(encoded.body.length),
      'cache-control': cacheControl(filePath, target.parsed),
      'x-content-type-options': 'nosniff',
      'vary': 'Accept-Encoding',
    };
    if (encoded.encoding) headers['content-encoding'] = encoded.encoding;

    res.writeHead(200, headers);
    if (req.method === 'HEAD') res.end();
    else res.end(encoded.body);
  } catch (error) {
    console.error('[serve-ci]', error);
    if (!res.headersSent) {
      res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
    }
    res.end('Internal server error');
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Serving HTTP on ${HOST} port ${PORT} (brotli/gzip + cache headers)`);
});

function shutdown() {
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 3000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
