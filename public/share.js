(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.RecipeShare = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function clean(value) {
    return String(value == null ? '' : value).trim();
  }

  function asLines(value) {
    if (Array.isArray(value)) return value.map(clean).filter(Boolean);
    return clean(value).split(/\r?\n/).map(clean).filter(Boolean);
  }

  function recipeShareText(recipe) {
    const source = recipe || {};
    const title = clean(source.title) || 'Untitled recipe';
    const parts = [`Diane's Recipes — ${title}`, `Title: ${title}`];
    const description = clean(source.description);

    if (description) parts.push('', description);

    const categories = Array.isArray(source.categories)
      ? source.categories.join(', ')
      : source.categories;

    const metadata = [
      ['Prep Time', source.prepTime],
      ['Total Time', clean(source.totalTime) || source.cookTime],
      ['Servings', source.servings],
      ['Categories', categories],
      ['Source URL', source.sourceUrl]
    ];

    const metaLines = metadata
      .map(([label, value]) => [label, clean(value)])
      .filter(([, value]) => value)
      .map(([label, value]) => `${label}: ${value}`);

    if (metaLines.length) parts.push('', ...metaLines);

    const ingredients = asLines(source.ingredients);
    if (ingredients.length) {
      parts.push('', 'Ingredients', ...ingredients.map((line) => `- ${line}`));
    }

    const directions = asLines(source.directions);
    if (directions.length) {
      parts.push('', 'Instructions', ...directions.map((line, index) => `${index + 1}. ${line}`));
    }

    const notes = clean(source.notes);
    if (notes) parts.push('', 'Notes', notes);

    return `${parts.join('\n').trim()}\n`;
  }

  function photoFileName(title, mime) {
    const extensions = {
      'image/jpeg': 'jpg',
      'image/jpg': 'jpg',
      'image/png': 'png',
      'image/webp': 'webp',
      'image/gif': 'gif',
      'image/heic': 'heic',
      'image/heif': 'heif'
    };

    const base = clean(title)
      .replace(/[\\/:*?"<>|]/g, '-')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 80) || 'recipe';

    return `${base}.${extensions[String(mime || '').toLowerCase()] || 'jpg'}`;
  }

  return {
    photoFileName,
    recipeShareText
  };
});
