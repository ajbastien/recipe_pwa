#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

function parseArgs(argv) {
  const args = { sort: 'title' };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--diane') args.diane = argv[++i];
    if (argv[i] === '--al') args.al = argv[++i];
    if (argv[i] === '--out') args.out = argv[++i];
    if (argv[i] === '--sort') args.sort = argv[++i];
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));

if (!args.diane || !args.al) {
  console.error(
    'Usage: node scripts/combine-device-exports.js --diane <diane-export-dir> --al <al-export-dir> [--out <dir>] [--sort title|newest|oldest]'
  );
  process.exit(1);
}

const dianeDir = path.resolve(args.diane);
const alDir = path.resolve(args.al);
const outDir = path.resolve(args.out || path.join(__dirname, '..', 'data', 'combined-export'));
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

const dianeRecipesRaw = readJson(dianeDir, 'recipes.json');
const alRecipesRaw = readJson(alDir, 'recipes.json');
const dianeImagesRaw = readJson(dianeDir, 'images.json');
const alImagesRaw = readJson(alDir, 'images.json');

if (!Array.isArray(dianeRecipesRaw) || !Array.isArray(alRecipesRaw)) {
  console.error('recipes.json files must contain arrays.');
  process.exit(1);
}

if (!Array.isArray(dianeImagesRaw) || !Array.isArray(alImagesRaw)) {
  console.error('images.json files must contain arrays.');
  process.exit(1);
}

const alRowNumbers = [889, 890, 891, 892];

if (alRecipesRaw.length < Math.max(...alRowNumbers)) {
  console.error(
    `AL export has only ${alRecipesRaw.length} recipes; expected at least ${Math.max(...alRowNumbers)}.`
  );
  process.exit(1);
}

const dianeRecipes = dianeRecipesRaw.map((recipe) => ({
  ...recipe,
  source: 'diane',
  sourceRow: recipe.legacyId
}));

const selectedAlRows = alRowNumbers.map((rowNumber) => {
  const recipe = alRecipesRaw[rowNumber - 1];
  if (!recipe) {
    console.error(`Missing AL recipe at row ${rowNumber}.`);
    process.exit(1);
  }
  return {
    ...recipe,
    source: 'al',
    sourceRow: rowNumber
  };
});

for (const recipe of selectedAlRows) {
  if (recipe.legacyServerId !== -1) {
    console.error(
      `AL row ${recipe.sourceRow} has serverID ${recipe.legacyServerId}; expected -1: ${recipe.title}`
    );
    process.exit(1);
  }
}

const combined = [...dianeRecipes, ...selectedAlRows];

const clientIds = new Set();
for (const recipe of combined) {
  if (!recipe.clientId) {
    console.error(`Recipe is missing clientId: ${recipe.title}`);
    process.exit(1);
  }
  if (clientIds.has(recipe.clientId)) {
    console.error(`Duplicate clientId ${recipe.clientId}: ${recipe.title}`);
    process.exit(1);
  }
  clientIds.add(recipe.clientId);
}

const neededAlImageIds = new Set(
  selectedAlRows.map((recipe) => recipe.imageId).filter(Boolean)
);

const imageById = new Map();

for (const image of dianeImagesRaw) {
  imageById.set(image.imageId, { ...image, sourceDirs: [dianeDir] });
}

for (const image of alImagesRaw) {
  if (!neededAlImageIds.has(image.imageId)) continue;
  const existing = imageById.get(image.imageId);
  if (existing) {
    existing.sourceDirs.push(alDir);
    continue;
  }
  imageById.set(image.imageId, { ...image, sourceDirs: [alDir] });
}

for (const recipe of combined) {
  if (recipe.imageId && !imageById.has(recipe.imageId)) {
    console.error(`Missing image ${recipe.imageId} for recipe: ${recipe.title}`);
    process.exit(1);
  }
}

const combinedImages = [...imageById.values()];

for (const image of combinedImages) {
  let copied = false;
  for (const sourceDir of image.sourceDirs) {
    const sourcePath = path.join(sourceDir, 'images', image.fileName);
    if (fs.existsSync(sourcePath)) {
      fs.copyFileSync(sourcePath, path.join(imagesDir, image.fileName));
      copied = true;
      break;
    }
  }
  if (!copied) {
    console.error(`Could not find image file ${image.fileName} in any source directory.`);
    process.exit(1);
  }
}

function normalizeTitle(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function timeValue(recipe) {
  const value = recipe.updatedAt || recipe.dateModified || recipe.dateAdded;
  const parsed = value ? Date.parse(value) : 0;
  return Number.isNaN(parsed) ? 0 : parsed;
}

function sortValue(recipe) {
  if (args.sort === 'newest') return -timeValue(recipe);
  if (args.sort === 'oldest') return timeValue(recipe);
  return normalizeTitle(recipe.title);
}

combined.sort((a, b) => {
  const av = sortValue(a);
  const bv = sortValue(b);
  if (av < bv) return -1;
  if (av > bv) return 1;
  return normalizeTitle(a.title).localeCompare(normalizeTitle(b.title));
});

const manifest = {
  createdAt: new Date().toISOString(),
  sourceDiane: dianeDir,
  sourceAl: alDir,
  selection: {
    diane: 'All recipes from the Diane export.',
    al: 'Only AL export row numbers 889-892, counted in id order (1-based).'
  },
  selectedAlRows: selectedAlRows.map((recipe) => ({
    row: recipe.sourceRow,
    legacyId: recipe.legacyId,
    legacyServerId: recipe.legacyServerId,
    title: recipe.title,
    dateAdded: recipe.dateAdded,
    dateModified: recipe.dateModified,
    imageId: recipe.imageId
  })),
  inputCounts: {
    diane: dianeRecipesRaw.length,
    al: alRecipesRaw.length
  },
  outputCounts: {
    recipes: combined.length,
    images: combinedImages.length
  },
  sort: args.sort,
  rules: [
    'Diane is authoritative for its entire database.',
    'Only AL rows 889-892 are added.',
    'Those AL rows are all local-only (serverID = -1) in the source database.',
    'Images are copied by checksum; duplicate images are stored once.'
  ]
};

fs.writeFileSync(path.join(outDir, 'recipes.json'), `${JSON.stringify(combined, null, 2)}\n`);
fs.writeFileSync(path.join(outDir, 'images.json'), `${JSON.stringify(combinedImages, null, 2)}\n`);
fs.writeFileSync(path.join(outDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

console.log(`Combined ${dianeRecipesRaw.length} Diane recipes + ${selectedAlRows.length} AL recipes = ${combined.length} recipes.`);
console.log(`Images: ${combinedImages.length}`);
console.log('AL rows added:');
for (const recipe of selectedAlRows) {
  console.log(`  ${recipe.sourceRow}: ${recipe.title}`);
}
console.log(`Wrote ${outDir}`);
