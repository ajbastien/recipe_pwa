(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.RecipeFavorites = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function cleanName(value) {
    return String(value == null ? '' : value).trim().replace(/\s+/g, ' ');
  }

  function displayName(value) {
    return cleanName(value).slice(0, 80);
  }

  function userKeyFromName(value) {
    return cleanName(value).toLocaleLowerCase();
  }

  function emptyFavorite(recipeId) {
    return {
      recipeId,
      globalFavorite: false,
      myFavorite: false,
      updatedAt: ''
    };
  }

  function isRecipeFavorite(record) {
    return Boolean(record && (record.globalFavorite || record.myFavorite));
  }

  function setScope(record, scope, favorite) {
    const next = Object.assign(emptyFavorite(record && record.recipeId), record || {});
    next.updatedAt = new Date().toISOString();
    if (scope === 'global') next.globalFavorite = Boolean(favorite);
    if (scope === 'me') next.myFavorite = Boolean(favorite);
    return next;
  }

  function applyServerRow(record, row) {
    const next = Object.assign(emptyFavorite(row && row.recipeId), record || {});
    next.recipeId = row.recipeId;
    if (row.scope === 'global') next.globalFavorite = Boolean(row.favorite);
    if (row.scope === 'me') next.myFavorite = Boolean(row.favorite);
    next.updatedAt = row.updatedAt || next.updatedAt || '';
    return next;
  }

  function favoriteMutation(options) {
    return {
      id: options.id,
      entity: 'favorite',
      op: 'favorite',
      entityId: options.recipeId,
      recipeId: options.recipeId,
      scope: options.scope,
      favorite: Boolean(options.favorite),
      clientId: options.userKey,
      userKey: options.userKey,
      createdAt: options.createdAt || new Date().toISOString(),
      updatedAt: options.createdAt || new Date().toISOString(),
      attempts: 0,
      lastError: null
    };
  }

  function renameMutation(options) {
    return {
      id: options.id,
      entity: 'user',
      op: 'rename',
      entityId: options.newUserKey,
      clientId: options.oldUserKey,
      oldUserKey: options.oldUserKey,
      newUserKey: options.newUserKey,
      displayName: options.displayName,
      createdAt: options.createdAt || new Date().toISOString(),
      updatedAt: options.createdAt || new Date().toISOString(),
      attempts: 0,
      lastError: null
    };
  }

  return {
    applyServerRow,
    displayName,
    emptyFavorite,
    favoriteMutation,
    isRecipeFavorite,
    renameMutation,
    setScope,
    userKeyFromName
  };
});
