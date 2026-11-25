#!/usr/bin/env node

const { openDatabase, DB_PATH } = require('../src/db');

const db = openDatabase();
const tables = db.prepare(
  "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name"
).all().map((row) => row.name);

db.close();

console.log(`Initialized ${DB_PATH}`);
console.log(`Tables: ${tables.join(', ')}`);
