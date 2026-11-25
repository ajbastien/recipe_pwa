#!/usr/bin/env node

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

function parseArgs(argv) {
  const args = { sort: 'title' };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--a') args.a = argv[++i];
    if (argv[i] === '--b') args.b = argv[++i];
    if (argv[i] === '--out') args.out = argv[++i];
    if (argv[i] === '--sort') args.sort = argv[++i];
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));

if (!args.a || !args.b) {
  console.error('Usage: node scripts/merge-exports.js --a <export-dir> --b <export-dir> [--out <dir>] [--sort title|newest|oldest]');
  process.exit(1);
}

const dirA = path.resolve(args.a);
const dirB = path.resolve(args.b);
const outDir = path.resolve(args.out || path.join(__dirname, '..', 'data', 'merged-export'));
const imagesDir = path.join(outDir, 'images');

fs.mkdirSync(imagesDir, { recursive: true });

function readJson(dir, name) {
  const filePath = path.join(dir, name);
  if (!fs.existsSync(filePath)) {
    console.error(`Missing file: ${filePath}`);
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

const recipesA = readJson(dirA, 'recipes.json');
const recipesB = readJson(dirB, 'recipes.json');
const imagesA = readJson(dirA, 'images.json');
const imagesB = readJson(dirB, 'images.json');

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

function normalizeTitle(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeUrl(value) {
  return String(value || '').trim().toLowerCase();
}

function timeValue(recipe) {
  const value = recipe.updatedAt || recipe.dateModified || recipe.dateAdded;
  const parsed = value ? Date.parse(value) : 0;
  return Number.isNaN(parsed) ? 0 : parsed;
}

function nonEmpty(value) {
  return Array.isArray(value) ? value.length > 0 : Boolean(String(value || '').trim());
}

function compareValues(a, b) {
  if (Array.isArray(a) && Array.isArray(b)) return JSON.stringify(a) === JSON.stringify(b);
  return String(a || '') === String(b || '');
}

const comparableFields = [
  'title', 'description', 'prepTime', 'cookTime', 'servings', 'favorite',
  'rating', 'notes', 'ingredients', 'directions', 'categories', 'sourceUrl', 'imageId'
];

function changedFields(a, b) {
  return comparableFields.filter((field) => !compareValues(a[field], b[field]));
}

function uniqueMap(items, keyFn) {
  const map = new Map();
  const duplicates = new Set();

  for (const item of items) {
    const key = keyFn(item);
    if (!key || key === 'server:-1') continue;
    if (map.has(key)) {
      duplicates.add(key);
    } else {
      map.set(key, item);
    }
  }

  for (const key of duplicates) map.delete(key);
  return { map, duplicates: [...duplicates] };
}

const serverA = uniqueMap(recipesA, (recipe) => `server:${recipe.legacyServerId}`);
const serverB = uniqueMap(recipesB, (recipe) => `server:${recipe.legacyServerId}`);

const sourceA = uniqueMap(recipesA, (recipe) => {
  const url = normalizeUrl(recipe.sourceUrl);
  return url ? `source:${url}` : null;
});
const sourceB = uniqueMap(recipesB, (recipe) => {
  const url = normalizeUrl(recipe.sourceUrl);
  return url ? `source:${url}` : null;
});

const titleA = uniqueMap(recipesA, (recipe) => {
  const title = normalizeTitle(recipe.title);
  return title ? `title:${title}` : null;
});
const titleB = uniqueMap(recipesB, (recipe) => {
  const title = normalizeTitle(recipe.title);
  return title ? `title:${title}` : null;
});

const usedA = new Set();
const usedB = new Set();
const merged = [];
const conflicts = [];

function pairingKey(mapA, mapB, usedSetA, usedSetB) {
  for (const [key, recipeA] of mapA) {
    const recipeB = mapB.get(key);
    if (!recipeB) continue;
    const idA = recipesA.indexOf(recipeA);
    const idB = recipesB.indexOf(recipeB);
    if (usedSetA.has(idA) || usedSetB.has(idB)) continue;
    return { key, recipeA, recipeB, idA, idB };
  }
  return null;
}

function mergePair(key, a, b) {
  const timeA = timeValue(a);
  const timeB = timeValue(b);
  const winner = timeA >= timeB ? a : b;
  const loser = winner === a ? b : a;
  const fields = changedFields(a, b);

  if (fields.length) {
    conflicts.push({
      key,
      titleA: a.title,
      titleB: b.title,
      fields,
      winner: winner === a ? 'A' : 'B',
      dateA: a.dateModified || a.updatedAt || null,
      dateB: b.dateModified || b.updatedAt || null
    });
  }

  const serverId = a.legacyServerId > 0 ? a.legacyServerId : b.legacyServerId;
  const canonicalClientId = deterministicId(
    'merged-recipe',
    serverId > 0 ? `server:${serverId}` : key
  );

  const categories = [...new Set([
    ...(a.categories || []),
    ...(b.categories || [])
  ])].sort((x, y) => x.localeCompare(y));

  const dateAdded = [a.dateAdded, b.dateAdded]
    .filter(Boolean)
    .sort((x, y) => Date.parse(x) - Date.parse(y))[0] || null;

  return {
    ...winner,
    clientId: canonicalClientId,
    legacyServerId: serverId > 0 ? serverId : -1,
    title: nonEmpty(winner.title) ? winner.title : loser.title,
    description: nonEmpty(winner.description) ? winner.description : loser.description,
    prepTime: nonEmpty(winner.prepTime) ? winner.prepTime : loser.prepTime,
    cookTime: nonEmpty(winner.cookTime) ? winner.cookTime : loser.cookTime,
    servings: nonEmpty(winner.servings) ? winner.servings : loser.servings,
    favorite: Boolean(a.favorite || b.favorite),
    rating: Math.max(a.rating || 0, b.rating || 0),
    notes: nonEmpty(winner.notes) ? winner.notes : loser.notes,
    ingredients: nonEmpty(winner.ingredients) ? winner.ingredients : loser.ingredients,
    directions: nonEmpty(winner.directions) ? winner.directions : loser.directions,
    categories,
    sourceUrl: nonEmpty(winner.sourceUrl) ? winner.sourceUrl : loser.sourceUrl,
    imageId: winner.imageId || loser.imageId || null,
    dateAdded,
    dateModified: winner.dateModified || winner.updatedAt || null,
    updatedAt: winner.updatedAt || winner.dateModified || null,
    rev: Math.max(a.rev || 1, b.rev || 1),
    deleted: false,
    dirty: false
  };
}

const pairGroups = [
  { name: 'serverId', a: serverA.map, b: serverB.map },
  { name: 'sourceUrl', a: sourceA.map, b: sourceB.map },
  { name: 'title', a: titleA.map, b: titleB.map }
];

const matchedBy = { serverId: 0, sourceUrl: 0, title: 0 };

for (const group of pairGroups) {
  while (true) {
    const pair = pairingKey(group.a, group.b, usedA, usedB);
    if (!pair) break;

    usedA.add(pair.idA);
    usedB.add(pair.idB);
    merged.push(mergePair(pair.key, pair.recipeA, pair.recipeB));
    matchedBy[group.name] += 1;
  }
}

const onlyA = [];
const onlyB = [];

recipesA.forEach((recipe, index) => {
  if (!usedA.has(index)) onlyA.push(recipe);
});

recipesB.forEach((recipe, index) => {
  if (!usedB.has(index)) onlyB.push(recipe);
});

merged.push(...onlyA, ...onlyB);

function sortValue(recipe) {
  if (args.sort === 'newest') return -timeValue(recipe);
  if (args.sort === 'oldest') return timeValue(recipe);
  return normalizeTitle(recipe.title);
}

merged.sort((a, b) => {
  const av = sortValue(a);
  const bv = sortValue(b);
  if (av < bv) return -1;
  if (av > bv) return 1;
  return normalizeTitle(a.title).localeCompare(normalizeTitle(b.title));
});

const allImages = [...imagesA, ...imagesB];
const imageById = new Map();

for (const image of allImages) {
  if (!imageById.has(image.imageId)) imageById.set(image.imageId, image);
}

const mergedImages = [...imageById.values()];

for (const image of mergedImages) {
  for (const sourceDir of [dirA, dirB]) {
    const sourcePath = path.join(sourceDir, 'images', image.fileName);
    if (fs.existsSync(sourcePath)) {
      fs.copyFileSync(sourcePath, path.join(imagesDir, image.fileName));
      break;
    }
  }
}

const manifest = {
  createdAt: new Date().toISOString(),
  sourceA: dirA,
  sourceB: dirB,
  inputCounts: {
    a: recipesA.length,
    b: recipesB.length
  },
  outputCounts: {
    recipes: merged.length,
    images: mergedImages.length
  },
  matchedBy,
  sort: args.sort,
  rules: [
    'Match shared records by legacy serverID first.',
    'Then match by exact normalized source URL when unique on both devices.',
    'Then match by exact normalized title when unique on both devices.',
    'Winner is the record with the newest dateModified/updatedAt.',
    'Categories are unioned. Favorite is OR. Rating is max. Other fields come from the winner.'
  ]
};

const report = {
  conflicts,
  onlyA: onlyA.map((recipe) => ({
    title: recipe.title,
    legacyServerId: recipe.legacyServerId,
    dateModified: recipe.dateModified,
    clientId: recipe.clientId
  })),
  onlyB: onlyB.map((recipe) => ({
    title: recipe.title,
    legacyServerId: recipe.legacyServerId,
    dateModified: recipe.dateModified,
    clientId: recipe.clientId
  })),
  duplicateKeys: {
    serverA: serverA.duplicates,
    serverB: serverB.duplicates,
    sourceA: sourceA.duplicates,
    sourceB: sourceB.duplicates,
    titleA: titleA.duplicates,
    titleB: titleB.duplicates
  }
};

fs.writeFileSync(path.join(outDir, 'recipes.json'), `${JSON.stringify(merged, null, 2)}\n`);
fs.writeFileSync(path.join(outDir, 'images.json'), `${JSON.stringify(mergedImages, null, 2)}\n`);
fs.writeFileSync(path.join(outDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
fs.writeFileSync(path.join(outDir, 'merge-report.json'), `${JSON.stringify(report, null, 2)}\n`);

console.log(`Merged ${recipesA.length + recipesB.length} input recipes into ${merged.length} recipes.`);
console.log(`Matched: serverId=${matchedBy.serverId}, sourceUrl=${matchedBy.sourceUrl}, title=${matchedBy.title}`);
console.log(`Only A=${onlyA.length}, Only B=${onlyB.length}, conflicts=${conflicts.length}`);
console.log(`Wrote ${outDir}`);
