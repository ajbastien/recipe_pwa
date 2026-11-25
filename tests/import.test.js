const test = require('node:test');
const assert = require('node:assert/strict');
const { parseRecipeText } = require('../public/import.js');

const websiteText = `
Save
Print
Grandma's Chicken Stew
Jump to Recipe
Description:
A cozy weeknight stew.
Prep Time: 20 minutes
Cook Time: 1 hour
Servings: 6
Categories: Dinner, Chicken
https://example.com/stew
Ingredients
• 2 tbsp olive oil
• 1 onion, diced
• 3 cloves garlic
Directions
1. Preheat the oven to 350°F.
2. Stir in the garlic and cook for one minute.
3. Bake for 45 minutes.
Notes
Freezes well.
Reviews
5 stars
`;

const notesText = `
Pasta Salad
A quick lunch.
2 cups pasta
1 cup cherry tomatoes
1/4 cup olive oil
Boil the pasta until tender.
Drain and rinse.
Stir everything together and chill.
Note: Add feta if you like.
`;

test('parses website-style recipe text', () => {
  const recipe = parseRecipeText(websiteText);

  assert.equal(recipe.title, "Grandma's Chicken Stew");
  assert.equal(recipe.description, 'A cozy weeknight stew.');
  assert.equal(recipe.prepTime, '20 minutes');
  assert.equal(recipe.cookTime, '1 hour');
  assert.equal(recipe.servings, '6');
  assert.deepEqual(recipe.categories, ['Dinner', 'Chicken']);
  assert.equal(recipe.sourceUrl, 'https://example.com/stew');
  assert.deepEqual(recipe.ingredients, [
    '2 tbsp olive oil',
    '1 onion, diced',
    '3 cloves garlic'
  ]);
  assert.deepEqual(recipe.directions, [
    'Preheat the oven to 350°F.',
    'Stir in the garlic and cook for one minute.',
    'Bake for 45 minutes.'
  ]);
  assert.equal(recipe.notes, 'Freezes well.');
});

test('parses loose Apple Notes style text', () => {
  const recipe = parseRecipeText(notesText);

  assert.equal(recipe.title, 'Pasta Salad');
  assert.equal(recipe.description, 'A quick lunch.');
  assert.deepEqual(recipe.ingredients, [
    '2 cups pasta',
    '1 cup cherry tomatoes',
    '1/4 cup olive oil'
  ]);
  assert.deepEqual(recipe.directions, [
    'Boil the pasta until tender.',
    'Drain and rinse.',
    'Stir everything together and chill.'
  ]);
  assert.equal(recipe.notes, 'Add feta if you like.');
  assert.equal(recipe.sourceUrl, '');
});

test('returns empty fields for blank input', () => {
  const recipe = parseRecipeText('   \n\n  ');

  assert.equal(recipe.title, '');
  assert.deepEqual(recipe.ingredients, []);
  assert.deepEqual(recipe.directions, []);
});
