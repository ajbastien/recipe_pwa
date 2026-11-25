const RECIPE_DB_NAME = 'my-recipes';
const RECIPE_DB_VERSION = 2;

let recipeDbPromise = null;

function openRecipeDb() {
  if (recipeDbPromise) return recipeDbPromise;

  recipeDbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(RECIPE_DB_NAME, RECIPE_DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;

      if (!db.objectStoreNames.contains('recipes')) {
        const recipes = db.createObjectStore('recipes', { keyPath: 'id' });
        recipes.createIndex('serverId', 'serverId', { unique: false });
        recipes.createIndex('updatedAt', 'updatedAt', { unique: false });
        recipes.createIndex('categories', 'categories', { multiEntry: true, unique: false });
      }

      if (!db.objectStoreNames.contains('images')) {
        db.createObjectStore('images', { keyPath: 'imageId' });
      }

      if (!db.objectStoreNames.contains('outbox')) {
        db.createObjectStore('outbox', { keyPath: 'id' });
      }

      if (!db.objectStoreNames.contains('syncState')) {
        db.createObjectStore('syncState', { keyPath: 'name' });
      }

      if (!db.objectStoreNames.contains('settings')) {
        db.createObjectStore('settings', { keyPath: 'name' });
      }

      if (!db.objectStoreNames.contains('favorites')) {
        db.createObjectStore('favorites', { keyPath: 'recipeId' });
      }

      if (!db.objectStoreNames.contains('favoriteOutbox')) {
        db.createObjectStore('favoriteOutbox', { keyPath: 'id' });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

  return recipeDbPromise;
}

function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error || new Error('IndexedDB transaction aborted.'));
    transaction.onerror = () => reject(transaction.error || new Error('IndexedDB transaction failed.'));
  });
}

async function getAll(storeName) {
  const db = await openRecipeDb();
  const transaction = db.transaction(storeName, 'readonly');
  const done = transactionDone(transaction);
  const result = await requestToPromise(transaction.objectStore(storeName).getAll());
  await done;
  return result || [];
}

async function get(storeName, key) {
  const db = await openRecipeDb();
  const transaction = db.transaction(storeName, 'readonly');
  const done = transactionDone(transaction);
  const result = await requestToPromise(transaction.objectStore(storeName).get(key));
  await done;
  return result || null;
}

async function getByIndex(storeName, indexName, key) {
  const db = await openRecipeDb();
  const transaction = db.transaction(storeName, 'readonly');
  const done = transactionDone(transaction);
  const result = await requestToPromise(
    transaction.objectStore(storeName).index(indexName).getAll(key)
  );
  await done;
  return (result && result[0]) || null;
}

async function put(storeName, value) {
  const db = await openRecipeDb();
  const transaction = db.transaction(storeName, 'readwrite');
  transaction.objectStore(storeName).put(value);
  await transactionDone(transaction);
  return value;
}

async function putMany(storeName, values) {
  if (!values.length) return;
  const db = await openRecipeDb();
  const transaction = db.transaction(storeName, 'readwrite');
  const store = transaction.objectStore(storeName);
  for (const value of values) store.put(value);
  await transactionDone(transaction);
}

async function remove(storeName, key) {
  const db = await openRecipeDb();
  const transaction = db.transaction(storeName, 'readwrite');
  transaction.objectStore(storeName).delete(key);
  await transactionDone(transaction);
}

async function clear(storeName) {
  const db = await openRecipeDb();
  const transaction = db.transaction(storeName, 'readwrite');
  transaction.objectStore(storeName).clear();
  await transactionDone(transaction);
}

async function getSetting(name, fallback = null) {
  const row = await get('settings', name);
  return row ? row.value : fallback;
}

async function setSetting(name, value) {
  return put('settings', { name, value });
}

async function getSyncState(name, fallback = null) {
  const row = await get('syncState', name);
  return row ? row.value : fallback;
}

async function setSyncState(name, value) {
  return put('syncState', { name, value });
}

async function addMutation(mutation) {
  return put('outbox', mutation);
}

window.RecipeDB = {
  addMutation,
  clear,
  getAll,
  get,
  getByIndex,
  getSetting,
  getSyncState,
  open: openRecipeDb,
  put,
  putMany,
  remove,
  setSetting,
  setSyncState
};
