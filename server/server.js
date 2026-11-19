'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { Worker } = require('node:worker_threads');
const { createLibraryApi, clampLang } = require('./library-api.js');

const ROOT = path.join(__dirname, '..');
const DB_PATH = process.env.MHXX_DB || path.join(ROOT, 'data', 'mhxx_dex.sqlite');
const PUBLIC_DIR = path.join(ROOT, 'public');
const PORT = Number(process.env.PORT || 8787);

let api;
try {
  api = openLibrary();
} catch (err) {
  console.error(`无法打开数据库：${DB_PATH}\n${err.message}`);
  console.error('请确认 webapp/data/mhxx_dex.sqlite 存在（由 Decompiled/database/mhxx_dex_decrypted.sqlite 复制而来）。');
  process.exit(1);
}

function openLibrary() {
  const db = new DatabaseSync(DB_PATH, { readOnly: true });
  return createLibraryApi(db, (name) => ['.png', '.jpg'].some((ext) => fs.existsSync(path.join(PUBLIC_DIR, 'icons', name + ext))));
}

function json(res, code, body) {
  const data = JSON.stringify(body);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(data),
    'Cache-Control': 'no-store',
  });
  res.end(data);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => {
      data += c;
      if (data.length > 2_000_000) reject(new Error('body too large'));
    });
    req.on('end', () => {
      if (!data) return resolve({});
      try {
        resolve(JSON.parse(data));
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

async function runLoadoutSearch(res, body) {
  const worker = new Worker(path.join(__dirname, 'loadout-search.js'), { workerData: { dbPath: DB_PATH, body, lang: clampLang(body?.lang) } });
  res.once('close', () => worker.terminate());
  const result = await new Promise((resolve, reject) => {
    worker.once('message', resolve);
    worker.once('error', reject);
    worker.once('exit', () => resolve(null));
  });
  if (!res.destroyed) json(res, result ? (result.error ? 400 : 200) : 500, result || { error: '搜索提前结束，请重试。' });
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

function serveFile(res, filePath, cache = true) {
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('not found');
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
      'Content-Length': data.length,
      'Cache-Control': cache ? 'public, max-age=86400' : 'no-store',
    });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x');

    if (url.pathname === '/api/set/search' && req.method === 'POST') {
      return await runLoadoutSearch(res, await readBody(req));
    }
    if (url.pathname.startsWith('/api/')) {
      const body = req.method === 'POST' && url.pathname === '/api/set/compute' ? await readBody(req) : undefined;
      return api(req, (status, data) => json(res, status, data), url.pathname, body);
    }

    if (url.pathname.startsWith('/icons/')) {
      const name = decodeURIComponent(url.pathname.slice('/icons/'.length)).replace(/[^A-Za-z0-9_\-. ]/g, '');
      if (!name) return res.writeHead(404).end();
      for (const ext of ['.png', '.jpg']) {
        const candidate = path.join(PUBLIC_DIR, 'icons', name + ext);
        if (fs.existsSync(candidate)) return serveFile(res, candidate);
      }
      return serveFile(res, path.join(PUBLIC_DIR, 'icons', 'blank16.png'));
    }

    let rel = decodeURIComponent(url.pathname);
    if (!rel || rel === '/') rel = '/index.html';
    const safe = path.normalize(rel).replace(/^(\.\.[/\\])+/, '');
    const filePath = path.join(PUBLIC_DIR, safe);
    if (!filePath.startsWith(PUBLIC_DIR + path.sep) && filePath !== path.join(PUBLIC_DIR, 'index.html')) {
      return res.writeHead(403).end();
    }
    // Load the HTML, JavaScript, and CSS together after each local update.
    return serveFile(res, filePath, false);
  } catch (err) {
    console.error(err);
    json(res, 500, { error: String(err && err.message ? err.message : err) });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`MHXX资料库 http://127.0.0.1:${PORT}`);
});
