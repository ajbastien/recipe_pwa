function nowIso() {
  return new Date().toISOString();
}

function asText(value) {
  if (value === null || value === undefined) return '';
  return String(value);
}

function cleanName(value) {
  return asText(value).trim().replace(/\s+/g, ' ');
}

function userKeyFromName(value) {
  return cleanName(value).toLocaleLowerCase();
}

function validateUserKey(userKey) {
  const key = userKeyFromName(userKey);
  if (!key) throw new Error('Name is required.');
  if (key.length > 120) throw new Error('Name is too long.');
  return key;
}

function validateRecipeId(recipeId) {
  const id = asText(recipeId).trim();
  if (!id) throw new Error('Recipe id is required.');
  return id;
}

function ensureUser(db, userKey, displayName) {
  const key = validateUserKey(userKey);
  const name = cleanName(displayName || key).slice(0, 80) || key;
  const timestamp = nowIso();
  const existing = db.prepare('SELECT * FROM app_users WHERE user_key = ?').get(key);

  if (!existing) {
    db.prepare(`
      INSERT INTO app_users (user_key, display_name, created_at, updated_at)
      VALUES (?, ?, ?, ?)
    `).run(key, name, timestamp, timestamp);
    return;
  }

  if (existing.display_name !== name) {
    db.prepare(`
      UPDATE app_users SET display_name = ?, updated_at = ? WHERE user_key = ?
    `).run(name, timestamp, key);
  }
}

function nextSeq(db) {
  const row = db.prepare('SELECT COALESCE(MAX(seq), 0) + 1 AS seq FROM favorites').get();
  return Number(row && row.seq) || 1;
}

function getFavoriteRow(db, scope, userKey, recipeId) {
  return db.prepare(`
    SELECT * FROM favorites
    WHERE scope = ? AND user_key = ? AND recipe_client_id = ?
  `).get(scope, userKey || '', recipeId) || null;
}

function rowToFavorite(row) {
  if (!row) return null;
  return {
    recipeId: row.recipe_client_id,
    scope: row.scope,
    userKey: row.user_key || '',
    favorite: Boolean(row.favorite),
    updatedAt: row.updated_at,
    seq: row.seq
  };
}

function findFavoriteReceipt(db, clientId, mutationId) {
  if (!clientId || !mutationId) return null;
  return db.prepare(`
    SELECT * FROM favorite_receipts
    WHERE client_id = ? AND mutation_id = ?
  `).get(clientId, mutationId) || null;
}

function recordFavoriteReceipt(db, clientId, mutationId) {
  if (!clientId || !mutationId) return;
  db.prepare(`
    INSERT INTO favorite_receipts (client_id, mutation_id, applied_at)
    VALUES (?, ?, ?)
    ON CONFLICT(client_id, mutation_id) DO NOTHING
  `).run(clientId, mutationId, nowIso());
}

function applyFavoriteMutation(db, mutation = {}) {
  const recipeId = validateRecipeId(mutation.recipeId || mutation.entityId);
  const scope = mutation.scope === 'global' || mutation.scope === 'me'
    ? mutation.scope
    : '';

  if (!scope) throw new Error('Favorite scope must be global or me.');

  const userKey = scope === 'me' ? validateUserKey(mutation.userKey) : '';
  const clientId = asText(mutation.clientId || userKey || 'global').trim() || 'global';
  const mutationId = asText(mutation.mutationId || mutation.id).trim();

  if (!mutationId) throw new Error('Favorite mutation id is required.');

  if (scope === 'me') {
    ensureUser(db, userKey, mutation.displayName || userKey);
  }

  const receipt = findFavoriteReceipt(db, clientId, mutationId);
  if (receipt) {
    return {
      status: 'ok',
      replay: true,
      favorite: rowToFavorite(getFavoriteRow(db, scope, userKey, recipeId))
    };
  }

  const favorite = mutation.favorite ? 1 : 0;
  const timestamp = asText(mutation.updatedAt).trim() || nowIso();
  const existing = getFavoriteRow(db, scope, userKey, recipeId);
  const seq = nextSeq(db);

  if (existing) {
    db.prepare(`
      UPDATE favorites
      SET favorite = ?, updated_at = ?, seq = ?
      WHERE scope = ? AND user_key = ? AND recipe_client_id = ?
    `).run(favorite, timestamp, seq, scope, userKey, recipeId);
  } else {
    db.prepare(`
      INSERT INTO favorites (scope, user_key, recipe_client_id, favorite, updated_at, seq)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(scope, userKey, recipeId, favorite, timestamp, seq);
  }

  if (scope === 'global') {
    db.prepare('UPDATE recipes SET favorite = ? WHERE client_id = ?')
      .run(favorite, recipeId);
  }

  recordFavoriteReceipt(db, clientId, mutationId);

  return {
    status: 'ok',
    replay: false,
    favorite: rowToFavorite(getFavoriteRow(db, scope, userKey, recipeId))
  };
}

function listFavorites(db, { cursor, limit = 500, userKey } = {}) {
  const key = validateUserKey(userKey);
  const safeLimit = Math.min(Math.max(Number(limit) || 500, 1), 1000);
  const decoded = Math.max(0, Number(cursor) || 0);

  const rows = db.prepare(`
    SELECT * FROM favorites
    WHERE seq > ?
      AND (scope = 'global' OR (scope = 'me' AND user_key = ?))
    ORDER BY seq ASC
    LIMIT ?
  `).all(decoded, key, safeLimit + 1);

  const hasMore = rows.length > safeLimit;
  const page = hasMore ? rows.slice(0, safeLimit) : rows;
  const last = page[page.length - 1];

  return {
    favorites: page.map(rowToFavorite),
    cursor: last ? String(last.seq) : String(decoded),
    hasMore,
    serverTime: nowIso()
  };
}

function renameUser(db, mutation = {}) {
  const oldUserKey = validateUserKey(mutation.oldUserKey);
  const newUserKey = validateUserKey(mutation.newUserKey);
  const mutationId = asText(mutation.mutationId || mutation.id).trim();

  if (!mutationId) throw new Error('Rename mutation id is required.');

  const existingReceipt = db.prepare(`
    SELECT * FROM user_rename_receipts WHERE mutation_id = ?
  `).get(mutationId);

  if (existingReceipt) {
    return { status: 'ok', replay: true, moved: existingReceipt.moved || 0 };
  }

  if (oldUserKey === newUserKey) {
    ensureUser(db, newUserKey, mutation.displayName || newUserKey);
    db.prepare(`
      INSERT INTO user_rename_receipts (mutation_id, old_user_key, new_user_key, moved, applied_at)
      VALUES (?, ?, ?, 0, ?)
    `).run(mutationId, oldUserKey, newUserKey, nowIso());
    return { status: 'ok', replay: false, moved: 0 };
  }

  ensureUser(db, newUserKey, mutation.displayName || newUserKey);

  const oldRows = db.prepare(`
    SELECT * FROM favorites WHERE scope = 'me' AND user_key = ?
  `).all(oldUserKey);

  for (const row of oldRows) {
    const target = getFavoriteRow(db, 'me', newUserKey, row.recipe_client_id);
    const favorite = row.favorite || (target && target.favorite) ? 1 : 0;
    const timestamp = nowIso();
    const seq = nextSeq(db);

    if (target) {
      db.prepare(`
        UPDATE favorites
        SET favorite = ?, updated_at = ?, seq = ?
        WHERE scope = 'me' AND user_key = ? AND recipe_client_id = ?
      `).run(favorite, timestamp, seq, newUserKey, row.recipe_client_id);
    } else {
      db.prepare(`
        INSERT INTO favorites (scope, user_key, recipe_client_id, favorite, updated_at, seq)
        VALUES ('me', ?, ?, ?, ?, ?)
      `).run(newUserKey, row.recipe_client_id, favorite, timestamp, seq);
    }
  }

  if (oldRows.length) {
    db.prepare("DELETE FROM favorites WHERE scope = 'me' AND user_key = ?")
      .run(oldUserKey);
  }

  db.prepare(`
    INSERT INTO user_rename_receipts (mutation_id, old_user_key, new_user_key, moved, applied_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(mutationId, oldUserKey, newUserKey, oldRows.length, nowIso());

  return { status: 'ok', replay: false, moved: oldRows.length };
}

function removeFavoritesForRecipe(db, recipeId) {
  const id = validateRecipeId(recipeId);
  db.prepare('DELETE FROM favorites WHERE recipe_client_id = ?').run(id);
}

function seedGlobalFavorites(db) {
  const rows = db.prepare(`
    SELECT client_id, favorite, updated_at
    FROM recipes
    WHERE favorite = 1
  `).all();

  for (const row of rows) {
    db.prepare(`
      INSERT INTO favorites (scope, user_key, recipe_client_id, favorite, updated_at, seq)
      VALUES ('global', '', ?, 1, ?, ?)
      ON CONFLICT(scope, user_key, recipe_client_id) DO NOTHING
    `).run(row.client_id, row.updated_at || nowIso(), nextSeq(db));
  }

  return rows.length;
}

module.exports = {
  applyFavoriteMutation,
  ensureUser,
  listFavorites,
  removeFavoritesForRecipe,
  renameUser,
  rowToFavorite,
  seedGlobalFavorites,
  userKeyFromName
};
