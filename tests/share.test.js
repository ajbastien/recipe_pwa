const assert = require('node:assert/strict');
const test = require('node:test');

const RecipeImport = require('../public/import');
const RecipeShare = require('../public/share');

test('share text is self-contained and includes no app URL', () => {
  const text = RecipeShare.recipeShareText({
    title: 'Test Cake',
    description: 'A small cake.',
    prepTime: '10 minutes',
    cookTime: '25 minutes',
    servings: '8 servings',
    categories: ['dessert', 'cake'],
    sourceUrl: 'https://example.com/cake',
    ingredients: ['1 cup flour', '2 eggs'],
    directions: ['Mix.', 'Bake.'],
    notes: 'Keep covered.'
  });

  assert.match(text, /^Diane's Recipes — Test Cake/);
  assert.match(text, /Title: Test Cake/);
  assert.match(text, /A small cake\./);
  assert.match(text, /Prep Time: 10 minutes/);
  assert.match(text, /Total Time: 25 minutes/);
  assert.match(text, /Servings: 8 servings/);
  assert.match(text, /Categories: dessert, cake/);
  assert.match(text, /Source URL: https:\/\/example\.com\/cake/);
  assert.match(text, /Ingredients\n- 1 cup flour\n- 2 eggs/);
  assert.match(text, /Instructions\n1\. Mix\.\n2\. Bake\./);
  assert.match(text, /Notes\nKeep covered\./);
  assert.doesNotMatch(text, /recipesapp|localhost/);
});

test('share text accepts line-based ingredient and direction strings', () => {
  const text = RecipeShare.recipeShareText({
    title: 'Loose Recipe',
    ingredients: '1 cup water\n1 cup sugar',
    directions: 'Stir\nServe'
  });

  assert.match(text, /Ingredients\n- 1 cup water\n- 1 cup sugar/);
  assert.match(text, /Instructions\n1\. Stir\n2\. Serve/);
});

test('share text tolerates an empty recipe', () => {
  assert.equal(
    RecipeShare.recipeShareText(null),
    "Diane's Recipes — Untitled recipe\nTitle: Untitled recipe\n"
  );
});

test('photo file names are sanitized and use the image extension', () => {
  assert.equal(
    RecipeShare.photoFileName('Diane\'s Cake: Trial?', 'image/png'),
    "Diane's Cake- Trial-.png"
  );
  assert.equal(
    RecipeShare.photoFileName('', 'image/heic'),
    'recipe.heic'
  );
});

test('shared recipe text round-trips through the import parser', () => {
  const recipe = {
    title: 'Shared Cake',
    description: 'Sent from one server to another.',
    prepTime: '15 minutes',
    cookTime: '1:00',
    servings: '8 servings',
    categories: ['dessert'],
    sourceUrl: 'https://example.com/shared-cake',
    ingredients: ['1 cup flour', '2 eggs'],
    directions: ['Mix everything.', 'Bake until done.'],
    notes: 'Shared note.'
  };

  const parsed = RecipeImport.parseRecipeText(RecipeShare.recipeShareText(recipe));

  assert.equal(parsed.title, 'Shared Cake');
  assert.equal(parsed.description, 'Sent from one server to another.');
  assert.equal(parsed.prepTime, '15 minutes');
  assert.equal(parsed.totalTime, '1:00');
  assert.equal(parsed.cookTime, '1:00');
  assert.equal(parsed.servings, '8 servings');
  assert.deepEqual(parsed.categories, ['dessert']);
  assert.equal(parsed.sourceUrl, 'https://example.com/shared-cake');
  assert.deepEqual(parsed.ingredients, ['1 cup flour', '2 eggs']);
  assert.deepEqual(parsed.directions, ['Mix everything.', 'Bake until done.']);
  assert.equal(parsed.notes, 'Shared note.');
});

test('import parser understands the legacy Cook / total label', () => {
  const parsed = RecipeImport.parseRecipeText([
    "Diane's Recipes — Legacy Recipe",
    'Cook / total: 1:00',
    '',
    'Ingredients',
    '- 1 cup milk',
    '',
    'Instructions',
    '1. Stir.'
  ].join('\n'));

  assert.equal(parsed.totalTime, '1:00');
  assert.equal(parsed.cookTime, '1:00');
});
