#!/usr/bin/env node

const { DatabaseSync } = require('node:sqlite');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--db') args.db = argv[++i];
    if (argv[i] === '--out') args.out = argv[++i];
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));

if (!args.db) {
  console.error('Usage: node scripts/export-flutter-db.js --db <legacy.db> [--out <export-dir>]');
  process.exit(1);
}

const legacyDbPath = path.resolve(args.db);
const outDir = path.resolve(args.out || path.join(__dirname, '..', 'data', 'legacy-export'));
const imagesDir = path.join(outDir, 'images');

if (!fs.existsSync(legacyDbPath)) {
  console.error(`Legacy database not found: ${legacyDbPath}`);
  process.exit(1);
}

fs.mkdirSync(imagesDir, { recursive: true });

function deterministicId(prefix, value) {
  const hex = crypto.createHash('sha256').update(`${prefix}:${value}`).digest('hex').slice(0, 32);
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `4${hex.slice(13, 16)}`,
    `a${hex.slice(17, 20)}`,
    hex.slice(20, 32)
  ].join('-');
}

function parseLegacyDate(value) {
  if (!value || typeof value !== 'string') return null;

  const dashed = /^(\d{4})-(\d{2})-(\d{2})-(\d{2}):(\d{2}):(\d{2})$/.exec(value);
  if (dashed) {
    const [, year, month, day, hour, minute, second] = dashed.map(Number);
    return new Date(Date.UTC(year, month - 1, day, hour, minute, second)).toISOString();
  }

  const compact = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z?$/.exec(value);
  if (compact) {
    const [, year, month, day, hour, minute, second] = compact.map(Number);
    return new Date(Date.UTC(year, month - 1, day, hour, minute, second)).toISOString();
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function splitLines(value) {
  if (!value) return [];
  return String(value)
    .replace(/\r\n/g, '\r')
    .split('\r')
    .map((line) => line.replace(/\n/g, ' ').trim())
    .filter(Boolean);
}

function splitCategories(value) {
  if (!value) return [];
  return String(value)
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function imageExtension(bytes) {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpg';
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'png';
  if (bytes.length >= 12 && bytes.subarray(8, 12).toString('ascii') === 'WEBP') return 'webp';
  return 'bin';
}

function mimeForExtension(extension) {
  if (extension === 'jpg') return 'image/jpeg';
  if (extension === 'png') return 'image/png';
  if (extension === 'webp') return 'image/webp';
  return 'application/octet-stream';
}

const db = new DatabaseSync(legacyDbPath, { readOnly: true });
const rows = db.prepare('SELECT * FROM recipes ORDER BY id').all();
const settings = db.prepare('SELECT * FROM settings').all();

const exportedImages = [];

const recipes = rows.map((row) => {
  const blob = row.imageData ? Buffer.from(row.imageData) : Buffer.alloc(0);
  let imageId = null;

  if (blob.length > 0) {
    const checksum = crypto.createHash('sha256').update(blob).digest('hex');
    const extension = imageExtension(blob);
    const fileName = `${checksum}.${extension}`;
    const outputPath = path.join(imagesDir, fileName);

    if (!exportedImages.some((image) => image.checksum === checksum)) {
      fs.writeFileSync(outputPath, blob);
      exportedImages.push({
        imageId: checksum,
        fileName,
        mime: mimeForExtension(extension),
        size: blob.length,
        checksum
      });
    }

    imageId = checksum;
  }

  const dateAdded = parseLegacyDate(row.dateAdded);
  const dateModified = parseLegacyDate(row.dateModified);

  return {
    clientId: deterministicId('recipe', row.id),
    legacyId: row.id,
    legacyServerId: row.serverID,
    title: row.title || '',
    description: row.description || '',
    prepTime: row.prepTime || '',
    cookTime: row.cookTime || '',
    servings: row.servings || '',
    favorite: Boolean(row.favorite),
    rating: row.rating || 0,
    notes: row.notes || '',
    ingredients: splitLines(row.ingredients),
    directions: splitLines(row.directions),
    categories: splitCategories(row.categories),
    dateAdded,
    dateModified,
    sourceUrl: row.url || '',
    imageId,
    rev: 1,
    deleted: false,
    dirty: false,
    updatedAt: dateModified || dateAdded || new Date(0).toISOString()
  };
});

db.close();

const manifest = {
  exportedAt: new Date().toISOString(),
  sourceDatabase: legacyDbPath,
  recipeCount: recipes.length,
  imageCount: exportedImages.length,
  settings: Object.fromEntries(settings.map((setting) => [setting.name, setting.value])),
  notes: 'This export is schema-only unless the source database is confirmed current.'
};

fs.writeFileSync(path.join(outDir, 'recipes.json'), `${JSON.stringify(recipes, null, 2)}\n`);
fs.writeFileSync(path.join(outDir, 'images.json'), `${JSON.stringify(exportedImages, null, 2)}\n`);
fs.writeFileSync(path.join(outDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

console.log(`Exported ${recipes.length} recipes and ${exportedImages.length} images to ${outDir}`);
