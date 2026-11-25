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
  editorFavorites: { globalFavorite: false, myFavorite: false },
  duplicates: [],
  dismissedDuplicates: [],
  comparePair: null,
  compareSelections: {}
};

const AUTO_SYNC_INTERVAL_MS = 10 * 60 * 1000;
const AUTO_SYNC_MIN_GAP_MS = 30 * 1000;
let syncInFlight = false;
let lastAutoSyncAt = 0;
let messageBoxResolver = null;
let messageBoxPreviousFocus = null;

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
  dedupeButton: document.getElementById('dedupe-btn'),
  importButton: document.getElementById('import-btn'),
  addButton: document.getElementById('add-btn'),
  duplicates: document.getElementById('duplicates'),
  duplicatesSummary: document.getElementById('duplicates-summary'),
  duplicatesList: document.getElementById('duplicates-list'),
  clearDuplicateIgnores: document.getElementById('clear-duplicate-ignores'),
  compare: document.getElementById('compare'),
  compareSummary: document.getElementById('compare-summary'),
  compareReasons: document.getElementById('compare-reasons'),
  compareGrid: document.getElementById('compare-grid'),
  compareMergeA: document.getElementById('compare-merge-a'),
  compareMergeB: document.getElementById('compare-merge-b'),
  compareCancel: document.getElementById('compare-cancel'),
  messageBox: document.getElementById('message-box'),
  messageBoxCard: document.getElementById('message-box-card'),
  messageBoxIcon: document.getElementById('message-box-icon'),
  messageBoxTitle: document.getElementById('message-box-title'),
  messageBoxDetail: document.getElementById('message-box-detail'),
  messageBoxPrimary: document.getElementById('message-box-primary'),
  messageBoxSecondary: document.getElementById('message-box-secondary'),
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

function messageBoxLabels(buttons) {
  if (buttons === 'yesNo') return { primary: 'Yes', secondary: 'No' };
  return { primary: 'OK', secondary: 'Cancel' };
}

function openMessageBox(options = {}) {
  if (messageBoxResolver) closeMessageBox(false);

  const buttons = options.buttons === 'yesNo' ? 'yesNo' : 'okCancel';
  const labels = messageBoxLabels(buttons);
  const tone = ['danger', 'warning', 'info'].includes(options.tone) ? options.tone : 'warning';
  const icons = { danger: '!', warning: '?', info: 'i' };

  return new Promise((resolve) => {
    messageBoxResolver = resolve;
    messageBoxPreviousFocus = document.activeElement;

    elements.messageBoxCard.dataset.tone = tone;
    elements.messageBoxIcon.textContent = icons[tone];
    elements.messageBoxTitle.textContent = options.title || 'Please confirm';
    elements.messageBoxDetail.textContent = options.detail || options.message || '';
    elements.messageBoxPrimary.textContent = options.primaryLabel || labels.primary;
    elements.messageBoxSecondary.textContent = options.secondaryLabel || labels.secondary;
    elements.messageBoxPrimary.className = 'button message-affirm';
    elements.messageBoxSecondary.className = 'button message-dismiss message-default';
    elements.messageBox.hidden = false;

    elements.messageBoxSecondary.focus();
  });
}

function closeMessageBox(result) {
  if (!messageBoxResolver) return;

  const resolve = messageBoxResolver;
  messageBoxResolver = null;
  elements.messageBox.hidden = true;

  if (messageBoxPreviousFocus && document.contains(messageBoxPreviousFocus)) {
    messageBoxPreviousFocus.focus();
  }
  messageBoxPreviousFocus = null;
  resolve(Boolean(result));
}

function askYesNo(title, detail, options = {}) {
  return openMessageBox({ ...options, buttons: 'yesNo', title, detail });
}

function askOkCancel(title, detail, options = {}) {
  return openMessageBox({ ...options, buttons: 'okCancel', title, detail });
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

  const recipe = await RecipeDB.get('recipes', id);
  if (!recipe) return;

  const confirmed = await askYesNo(
    'Delete recipe?',
    `Delete "${recipe.title || 'Untitled recipe'}"? It will also be removed from other devices when synced.`,
    { tone: 'danger', destructive: true }
  );
  if (!confirmed) return;

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

function compareFields() {
  return [
    { key: 'title', label: 'Title' },
    { key: 'description', label: 'Description' },
    { key: 'prepTime', label: 'Prep time' },
    { key: 'cookTime', label: 'Cook / total time' },
    { key: 'servings', label: 'Servings' },
    { key: 'imageId', label: 'Photo' },
    { key: 'ingredients', label: 'Ingredients', both: true },
    { key: 'directions', label: 'Instructions', both: true },
    { key: 'notes', label: 'Notes', both: true },
    { key: 'categories', label: 'Categories', both: true },
    { key: 'sourceUrl', label: 'Source URL' }
  ];
}

async function loadDismissedDuplicates() {
  const value = await RecipeDB.getSetting('dismissedDuplicatePairs', []);
  state.dismissedDuplicates = Array.isArray(value) ? value.map(String) : [];
}

function duplicatePairMeta(pair) {
  return `${pair.score}% match · ${pair.confidence} confidence · ${pair.reasons.join(' · ')}`;
}

function renderDuplicates() {
  if (!elements.duplicatesList) return;

  elements.duplicatesList.innerHTML = '';
  const pairCount = state.duplicates.reduce((total, group) => total + group.pairs.length, 0);

  if (!pairCount) {
    elements.duplicatesSummary.textContent = 'No likely duplicates found. Recipes with very different titles and ingredients are not shown.';
    return;
  }

  elements.duplicatesSummary.textContent = `${pairCount} possible ${pairCount === 1 ? 'pair' : 'pairs'} in ${state.duplicates.length} ${state.duplicates.length === 1 ? 'group' : 'groups'}. Review each pair before merging.`;

  for (const group of state.duplicates) {
    const card = document.createElement('div');
    card.className = 'duplicate-group';

    const heading = document.createElement('h3');
    heading.textContent = `${group.recipes.length} connected recipes`;
    card.append(heading);

    for (const pair of group.pairs) {
      const row = document.createElement('div');
      row.className = 'duplicate-pair';

      const info = document.createElement('div');
      const title = document.createElement('strong');
      title.textContent = `${pair.a.title || 'Untitled recipe'} ↔ ${pair.b.title || 'Untitled recipe'}`;
      const meta = document.createElement('p');
      meta.className = 'duplicate-pair-meta';
      meta.textContent = duplicatePairMeta(pair);
      info.append(title, meta);

      const actions = document.createElement('div');
      actions.className = 'duplicate-pair-actions';

      const compareButton = document.createElement('button');
      compareButton.type = 'button';
      compareButton.className = 'button primary';
      compareButton.textContent = 'Compare & merge';
      compareButton.addEventListener('click', () => openCompare(pair));

      const ignoreButton = document.createElement('button');
      ignoreButton.type = 'button';
      ignoreButton.className = 'button ghost';
      ignoreButton.textContent = 'Ignore';
      ignoreButton.addEventListener('click', () => {
        ignoreDuplicatePair(pair).catch((err) => setStatus(`Could not ignore pair: ${err.message}`, true));
      });

      actions.append(compareButton, ignoreButton);
      row.append(info, actions);
      card.append(row);
    }

    elements.duplicatesList.append(card);
  }
}

async function openDuplicates() {
  if (!elements.duplicates) return;

  setStatus('Looking for possible duplicates...');
  await loadDismissedDuplicates();
  state.duplicates = RecipeDedupe.findDuplicates(state.allRecipes, {
    dismissed: state.dismissedDuplicates
  });

  renderDuplicates();
  elements.duplicates.hidden = false;

  const pairCount = state.duplicates.reduce((total, group) => total + group.pairs.length, 0);
  setStatus(pairCount
    ? `Found ${pairCount} possible duplicate ${pairCount === 1 ? 'pair' : 'pairs'}.`
    : 'No likely duplicates found.');
}

async function ignoreDuplicatePair(pair) {
  if (!state.dismissedDuplicates.includes(pair.key)) {
    state.dismissedDuplicates.push(pair.key);
  }
  await RecipeDB.setSetting('dismissedDuplicatePairs', state.dismissedDuplicates);
  await openDuplicates();
  setStatus('Duplicate pair ignored.');
}

async function clearIgnoredDuplicates() {
  state.dismissedDuplicates = [];
  await RecipeDB.setSetting('dismissedDuplicatePairs', state.dismissedDuplicates);
  await openDuplicates();
  setStatus('Ignored duplicate pairs cleared.');
}

function compareValue(recipe, field) {
  const value = document.createElement('p');
  value.className = 'compare-value';

  if (field === 'imageId') {
    if (!recipe.imageId) {
      value.textContent = 'No photo';
      return value;
    }
    const image = document.createElement('img');
    image.src = imageUrlFor(recipe.imageId);
    image.alt = '';
    image.onerror = () => { image.src = '/app-icon-v12.png'; };
    value.append(image);
    return value;
  }

  const raw = recipe[field];
  if (Array.isArray(raw)) {
    value.textContent = raw.length ? raw.map((item) => `• ${item}`).join('\n') : 'Empty';
  } else {
    value.textContent = String(raw || '').trim() || 'Empty';
  }
  return value;
}

function renderCompare() {
  if (!state.comparePair || !elements.compareGrid) return;

  const pair = state.comparePair;
  elements.compareSummary.textContent = `${pair.a.title || 'Untitled recipe'} compared with ${pair.b.title || 'Untitled recipe'}`;
  elements.compareReasons.textContent = duplicatePairMeta(pair);
  elements.compareGrid.innerHTML = '';

  for (const field of compareFields()) {
    const row = document.createElement('div');
    row.className = 'compare-row';

    const label = document.createElement('div');
    label.className = 'compare-label';
    label.textContent = field.label;
    row.append(label);

    for (const side of ['a', 'b']) {
      const recipe = side === 'a' ? pair.a : pair.b;
      const column = document.createElement('div');
      column.className = 'compare-side';

      const heading = document.createElement('h4');
      heading.textContent = `${side.toUpperCase()} — ${recipe.title || 'Untitled recipe'}`;

      const choices = document.createElement('div');
      choices.className = 'compare-choices';
      const options = field.both ? ['a', 'b', 'both'] : ['a', 'b'];

      for (const choice of options) {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = choice === 'both' ? 'Both' : choice.toUpperCase();
        button.dataset.field = field.key;
        button.dataset.choice = choice;
        choices.append(button);
      }

      column.append(heading, compareValue(recipe, field.key), choices);
      row.append(column);
    }

    elements.compareGrid.append(row);
  }

  updateCompareChoices();
}

function updateCompareChoices() {
  if (!elements.compareGrid) return;
  for (const button of elements.compareGrid.querySelectorAll('button[data-field][data-choice]')) {
    const selected = state.compareSelections[button.dataset.field] === button.dataset.choice;
    button.setAttribute('aria-pressed', String(selected));
  }
}

function handleCompareChoice(event) {
  const button = event.target.closest('button[data-field][data-choice]');
  if (!button || !elements.compareGrid.contains(button)) return;
  state.compareSelections[button.dataset.field] = button.dataset.choice;
  updateCompareChoices();
}

function openCompare(pair) {
  state.comparePair = pair;
  state.compareSelections = RecipeDedupe.suggestSelections(pair.a, pair.b);
  renderCompare();
  if (elements.duplicates) elements.duplicates.hidden = true;
  if (elements.compare) elements.compare.hidden = false;
}

function backToDuplicates() {
  if (elements.compare) elements.compare.hidden = true;
  if (elements.duplicates) elements.duplicates.hidden = false;
  state.comparePair = null;
}

async function mergeDuplicateFavorites(keeper, other) {
  const keeperRecord = await RecipeDB.get('favorites', keeper.id)
    || RecipeFavorites.emptyFavorite(keeper.id);
  const otherRecord = await RecipeDB.get('favorites', other.id)
    || RecipeFavorites.emptyFavorite(other.id);
  const union = RecipeDedupe.unionFavorites(keeperRecord, otherRecord);
  union.recipeId = keeper.id;
  union.updatedAt = nowIso();

  if (union.globalFavorite || union.myFavorite) {
    await RecipeDB.put('favorites', union);
  }

  for (const [scope, key] of [['global', 'globalFavorite'], ['me', 'myFavorite']]) {
    if (Boolean(keeperRecord[key]) !== Boolean(union[key])) {
      await queueFavoriteChange(keeper.id, scope, Boolean(union[key]));
    }
  }
}

async function removeDuplicateRecipe(recipe, keeperImageId) {
  const timestamp = nowIso();
  const outbox = await RecipeDB.getAll('outbox');
  const recipeMutations = outbox.filter((mutation) =>
    (mutation.entity === 'recipe' || ['create', 'update', 'delete'].includes(mutation.op))
    && mutation.entityId === recipe.id
  );
  const pendingCreate = recipeMutations.some((mutation) => mutation.op === 'create');
  const unsynced = pendingCreate || !recipe.serverId;

  for (const mutation of recipeMutations) {
    await RecipeDB.remove('outbox', mutation.id);
  }

  const favoriteOutbox = await RecipeDB.getAll('favoriteOutbox');
  for (const mutation of favoriteOutbox) {
    if (mutation.recipeId === recipe.id) await RecipeDB.remove('favoriteOutbox', mutation.id);
  }
  await RecipeDB.remove('favorites', recipe.id);

  if (recipe.imageId && recipe.imageId !== keeperImageId) {
    const imageMutations = outbox.filter((mutation) =>
      (mutation.entity === 'image' || mutation.op === 'image')
      && (mutation.entityId === recipe.imageId || (mutation.payload && mutation.payload.imageId === recipe.imageId))
    );
    for (const mutation of imageMutations) {
      await RecipeDB.remove('outbox', mutation.id);
    }
  }

  if (unsynced) {
    await RecipeDB.remove('recipes', recipe.id);
    return;
  }

  recipe.deleted = true;
  recipe.deletedAt = timestamp;
  recipe.updatedAt = timestamp;
  recipe.dirty = true;
  await RecipeDB.put('recipes', recipe);
  await RecipeDB.addMutation({
    id: SyncEngine.newId(),
    entity: 'recipe',
    entityId: recipe.id,
    serverId: recipe.serverId,
    op: 'delete',
    payload: SyncEngine.toServerPayload(recipe),
    baseRev: recipe.rev || 0,
    createdAt: timestamp,
    updatedAt: timestamp,
    attempts: 0,
    lastError: null
  });
}

async function mergeDuplicatePair(keeperId) {
  const pair = state.comparePair;
  if (!pair) return;

  const keeper = pair.a.id === keeperId ? pair.a : pair.b;
  const other = pair.a.id === keeperId ? pair.b : pair.a;
  const confirmed = await askOkCancel(
    'Merge duplicate recipes?',
    `Merge "${other.title || 'Untitled recipe'}" into "${keeper.title || 'Untitled recipe'}"?\n\nThe other recipe will be removed from this device and from other devices when synced. This cannot be undone.`,
    { tone: 'warning', destructive: true }
  );
  if (!confirmed) return;

  setStatus('Merging recipes...');
  const plan = RecipeDedupe.buildMergePlan(pair.a, pair.b, state.compareSelections, keeperId);
  const merged = RecipeDedupe.applyMergeMetadata(plan, nowIso());

  if (plan.contentChanged) {
    await RecipeDB.put('recipes', merged);
    await enqueueRecipeMutation(merged, merged.serverId ? 'update' : 'create');
  }

  await mergeDuplicateFavorites(plan.keeper, plan.other);
  await removeDuplicateRecipe(plan.other, merged.imageId);

  if (elements.compare) elements.compare.hidden = true;
  if (elements.duplicates) elements.duplicates.hidden = true;
  state.comparePair = null;

  await loadRecipes();
  await syncAfterLocalChange('Recipes merged');
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
  elements.messageBoxPrimary.addEventListener('click', () => closeMessageBox(true));
  elements.messageBoxSecondary.addEventListener('click', () => closeMessageBox(false));
  elements.messageBox.addEventListener('click', (event) => {
    if (event.target === elements.messageBox) closeMessageBox(false);
  });
  document.addEventListener('keydown', (event) => {
    if (!messageBoxResolver) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      closeMessageBox(false);
      return;
    }
    if (event.key === 'Enter' && !event.target.closest('button')) {
      event.preventDefault();
      closeMessageBox(false);
    }
  });

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
  elements.dedupeButton.addEventListener('click', () => {
    openDuplicates().catch((err) => setStatus(`Could not find duplicates: ${err.message}`, true));
  });
  elements.clearDuplicateIgnores.addEventListener('click', () => {
    clearIgnoredDuplicates().catch((err) => setStatus(`Could not clear ignored pairs: ${err.message}`, true));
  });
  elements.compareGrid.addEventListener('click', handleCompareChoice);
  elements.compareMergeA.addEventListener('click', () => {
    if (state.comparePair) {
      mergeDuplicatePair(state.comparePair.a.id).catch((err) =>
        setStatus(`Could not merge recipes: ${err.message}`, true)
      );
    }
  });
  elements.compareMergeB.addEventListener('click', () => {
    if (state.comparePair) {
      mergeDuplicatePair(state.comparePair.b.id).catch((err) =>
        setStatus(`Could not merge recipes: ${err.message}`, true)
      );
    }
  });
  elements.compareCancel.addEventListener('click', backToDuplicates);
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
