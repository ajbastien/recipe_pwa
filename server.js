const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { openDatabase } = require('./src/db');
const recipeStore = require('./src/recipes');
const favoriteStore = require('./src/favorites');

const app = express();
const db = openDatabase();

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const IMAGE_DIR = path.join(__dirname, 'data', 'images');
const SYNC_TOKEN = process.env.SYNC_TOKEN || '';

fs.mkdirSync(IMAGE_DIR, { recursive: true });

function requireAuth(req, res, next) {
  if (!SYNC_TOKEN) return next();

  const header = req.get('Authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (token !== SYNC_TOKEN) {
    res.set('Cache-Control', 'no-store');
    return res.status(401).json({ error: 'Unauthorized' });
  }
  return next();
}

app.use((req, res, next) => {
  if (req.path.startsWith('/api/') && req.path !== '/api/health' && req.path !== '/api/config') {
    return requireAuth(req, res, next);
  }
  return next();
});

app.use(express.static(PUBLIC_DIR, {
  index: false,
  etag: true,
  lastModified: true,
  setHeaders(res, filePath) {
    if (/\.(?:html|js|css|webmanifest|png|svg)$/i.test(filePath)) {
      res.setHeader('Cache-Control', 'no-cache');
      if (/sw\.js$/i.test(filePath)) {
        res.setHeader('Service-Worker-Allowed', '/');
      }
    } else {
      res.setHeader('Cache-Control', 'public, max-age=86400');
    }
  }
}));

app.get('/api/health', (_req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ ok: true, name: "Diane's Recipes" });
});

app.get('/api/config', (_req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ authRequired: Boolean(SYNC_TOKEN) });
});

function isImageMime(value) {
  return String(value || '').toLowerCase().startsWith('image/');
}

function isPrivateImageHost(hostname) {
  const host = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '');
  if (!host) return true;
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host === '::1') return true;
  if (/^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host) || /^169\.254\./.test(host)) return true;
  if (/^fe80:/i.test(host)) return true;

  const private172 = host.match(/^172\.(\d+)\./);
  if (private172 && Number(private172[1]) >= 16 && Number(private172[1]) <= 31) return true;

  return false;
}

app.get('/api/fetch-image', async (req, res) => {
  const rawUrl = String(req.query.url || '').trim();
  if (!rawUrl) {
    res.set('Cache-Control', 'no-store');
    return res.status(400).json({ error: 'Image URL is required.' });
  }

  let target;
  try {
    target = new URL(rawUrl);
  } catch {
    res.set('Cache-Control', 'no-store');
    return res.status(400).json({ error: 'Enter a valid image URL.' });
  }

  if (!['http:', 'https:'].includes(target.protocol)) {
    res.set('Cache-Control', 'no-store');
    return res.status(400).json({ error: 'Only http and https image URLs are supported.' });
  }

  if (isPrivateImageHost(target.hostname)) {
    res.set('Cache-Control', 'no-store');
    return res.status(400).json({ error: 'Private or local image URLs are not allowed.' });
  }

  try {
    const response = await fetch(target, {
      redirect: 'follow',
      signal: AbortSignal.timeout(15000),
      headers: {
        Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
        'User-Agent': "Diane's Recipes image fetch"
      }
    });

    if (!response.ok) throw new Error(`Remote server returned ${response.status}.`);

    const mime = String(response.headers.get('content-type') || '').split(';')[0].trim();
    if (!isImageMime(mime)) throw new Error('The URL did not return an image.');

    const contentLength = Number(response.headers.get('content-length') || 0);
    if (contentLength > 10 * 1024 * 1024) throw new Error('Image is too large. The limit is 10 MB.');

    const bytes = Buffer.from(await response.arrayBuffer());
    if (!bytes.length) throw new Error('The image was empty.');
    if (bytes.length > 10 * 1024 * 1024) throw new Error('Image is too large. The limit is 10 MB.');

    res.set('Cache-Control', 'no-store');
    res.type(mime || 'image/jpeg');
    return res.send(bytes);
  } catch (err) {
    res.set('Cache-Control', 'no-store');
    return res.status(400).json({ error: `Could not fetch image: ${err.message}` });
  }
});

function extensionForMime(mime) {
  if (/jpeg|jpg/i.test(mime)) return 'jpg';
  if (/png/i.test(mime)) return 'png';
  if (/webp/i.test(mime)) return 'webp';
  if (/gif/i.test(mime)) return 'gif';
  return 'bin';
}

function saveImage(imageId, bytes, mime, recipeServerId) {
  if (!/^[a-f0-9]{64}$/i.test(imageId)) {
    throw new Error('Image id must be a SHA-256 hex string.');
  }

  const checksum = crypto.createHash('sha256').update(bytes).digest('hex');
  if (checksum !== imageId.toLowerCase()) {
    throw new Error('Image checksum does not match the image id.');
  }

  const fileName = `${imageId.toLowerCase()}.${extensionForMime(mime)}`;
  const filePath = path.join(IMAGE_DIR, fileName);
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, bytes);
  }

  db.prepare(`
    INSERT INTO images (image_id, recipe_server_id, mime, size, checksum, file_name, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(image_id) DO UPDATE SET
      mime = excluded.mime,
      size = excluded.size,
      checksum = excluded.checksum,
      file_name = excluded.file_name
  `).run(
    imageId.toLowerCase(),
    recipeServerId || null,
    mime || 'image/jpeg',
    bytes.length,
    checksum,
    fileName,
    new Date().toISOString()
  );

  if (recipeServerId) {
    db.prepare('UPDATE images SET recipe_server_id = ? WHERE image_id = ?')
      .run(recipeServerId, imageId.toLowerCase());
  }

  return {
    imageId: imageId.toLowerCase(),
    url: `/api/images/${imageId.toLowerCase()}`,
    mime: mime || 'image/jpeg',
    size: bytes.length
  };
}

app.post(
  '/api/images/:imageId',
  express.raw({ type: ['image/*', 'application/octet-stream'], limit: '10mb' }),
  (req, res) => {
    try {
      const bytes = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
      if (!bytes.length) {
        res.set('Cache-Control', 'no-store');
        return res.status(400).json({ error: 'Image body is empty.' });
      }

      const recipeServerId = Number(req.query.recipeServerId);
      const result = saveImage(
        req.params.imageId,
        bytes,
        req.get('Content-Type') || 'application/octet-stream',
        Number.isInteger(recipeServerId) ? recipeServerId : null
      );
      res.set('Cache-Control', 'no-store');
      return res.status(201).json(result);
    } catch (err) {
      res.set('Cache-Control', 'no-store');
      return res.status(400).json({ error: err.message });
    }
  }
);

app.get('/api/images/:imageId', (req, res) => {
  const row = db.prepare('SELECT * FROM images WHERE image_id = ?').get(req.params.imageId);
  if (!row) {
    res.set('Cache-Control', 'no-store');
    return res.status(404).json({ error: 'Image not found.' });
  }

  const filePath = path.join(IMAGE_DIR, row.file_name);
  if (!fs.existsSync(filePath)) {
    res.set('Cache-Control', 'no-store');
    return res.status(404).json({ error: 'Image file not found.' });
  }

  res.set('Cache-Control', 'public, max-age=31536000, immutable');
  res.type(row.mime || 'image/jpeg');
  return res.sendFile(filePath);
});

app.use(express.json({ limit: '10mb' }));

app.get('/api/sync/pull', (req, res) => {
  try {
    const result = recipeStore.listRecipes(db, {
      cursor: req.query.cursor,
      limit: req.query.limit
    });
    res.set('Cache-Control', 'no-store');
    res.json(result);
  } catch (err) {
    res.set('Cache-Control', 'no-store');
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/favorites/pull', (req, res) => {
  try {
    const result = favoriteStore.listFavorites(db, {
      cursor: req.query.cursor,
      limit: req.query.limit,
      userKey: req.query.userKey
    });
    res.set('Cache-Control', 'no-store');
    res.json(result);
  } catch (err) {
    res.set('Cache-Control', 'no-store');
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/favorites/push', (req, res) => {
  const mutations = Array.isArray(req.body && req.body.mutations) ? req.body.mutations : [];
  const results = mutations.map((mutation) => {
    const mutationId = mutation && (mutation.id || mutation.mutationId);
    try {
      return {
        mutationId,
        ...favoriteStore.applyFavoriteMutation(db, mutation || {})
      };
    } catch (err) {
      return { mutationId, status: 'error', error: err.message };
    }
  });

  res.set('Cache-Control', 'no-store');
  res.json({ results, serverTime: new Date().toISOString() });
});

app.post('/api/favorites/rename', (req, res) => {
  try {
    const result = favoriteStore.renameUser(db, req.body || {});
    res.set('Cache-Control', 'no-store');
    res.json(result);
  } catch (err) {
    res.set('Cache-Control', 'no-store');
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/recipes', (req, res) => {
  const result = recipeStore.listRecipes(db, {
    cursor: req.query.cursor,
    limit: req.query.limit
  });
  res.set('Cache-Control', 'no-store');
  res.json(result);
});

app.get('/api/recipes/:serverId', (req, res) => {
  const recipe = recipeStore.getRecipe(db, req.params.serverId);
  res.set('Cache-Control', 'no-store');
  if (!recipe) return res.status(404).json({ error: 'Recipe not found.' });
  return res.json(recipe);
});

function resolveServerId(mutation) {
  if (mutation.serverId) return Number(mutation.serverId);
  if (mutation.payload && mutation.payload.serverId) return Number(mutation.payload.serverId);
  if (mutation.entityId && /^\d+$/.test(String(mutation.entityId))) return Number(mutation.entityId);

  const clientId = mutation.clientId || (mutation.payload && mutation.payload.clientId);
  if (clientId) {
    const row = db.prepare('SELECT server_id FROM recipes WHERE client_id = ?').get(clientId);
    if (row) return row.server_id;
  }
  return null;
}

function applyLegacyFavorite(mutation, recipeClientId) {
  const payload = mutation && mutation.payload;
  if (!payload || !recipeClientId) return;
  if (payload.favoriteScope === 'separate') return;
  if (!Object.prototype.hasOwnProperty.call(payload, 'favorite')) return;

  favoriteStore.applyFavoriteMutation(db, {
    clientId: `legacy:${recipeClientId}`,
    mutationId: `legacy:${mutation.id || mutation.mutationId}`,
    recipeId: recipeClientId,
    scope: 'global',
    favorite: payload.favorite ? 1 : 0,
    updatedAt: mutation.updatedAt
  });
}

function applyMutation(mutation) {
  if (!mutation || typeof mutation !== 'object') {
    return { status: 'error', error: 'Invalid mutation.' };
  }

  const mutationId = mutation.id || mutation.mutationId;
  if (!mutationId) return { status: 'error', error: 'Mutation id is required.' };

  if (mutation.entity === 'image' || mutation.op === 'image') {
    try {
      const payload = mutation.payload || {};
      const bytes = Buffer.from(payload.dataBase64 || '', 'base64');
      if (!bytes.length) throw new Error('Image data is empty.');
      return {
        status: 'ok',
        image: saveImage(payload.imageId || mutation.entityId, bytes, payload.mime, null)
      };
    } catch (err) {
      return { status: 'error', error: err.message };
    }
  }

  if (mutation.entity !== 'recipe' && !['create', 'update', 'delete'].includes(mutation.op)) {
    return { status: 'error', error: 'Unsupported mutation.' };
  }

  try {
    if (mutation.op === 'create') {
      const result = recipeStore.insertRecipe(db, mutation.payload || {}, {
        clientId: mutation.entityId,
        mutationId
      });
      if (result.recipe) applyLegacyFavorite(mutation, result.recipe.clientId);
      if (result.conflict === 'clientId') {
        return { status: 'exists', recipe: result.recipe };
      }
      return { status: 'ok', recipe: result.recipe };
    }

    const serverId = resolveServerId(mutation);
    if (!serverId) return { status: 'error', error: 'Recipe server id could not be resolved.' };

    if (mutation.op === 'update') {
      const result = recipeStore.updateRecipe(db, serverId, mutation.payload || {}, {
        mutationId,
        expectedRev: mutation.baseRev
      });
      if (result.error === 'conflict') return { status: 'conflict', recipe: result.recipe };
      if (result.error === 'notFound') return { status: 'error', error: 'Recipe not found.' };
      if (result.error === 'deleted') return { status: 'deleted', recipe: result.recipe };
      applyLegacyFavorite(mutation, result.recipe && result.recipe.clientId);
      return { status: 'ok', recipe: result.recipe };
    }

    if (mutation.op === 'delete') {
      const result = recipeStore.deleteRecipe(db, serverId, {
        mutationId,
        expectedRev: mutation.baseRev
      });
      if (result.error === 'conflict') return { status: 'conflict', recipe: result.recipe };
      if (result.error === 'notFound') return { status: 'error', error: 'Recipe not found.' };
      if (result.recipe && result.recipe.clientId) {
        favoriteStore.removeFavoritesForRecipe(db, result.recipe.clientId);
      }
      return { status: 'ok', recipe: result.recipe };
    }

    return { status: 'error', error: 'Unsupported recipe operation.' };
  } catch (err) {
    return { status: 'error', error: err.message };
  }
}

app.post('/api/sync/push', (req, res) => {
  const mutations = Array.isArray(req.body && req.body.mutations) ? req.body.mutations : [];
  const results = mutations.map((mutation) => ({
    mutationId: mutation && (mutation.id || mutation.mutationId),
    ...applyMutation(mutation)
  }));

  res.set('Cache-Control', 'no-store');
  res.json({ results, serverTime: new Date().toISOString() });
});

app.post('/api/recipes', (req, res) => {
  const mutationId = req.get('Idempotency-Key') || (req.body && req.body.mutationId);
  const result = applyMutation({
    id: mutationId,
    op: 'create',
    entity: 'recipe',
    entityId: req.body && req.body.clientId,
    payload: req.body
  });

  res.set('Cache-Control', 'no-store');
  if (result.status === 'error') return res.status(400).json({ error: result.error });
  if (result.status === 'conflict' || result.status === 'exists') {
    return res.status(409).json(result);
  }
  return res.status(201).json(result.recipe);
});

app.put('/api/recipes/:serverId', (req, res) => {
  const mutationId = req.get('Idempotency-Key') || (req.body && req.body.mutationId);
  const result = applyMutation({
    id: mutationId,
    op: 'update',
    entity: 'recipe',
    serverId: req.params.serverId,
    clientId: req.body && req.body.clientId,
    baseRev: req.body && req.body.rev,
    payload: req.body
  });

  res.set('Cache-Control', 'no-store');
  if (result.status === 'error') return res.status(400).json({ error: result.error });
  if (result.status === 'conflict') return res.status(409).json(result);
  if (result.status === 'deleted') return res.status(410).json(result);
  return res.json(result.recipe);
});

app.delete('/api/recipes/:serverId', (req, res) => {
  const mutationId = req.get('Idempotency-Key') || (req.body && req.body.mutationId);
  const result = applyMutation({
    id: mutationId,
    op: 'delete',
    entity: 'recipe',
    serverId: req.params.serverId,
    baseRev: req.body && req.body.rev,
    payload: req.body || {}
  });

  res.set('Cache-Control', 'no-store');
  if (result.status === 'error') return res.status(400).json({ error: result.error });
  if (result.status === 'conflict') return res.status(409).json(result);
  return res.json(result.recipe);
});

app.get('*', (_req, res) => {
  res.set('Cache-Control', 'no-store');
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Diane's Recipes running at http://localhost:${PORT}`);
});
