(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.RecipeDedupe = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const STOP_WORDS = new Set([
    'a', 'an', 'and', 'at', 'by', 'for', 'from', 'in', 'into', 'of', 'on', 'or',
    'the', 'to', 'with', 'without',
    'cup', 'cups', 'tsp', 'tbsp', 'teaspoon', 'teaspoons', 'tablespoon',
    'tablespoons', 'oz', 'ounce', 'ounces', 'lb', 'lbs', 'pound', 'pounds',
    'g', 'kg', 'ml', 'l'
  ]);

  const TITLE_STOP_WORDS = new Set([...STOP_WORDS, 'recipe', 'recipes']);

  const MERGE_FIELDS = [
    'title',
    'description',
    'prepTime',
    'cookTime',
    'servings',
    'notes',
    'sourceUrl',
    'imageId',
    'ingredients',
    'directions',
    'categories'
  ];

  function tokenize(value, stopWords) {
    return String(value == null ? '' : value)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .split(/\s+/)
      .filter((token) => token
        && !stopWords.has(token)
        && token.length > 1
        && !/^\d+$/.test(token));
  }

  function titleTokens(title) {
    return tokenize(title, TITLE_STOP_WORDS);
  }

  function ingredientTokens(recipe) {
    const source = Array.isArray(recipe.ingredients)
      ? recipe.ingredients.join(' ')
      : recipe.ingredients;
    return tokenize(source, STOP_WORDS);
  }

  function normalizeTitle(title) {
    return titleTokens(title).join(' ');
  }

  function setDice(a, b) {
    if (!a.size || !b.size) return 0;
    let shared = 0;
    for (const token of a) {
      if (b.has(token)) shared += 1;
    }
    return (2 * shared) / (a.size + b.size);
  }

  function pairKey(idA, idB) {
    return [String(idA), String(idB)].sort().join('||');
  }

  function asArray(value) {
    if (Array.isArray(value)) return value;
    return String(value == null ? '' : value)
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
  }

  function mergeUnique(a, b) {
    const seen = new Set();
    const result = [];

    for (const item of [...asArray(a), ...asArray(b)]) {
      const text = String(item || '').trim();
      if (!text) continue;
      const key = text.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(text);
    }

    return result;
  }

  function joinNotes(a, b) {
    const first = String(a || '').trim();
    const second = String(b || '').trim();
    if (!first) return second;
    if (!second || first.toLowerCase() === second.toLowerCase()) return first;
    return `${first}\n\n${second}`;
  }

  function scorePair(a, b) {
    if (!a || !b || a.id === b.id) return null;

    const aTitle = new Set(titleTokens(a.title));
    const bTitle = new Set(titleTokens(b.title));
    const aTitleText = normalizeTitle(a.title);
    const bTitleText = normalizeTitle(b.title);
    const reasons = [];
    let score = 0;

    if (aTitleText && aTitleText === bTitleText) {
      score += 55;
      reasons.push('Identical title');
    } else if (
      aTitleText && bTitleText
      && (aTitleText.includes(bTitleText) || bTitleText.includes(aTitleText))
      && Math.min(aTitleText.length, bTitleText.length) >= 4
    ) {
      score += 42;
      reasons.push('One title includes the other');
    } else {
      const similarity = setDice(aTitle, bTitle);
      if (similarity >= 0.8) {
        score += 38;
        reasons.push('Very similar title');
      } else if (similarity >= 0.6) {
        score += 22;
        reasons.push('Similar title');
      }
    }

    const aIngredients = new Set(ingredientTokens(a));
    const bIngredients = new Set(ingredientTokens(b));
    const smaller = Math.min(aIngredients.size, bIngredients.size);
    let sharedIngredients = 0;

    if (smaller) {
      for (const token of aIngredients) {
        if (bIngredients.has(token)) sharedIngredients += 1;
      }
      const overlap = sharedIngredients / smaller;
      if (overlap >= 0.75 && sharedIngredients >= 5) {
        score += 42;
        reasons.push(`${sharedIngredients} shared ingredients (${Math.round(overlap * 100)}%)`);
      } else if (overlap >= 0.55 && sharedIngredients >= 4) {
        score += 28;
        reasons.push(`${sharedIngredients} shared ingredients (${Math.round(overlap * 100)}%)`);
      } else if (overlap >= 0.4 && sharedIngredients >= 3) {
        score += 14;
        reasons.push(`${sharedIngredients} shared ingredients (${Math.round(overlap * 100)}%)`);
      }
    }

    if (!score) return null;

    const sameText = (left, right) =>
      String(left || '').trim().toLowerCase() === String(right || '').trim().toLowerCase()
      && Boolean(String(left || '').trim());

    if (sameText(a.servings, b.servings)) score += 4;
    if (sameText(a.cookTime, b.cookTime)) score += 4;
    if (sameText(a.prepTime, b.prepTime)) score += 3;

    const aCategories = new Set((a.categories || []).map((value) => String(value).toLowerCase()));
    if ((b.categories || []).some((value) => aCategories.has(String(value).toLowerCase()))) {
      score += 5;
    }

    score = Math.min(100, score);
    const confidence = score >= 70 ? 'high' : score >= 55 ? 'medium' : 'low';

    return {
      a,
      b,
      key: pairKey(a.id, b.id),
      score,
      confidence,
      reasons
    };
  }

  function candidateIndexes(recipes) {
    const titleSets = recipes.map((recipe) => new Set(titleTokens(recipe.title)));
    const tokenSets = recipes.map((recipe, index) => new Set([
      ...titleSets[index],
      ...ingredientTokens(recipe)
    ]));
    const postings = new Map();

    tokenSets.forEach((tokens, recipeIndex) => {
      for (const token of tokens) {
        if (!postings.has(token)) postings.set(token, []);
        postings.get(token).push(recipeIndex);
      }
    });

    const maxDocFreq = Math.max(40, Math.floor(recipes.length * 0.35));
    const rareDocFreq = Math.max(20, Math.floor(recipes.length * 0.03));
    const rareIngredientDocFreq = Math.max(60, Math.floor(recipes.length * 0.08));
    const candidates = new Map();

    recipes.forEach((_, i) => {
      for (const token of tokenSets[i]) {
        const indexes = postings.get(token) || [];
        const docFreq = indexes.length;
        if (docFreq < 2 || docFreq > maxDocFreq) continue;

        const isTitleToken = titleSets[i].has(token);
        const isRareToken = docFreq <= rareIngredientDocFreq;
        const isRareTitleToken = isTitleToken && docFreq <= rareDocFreq;

        for (const j of indexes) {
          if (j <= i) continue;
          const key = `${i}:${j}`;
          let candidate = candidates.get(key);
          if (!candidate) {
            candidate = { i, j, shared: 0, sharedRare: 0, sharedTitle: 0, sharedRareTitle: 0 };
            candidates.set(key, candidate);
          }
          candidate.shared += 1;
          if (isRareToken) candidate.sharedRare += 1;
          if (isTitleToken && titleSets[j].has(token)) candidate.sharedTitle += 1;
          if (isRareTitleToken && titleSets[j].has(token)) candidate.sharedRareTitle += 1;
        }
      }
    });

    return [...candidates.values()]
      .filter((candidate) => candidate.sharedRare >= 5
        || candidate.sharedRareTitle >= 1
        || candidate.sharedTitle >= 2)
      .map((candidate) => [candidate.i, candidate.j]);
  }

  function groupPairs(pairs) {
    const parent = new Map();

    function find(id) {
      if (!parent.has(id)) parent.set(id, id);
      const current = parent.get(id);
      if (current === id) return id;
      const root = find(current);
      parent.set(id, root);
      return root;
    }

    function union(a, b) {
      const rootA = find(a);
      const rootB = find(b);
      if (rootA !== rootB) parent.set(rootB, rootA);
      return rootA;
    }

    for (const pair of pairs) union(pair.a.id, pair.b.id);

    const groups = new Map();

    for (const pair of pairs) {
      const root = find(pair.a.id);
      if (!groups.has(root)) {
        groups.set(root, { recipes: [], pairs: [], score: 0 });
      }

      const group = groups.get(root);
      if (!group.recipes.some((recipe) => recipe.id === pair.a.id)) group.recipes.push(pair.a);
      if (!group.recipes.some((recipe) => recipe.id === pair.b.id)) group.recipes.push(pair.b);
      group.pairs.push(pair);
      group.score = Math.max(group.score, pair.score);
    }

    return [...groups.values()].sort((a, b) => b.score - a.score);
  }

  function findDuplicates(recipes, options) {
    const settings = options || {};
    const dismissed = new Set(settings.dismissed || []);
    const minScore = Number(settings.minScore || 50);
    const pairs = [];

    for (const [i, j] of candidateIndexes(recipes)) {
      const pair = scorePair(recipes[i], recipes[j]);
      if (!pair || pair.score < minScore || dismissed.has(pair.key)) continue;
      pairs.push(pair);
    }

    pairs.sort((a, b) => b.score - a.score
      || String(a.a.title).localeCompare(String(b.a.title)));

    return groupPairs(pairs);
  }

  function valueFor(recipe, field) {
    if (Array.isArray(recipe[field])) return recipe[field];
    return String(recipe[field] || '');
  }

  function richness(value) {
    if (Array.isArray(value)) {
      return value.length * 20 + value.join(' ').length;
    }
    return String(value || '').length;
  }

  function suggestSelections(a, b) {
    const preferred = (field) => richness(valueFor(a, field)) >= richness(valueFor(b, field)) ? 'a' : 'b';

    return {
      title: 'a',
      description: preferred('description'),
      prepTime: preferred('prepTime'),
      cookTime: preferred('cookTime'),
      servings: preferred('servings'),
      imageId: a.imageId ? 'a' : b.imageId ? 'b' : 'a',
      ingredients: preferred('ingredients'),
      directions: preferred('directions'),
      notes: preferred('notes'),
      categories: preferred('categories'),
      sourceUrl: preferred('sourceUrl')
    };
  }

  function sameMergeContent(current, next) {
    for (const field of MERGE_FIELDS) {
      if (Array.isArray(current[field]) || Array.isArray(next[field])) {
        if (JSON.stringify(asArray(current[field])) !== JSON.stringify(asArray(next[field]))) return false;
      } else if (String(current[field] || '') !== String(next[field] || '')) {
        return false;
      }
    }

    if (String(current.dateAdded || '') !== String(next.dateAdded || '')) return false;
    if (Number(current.rating || 0) !== Number(next.rating || 0)) return false;
    return true;
  }

  function unionFavorites(a, b) {
    return {
      recipeId: (a && a.recipeId) || (b && b.recipeId) || null,
      globalFavorite: Boolean(a && a.globalFavorite) || Boolean(b && b.globalFavorite),
      myFavorite: Boolean(a && a.myFavorite) || Boolean(b && b.myFavorite)
    };
  }

  function applyMergeMetadata(plan, timestamp) {
    const merged = { ...plan.recipe };
    if (!plan.contentChanged) return merged;

    merged.dateModified = timestamp;
    merged.updatedAt = timestamp;
    merged.dirty = true;
    return merged;
  }

  function buildMergePlan(a, b, selections, keeperId) {
    const keeper = a.id === keeperId ? a : b;
    const other = a.id === keeperId ? b : a;
    const chosen = Object.assign({}, suggestSelections(a, b), selections || {});
    const pick = (field) => chosen[field] === 'b' ? b : a;
    const pickBoth = (field) => {
      if (chosen[field] === 'both') return mergeUnique(a[field], b[field]);
      return [...asArray(pick(field)[field])];
    };

    const dates = [keeper.dateAdded, other.dateAdded]
      .filter(Boolean)
      .map((value) => String(value))
      .sort();

    const merged = {
      ...keeper,
      id: keeper.id,
      serverId: keeper.serverId || null,
      rev: keeper.rev || 0,
      title: String(pick('title').title || ''),
      description: String(pick('description').description || ''),
      prepTime: String(pick('prepTime').prepTime || ''),
      cookTime: String(pick('cookTime').cookTime || ''),
      servings: String(pick('servings').servings || ''),
      imageId: pick('imageId').imageId || null,
      ingredients: pickBoth('ingredients'),
      directions: pickBoth('directions'),
      categories: pickBoth('categories'),
      notes: chosen.notes === 'both'
        ? joinNotes(a.notes, b.notes)
        : String(pick('notes').notes || ''),
      sourceUrl: String(pick('sourceUrl').sourceUrl || ''),
      dateAdded: dates[0] || keeper.dateAdded || '',
      dateModified: keeper.dateModified || '',
      updatedAt: keeper.updatedAt || '',
      rating: Math.max(Number(a.rating || 0), Number(b.rating || 0)),
      favorite: Boolean(a.favorite || b.favorite),
      deleted: false,
      deletedAt: null,
      dirty: Boolean(keeper.dirty)
    };

    return {
      keeperId: keeper.id,
      otherId: other.id,
      keeper,
      other,
      recipe: merged,
      contentChanged: !sameMergeContent(keeper, merged)
    };
  }

  return {
    MERGE_FIELDS,
    applyMergeMetadata,
    buildMergePlan,
    candidateIndexes,
    findDuplicates,
    groupPairs,
    joinNotes,
    mergeUnique,
    normalizeTitle,
    pairKey,
    scorePair,
    suggestSelections,
    unionFavorites
  };
});
