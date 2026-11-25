const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const RecipeFavorites = require('../public/favorites');

function freshDb(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'recipe-favorites-'));
  process.env.DB_PATH = path.join(dir, 'recipes.db');
  delete require.cache[require.resolve('../src/db')];

  const { openDatabase, initSchema } = require('../src/db');
  const favorites = require('../src/favorites');
  const recipes = require('../src/recipes');
  const db = openDatabase();

  t.after(() => {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  return { db, favorites, recipes, initSchema };
}

function allFavorites(favorites, db, userKey) {
  return favorites.listFavorites(db, { userKey }).favorites;
}

function findFavorite(rows, scope, recipeId) {
  return rows.find((row) => row.scope === scope && row.recipeId === recipeId);
}

test('client favorite helpers use the recipe id and derived state', () => {
  assert.equal(RecipeFavorites.userKeyFromName('  Diane  Austin '), 'diane austin');
  assert.equal(RecipeFavorites.isRecipeFavorite(RecipeFavorites.emptyFavorite('recipe-1')), false);

  const personal = RecipeFavorites.setScope(
    RecipeFavorites.emptyFavorite('recipe-1'),
    'me',
    true
  );
  assert.equal(personal.recipeId, 'recipe-1');
  assert.equal(personal.myFavorite, true);
  assert.equal(RecipeFavorites.isRecipeFavorite(personal), true);

  const serverRow = RecipeFavorites.applyServerRow(personal, {
    recipeId: 'recipe-1',
    scope: 'global',
    favorite: false,
    updatedAt: '2026-01-01T00:00:00.000Z'
  });
  assert.equal(serverRow.myFavorite, true);
  assert.equal(serverRow.globalFavorite, false);
  assert.equal(RecipeFavorites.isRecipeFavorite(serverRow), true);
});

test('migration seeds existing shared favorites without changing recipe timestamps', (t) => {
  const { db, favorites, recipes, initSchema } = freshDb(t);
  const created = recipes.insertRecipe(db, { title: 'Favorited recipe' }, {
    clientId: 'recipe-favorite',
    mutationId: 'create-favorite'
  });
  const before = recipes.getRecipe(db, created.recipe.serverId);

  db.prepare('UPDATE recipes SET favorite = 1 WHERE client_id = ?')
    .run('recipe-favorite');
  db.prepare('DELETE FROM favorites').run();
  db.exec('PRAGMA user_version = 0');

  initSchema(db);

  const row = db.prepare('PRAGMA user_version').get();
  assert.equal(Number(row.user_version), 2);

  const seeded = findFavorite(
    allFavorites(favorites, db, 'anyone'),
    'global',
    'recipe-favorite'
  );
  assert.ok(seeded);
  assert.equal(seeded.favorite, true);

  const after = recipes.getRecipe(db, created.recipe.serverId);
  assert.equal(after.updatedAt, before.updatedAt);
  assert.equal(after.rev, before.rev);
});

test('global and personal favorites have different sharing scopes', (t) => {
  const { db, favorites, recipes } = freshDb(t);
  const created = recipes.insertRecipe(db, { title: 'Scope test' }, {
    clientId: 'recipe-scope',
    mutationId: 'create-scope'
  });
  const before = recipes.getRecipe(db, created.recipe.serverId);

  favorites.applyFavoriteMutation(db, {
    id: 'global-1',
    clientId: 'diane',
    recipeId: 'recipe-scope',
    scope: 'global',
    favorite: true,
    updatedAt: '2026-01-01T00:00:00.000Z'
  });

  favorites.applyFavoriteMutation(db, {
    id: 'personal-1',
    clientId: 'diane',
    userKey: 'Diane',
    recipeId: 'recipe-scope',
    scope: 'me',
    favorite: true,
    updatedAt: '2026-01-02T00:00:00.000Z'
  });

  const dianeRows = allFavorites(favorites, db, 'diane');
  const bobRows = allFavorites(favorites, db, 'bob');

  assert.equal(findFavorite(dianeRows, 'global', 'recipe-scope').favorite, true);
  assert.equal(findFavorite(dianeRows, 'me', 'recipe-scope').favorite, true);
  assert.equal(findFavorite(bobRows, 'global', 'recipe-scope').favorite, true);
  assert.equal(findFavorite(bobRows, 'me', 'recipe-scope'), undefined);

  const after = recipes.getRecipe(db, created.recipe.serverId);
  assert.equal(after.updatedAt, before.updatedAt);
  assert.equal(after.rev, before.rev);
  assert.equal(after.favorite, true);
});

test('favorite-only legacy updates do not change recipe dates or revisions', (t) => {
  const { db, favorites, recipes } = freshDb(t);
  const created = recipes.insertRecipe(db, {
    title: 'Legacy favorite',
    ingredients: ['1 cup flour'],
    directions: ['Bake.']
  }, {
    clientId: 'recipe-legacy',
    mutationId: 'create-legacy'
  });
  const before = recipes.getRecipe(db, created.recipe.serverId);

  const updated = recipes.updateRecipe(db, created.recipe.serverId, {
    title: 'Legacy favorite',
    ingredients: ['1 cup flour'],
    directions: ['Bake.'],
    favorite: true
  }, { mutationId: 'legacy-favorite-1', expectedRev: before.rev });

  assert.equal(updated.unchanged, true);
  const after = recipes.getRecipe(db, created.recipe.serverId);
  assert.equal(after.updatedAt, before.updatedAt);
  assert.equal(after.rev, before.rev);

  favorites.applyFavoriteMutation(db, {
    id: 'legacy-favorite-1',
    clientId: 'legacy:recipe-legacy',
    recipeId: 'recipe-legacy',
    scope: 'global',
    favorite: true
  });

  const rows = allFavorites(favorites, db, 'anyone');
  assert.equal(findFavorite(rows, 'global', 'recipe-legacy').favorite, true);
  assert.equal(recipes.getRecipe(db, created.recipe.serverId).updatedAt, before.updatedAt);
});

test('renaming a user moves personal favorites by recipe id', (t) => {
  const { db, favorites } = freshDb(t);

  favorites.applyFavoriteMutation(db, {
    id: 'personal-before-rename',
    clientId: 'diane',
    userKey: 'diane',
    recipeId: 'recipe-rename',
    scope: 'me',
    favorite: true
  });

  const result = favorites.renameUser(db, {
    id: 'rename-1',
    oldUserKey: 'Diane',
    newUserKey: 'Diane Austin',
    displayName: 'Diane Austin'
  });

  assert.equal(result.status, 'ok');
  assert.equal(result.moved, 1);

  const oldRows = allFavorites(favorites, db, 'diane');
  const newRows = allFavorites(favorites, db, 'diane austin');
  assert.equal(findFavorite(oldRows, 'me', 'recipe-rename'), undefined);
  assert.equal(findFavorite(newRows, 'me', 'recipe-rename').favorite, true);
});

test('deleting a recipe removes its global and personal favorites', (t) => {
  const { db, favorites } = freshDb(t);

  favorites.applyFavoriteMutation(db, {
    id: 'global-delete',
    clientId: 'diane',
    recipeId: 'recipe-delete',
    scope: 'global',
    favorite: true
  });
  favorites.applyFavoriteMutation(db, {
    id: 'me-delete',
    clientId: 'diane',
    userKey: 'diane',
    recipeId: 'recipe-delete',
    scope: 'me',
    favorite: true
  });

  favorites.removeFavoritesForRecipe(db, 'recipe-delete');

  const rows = allFavorites(favorites, db, 'diane');
  assert.equal(findFavorite(rows, 'global', 'recipe-delete'), undefined);
  assert.equal(findFavorite(rows, 'me', 'recipe-delete'), undefined);
});

test('favorite mutations are idempotent and accept unsynced recipe ids', (t) => {
  const { db, favorites } = freshDb(t);
  const mutation = {
    id: 'personal-unsynced',
    clientId: 'diane',
    userKey: 'diane',
    recipeId: 'recipe-not-synced-yet',
    scope: 'me',
    favorite: true
  };

  const first = favorites.applyFavoriteMutation(db, mutation);
  const replay = favorites.applyFavoriteMutation(db, mutation);

  assert.equal(first.replay, false);
  assert.equal(replay.replay, true);

  const rows = allFavorites(favorites, db, 'diane');
  assert.equal(rows.filter((row) => row.recipeId === 'recipe-not-synced-yet').length, 1);
});
