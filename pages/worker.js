/* global MHXX_MONSTER_DIAGRAMS, initSqlJs */

const { createLibraryApi, clampLang } = require('../server/library-api.js');
const { searchLoadouts } = require('../server/loadout-algorithm.js');

const monsterDiagrams = new Set(MHXX_MONSTER_DIAGRAMS);

// The shared queries use the synchronous node:sqlite get/all shape.
function adaptDatabase(sqlite) {
  return {
    prepare(sql) {
      function read(params, firstOnly) {
        const statement = sqlite.prepare(sql, params);
        try {
          if (firstOnly) return statement.step() ? statement.getAsObject() : undefined;
          const rows = [];
          while (statement.step()) rows.push(statement.getAsObject());
          return rows;
        } finally {
          statement.free();
        }
      }
      return {
        get: (...params) => read(params, true),
        all: (...params) => read(params, false),
      };
    },
  };
}

async function openLibrary() {
  importScripts('vendor/sql-wasm.js');
  const [SQL, response] = await Promise.all([
    initSqlJs({ locateFile: (name) => new URL(`vendor/${name}`, self.location.href).href }),
    fetch('mhxx_dex.sqlite'),
  ]);
  if (!response.ok) throw new Error(`无法下载资料库（HTTP ${response.status}）`);
  const sqlite = new SQL.Database(new Uint8Array(await response.arrayBuffer()));
  sqlite.run('PRAGMA query_only = ON');
  const db = adaptDatabase(sqlite);
  return { db, query: createLibraryApi(db, (name) => monsterDiagrams.has(name)) };
}

let library;
self.onmessage = async ({ data: { id, method, url, body } }) => {
  const reply = (status, body) => self.postMessage({ id, status, body });
  try {
    const { db, query } = await (library ??= openLibrary());
    const pathname = new URL(url, self.location.href).pathname;
    if (method === 'POST' && pathname === '/api/set/search') {
      const result = searchLoadouts(db, body, clampLang(body?.lang));
      reply(result.error ? 400 : 200, result);
    } else {
      query({ url, method }, reply, pathname, body);
    }
  } catch (error) {
    reply(500, { error: error.message });
  }
};
