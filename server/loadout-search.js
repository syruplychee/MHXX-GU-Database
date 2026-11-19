'use strict';

const { parentPort, workerData } = require('node:worker_threads');
const { DatabaseSync } = require('node:sqlite');

const { searchLoadouts } = require('./loadout-algorithm.js');

if (parentPort) {
  const { dbPath, body, lang } = workerData;
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try { parentPort.postMessage(searchLoadouts(db, body, lang)); }
  finally { db.close(); }
}

module.exports = { searchLoadouts };
