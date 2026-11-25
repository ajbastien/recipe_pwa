#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { openDatabase, DB_PATH } = require('../src/db');

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--dir') args.dir = argv[++i];
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));

if (!args.dir) {
  console.error('Usage: node scripts/import-export.js --dir <export-dir>');
  process.exit(1);
}

const exportDir = path.resolve(args.dir);
const recipesPath = path.join(exportDir, 'recipes.json');
const imagesPath = path.join(exportDir, 'images.json');
const exportImagesDir = path.join(exportDir, 'images');

for (const filePath of [recipesPath, imagesPath]) {
  if (!fs.existsSync(filePath)) {
    console.error(`Missing export file: ${filePath}`);
    process.exit(1);
  }
}

const recipes = JSON.parse(fs.readFileSync(recipesPath, 'utf8'));
const images = JSON.parse(fs.readFileSync(imagesPath, 'utf8'));

if (!Array.isArray(recipes) || !Array.isArray(images)) {
  console.error('recipes.json and images.json must contain arrays.');
  process.exit(1);
}

const projectRoot = path.join(__dirname, '..');
const serverImagesDir = path.join(projectRoot, 'data', 'images');
fs.mkdirSync(serverImagesDir, { recursive: true });

const db = openDatabase();

const insertRecipe = db.prepare(`
  INSERT INTO recipes (
    client_id, rev, created_at, updated_at, deleted_at,
    title, description, prep_time, cook_time, servings,
    favorite, rating, notes, ingredients, directions,
    categories, source_url, image_id
  ) VALUES (
    ?, ?, ?, ?, ?,
    ?, ?, ?, ?, ?,
    ?, ?, ?, ?, ?,
    ?, ?, ?
  )
  ON CONFLICT(client_id) DO UPDATE SET
    rev = excluded.rev,
    updated_at = excluded.updated_at,
    title = excluded.title,
    description = excluded.description,
    prep_time = excluded.prep_time,
    cook_time = excluded.cook_time,
    servings = excluded.servings,
    favorite = excluded.favorite,
    rating = excluded.rating,
    notes = excluded.notes,
    ingredients = excluded.ingredients,
    directions = excluded.directions,
    categories = excluded.categories,
    source_url = excluded.source_url,
    image_id = excluded.image_id
`);

const insertImage = db.prepare(`
  INSERT INTO images (
    image_id, recipe_server_id, mime, size, checksum, file_name, created_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(image_id) DO UPDATE SET
    recipe_server_id = excluded.recipe_server_id,
    mime = excluded.mime,
    size = excluded.size,
    checksum = excluded.checksum,
    file_name = excluded.file_name
`);

const findRecipe = db.prepare('SELECT server_id FROM recipes WHERE client_id = ?');

let imageCount = 0;

db.exec('BEGIN');

try {
  for (const recipe of recipes) {
    const createdAt = recipe.dateAdded || recipe.updatedAt || new Date(0).toISOString();
    const updatedAt = recipe.updatedAt || createdAt;

    insertRecipe.run(
      recipe.clientId,
      recipe.rev || 1,
      createdAt,
      updatedAt,
      recipe.deleted ? updatedAt : null,
      recipe.title || '',
      recipe.description || '',
      recipe.prepTime || '',
      recipe.cookTime || '',
      recipe.servings || '',
      recipe.favorite ? 1 : 0,
      recipe.rating || 0,
      recipe.notes || '',
      JSON.stringify(recipe.ingredients || []),
      JSON.stringify(recipe.directions || []),
      JSON.stringify(recipe.categories || []),
      recipe.sourceUrl || '',
      recipe.imageId || null
    );
  }

  for (const image of images) {
    const sourcePath = path.join(exportImagesDir, image.fileName);
    if (!fs.existsSync(sourcePath)) continue;

    const targetPath = path.join(serverImagesDir, image.fileName);
    fs.copyFileSync(sourcePath, targetPath);

    let recipeServerId = null;
    const owner = recipes.find((recipe) => recipe.imageId === image.imageId);
    if (owner) {
      const found = findRecipe.get(owner.clientId);
      recipeServerId = found ? found.server_id : null;
    }

    insertImage.run(
      image.imageId,
      recipeServerId,
      image.mime || 'image/jpeg',
      image.size || 0,
      image.checksum || image.imageId,
      image.fileName,
      new Date().toISOString()
    );

    imageCount += 1;
  }

  db.exec('COMMIT');
} catch (err) {
  db.exec('ROLLBACK');
  db.close();
  console.error('Import failed:', err.message);
  process.exit(1);
}

const recipeCount = db.prepare('SELECT COUNT(*) AS count FROM recipes').get().count;
db.close();

console.log(`Imported into ${DB_PATH}`);
console.log(`Export recipes: ${recipes.length}; server recipes: ${recipeCount}`);
console.log(`Imported images: ${imageCount}`);
