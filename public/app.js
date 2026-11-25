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
  importImage: null,
  localImageUrls: new Map(),
  imageBlobs: new Map(),
  favorites: new Map(),
  userName: '',
  userKey: '',
  favoriteDialogId: null,
  editorFavorites: { globalFavorite: false, myFavorite: false }
};

const AUTO_SYNC_INTERVAL_MS = 10 * 60 * 1000;
const AUTO_SYNC_MIN_GAP_MS = 30 * 1000;
let syncInFlight = false;
let lastAutoSyncAt = 0;

const elements = {
  status: document.getElementById('status'),
  grid: document.getElementById('grid'),
  empty: document.getElementById('empty'),
  recipeCount: document.getElementById('recipe-count'),
  search: document.getElementById('search'),
  sort: document.getElementById('sort'),
  categoryFilters: document.getElementById('category-filters'),
  settingsButton: document.getElementById('settings-btn'),
  syncButton: document.getElementById('sync-btn'),
  importButton: document.getElementById('import-btn'),
  addButton: document.getElementById('add-btn'),
  import: document.getElementById('import'),
  importText: document.getElementById('import-text'),
  pasteButton: document.getElementById('paste-btn'),
  parseButton: document.getElementById('parse-btn'),
  importImage: document.getElementById('import-image'),
  importImageInput: document.getElementById('import-image-input'),
  importImageUrl: document.getElementById('import-image-url'),
  fetchImageButton: document.getElementById('fetch-image-btn'),
  importImageStatus: document.getElementById('import-image-status'),
  welcome: document.getElementById('welcome'),
  welcomeName: document.getElementById('welcome-name'),
  welcomeSave: document.getElementById('welcome-save'),
  settings: document.getElementById('settings'),
  settingsName: document.getElementById('settings-name'),
  settingsSave: document.getElementById('settings-save'),
  favoriteDialog: document.getElementById('favorite-dialog'),
  favoriteRecipeTitle: document.getElementById('favorite-recipe-title'),
  favoriteGlobal: document.getElementById('favorite-global'),
  favoriteMe: document.getElementById('favorite-me'),
  favoriteDone: document.getElementById('favorite-done'),
  detail: document.getElementById('detail'),
  detailImage: document.getElementById('detail-image'),
  detailTitle: document.getElementById('detail-title'),
  detailDescription: document.getElementById('detail-description'),
  detailMeta: document.getElementById('detail-meta'),
  detailIngredients: document.getElementById('detail-ingredients'),
  detailDirections: document.getElementById('detail-directions'),
  detailNotes: document.getElementById('detail-notes'),
  detailShare: document.getElementById('detail-share'),
  detailEdit: document.getElementById('detail-edit'),
  detailDelete: document.getElementById('detail-delete'),
  editor: document.getElementById('editor'),
  editorHeading: document.getElementById('editor-heading'),
  form: document.getElementById('recipe-form'),
  editorImage: document.getElementById('editor-image'),
  imageInput: document.getElementById('field-image'),
  editorFavoriteGlobal: document.getElementById('editor-favorite-global'),
  editorFavoriteMe: document.getElementById('editor-favorite-me'),
  editorImageUrl: document.getElementById('editor-image-url'),
  editorFetchImageButton: document.getElementById('editor-fetch-image-btn'),
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

function favoriteFor(recipe) {
  if (!recipe) return RecipeFavorites.emptyFavorite(recipe && recipe.id);
  return state.favorites.get(recipe.id)
    || {
      recipeId: recipe.id,
      globalFavorite: Boolean(recipe.favorite),
      myFavorite: false,
      updatedAt: ''
    };
}

function isFavorite(recipe) {
  return RecipeFavorites.isRecipeFavorite(favoriteFor(recipe));
}

function setToggleButton(button, active, activeText, inactiveText) {
  if (!button) return;
  button.textContent = active ? activeText : inactiveText;
  button.setAttribute('aria-pressed', String(Boolean(active)));
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

async function refreshLocalImageUrls() {
  for (const url of state.localImageUrls.values()) URL.revokeObjectURL(url);
  state.localImageUrls.clear();
  state.imageBlobs.clear();

  const images = await RecipeDB.getAll('images');
  for (const record of images) {
    if (record.imageId && record.blob) {
      state.localImageUrls.set(record.imageId, URL.createObjectURL(record.blob));
      state.imageBlobs.set(record.imageId, record);
    }
  }
}

function imageUrlFor(imageId) {
  if (!imageId) return '/app-icon-v12.png';
  return state.localImageUrls.get(imageId)
    || `/api/images/${encodeURIComponent(imageId)}`;
}

async function loadRecipes() {
  const all = await RecipeDB.getAll('recipes');
  const favorites = await RecipeDB.getAll('favorites');
  state.favorites = new Map(favorites.map((record) => [record.recipeId, record]));
  await refreshLocalImageUrls();

  state.allRecipes = all.filter((recipe) => !recipe.deleted);
  state.categories = new Set(
    state.allRecipes.flatMap((recipe) => recipe.categories || [])
  );
  state.categories.delete('');

  if (!elements.detail.hidden && state.detailId) openDetail(state.detailId);
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
      const favoriteDiff = Number(isFavorite(b)) - Number(isFavorite(a));
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
    image.src = imageUrlFor(recipe.imageId);
    image.alt = '';
    image.loading = 'lazy';
    image.onerror = () => { image.src = '/app-icon-v12.png'; };

    const body = document.createElement('div');
    body.className = 'recipe-card-body';

    const title = document.createElement('h2');
    title.textContent = recipe.title || 'Untitled recipe';

    const categories = document.createElement('p');
    categories.className = 'recipe-categories';
    categories.textContent = (recipe.categories || []).join(', ');

    const favorited = isFavorite(recipe);
    const heart = document.createElement('button');
    heart.type = 'button';
    heart.className = `favorite-button${favorited ? ' active' : ''}`;
    heart.textContent = favorited ? '♥' : '♡';
    heart.setAttribute('aria-label', favorited ? 'Edit favorites' : 'Add favorite');
    heart.addEventListener('click', (event) => {
      event.stopPropagation();
      openFavoriteDialog(recipe.id);
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

async function withSyncLock(task) {
  if (syncInFlight) return false;

  syncInFlight = true;
  if (elements.syncButton) elements.syncButton.disabled = true;
  try {
    return await task();
  } finally {
    syncInFlight = false;
    if (elements.syncButton) elements.syncButton.disabled = false;
  }
}

async function syncAfterLocalChange(message) {
  if (!navigator.onLine) {
    setStatus(`${message}. Queued for sync when online.`);
    return;
  }

  setStatus(`${message}. Syncing...`);
  await withSyncLock(async () => {
    try {
      await SyncEngine.syncNow((progress) => setStatus(progress));
      await applyFavoriteStateToRecipes();
      await loadRecipes();
      lastAutoSyncAt = Date.now();
      setStatus(`${message}. Synced.`);
    } catch (err) {
      setStatus(`${message}. Sync failed: ${err.message}`, true);
    }
  });
}

async function autoSync(reason) {
  if (!navigator.onLine || document.hidden) return;
  if (syncInFlight || Date.now() - lastAutoSyncAt < AUTO_SYNC_MIN_GAP_MS) return;

  setStatus('Syncing...');
  await withSyncLock(async () => {
    try {
      await SyncEngine.syncNow();
      await applyFavoriteStateToRecipes();
      await loadRecipes();
      lastAutoSyncAt = Date.now();
      setStatus(`Synced ${reason}.`);
    } catch (err) {
      setStatus(`Auto sync failed: ${err.message}`, true);
    }
  });
}

async function queueFavoriteChange(recipeId, scope, favorite, options = {}) {
  const userKey = options.userKey || state.userKey || '';
  const existing = await RecipeDB.get('favorites', recipeId)
    || RecipeFavorites.emptyFavorite(recipeId);
  const next = RecipeFavorites.setScope(existing, scope, favorite);
  await RecipeDB.put('favorites', next);

  const outbox = await RecipeDB.getAll('favoriteOutbox');
  const pending = outbox.find((mutation) =>
    mutation.op === 'favorite'
    && mutation.recipeId === recipeId
    && mutation.scope === scope
  );

  const timestamp = nowIso();
  const mutation = pending || RecipeFavorites.favoriteMutation({
    id: SyncEngine.newId(),
    recipeId,
    scope,
    favorite,
    userKey,
    createdAt: timestamp
  });

  mutation.favorite = Boolean(favorite);
  mutation.userKey = userKey;
  mutation.clientId = userKey;
  mutation.updatedAt = timestamp;
  mutation.lastError = null;
  await RecipeDB.put('favoriteOutbox', mutation);

  const recipe = await RecipeDB.get('recipes', recipeId);
  if (recipe) {
    recipe.favorite = RecipeFavorites.isRecipeFavorite(next);
    await RecipeDB.put('recipes', recipe);
  }

  return next;
}

async function seedLocalFavoritesFromRecipes() {
  const recipes = await RecipeDB.getAll('recipes');
  const existing = await RecipeDB.getAll('favorites');
  const known = new Set(existing.map((record) => record.recipeId));

  for (const recipe of recipes) {
    if (!recipe.favorite || known.has(recipe.id)) continue;
    await RecipeDB.put('favorites', {
      recipeId: recipe.id,
      globalFavorite: true,
      myFavorite: false,
      updatedAt: nowIso()
    });
  }
}

async function applyFavoriteStateToRecipes() {
  const recipes = await RecipeDB.getAll('recipes');
  const favorites = await RecipeDB.getAll('favorites');
  const map = new Map(favorites.map((record) => [record.recipeId, record]));

  for (const recipe of recipes) {
    const record = map.get(recipe.id);
    if (!record) continue;
    const derived = RecipeFavorites.isRecipeFavorite(record);
    if (Boolean(recipe.favorite) !== derived) {
      recipe.favorite = derived;
      await RecipeDB.put('recipes', recipe);
    }
  }
}

async function setRecipeFavorite(recipeId, scope, favorite) {
  await queueFavoriteChange(recipeId, scope, favorite);
  await loadRecipes();
  updateFavoriteDialog();
  await syncAfterLocalChange('Favorites updated');
}

function openFavoriteDialog(recipeId) {
  const recipe = state.allRecipes.find((item) => item.id === recipeId);
  if (!recipe || !elements.favoriteDialog) return;

  state.favoriteDialogId = recipeId;
  elements.favoriteRecipeTitle.textContent = recipe.title || 'Untitled recipe';
  updateFavoriteDialog();
  elements.favoriteDialog.hidden = false;
}

function updateFavoriteDialog() {
  if (!state.favoriteDialogId || !elements.favoriteDialog) return;
  const record = state.favorites.get(state.favoriteDialogId)
    || RecipeFavorites.emptyFavorite(state.favoriteDialogId);

  setToggleButton(elements.favoriteGlobal, record.globalFavorite, 'On', 'Off');
  setToggleButton(elements.favoriteMe, record.myFavorite, 'On', 'Off');
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
  elements.detailImage.src = imageUrlFor(recipe.imageId);
  elements.detailImage.onerror = () => { elements.detailImage.src = '/app-icon-v12.png'; };
  elements.detailTitle.textContent = recipe.title || 'Untitled recipe';
  elements.detailDescription.textContent = recipe.description || '';
  elements.detailDescription.hidden = !recipe.description;

  const favorite = favoriteFor(recipe);
  const favoriteScopes = [];
  if (favorite.globalFavorite) favoriteScopes.push('Everyone');
  if (favorite.myFavorite) favoriteScopes.push('For Me');

  elements.detailMeta.innerHTML = '';
  const metaItems = [
    ['Prep', recipe.prepTime],
    ['Cook / total', recipe.cookTime],
    ['Servings', recipe.servings],
    ['Favorite', favoriteScopes.length ? `Yes (${favoriteScopes.join(', ')})` : 'No'],
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

function shareablePhotoFile(recipe) {
  if (!recipe || !recipe.imageId) return null;
  const record = state.imageBlobs.get(recipe.imageId);
  if (!record || !record.blob || typeof File === 'undefined') return null;

  const mime = record.mime || record.blob.type || 'image/jpeg';
  let file;
  try {
    file = new File([record.blob], RecipeShare.photoFileName(recipe.title, mime), {
      type: mime,
      lastModified: Date.now()
    });
    if (typeof navigator.canShare === 'function' && !navigator.canShare({ files: [file] })) {
      return null;
    }
  } catch (err) {
    return null;
  }

  return file;
}

async function copyToClipboard(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.top = '-1000px';
  textarea.style.opacity = '0';
  document.body.append(textarea);
  textarea.select();

  try {
    if (!document.execCommand('copy')) throw new Error('Copy was blocked.');
  } finally {
    textarea.remove();
  }
}

async function shareCurrentRecipe() {
  const recipe = state.allRecipes.find((item) => item.id === state.detailId);
  if (!recipe) return;

  const title = `Diane's Recipes — ${recipe.title || 'Untitled recipe'}`;
  const text = RecipeShare.recipeShareText(recipe);
  const file = shareablePhotoFile(recipe);

  if (typeof navigator.share === 'function') {
    try {
      const payload = file ? { title, text, files: [file] } : { title, text };
      await navigator.share(payload);
      setStatus('Recipe shared.');
      return;
    } catch (err) {
      if (err && err.name === 'AbortError') return;

      if (file) {
        try {
          await navigator.share({ title, text });
          setStatus('Recipe shared.');
          return;
        } catch (retryError) {
          if (retryError && retryError.name === 'AbortError') return;
        }
      }
    }
  }

  try {
    await copyToClipboard(text);
    setStatus('Recipe copied — paste to share.');
  } catch (err) {
    setStatus(`Could not share recipe: ${err.message}`, true);
  }
}

function updateEditorFavoriteButtons() {
  setToggleButton(
    elements.editorFavoriteGlobal,
    state.editorFavorites.globalFavorite,
    'Everyone: On',
    'Everyone: Off'
  );
  setToggleButton(
    elements.editorFavoriteMe,
    state.editorFavorites.myFavorite,
    'For Me: On',
    'For Me: Off'
  );
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

  const favoriteRecord = recipe
    ? (state.favorites.get(id) || await RecipeDB.get('favorites', id))
    : null;
  state.editorFavorites = favoriteRecord
    ? {
      globalFavorite: Boolean(favoriteRecord.globalFavorite),
      myFavorite: Boolean(favoriteRecord.myFavorite)
    }
    : {
      globalFavorite: Boolean(source.favorite),
      myFavorite: false
    };
  updateEditorFavoriteButtons();

  if (state.pendingImage) {
    elements.editorImage.src = URL.createObjectURL(state.pendingImage.blob);
  } else if (source.imageId && state.localImageUrls.has(source.imageId)) {
    elements.editorImage.src = state.localImageUrls.get(source.imageId);
  } else if (source.imageId) {
    elements.editorImage.src = `/api/images/${encodeURIComponent(source.imageId)}`;
  } else {
    elements.editorImage.src = '/app-icon-v12.png';
  }
  elements.editorImage.onerror = () => { elements.editorImage.src = '/app-icon-v12.png'; };

  document.getElementById('field-title').value = source.title || '';
  document.getElementById('field-description').value = source.description || '';
  document.getElementById('field-prep').value = source.prepTime || '';
  document.getElementById('field-cook').value = source.cookTime || source.totalTime || '';
  document.getElementById('field-servings').value = source.servings || '';
  document.getElementById('field-categories').value = (source.categories || []).join(', ');
  document.getElementById('field-ingredients').value = (source.ingredients || []).join('\n');
  document.getElementById('field-directions').value = (source.directions || []).join('\n');
  document.getElementById('field-notes').value = source.notes || '';
  document.getElementById('field-url').value = source.sourceUrl || '';
  elements.imageInput.value = '';
  elements.editorImageUrl.value = '';

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
  elements.importImage.src = '/app-icon-v12.png';
  elements.importImageStatus.textContent = 'No photo detected';
  elements.importImageInput.value = '';
  elements.importImageUrl.value = '';
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

function isImageType(type) {
  return String(type || '').toLowerCase().startsWith('image/');
}

async function syncAuthHeaders() {
  const token = await RecipeDB.getSetting('syncToken', '');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function fetchImageBlobFromUrl(url) {
  const clean = String(url || '').trim();
  if (!/^https?:\/\//i.test(clean)) {
    throw new Error('Enter an http or https image URL.');
  }

  const response = await fetch(`/api/fetch-image?url=${encodeURIComponent(clean)}`, {
    headers: await syncAuthHeaders()
  });

  if (!response.ok) {
    let message = `Image URL rejected (${response.status}).`;
    try {
      const data = await response.json();
      if (data && data.error) message = data.error;
    } catch {}
    throw new Error(message);
  }

  const blob = await response.blob();
  if (!isImageType(blob.type)) {
    throw new Error('The URL did not return an image.');
  }

  return { blob, url: clean };
}

async function addImageFromUrl(url, announce = true) {
  const { blob, url: clean } = await fetchImageBlobFromUrl(url);
  await setImportImage(blob, blob.type);
  elements.importImageUrl.value = clean;
  if (announce) setStatus('Photo added from URL.');
  return blob;
}

async function addEditorImageFromUrl(url) {
  const { blob, url: clean } = await fetchImageBlobFromUrl(url);
  await setPendingImage(blob, blob.type);
  elements.editorImageUrl.value = clean;
  setStatus('Recipe photo added from URL. Save to keep it.');
  return blob;
}

async function pasteFromClipboard() {
  let textPasted = false;
  let photoPasted = false;

  try {
    const text = await navigator.clipboard.readText();
    if (text) {
      elements.importText.value = text;
      textPasted = true;
    }
  } catch {}

  if (navigator.clipboard && navigator.clipboard.read && typeof window.ClipboardItem !== 'undefined') {
    try {
      const items = await navigator.clipboard.read();
      for (const item of items) {
        const imageType = (item.types || []).find(isImageType);
        if (!imageType) continue;
        const blob = await item.getType(imageType);
        await setImportImage(blob, imageType);
        photoPasted = true;
        break;
      }
    } catch {}
  }

  if (photoPasted) {
    setStatus(textPasted
      ? 'Clipboard text and photo pasted.'
      : 'Clipboard photo added. Paste the text manually if needed.');
  } else {
    setStatus(
      textPasted
        ? 'Clipboard text pasted.'
        : 'Clipboard text/photo unavailable. Tap the text box and paste, or choose a photo.',
      !textPasted
    );
  }
}

async function handleImportPaste(event) {
  const clipboard = event.clipboardData || window.clipboardData;
  if (!clipboard) return;

  const images = [];
  const files = clipboard.files ? Array.from(clipboard.files) : [];
  for (const file of files) {
    if (isImageType(file.type)) images.push({ blob: file, mime: file.type });
  }

  const items = clipboard.items ? Array.from(clipboard.items) : [];
  for (const item of items) {
    if (item.kind !== 'file' || !isImageType(item.type)) continue;
    const file = item.getAsFile();
    if (file) images.push({ blob: file, mime: file.type || item.type });
  }

  if (clipboard.getData) {
    const html = clipboard.getData('text/html') || '';
    const plain = clipboard.getData('text/plain') || '';

    if (!elements.importImageUrl.value) {
      const remoteImage = html.match(/<img[^>]+src=["'](https?:[^"']+)["']/i)
        || plain.match(/^\s*(?:image|photo|picture)\s*:\s*(https?:\/\/\S+)/im);
      if (remoteImage) {
        elements.importImageUrl.value = remoteImage[1];
        setStatus('Image URL found. Tap Add from URL to attach it.');
      }
    }

    const dataImage = html.match(/<img[^>]+src=["'](data:image\/[^"']+)["']/i);
    if (dataImage) {
      try {
        const response = await fetch(dataImage[1]);
        const blob = await response.blob();
        images.push({ blob, mime: blob.type || 'image/jpeg' });
      } catch {}
    }
  }

  if (!images.length) return;

  await setImportImage(images[0].blob, images[0].mime);
  setStatus('Clipboard photo added.');
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

  if (!elements.importImageUrl.value && parsed.imageUrl) {
    elements.importImageUrl.value = parsed.imageUrl;
  }

  let imageError = '';
  const imageUrl = elements.importImageUrl.value.trim();
  if (imageUrl && !state.importImage) {
    try {
      await addImageFromUrl(imageUrl, false);
    } catch (err) {
      imageError = err.message;
    }
  }

  const photoReady = Boolean(state.importImage);
  await openEditor(null, { draft: parsed, pendingImage: state.importImage });

  state.importImage = null;
  elements.importText.value = '';
  elements.importImageUrl.value = '';
  elements.importImage.hidden = true;
  elements.importImage.src = '/app-icon-v12.png';
  elements.importImageStatus.textContent = 'No photo detected';

  const summary = `Imported: ${importSummary(parsed, photoReady)}. Review before saving.`;
  setStatus(imageError ? `${summary} Image URL failed: ${imageError}` : summary, Boolean(imageError));
}

function sameArray(a, b) {
  return JSON.stringify(a || []) === JSON.stringify(b || []);
}

function recipeContentChanged(existing, next) {
  if (!existing) return true;

  const fields = [
    'title',
    'description',
    'prepTime',
    'cookTime',
    'servings',
    'notes',
    'sourceUrl',
    'imageId'
  ];

  if (fields.some((field) => String(existing[field] || '') !== String(next[field] || ''))) {
    return true;
  }

  return !sameArray(existing.ingredients, next.ingredients)
    || !sameArray(existing.directions, next.directions)
    || !sameArray(existing.categories, next.categories);
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
  const recipeId = existing ? existing.id : SyncEngine.newId();
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

  const currentFavorite = await RecipeDB.get('favorites', recipeId)
    || RecipeFavorites.emptyFavorite(recipeId);

  const recipe = {
    id: recipeId,
    serverId: existing ? existing.serverId || null : null,
    rev: existing ? existing.rev || 0 : 0,
    title,
    description: String(data.get('description') || ''),
    prepTime: String(data.get('prepTime') || ''),
    cookTime: String(data.get('cookTime') || ''),
    servings: String(data.get('servings') || ''),
    favorite: false,
    rating: existing ? existing.rating || 0 : 0,
    notes: String(data.get('notes') || ''),
    ingredients: splitLines(data.get('ingredients')),
    directions: splitLines(data.get('directions')),
    categories: splitCategories(data.get('categories')),
    sourceUrl: String(data.get('sourceUrl') || ''),
    imageId,
    dateAdded: existing ? existing.dateAdded : timestamp,
    dateModified: existing ? existing.dateModified : timestamp,
    deleted: false,
    deletedAt: null,
    updatedAt: existing ? existing.updatedAt : timestamp,
    dirty: existing ? Boolean(existing.dirty) : true
  };

  const contentChanged = recipeContentChanged(existing, recipe);
  if (contentChanged) {
    recipe.dateModified = timestamp;
    recipe.updatedAt = timestamp;
    recipe.dirty = true;
    await RecipeDB.put('recipes', recipe);
    await enqueueRecipeMutation(recipe, existing ? 'update' : 'create');
  }

  const favoriteChanges = [];
  for (const [scope, key] of [['global', 'globalFavorite'], ['me', 'myFavorite']]) {
    if (Boolean(currentFavorite[key]) !== Boolean(state.editorFavorites[key])) {
      favoriteChanges.push({ scope, favorite: Boolean(state.editorFavorites[key]) });
    }
  }

  for (const change of favoriteChanges) {
    await queueFavoriteChange(recipeId, change.scope, change.favorite);
  }

  state.pendingImage = null;
  state.pendingImageRemoved = false;
  state.editingId = null;
  elements.editor.hidden = true;
  await loadRecipes();

  if (!contentChanged && !favoriteChanges.length) {
    setStatus('No changes to save.');
    return;
  }

  await syncAfterLocalChange('Recipe saved');
}

async function deleteRecipe() {
  const id = state.detailId;
  if (!id) return;
  if (!window.confirm('Delete this recipe? It will also be removed from other devices when synced.')) return;

  const recipe = await RecipeDB.get('recipes', id);
  if (!recipe) return;

  const outbox = await RecipeDB.getAll('outbox');
  const pendingCreate = outbox.find((mutation) =>
    mutation.entityId === id && mutation.op === 'create'
  );

  const favoriteOutbox = await RecipeDB.getAll('favoriteOutbox');
  for (const mutation of favoriteOutbox) {
    if (mutation.recipeId === id) await RecipeDB.remove('favoriteOutbox', mutation.id);
  }
  await RecipeDB.remove('favorites', id);

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
  await syncAfterLocalChange('Recipe deleted');
}

async function runSync() {
  await withSyncLock(async () => {
    try {
      await SyncEngine.syncNow((message) => setStatus(message));
      await applyFavoriteStateToRecipes();
      await loadRecipes();
      lastAutoSyncAt = Date.now();
      setStatus('Sync complete.');
    } catch (err) {
      setStatus(`Sync failed: ${err.message}`, true);
    }
  });
}

function updateUserLabel() {
  if (!elements.settingsButton) return;
  elements.settingsButton.title = state.userName
    ? `Settings (${state.userName})`
    : 'Settings';
}

async function loadUserProfile() {
  state.userName = (await RecipeDB.getSetting('userName', '')) || '';
  state.userKey = (await RecipeDB.getSetting('userKey', '')) || '';
  updateUserLabel();

  if (!state.userName || !state.userKey) {
    if (elements.welcome) {
      elements.welcomeName.value = '';
      elements.welcome.hidden = false;
      elements.welcomeName.focus();
    }
    return false;
  }

  return true;
}

async function queueRenameUser(oldUserKey, newUserKey, displayName) {
  const outbox = await RecipeDB.getAll('favoriteOutbox');
  const pending = outbox.find((mutation) => mutation.op === 'rename');
  const mutation = pending || RecipeFavorites.renameMutation({
    id: SyncEngine.newId(),
    oldUserKey,
    newUserKey,
    displayName
  });

  mutation.oldUserKey = oldUserKey;
  mutation.newUserKey = newUserKey;
  mutation.displayName = displayName;
  mutation.updatedAt = nowIso();
  mutation.lastError = null;
  await RecipeDB.put('favoriteOutbox', mutation);
}

function openSettings() {
  if (!elements.settings) return;
  elements.settingsName.value = state.userName;
  elements.settings.hidden = false;
  elements.settingsName.focus();
}

async function saveUserName(rawName, firstLaunch = false) {
  const name = RecipeFavorites.displayName(rawName);
  if (!name) {
    setStatus('Enter a name first.', true);
    return false;
  }

  const newKey = RecipeFavorites.userKeyFromName(name);
  const oldKey = state.userKey;

  await RecipeDB.setSetting('userName', name);
  await RecipeDB.setSetting('userKey', newKey);
  state.userName = name;
  state.userKey = newKey;
  updateUserLabel();

  if (elements.welcome) elements.welcome.hidden = true;
  if (elements.settings) elements.settings.hidden = true;

  if (oldKey && oldKey !== newKey) {
    await RecipeDB.setSetting('favoritesCursor', '');

    const favoriteOutbox = await RecipeDB.getAll('favoriteOutbox');
    for (const mutation of favoriteOutbox) {
      if (mutation.op !== 'favorite') continue;
      mutation.userKey = newKey;
      mutation.clientId = newKey;
      mutation.updatedAt = nowIso();
      await RecipeDB.put('favoriteOutbox', mutation);
    }

    await queueRenameUser(oldKey, newKey, name);
  }

  await loadRecipes();
  await syncAfterLocalChange(firstLaunch ? 'Name saved' : 'Name saved');
  return true;
}

function bindEvents() {
  elements.syncButton.addEventListener('click', runSync);
  elements.settingsButton.addEventListener('click', openSettings);
  elements.welcomeSave.addEventListener('click', () => {
    saveUserName(elements.welcomeName.value, true).catch((err) =>
      setStatus(`Could not save name: ${err.message}`, true)
    );
  });
  elements.welcomeName.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') elements.welcomeSave.click();
  });
  elements.settingsSave.addEventListener('click', () => {
    saveUserName(elements.settingsName.value).catch((err) =>
      setStatus(`Could not save name: ${err.message}`, true)
    );
  });
  elements.settingsName.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') elements.settingsSave.click();
  });
  elements.favoriteGlobal.addEventListener('click', () => {
    setRecipeFavorite(state.favoriteDialogId, 'global', !state.favorites.get(state.favoriteDialogId || '')?.globalFavorite);
  });
  elements.favoriteMe.addEventListener('click', () => {
    setRecipeFavorite(state.favoriteDialogId, 'me', !state.favorites.get(state.favoriteDialogId || '')?.myFavorite);
  });
  elements.favoriteDone.addEventListener('click', () => {
    elements.favoriteDialog.hidden = true;
    state.favoriteDialogId = null;
  });
  elements.editorFavoriteGlobal.addEventListener('click', () => {
    state.editorFavorites.globalFavorite = !state.editorFavorites.globalFavorite;
    updateEditorFavoriteButtons();
  });
  elements.editorFavoriteMe.addEventListener('click', () => {
    state.editorFavorites.myFavorite = !state.editorFavorites.myFavorite;
    updateEditorFavoriteButtons();
  });
  elements.importButton.addEventListener('click', openImport);
  elements.pasteButton.addEventListener('click', pasteFromClipboard);
  elements.parseButton.addEventListener('click', parseImport);
  elements.import.addEventListener('paste', handleImportPaste);
  elements.importImageInput.addEventListener('change', async (event) => {
    const file = event.target.files && event.target.files[0];
    if (!file) return;
    await setImportImage(file, file.type);
    setStatus('Photo chosen.');
  });
  elements.fetchImageButton.addEventListener('click', async () => {
    try {
      await addImageFromUrl(elements.importImageUrl.value);
    } catch (err) {
      setStatus(err.message, true);
    }
  });
  elements.editorFetchImageButton.addEventListener('click', async () => {
    try {
      await addEditorImageFromUrl(elements.editorImageUrl.value);
    } catch (err) {
      setStatus(err.message, true);
    }
  });
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
    elements.editorImage.src = '/app-icon-v12.png';
    elements.imageInput.value = '';
    elements.editorImageUrl.value = '';
  });

  elements.form.addEventListener('submit', saveRecipe);
  elements.detailShare.addEventListener('click', shareCurrentRecipe);
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
  window.addEventListener('online', () => {
    setStatus('Back online. Syncing...');
    autoSync('after reconnecting');
  });

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) autoSync('after returning to the app');
  });
  window.addEventListener('pageshow', (event) => {
    if (event.persisted) autoSync('after returning to the app');
  });

  window.setInterval(() => autoSync('automatically'), AUTO_SYNC_INTERVAL_MS);
}

async function initialize() {
  setStatus('Loading recipes...');
  registerServiceWorker();
  await RecipeDB.open();
  bindEvents();
  const hasProfile = await loadUserProfile();
  await seedLocalFavoritesFromRecipes();
  await loadConfig();
  await loadRecipes();

  if (!state.allRecipes.length) {
    await RecipeDB.setSyncState('cursor', '');
    await RecipeDB.setSetting('favoritesCursor', '');
  }

  if (!hasProfile) {
    setStatus('Enter a name to finish setup.');
    return;
  }

  if (navigator.onLine) {
    await autoSync('on open');
  } else {
    setStatus('Offline — using cached recipes.', true);
  }
}

initialize().catch((err) => setStatus(`Startup failed: ${err.message}`, true));
