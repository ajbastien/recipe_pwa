const assert = require('node:assert/strict');
const test = require('node:test');

const RecipeDedupe = require('../public/dedupe');

const cookieIngredients = [
  '2 cups flour',
  '1 cup butter',
  '1 cup sugar',
  '2 eggs',
  '1 tsp vanilla',
  '1 cup chocolate chips',
  '1/2 tsp salt',
  '1 tsp baking soda'
];

function baseRecipe(overrides) {
  return {
    id: 'a',
    serverId: 1,
    rev: 3,
    title: 'Chocolate Chip Cookies Recipe',
    description: 'Diane favorite.',
    prepTime: '20 minutes',
    cookTime: '10 minutes',
    servings: '24 cookies',
    favorite: false,
    rating: 2,
    notes: 'Use parchment paper.',
    ingredients: [...cookieIngredients],
    directions: ['Cream butter and sugar.', 'Add eggs and vanilla.', 'Bake at 350.'],
    categories: ['dessert', 'cookies'],
    sourceUrl: 'https://example.com/version-a',
    imageId: 'image-a',
    dateAdded: '2020-01-01T00:00:00.000Z',
    dateModified: '2022-01-01T00:00:00.000Z',
    updatedAt: '2022-01-01T00:00:00.000Z',
    deleted: false,
    deletedAt: null,
    dirty: false,
    ...overrides
  };
}

const cookieA = baseRecipe({});
const cookieB = baseRecipe({
  id: 'b',
  serverId: 2,
  rev: 1,
  title: 'Chocolate Chip Cookies',
  description: 'Family cookie recipe.',
  rating: 5,
  notes: 'Chill the dough.',
  ingredients: [
    '2 cups flour',
    '1 cup butter',
    '1 cup sugar',
    '2 eggs',
    '1 tsp vanilla',
    '1 cup chocolate chips',
    '1/2 tsp salt',
    '1 tsp baking powder'
  ],
  directions: ['Mix everything.', 'Bake until golden.'],
  categories: ['dessert'],
  sourceUrl: 'https://example.com/version-b',
  imageId: 'image-b',
  dateAdded: '2019-01-01T00:00:00.000Z'
});
const stew = baseRecipe({
  id: 'stew',
  serverId: 3,
  title: 'Beef Stew',
  ingredients: ['2 lb beef', '4 carrots', '3 potatoes', '1 onion', '2 cups broth'],
  directions: ['Brown the beef.', 'Simmer for two hours.'],
  categories: ['dinner'],
  sourceUrl: 'https://example.com/stew',
  imageId: null
});

test('title normalization removes punctuation and generic recipe words', () => {
  assert.equal(
    RecipeDedupe.normalizeTitle('Chocolate-Chip Cookies Recipe!'),
    'chocolate chip cookies'
  );
});

test('finds likely duplicate recipes and explains the match', () => {
  const groups = RecipeDedupe.findDuplicates([cookieA, cookieB, stew]);

  assert.equal(groups.length, 1);
  assert.equal(groups[0].recipes.length, 2);

  const pair = groups[0].pairs[0];
  assert.equal(pair.confidence, 'high');
  assert.match(pair.reasons.join(' '), /title/i);
  assert.match(pair.reasons.join(' '), /ingredient/i);
});

test('dismissed pairs stay dismissed', () => {
  const key = RecipeDedupe.pairKey(cookieA.id, cookieB.id);
  const groups = RecipeDedupe.findDuplicates([cookieA, cookieB, stew], {
    dismissed: [key]
  });

  assert.equal(groups.length, 0);
});

test('connected duplicate pairs form one group', () => {
  const cookieC = baseRecipe({
    id: 'c',
    serverId: 4,
    title: 'Chocolate Cookies',
    ingredients: cookieIngredients.slice(0, 7),
    sourceUrl: 'https://example.com/version-c',
    imageId: null
  });

  const groups = RecipeDedupe.findDuplicates([cookieA, cookieB, cookieC, stew]);

  assert.ok(groups.some((group) => group.recipes.length === 3));
});

test('merge plan keeps the stable keeper id and can combine lists', () => {
  const selections = Object.assign({}, RecipeDedupe.suggestSelections(cookieA, cookieB), {
    title: 'a',
    ingredients: 'both',
    directions: 'both',
    categories: 'both',
    notes: 'both',
    sourceUrl: 'b',
    imageId: 'b'
  });
  const plan = RecipeDedupe.buildMergePlan(cookieA, cookieB, selections, cookieA.id);

  assert.equal(plan.keeperId, cookieA.id);
  assert.equal(plan.otherId, cookieB.id);
  assert.equal(plan.recipe.id, cookieA.id);
  assert.equal(plan.recipe.serverId, cookieA.serverId);
  assert.equal(plan.recipe.rev, cookieA.rev);
  assert.equal(plan.recipe.imageId, 'image-b');
  assert.equal(plan.recipe.sourceUrl, cookieB.sourceUrl);
  assert.equal(plan.recipe.rating, 5);
  assert.equal(plan.recipe.dateAdded, cookieB.dateAdded);
  assert.match(plan.recipe.notes, /Use parchment paper/);
  assert.match(plan.recipe.notes, /Chill the dough/);
  assert.ok(plan.recipe.ingredients.includes('1 tsp baking soda'));
  assert.ok(plan.recipe.ingredients.includes('1 tsp baking powder'));
  assert.ok(plan.recipe.directions.includes('Cream butter and sugar.'));
  assert.ok(plan.recipe.directions.includes('Mix everything.'));
  assert.equal(plan.contentChanged, true);
});

test('merge plan can keep the second recipe id', () => {
  const plan = RecipeDedupe.buildMergePlan(
    cookieA,
    cookieB,
    { title: 'a', ingredients: 'a', directions: 'a', notes: 'a', categories: 'a', sourceUrl: 'a', imageId: 'a' },
    cookieB.id
  );

  assert.equal(plan.keeperId, cookieB.id);
  assert.equal(plan.otherId, cookieA.id);
  assert.equal(plan.recipe.id, cookieB.id);
  assert.equal(plan.recipe.serverId, cookieB.serverId);
  assert.equal(plan.recipe.rev, cookieB.rev);
});

test('favorite-only differences do not mark recipe content as changed', () => {
  const sameA = baseRecipe({ favorite: true });
  const sameB = baseRecipe({ id: 'b', favorite: false });
  const plan = RecipeDedupe.buildMergePlan(sameA, sameB, {}, sameA.id);
  const merged = RecipeDedupe.applyMergeMetadata(plan, '2026-01-01T00:00:00.000Z');

  assert.equal(plan.contentChanged, false);
  assert.equal(merged.updatedAt, sameA.updatedAt);
  assert.equal(merged.dateModified, sameA.dateModified);
  assert.equal(merged.dirty, sameA.dirty);
});

test('content changes update merge timestamps and dirty state', () => {
  const plan = RecipeDedupe.buildMergePlan(cookieA, cookieB, { title: 'b' }, cookieA.id);
  const merged = RecipeDedupe.applyMergeMetadata(plan, '2026-01-01T00:00:00.000Z');

  assert.equal(plan.contentChanged, true);
  assert.equal(merged.updatedAt, '2026-01-01T00:00:00.000Z');
  assert.equal(merged.dateModified, '2026-01-01T00:00:00.000Z');
  assert.equal(merged.dirty, true);
});

test('favorites union keeps them scoped to the keeper recipe id', () => {
  const union = RecipeDedupe.unionFavorites(
    { recipeId: 'a', globalFavorite: true, myFavorite: false },
    { recipeId: 'b', globalFavorite: false, myFavorite: true }
  );

  assert.equal(union.recipeId, 'a');
  assert.equal(union.globalFavorite, true);
  assert.equal(union.myFavorite, true);
});
