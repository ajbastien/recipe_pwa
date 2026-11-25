const SyncEngine = (() => {
  function newId() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
      const random = Math.floor(Math.random() * 16);
      const value = char === 'x' ? random : (random & 0x3) | 0x8;
      return value.toString(16);
    });
  }

  async function authHeaders() {
    const token = await RecipeDB.getSetting('syncToken', '');
    return token ? { Authorization: `Bearer ${token}` } : {};
  }

  async function fetchJson(url, options = {}) {
    const headers = { ...(await authHeaders()), ...(options.headers || {}) };
    const response = await fetch(url, { ...options, headers });
    const contentType = response.headers.get('Content-Type') || '';
    const data = contentType.includes('application/json')
      ? await response.json()
      : await response.text();

    if (!response.ok) {
      const error = new Error(
        (data && data.error) || (typeof data === 'string' && data) || `HTTP ${response.status}`
      );
      error.status = response.status;
      error.data = data;
      throw error;
    }

    return data;
  }

  function toServerPayload(recipe) {
    return {
      clientId: recipe.id,
      serverId: recipe.serverId || null,
      rev: recipe.rev || 0,
      title: recipe.title,
      description: recipe.description || '',
      prepTime: recipe.prepTime || '',
      cookTime: recipe.cookTime || '',
      servings: recipe.servings || '',
      favorite: Boolean(recipe.favorite),
      rating: recipe.rating || 0,
      notes: recipe.notes || '',
      ingredients: recipe.ingredients || [],
      directions: recipe.directions || [],
      categories: recipe.categories || [],
      sourceUrl: recipe.sourceUrl || '',
      imageId: recipe.imageId || null,
      updatedAt: recipe.updatedAt || new Date().toISOString()
    };
  }

  function fromServerRecipe(row, existingId) {
    return {
      id: existingId || row.clientId,
      serverId: row.serverId,
      rev: row.rev || 1,
      title: row.title || '',
      description: row.description || '',
      prepTime: row.prepTime || '',
      cookTime: row.cookTime || '',
      servings: row.servings || '',
      favorite: Boolean(row.favorite),
      rating: row.rating || 0,
      notes: row.notes || '',
      ingredients: row.ingredients || [],
      directions: row.directions || [],
      categories: row.categories || [],
      dateAdded: row.createdAt || row.dateAdded || new Date(0).toISOString(),
      dateModified: row.updatedAt || row.dateModified || new Date(0).toISOString(),
      sourceUrl: row.sourceUrl || '',
      imageId: row.imageId || null,
      deleted: Boolean(row.deleted),
      deletedAt: row.deletedAt || null,
      updatedAt: row.updatedAt || new Date().toISOString(),
      dirty: false
    };
  }

  async function mergeServerRecipe(row, pendingIds) {
    let existing = null;
    if (row.serverId) {
      existing = await RecipeDB.getByIndex('recipes', 'serverId', row.serverId);
    }
    if (!existing && row.clientId) {
      existing = await RecipeDB.get('recipes', row.clientId);
    }

    const id = existing ? existing.id : row.clientId;
    if (!id) return;

    if (pendingIds.has(id)) return;

    const local = fromServerRecipe(row, id);
    if (existing && existing.deleted && !local.deleted) {
      local.id = existing.id;
    }

    await RecipeDB.put('recipes', local);
  }

  async function uploadImage(mutation) {
    const imageId = mutation.entityId || (mutation.payload && mutation.payload.imageId);
    if (!imageId) throw new Error('Image mutation is missing an image id.');

    const record = await RecipeDB.get('images', imageId);
    if (!record || !record.blob) {
      await RecipeDB.remove('outbox', mutation.id);
      return;
    }

    const headers = await authHeaders();
    headers['Content-Type'] = record.mime || 'image/jpeg';

    const response = await fetch(`/api/images/${encodeURIComponent(imageId)}`, {
      method: 'POST',
      headers,
      body: record.blob
    });

    if (!response.ok) {
      let message = `HTTP ${response.status}`;
      try {
        const data = await response.json();
        if (data && data.error) message = data.error;
      } catch {}
      throw new Error(message);
    }

    await RecipeDB.remove('outbox', mutation.id);
  }

  async function pushRecipeMutations(mutations, report) {
    if (!mutations.length) return;

    const data = await fetchJson('/api/sync/push', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mutations })
    });

    const results = Array.isArray(data.results) ? data.results : [];
    const byId = new Map(results.map((result) => [result.mutationId, result]));

    for (const mutation of mutations) {
      const result = byId.get(mutation.id) || { status: 'error', error: 'No result returned.' };

      if (result.status === 'ok' || result.status === 'exists' || result.status === 'deleted') {
        await RecipeDB.remove('outbox', mutation.id);
        const pendingIds = new Set(
          (await RecipeDB.getAll('outbox')).map((item) => item.entityId).filter(Boolean)
        );
        if (result.recipe) await mergeServerRecipe(result.recipe, pendingIds);
        report.pushed += 1;
        continue;
      }

      if (result.status === 'conflict') {
        const local = await RecipeDB.get('recipes', mutation.entityId);
        const serverTime = Date.parse(result.recipe && result.recipe.updatedAt) || 0;
        const localTime = Date.parse(local && local.updatedAt) || 0;

        if (localTime > serverTime) {
          mutation.baseRev = result.recipe ? result.recipe.rev : mutation.baseRev;
          mutation.lastError = 'Rebased after server conflict.';
          mutation.attempts = (mutation.attempts || 0) + 1;
          await RecipeDB.put('outbox', mutation);
          report.conflicts += 1;
        } else {
          await mergeServerRecipe(result.recipe, new Set());
          await RecipeDB.remove('outbox', mutation.id);
          report.conflicts += 1;
        }
        continue;
      }

      mutation.lastError = result.error || 'Push failed.';
      mutation.attempts = (mutation.attempts || 0) + 1;
      await RecipeDB.put('outbox', mutation);
      report.failed += 1;
    }
  }

  async function pullAll(report) {
    let cursor = await RecipeDB.getSyncState('cursor', '');

    while (true) {
      const query = new URLSearchParams({ limit: '500' });
      if (cursor) query.set('cursor', cursor);

      const page = await fetchJson(`/api/sync/pull?${query.toString()}`);
      const recipes = Array.isArray(page.recipes) ? page.recipes : [];
      const pendingIds = new Set(
        (await RecipeDB.getAll('outbox')).map((item) => item.entityId).filter(Boolean)
      );

      for (const row of recipes) await mergeServerRecipe(row, pendingIds);

      report.pulled += recipes.length;

      if (page.cursor) {
        cursor = page.cursor;
        await RecipeDB.setSyncState('cursor', cursor);
      }

      if (!page.hasMore || !recipes.length) break;
    }

    await RecipeDB.setSyncState('lastSync', new Date().toISOString());
  }

  async function syncNow(onProgress = () => {}) {
    if (!navigator.onLine) throw new Error('Offline');

    const report = { pushed: 0, pulled: 0, conflicts: 0, failed: 0 };
    onProgress('Checking pending changes...');

    const outbox = await RecipeDB.getAll('outbox');
    outbox.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));

    const imageMutations = outbox.filter(
      (mutation) => mutation.entity === 'image' || mutation.op === 'image'
    );
    const recipeMutations = outbox.filter(
      (mutation) => mutation.entity === 'recipe' || ['create', 'update', 'delete'].includes(mutation.op)
    );

    for (let index = 0; index < imageMutations.length; index += 1) {
      onProgress(`Uploading image ${index + 1} of ${imageMutations.length}...`);
      try {
        await uploadImage(imageMutations[index]);
        report.pushed += 1;
      } catch (err) {
        const mutation = imageMutations[index];
        mutation.lastError = err.message;
        mutation.attempts = (mutation.attempts || 0) + 1;
        await RecipeDB.put('outbox', mutation);
        report.failed += 1;
        throw err;
      }
    }

    if (recipeMutations.length) {
      onProgress(`Pushing ${recipeMutations.length} recipe change(s)...`);
      await pushRecipeMutations(recipeMutations, report);
    }

    if (report.failed) {
      throw new Error(`${report.failed} change(s) still pending.`);
    }

    onProgress('Pulling server changes...');
    await pullAll(report);

    onProgress(`Sync complete: ${report.pushed} pushed, ${report.pulled} pulled.`);
    return report;
  }

  return {
    fetchJson,
    fromServerRecipe,
    newId,
    syncNow,
    toServerPayload
  };
})();

window.SyncEngine = SyncEngine;
