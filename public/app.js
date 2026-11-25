const state = {
  allRecipes: [],
  recipes: [],
  categories: new Set(),
  selectedCategories: new Set(),
  search: '',
  sort: 'title',
  editingId: null,
  detailId: null,
  pendingImage: null,
  pendingImageRemoved: false,
  importImage: null
};

const elements = {
  status: document.getElementById('status'),
  grid: document.getElementById('grid'),
  empty: document.getElementById('empty'),
  recipeCount: document.getElementById('recipe-count'),
  search: document.getElementById('search'),
  sort: document.getElementById('sort'),
  categoryFilters: document.getElementById('category-filters'),
  syncButton: document.getElementById('sync-btn'),
  importButton: document.getElementById('import-btn'),
  addButton: document.getElementById('add-btn'),
  import: document.getElementById('import'),
  importText: document.getElementById('import-text'),
  pasteButton: document.getElementById('paste-btn'),
  parseButton: document.getElementById('parse-btn'),
  importImage: document.getElementById('import-image'),
  importImageStatus: document.getElementById('import-image-status'),
  detail: document.getElementById('detail'),
  detailImage: document.getElementById('detail-image'),
  detailTitle: document.getElementById('detail-title'),
  detailDescription: document.getElementById('detail-description'),
  detailMeta: document.getElementById('detail-meta'),
  detailIngredients: document.getElementById('detail-ingredients'),
  detailDirections: document.getElementById('detail-directions'),
  detailNotes: document.getElementById('detail-notes'),
  detailEdit: document.getElementById('detail-edit'),
  detailDelete: document.getElementById('detail-delete'),
  editor: document.getElementById('editor'),
  editorHeading: document.getElementById('editor-heading'),
  form: document.getElementById('recipe-form'),
  editorImage: document.getElementById('editor-image'),
  imageInput: document.getElementById('field-image'),
  removeImage: document.getElementById('remove-image'),
  tokenField: document.getElementById('token-field'),
  tokenInput: document.getElementById('sync-token')
};

function nowIso() {
  return new Date().toISOString();
}

function setStatus(message, isError = false) {
  if (!elements.status) return;
  elements.status.textContent = message;
  elements.status.classList.toggle('error', Boolean(isError));
}

function splitLines(value) {
  return String(value || '')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

function splitCategories(value) {
  return String(value || '')
    .split(',')
    .map((category) => category.trim())
    .filter(Boolean);
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;

  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js')
      .then(() => {
        if (navigator.storage && navigator.storage.persist) {
          navigator.storage.persist().catch(() => {});
        }
      })
      .catch((err) => console.warn('Service worker registration failed:', err));
  });
}

async function loadConfig() {
  try {
    const config = await SyncEngine.fetchJson('/api/config');
    elements.tokenField.hidden = !config.authRequired;
    if (config.authRequired) {
      elements.tokenInput.value = (await RecipeDB.getSetting('syncToken', '')) || '';
    }
  } catch {
    elements.tokenField.hidden = true;
  }
}

async function loadRecipes() {
  const all = await RecipeDB.getAll('recipes');
  state.allRecipes = all.filter((recipe) => !recipe.deleted);
  state.categories = new Set(
    state.allRecipes.flatMap((recipe) => recipe.categories || [])
  );
  state.categories.delete('');

  buildCategoryFilters();
  applyFilters();
}

function buildCategoryFilters() {
  if (!elements.categoryFilters) return;

  elements.categoryFilters.innerHTML = '';
  const categories = [...state.categories].sort((a, b) => a.localeCompare(b));
  if (!categories.length) {
    elements.categoryFilters.textContent = 'No categories yet.';
    return;
  }

  for (const category of categories) {
    const label = document.createElement('label');
    label.className = 'category-option';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = state.selectedCategories.has(category);
    checkbox.addEventListener('change', () => {
      if (checkbox.checked) state.selectedCategories.add(category);
      else state.selectedCategories.delete(category);
      applyFilters();
    });

    const text = document.createElement('span');
    text.textContent = category;

    label.append(checkbox, text);
    elements.categoryFilters.append(label);
  }
}

function applyFilters() {
  let list = [...state.allRecipes];

  if (state.search) {
    const needle = state.search.toLowerCase();
    list = list.filter((recipe) => String(recipe.title || '').toLowerCase().includes(needle));
  }

  if (state.selectedCategories.size) {
    list = list.filter((recipe) =>
      [...state.selectedCategories].every((category) => (recipe.categories || []).includes(category))
    );
  }

  list.sort((a, b) => {
    if (state.sort === 'newest') {
      return String(b.updatedAt || b.dateAdded || '').localeCompare(String(a.updatedAt || a.dateAdded || ''));
    }
    if (state.sort === 'oldest') {
      return String(a.dateAdded || a.updatedAt || '').localeCompare(String(b.dateAdded || b.updatedAt || ''));
    }
    if (state.sort === 'favorites') {
      const favoriteDiff = Number(Boolean(b.favorite)) - Number(Boolean(a.favorite));
      if (favoriteDiff) return favoriteDiff;
    }
    return String(a.title || '').localeCompare(String(b.title || ''));
  });

  state.recipes = list;
  renderGrid();
  updateRecipeCount();
}

function recipeLabel(count) {
  return `${count} ${count === 1 ? 'recipe' : 'recipes'}`;
}

function updateRecipeCount() {
  if (!elements.recipeCount) return;

  const total = state.allRecipes.length;
  const shown = state.recipes.length;
  elements.recipeCount.textContent = shown === total
    ? recipeLabel(total)
    : `Showing ${recipeLabel(shown)} of ${recipeLabel(total)}`;
}

function renderGrid() {
  const grid = elements.grid;
  if (!grid) return;

  grid.innerHTML = '';
  elements.empty.hidden = state.recipes.length > 0;

  for (const recipe of state.recipes) {
    const card = document.createElement('article');
    card.className = 'recipe-card';

    const image = document.createElement('img');
    image.className = 'recipe-image';
    image.src = recipe.imageId ? `/api/images/${encodeURIComponent(recipe.imageId)}` : '/app-icon.png';
    image.alt = '';
    image.loading = 'lazy';
    image.onerror = () => { image.src = '/app-icon.png'; };

    const body = document.createElement('div');
    body.className = 'recipe-card-body';

    const title = document.createElement('h2');
    title.textContent = recipe.title || 'Untitled recipe';

    const categories = document.createElement('p');
    categories.className = 'recipe-categories';
    categories.textContent = (recipe.categories || []).join(', ');

    const heart = document.createElement('button');
    heart.type = 'button';
    heart.className = `favorite-button${recipe.favorite ? ' active' : ''}`;
    heart.textContent = recipe.favorite ? '♥' : '♡';
    heart.setAttribute('aria-label', recipe.favorite ? 'Remove favorite' : 'Add favorite');
    heart.addEventListener('click', (event) => {
      event.stopPropagation();
      toggleFavorite(recipe.id);
    });

    body.append(title, categories, heart);
    card.append(image, body);
    card.addEventListener('click', () => openDetail(recipe.id));
    grid.append(card);
  }
}

async function enqueueRecipeMutation(recipe, op) {
  const outbox = await RecipeDB.getAll('outbox');
  const existingMutation = outbox.find((mutation) =>
    mutation.entityId === recipe.id && ['create', 'update'].includes(mutation.op)
  );

  if (existingMutation) {
    existingMutation.op = existingMutation.op === 'create' ? 'create' : 'update';
    existingMutation.payload = SyncEngine.toServerPayload(recipe);
    existingMutation.baseRev = recipe.rev || 0;
    existingMutation.serverId = recipe.serverId || null;
    existingMutation.lastError = null;
    existingMutation.updatedAt = nowIso();
    await RecipeDB.put('outbox', existingMutation);
    return;
  }

  const mutation = {
    id: SyncEngine.newId(),
    entity: 'recipe',
    entityId: recipe.id,
    serverId: recipe.serverId || null,
    op,
    payload: SyncEngine.toServerPayload(recipe),
    baseRev: recipe.rev || 0,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    attempts: 0,
    lastError: null
  };

  await RecipeDB.addMutation(mutation);
}

async function toggleFavorite(id) {
  const recipe = await RecipeDB.get('recipes', id);
  if (!recipe) return;

  recipe.favorite = !recipe.favorite;
  recipe.updatedAt = nowIso();
  recipe.dirty = true;

  await RecipeDB.put('recipes', recipe);
  await enqueueRecipeMutation(recipe, 'update');
  await loadRecipes();
}

async function sha256Blob(blob) {
  const buffer = await blob.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function setPendingImage(blob, mime) {
  if (!blob || !blob.size) return;

  state.pendingImage = {
    imageId: await sha256Blob(blob),
    blob,
    mime: mime || blob.type || 'image/jpeg',
    size: blob.size
  };
  state.pendingImageRemoved = false;
  elements.editorImage.src = URL.createObjectURL(blob);
}

async function handleImageSelection(event) {
  const file = event.target.files && event.target.files[0];
  if (!file) return;
  await setPendingImage(file, file.type);
}

function openDetail(id) {
  const recipe = state.allRecipes.find((item) => item.id === id);
  if (!recipe) return;

  state.detailId = id;
  elements.detailImage.src = recipe.imageId
    ? `/api/images/${encodeURIComponent(recipe.imageId)}`
    : '/app-icon.png';
  elements.detailImage.onerror = () => { elements.detailImage.src = '/app-icon.png'; };
  elements.detailTitle.textContent = recipe.title || 'Untitled recipe';
  elements.detailDescription.textContent = recipe.description || '';
  elements.detailDescription.hidden = !recipe.description;

  elements.detailMeta.innerHTML = '';
  const metaItems = [
    ['Prep', recipe.prepTime],
    ['Cook', recipe.cookTime],
    ['Servings', recipe.servings],
    ['Favorite', recipe.favorite ? 'Yes' : 'No'],
    ['Categories', (recipe.categories || []).join(', ')],
    ['Source', recipe.sourceUrl]
  ];

  for (const [label, value] of metaItems) {
    if (!value) continue;
    const row = document.createElement('p');
    const strong = document.createElement('strong');
    strong.textContent = `${label}: `;
    row.append(strong, document.createTextNode(String(value)));
    elements.detailMeta.append(row);
  }

  elements.detailIngredients.innerHTML = '';
  for (const ingredient of recipe.ingredients || []) {
    const item = document.createElement('li');
    item.textContent = ingredient;
    elements.detailIngredients.append(item);
  }

  elements.detailDirections.innerHTML = '';
  for (const direction of recipe.directions || []) {
    const item = document.createElement('li');
    item.textContent = direction;
    elements.detailDirections.append(item);
  }

  if (recipe.notes) {
    elements.detailNotes.textContent = recipe.notes;
    elements.detailNotes.hidden = false;
  } else {
    elements.detailNotes.hidden = true;
  }

  elements.detail.hidden = false;
}

async function openEditor(id = null, options = {}) {
  const draft = options.draft || null;
  state.editingId = id;
  state.pendingImage = options.pendingImage || null;
  state.pendingImageRemoved = false;

  const recipe = id ? await RecipeDB.get('recipes', id) : null;
  const source = recipe || draft || {};
  elements.editorHeading.textContent = recipe
    ? 'Edit recipe'
    : draft
      ? 'Imported recipe — review before saving'
      : 'New recipe';
  elements.form.reset();

  if (state.pendingImage) {
    elements.editorImage.src = URL.createObjectURL(state.pendingImage.blob);
  } else if (source.imageId) {
    elements.editorImage.src = `/api/images/${encodeURIComponent(source.imageId)}`;
  } else {
    elements.editorImage.src = '/app-icon.png';
  }
  elements.editorImage.onerror = () => { elements.editorImage.src = '/app-icon.png'; };

  document.getElementById('field-title').value = source.title || '';
  document.getElementById('field-description').value = source.description || '';
  document.getElementById('field-prep').value = source.prepTime || '';
  document.getElementById('field-cook').value = source.cookTime || '';
  document.getElementById('field-servings').value = source.servings || '';
  document.getElementById('field-categories').value = (source.categories || []).join(', ');
  document.getElementById('field-favorite').checked = Boolean(source.favorite);
  document.getElementById('field-ingredients').value = (source.ingredients || []).join('\n');
  document.getElementById('field-directions').value = (source.directions || []).join('\n');
  document.getElementById('field-notes').value = source.notes || '';
  document.getElementById('field-url').value = source.sourceUrl || '';
  elements.imageInput.value = '';

  elements.detail.hidden = true;
  elements.import.hidden = true;
  elements.editor.hidden = false;
  document.getElementById('field-title').focus();
}

function importSummary(parsed, hasPhoto) {
  const parts = [];
  if (parsed.ingredients && parsed.ingredients.length) {
    parts.push(`${parsed.ingredients.length} ingredients`);
  }
  if (parsed.directions && parsed.directions.length) {
    parts.push(`${parsed.directions.length} steps`);
  }
  if (hasPhoto) parts.push('photo');
  return parts.length ? parts.join(', ') : 'title only';
}

function openImport() {
  state.importImage = null;
  elements.importText.value = '';
  elements.importImage.hidden = true;
  elements.importImage.src = '/app-icon.png';
  elements.importImageStatus.textContent = 'No photo detected';
  elements.detail.hidden = true;
  elements.editor.hidden = true;
  elements.import.hidden = false;
  elements.importText.focus();
}

async function setImportImage(blob, mime) {
  if (!blob || !blob.size) return;

  state.importImage = {
    imageId: await sha256Blob(blob),
    blob,
    mime: mime || blob.type || 'image/jpeg',
    size: blob.size
  };

  elements.importImage.src = URL.createObjectURL(blob);
  elements.importImage.hidden = false;
  const size = blob.size >= 1024 * 1024
    ? `${(blob.size / 1024 / 1024).toFixed(1)} MB`
    : `${Math.max(1, Math.round(blob.size / 1024))} KB`;
  elements.importImageStatus.textContent = `Photo ready (${size})`;
}

async function pasteFromClipboard() {
  let textPasted = false;

  try {
    const text = await navigator.clipboard.readText();
    if (text) {
      elements.importText.value = text;
      textPasted = true;
    }
  } catch {}

  setStatus(
    textPasted
      ? 'Clipboard text pasted.'
      : 'Clipboard text unavailable. Tap the text box and paste manually.',
    !textPasted
  );

  if (navigator.clipboard && navigator.clipboard.read && typeof window.ClipboardItem !== 'undefined') {
    try {
      const items = await navigator.clipboard.read();
      for (const item of items) {
        const imageType = (item.types || []).find((type) => String(type).startsWith('image/'));
        if (!imageType) continue;
        const blob = await item.getType(imageType);
        await setImportImage(blob, imageType);
        break;
      }
    } catch {}
  }
}

async function handleImportPaste(event) {
  const items = event.clipboardData && event.clipboardData.items;
  if (!items) return;

  for (const item of items) {
    if (item.kind === 'file' && String(item.type).startsWith('image/')) {
      const file = item.getAsFile();
      if (file) await setImportImage(file, file.type || item.type);
    }
  }
}

async function parseImport() {
  const text = elements.importText.value.trim();
  if (!text) {
    setStatus('Paste a recipe first.', true);
    return;
  }

  const parsed = RecipeImport.parseRecipeText(text);
  if (!parsed.title) {
    setStatus('No title found. Add a title line and try again.', true);
    return;
  }

  const photoReady = Boolean(state.importImage);
  await openEditor(null, { draft: parsed, pendingImage: state.importImage });

  state.importImage = null;
  elements.importText.value = '';
  elements.importImage.hidden = true;
  elements.importImage.src = '/app-icon.png';
  elements.importImageStatus.textContent = 'No photo detected';
  setStatus(`Imported: ${importSummary(parsed, photoReady)}. Review before saving.`);
}

async function saveRecipe(event) {
  event.preventDefault();

  const data = new FormData(elements.form);
  const title = String(data.get('title') || '').trim();
  if (!title) {
    setStatus('Recipe title is required.', true);
    return;
  }

  const existing = state.editingId ? await RecipeDB.get('recipes', state.editingId) : null;
  const timestamp = nowIso();
  let imageId = existing ? existing.imageId || null : null;

  if (state.pendingImageRemoved) {
    imageId = null;
  }

  if (state.pendingImage) {
    imageId = state.pendingImage.imageId;
    await RecipeDB.put('images', {
      imageId,
      blob: state.pendingImage.blob,
      mime: state.pendingImage.mime,
      size: state.pendingImage.size,
      createdAt: timestamp
    });

    if (!existing || existing.imageId !== imageId) {
      await RecipeDB.addMutation({
        id: SyncEngine.newId(),
        entity: 'image',
        op: 'image',
        entityId: imageId,
        payload: { imageId, mime: state.pendingImage.mime },
        createdAt: timestamp,
        attempts: 0,
        lastError: null
      });
    }
  }

  const recipe = {
    id: existing ? existing.id : SyncEngine.newId(),
    serverId: existing ? existing.serverId || null : null,
    rev: existing ? existing.rev || 0 : 0,
    title,
    description: String(data.get('description') || ''),
    prepTime: String(data.get('prepTime') || ''),
    cookTime: String(data.get('cookTime') || ''),
    servings: String(data.get('servings') || ''),
    favorite: Boolean(data.get('favorite')),
    rating: existing ? existing.rating || 0 : 0,
    notes: String(data.get('notes') || ''),
    ingredients: splitLines(data.get('ingredients')),
    directions: splitLines(data.get('directions')),
    categories: splitCategories(data.get('categories')),
    sourceUrl: String(data.get('sourceUrl') || ''),
    imageId,
    dateAdded: existing ? existing.dateAdded : timestamp,
    dateModified: timestamp,
    deleted: false,
    deletedAt: null,
    updatedAt: timestamp,
    dirty: true
  };

  await RecipeDB.put('recipes', recipe);
  await enqueueRecipeMutation(recipe, existing ? 'update' : 'create');

  state.pendingImage = null;
  state.pendingImageRemoved = false;
  elements.editor.hidden = true;
  await loadRecipes();
  setStatus('Recipe saved locally. Sync to send it to the server.');
}

async function deleteRecipe() {
  const id = state.detailId;
  if (!id) return;
  if (!window.confirm('Delete this recipe and sync the deletion?')) return;

  const recipe = await RecipeDB.get('recipes', id);
  if (!recipe) return;

  const outbox = await RecipeDB.getAll('outbox');
  const pendingCreate = outbox.find((mutation) =>
    mutation.entityId === id && mutation.op === 'create'
  );

  if (pendingCreate) {
    await RecipeDB.remove('outbox', pendingCreate.id);
    const pendingImage = outbox.find((mutation) =>
      mutation.entity === 'image' && mutation.entityId === recipe.imageId
    );
    if (pendingImage) await RecipeDB.remove('outbox', pendingImage.id);
    await RecipeDB.remove('recipes', id);
  } else {
    recipe.deleted = true;
    recipe.deletedAt = nowIso();
    recipe.updatedAt = recipe.deletedAt;
    recipe.dirty = true;
    await RecipeDB.put('recipes', recipe);
    await enqueueRecipeMutation(recipe, 'delete');
  }

  elements.detail.hidden = true;
  state.detailId = null;
  await loadRecipes();
  setStatus('Recipe deleted locally. Sync to send the deletion.');
}

async function runSync() {
  elements.syncButton.disabled = true;
  try {
    await SyncEngine.syncNow((message) => setStatus(message));
    await loadRecipes();
    setStatus('Sync complete.');
  } catch (err) {
    setStatus(`Sync failed: ${err.message}`, true);
  } finally {
    elements.syncButton.disabled = false;
  }
}

function bindEvents() {
  elements.syncButton.addEventListener('click', runSync);
  elements.importButton.addEventListener('click', openImport);
  elements.pasteButton.addEventListener('click', pasteFromClipboard);
  elements.parseButton.addEventListener('click', parseImport);
  elements.importText.addEventListener('paste', handleImportPaste);
  elements.addButton.addEventListener('click', () => openEditor());

  elements.search.addEventListener('input', () => {
    state.search = elements.search.value.trim();
    applyFilters();
  });

  elements.sort.addEventListener('change', () => {
    state.sort = elements.sort.value;
    applyFilters();
  });

  elements.imageInput.addEventListener('change', handleImageSelection);
  elements.removeImage.addEventListener('click', () => {
    state.pendingImage = null;
    state.pendingImageRemoved = true;
    elements.editorImage.src = '/app-icon.png';
    elements.imageInput.value = '';
  });

  elements.form.addEventListener('submit', saveRecipe);
  elements.detailEdit.addEventListener('click', () => openEditor(state.detailId));
  elements.detailDelete.addEventListener('click', deleteRecipe);

  for (const button of document.querySelectorAll('[data-close]')) {
    button.addEventListener('click', () => {
      const target = button.dataset.close;
      if (elements[target]) elements[target].hidden = true;
    });
  }

  elements.tokenInput.addEventListener('change', async () => {
    await RecipeDB.setSetting('syncToken', elements.tokenInput.value.trim());
    setStatus('Sync token saved.');
  });

  window.addEventListener('offline', () => setStatus('Offline — using cached recipes.', true));
  window.addEventListener('online', () => setStatus('Back online. Sync when ready.'));
}

async function initialize() {
  setStatus('Loading recipes...');
  registerServiceWorker();
  await RecipeDB.open();
  bindEvents();
  await loadConfig();
  await loadRecipes();

  if (!state.allRecipes.length && navigator.onLine) {
    await RecipeDB.setSyncState('cursor', '');
    await runSync();
  } else {
    setStatus(`${state.allRecipes.length} recipes available offline.`);
  }
}

initialize().catch((err) => setStatus(`Startup failed: ${err.message}`, true));
