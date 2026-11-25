function nowIso() {
  return new Date().toISOString();
}

function asText(value) {
  if (value === null || value === undefined) return '';
  return String(value);
}

function asStringArray(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => asText(item).replace(/\r/g, '').trim())
    .filter(Boolean);
}

function normalizeRecipeInput(input = {}) {
  const title = asText(input.title).trim();
  if (!title) throw new Error('Recipe title is required.');

  return {
    title,
    description: asText(input.description),
    prepTime: asText(input.prepTime),
    cookTime: asText(input.cookTime),
    servings: asText(input.servings),
    favorite: input.favorite ? 1 : 0,
    rating: Number.isFinite(Number(input.rating)) ? Number(input.rating) : 0,
    notes: asText(input.notes),
    ingredients: asStringArray(input.ingredients),
    directions: asStringArray(input.directions),
    categories: asStringArray(input.categories),
    sourceUrl: asText(input.sourceUrl),
    imageId: input.imageId ? asText(input.imageId) : null
  };
}

function rowToRecipe(row) {
  if (!row) return null;

  return {
    clientId: row.client_id,
    serverId: row.server_id,
    rev: row.rev,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at || null,
    deleted: Boolean(row.deleted_at),
    title: row.title,
    description: row.description || '',
    prepTime: row.prep_time || '',
    cookTime: row.cook_time || '',
    servings: row.servings || '',
    favorite: Boolean(row.favorite),
    rating: row.rating || 0,
    notes: row.notes || '',
    ingredients: parseJsonArray(row.ingredients),
    directions: parseJsonArray(row.directions),
    categories: parseJsonArray(row.categories),
    sourceUrl: row.source_url || '',
    imageId: row.image_id || null
  };
}

function parseJsonArray(value) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function encodeCursor(row) {
  return `${row.updated_at}|${row.server_id}`;
}

function decodeCursor(cursor) {
  if (!cursor || typeof cursor !== 'string') return null;

  const separator = cursor.lastIndexOf('|');
  if (separator < 0) return null;

  const updatedAt = cursor.slice(0, separator);
  const serverId = Number(cursor.slice(separator + 1));
  if (!updatedAt || !Number.isInteger(serverId)) return null;

  return { updatedAt, serverId };
}

function listRecipes(db, { cursor, limit = 500 } = {}) {
  const safeLimit = Math.min(Math.max(Number(limit) || 500, 1), 1000);
  const decoded = decodeCursor(cursor);

  const rows = decoded
    ? db.prepare(`
        SELECT * FROM recipes
        WHERE updated_at > ?
           OR (updated_at = ? AND server_id > ?)
        ORDER BY updated_at ASC, server_id ASC
        LIMIT ?
      `).all(decoded.updatedAt, decoded.updatedAt, decoded.serverId, safeLimit + 1)
    : db.prepare(`
        SELECT * FROM recipes
        ORDER BY updated_at ASC, server_id ASC
        LIMIT ?
      `).all(safeLimit + 1);

  const hasMore = rows.length > safeLimit;
  const page = hasMore ? rows.slice(0, safeLimit) : rows;
  const recipes = page.map(rowToRecipe);

  return {
    recipes,
    cursor: page.length ? encodeCursor(page[page.length - 1]) : cursor || null,
    hasMore,
    serverTime: nowIso()
  };
}

function getRecipe(db, serverId) {
  const row = db.prepare('SELECT * FROM recipes WHERE server_id = ?').get(serverId);
  return rowToRecipe(row);
}

function findReceipt(db, clientId, mutationId) {
  if (!clientId || !mutationId) return null;
  return db.prepare(`
    SELECT * FROM outbox_receipts
    WHERE client_id = ? AND mutation_id = ?
  `).get(clientId, mutationId) || null;
}

function recordReceipt(db, clientId, mutationId, serverId) {
  if (!clientId || !mutationId) return;
  db.prepare(`
    INSERT INTO outbox_receipts (client_id, mutation_id, server_id, applied_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(client_id, mutation_id) DO NOTHING
  `).run(clientId, mutationId, serverId, nowIso());
}

function insertRecipe(db, input, { clientId, mutationId } = {}) {
  const normalized = normalizeRecipeInput(input);
  const recipeClientId = asText(clientId || input.clientId).trim();
  if (!recipeClientId) throw new Error('Recipe clientId is required.');

  const receipt = findReceipt(db, recipeClientId, mutationId);
  if (receipt && receipt.server_id) {
    return { recipe: getRecipe(db, receipt.server_id), replay: true };
  }

  const existing = db.prepare('SELECT * FROM recipes WHERE client_id = ?').get(recipeClientId);
  if (existing) {
    return { recipe: rowToRecipe(existing), conflict: 'clientId' };
  }

  const timestamp = nowIso();
  const result = db.prepare(`
    INSERT INTO recipes (
      client_id, rev, created_at, updated_at, deleted_at,
      title, description, prep_time, cook_time, servings,
      favorite, rating, notes, ingredients, directions,
      categories, source_url, image_id
    ) VALUES (?, 1, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    recipeClientId,
    timestamp,
    timestamp,
    normalized.title,
    normalized.description,
    normalized.prepTime,
    normalized.cookTime,
    normalized.servings,
    normalized.favorite,
    normalized.rating,
    normalized.notes,
    JSON.stringify(normalized.ingredients),
    JSON.stringify(normalized.directions),
    JSON.stringify(normalized.categories),
    normalized.sourceUrl,
    normalized.imageId
  );

  const serverId = Number(result.lastInsertRowid);
  recordReceipt(db, recipeClientId, mutationId, serverId);
  return { recipe: getRecipe(db, serverId), replay: false };
}

function updateRecipe(db, serverId, input, { mutationId, expectedRev } = {}) {
  const current = db.prepare('SELECT * FROM recipes WHERE server_id = ?').get(serverId);
  if (!current) return { error: 'notFound' };
  if (current.deleted_at) return { error: 'deleted', recipe: rowToRecipe(current) };

  const receipt = findReceipt(db, current.client_id, mutationId);
  if (receipt && receipt.server_id === Number(serverId)) {
    return { recipe: rowToRecipe(current), replay: true };
  }

  if (Number.isFinite(Number(expectedRev)) && Number(current.rev) !== Number(expectedRev)) {
    return { error: 'conflict', recipe: rowToRecipe(current) };
  }

  const normalized = normalizeRecipeInput(input);
  const timestamp = nowIso();

  db.prepare(`
    UPDATE recipes SET
      rev = rev + 1,
      updated_at = ?,
      title = ?,
      description = ?,
      prep_time = ?,
      cook_time = ?,
      servings = ?,
      favorite = ?,
      rating = ?,
      notes = ?,
      ingredients = ?,
      directions = ?,
      categories = ?,
      source_url = ?,
      image_id = ?
    WHERE server_id = ?
  `).run(
    timestamp,
    normalized.title,
    normalized.description,
    normalized.prepTime,
    normalized.cookTime,
    normalized.servings,
    normalized.favorite,
    normalized.rating,
    normalized.notes,
    JSON.stringify(normalized.ingredients),
    JSON.stringify(normalized.directions),
    JSON.stringify(normalized.categories),
    normalized.sourceUrl,
    normalized.imageId,
    serverId
  );

  recordReceipt(db, current.client_id, mutationId, Number(serverId));
  return { recipe: getRecipe(db, serverId), replay: false };
}

function deleteRecipe(db, serverId, { mutationId, expectedRev } = {}) {
  const current = db.prepare('SELECT * FROM recipes WHERE server_id = ?').get(serverId);
  if (!current) return { error: 'notFound' };
  if (current.deleted_at) {
    return { recipe: rowToRecipe(current), replay: true };
  }

  const receipt = findReceipt(db, current.client_id, mutationId);
  if (receipt && receipt.server_id === Number(serverId)) {
    return { recipe: rowToRecipe(current), replay: true };
  }

  if (Number.isFinite(Number(expectedRev)) && Number(current.rev) !== Number(expectedRev)) {
    return { error: 'conflict', recipe: rowToRecipe(current) };
  }

  const timestamp = nowIso();
  db.prepare(`
    UPDATE recipes SET
      rev = rev + 1,
      updated_at = ?,
      deleted_at = ?
    WHERE server_id = ?
  `).run(timestamp, timestamp, serverId);

  recordReceipt(db, current.client_id, mutationId, Number(serverId));
  return { recipe: getRecipe(db, serverId), replay: false };
}

module.exports = {
  decodeCursor,
  deleteRecipe,
  findReceipt,
  getRecipe,
  insertRecipe,
  listRecipes,
  normalizeRecipeInput,
  recordReceipt,
  rowToRecipe,
  updateRecipe
};
