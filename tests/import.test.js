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

const bananaSplitText = `
Save This Recipe!
Get this sent to your inbox, plus get new recipes from us every week!
Email *

Save

Desserts

Banana Split
This classic ice cream dessert starts with a fresh banana, three scoops of ice cream (vanilla, chocolate, and strawberry), pineapple, chocolate syrup, and strawberries. Oh, and don't forget the whipped cream, nuts, and maraschino cherries. Grab a spoon and dig in!
4.77 from 21 votes
Print
Save Recipe
Review
Prep Time
10minutes mins
Total Time
10minutes mins
Cuisine
American
Servings
1
Equipment
Banana Split Bowl (this glass one is pretty!)
Ice Cream Scoop (I use this KitchenAid one)
Ingredients
  
1x
2x
3x

1 banana, peeled and split lengthwise
1 scoop vanilla ice cream
1 scoop chocolate ice cream
1 scoop strawberry ice cream
2 tablespoons pineapple sauce or diced fresh pineapple
2 tablespoons chocolate syrup or hot fudge
2 tablespoons strawberry sauce or diced fresh strawberries
Whipped cream
3 maraschino cherries
2 tablespoons finely chopped peanuts or other nuts
Instructions
 



Peel the banana and cut it in half lengthwise. Place the banana slices against the sides of a long, shallow dish.

Place the scoops of vanilla, chocolate, and strawberry ice cream in a row between the banana slices.


Drizzle the pineapple sauce (or spoon the fresh pineapple) over the vanilla ice cream. Drizzle the chocolate syrup or hot fudge over the chocolate ice cream. Drizzle the strawberry syrup (or spoon the fresh strawberries) over the strawberry ice cream.

Top each scoop of ice cream with a generous dollop of whipped cream and a maraschino cherry. Garnish with the chopped nuts and serve immediately.

Notes
If you want to add additional toppings or use different ice cream flavors, go for it! See post for ideas! 
Nutrition
Calories: 873kcal, Carbohydrates: 144g, Protein: 15g, Fat: 31g, Saturated Fat: 14g, Polyunsaturated Fat: 4g, Monounsaturated Fat: 9g, Cholesterol: 71mg, Sodium: 186mg, Potassium: 1135mg, Fiber: 9g, Sugar: 68g, Vitamin A: 870IU, Vitamin C: 36mg, Calcium: 283mg, Iron: 3mg 
`;

test('parses the banana split website sample', () => {
  const recipe = parseRecipeText(bananaSplitText);

  assert.equal(recipe.title, 'Banana Split');
  assert.equal(
    recipe.description,
    "This classic ice cream dessert starts with a fresh banana, three scoops of ice cream (vanilla, chocolate, and strawberry), pineapple, chocolate syrup, and strawberries. Oh, and don't forget the whipped cream, nuts, and maraschino cherries. Grab a spoon and dig in!"
  );
  assert.equal(recipe.prepTime, '10 minutes');
  assert.equal(recipe.totalTime, '10 minutes');
  assert.equal(recipe.cookTime, '10 minutes');
  assert.equal(recipe.servings, '1');
  assert.deepEqual(recipe.categories, ['Desserts', 'American']);
  assert.deepEqual(recipe.ingredients, [
    '1 banana, peeled and split lengthwise',
    '1 scoop vanilla ice cream',
    '1 scoop chocolate ice cream',
    '1 scoop strawberry ice cream',
    '2 tablespoons pineapple sauce or diced fresh pineapple',
    '2 tablespoons chocolate syrup or hot fudge',
    '2 tablespoons strawberry sauce or diced fresh strawberries',
    'Whipped cream',
    '3 maraschino cherries',
    '2 tablespoons finely chopped peanuts or other nuts'
  ]);
  assert.equal(recipe.directions.length, 4);
  assert.match(recipe.directions[0], /^Peel the banana/);
  assert.equal(
    recipe.notes,
    'If you want to add additional toppings or use different ice cream flavors, go for it! See post for ideas!'
  );
  assert.equal(recipe.sourceUrl, '');
});

test('extracts a labeled image URL without using it as the source URL', () => {
  const recipe = parseRecipeText(`
Banana Bread
Image: https://example.com/photos/banana-bread.jpg
Source: https://example.com/banana-bread
Ingredients
1 banana
Instructions
1. Mash the banana.
`);

  assert.equal(recipe.imageUrl, 'https://example.com/photos/banana-bread.jpg');
  assert.equal(recipe.sourceUrl, 'https://example.com/banana-bread');
});

test('parses label and value joined without a space', () => {
  const recipe = parseRecipeText(`
Desserts
Banana Split
Prep Time10minutes mins
Total Time10minutes mins
CuisineAmerican
Servings1
Ingredients
ÂÂ
1x
2x
3x
1 banana, peeled and split lengthwise
Instructions
1. Peel the banana.
`);

  assert.equal(recipe.title, 'Banana Split');
  assert.equal(recipe.prepTime, '10 minutes');
  assert.equal(recipe.totalTime, '10 minutes');
  assert.equal(recipe.cookTime, '10 minutes');
  assert.equal(recipe.servings, '1');
  assert.deepEqual(recipe.categories, ['Desserts', 'American']);
  assert.deepEqual(recipe.ingredients, ['1 banana, peeled and split lengthwise']);
  assert.deepEqual(recipe.directions, ['Peel the banana.']);
});

test('returns empty fields for blank input', () => {
  const recipe = parseRecipeText('   \n\n  ');

  assert.equal(recipe.title, '');
  assert.deepEqual(recipe.ingredients, []);
  assert.deepEqual(recipe.directions, []);
});
