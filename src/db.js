const { DatabaseSync } = require('node:sqlite');
const fs = require('fs');
const path = require('path');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'recipes.db');

function openDatabase() {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

  const db = new DatabaseSync(DB_PATH);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  initSchema(db);
  return db;
}

function initSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS recipes (
      server_id    INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id    TEXT NOT NULL UNIQUE,
      rev          INTEGER NOT NULL DEFAULT 1,
      created_at   TEXT NOT NULL,
      updated_at   TEXT NOT NULL,
      deleted_at   TEXT,
      title        TEXT NOT NULL,
      description  TEXT NOT NULL DEFAULT '',
      prep_time    TEXT NOT NULL DEFAULT '',
      cook_time    TEXT NOT NULL DEFAULT '',
      servings     TEXT NOT NULL DEFAULT '',
      favorite     INTEGER NOT NULL DEFAULT 0,
      rating       INTEGER NOT NULL DEFAULT 0,
      notes        TEXT NOT NULL DEFAULT '',
      ingredients  TEXT NOT NULL DEFAULT '[]',
      directions   TEXT NOT NULL DEFAULT '[]',
      categories   TEXT NOT NULL DEFAULT '[]',
      source_url   TEXT NOT NULL DEFAULT '',
      image_id     TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_recipes_updated_at
      ON recipes(updated_at);

    CREATE INDEX IF NOT EXISTS idx_recipes_deleted_at
      ON recipes(deleted_at);

    CREATE TABLE IF NOT EXISTS images (
      image_id          TEXT PRIMARY KEY,
      recipe_server_id  INTEGER,
      mime              TEXT NOT NULL DEFAULT 'image/jpeg',
      size              INTEGER NOT NULL DEFAULT 0,
      checksum          TEXT NOT NULL,
      file_name         TEXT NOT NULL,
      created_at        TEXT NOT NULL,
      FOREIGN KEY (recipe_server_id) REFERENCES recipes(server_id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_images_recipe
      ON images(recipe_server_id);

    CREATE TABLE IF NOT EXISTS outbox_receipts (
      client_id    TEXT NOT NULL,
      mutation_id  TEXT NOT NULL,
      server_id    INTEGER,
      applied_at   TEXT NOT NULL,
      PRIMARY KEY (client_id, mutation_id)
    );

    CREATE TABLE IF NOT EXISTS settings (
      name   TEXT PRIMARY KEY,
      value  TEXT
    );
  `);
}

module.exports = {
  DB_PATH,
  openDatabase,
  initSchema
};
