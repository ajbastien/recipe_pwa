(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.RecipeImport = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const BOILERPLATE = new Set([
    'save',
    'save recipe',
    'print',
    'print recipe',
    'jump to recipe',
    'jump to instructions',
    'rate this recipe',
    'leave a comment',
    'subscribe',
    'follow',
    'share',
    'pin',
    'pin it',
    'advertisement',
    'skip to content',
    'recipe'
  ]);

  const DIRECTION_STARTS = /^(preheat|heat|mix|stir|combine|add|bake|cook|simmer|bring|pour|whisk|beat|chop|slice|place|remove|serve|let|cover|reduce|season|sprinkle|layer|fold|knead|refrigerate|chill|garnish|transfer|drain|rinse|spread|roll|cut|sauté|saute|fry|boil|blend|process|dissolve|melt|cool|set aside|prepare|make|arrange|top|finish|enjoy)\b/i;

  const INGREDIENT_HINT = /^(?:\d|½|¼|¾|⅓|⅔|⅛|[.,])|\b(?:cup|cups|tsp|tbsp|teaspoon|teaspoons|tablespoon|tablespoons|oz|ounce|ounces|lb|lbs|pound|pounds|g|kg|ml|l|clove|cloves|can|cans|pinch|dash|handful|slice|slices)\b/i;

  function normalizeLines(text) {
    return String(text || '')
      .replace(/\r\n?/g, '\n')
      .replace(/\u00a0/g, ' ')
      .split('\n')
      .map((line) => line.replace(/\s+$/, '').trim())
      .filter(Boolean);
  }

  function isBoilerplate(line) {
    return BOILERPLATE.has(line.toLowerCase().replace(/[.:!]+$/, ''));
  }

  function headerKind(line) {
    const value = line.replace(/[:\s]+$/, '').toLowerCase();
    if (/^(ingredients?|what you(?:'|’)ll need|what you need|shopping list)$/.test(value)) return 'ingredients';
    if (/^(directions?|instructions?|method|steps?|preparation)$/.test(value)) return 'directions';
    if (/^(notes?|tips?|chef(?:'|’)s notes?)$/.test(value)) return 'notes';
    if (/^(description|about|introduction)$/.test(value)) return 'description';
    return null;
  }

  function isStopHeader(line) {
    const value = line.replace(/[:\s]+$/, '').toLowerCase();
    return /^(nutrition(al)?( facts| information)?|reviews?|comments?|related|you might also like|more recipes|rate this recipe|print recipe|save recipe|share|subscribe|advertisement|ingredients?|directions?|instructions?|method|steps?|preparation|notes?|description|about|introduction)$/.test(value);
  }

  function looksLikeMeta(line) {
    return /^\s*(prep(?:\s*time)?|prepare|cook(?:\s*time)?|total(?:\s*time)?|serves|servings|yield|categor(?:y|ies)|tags?|source|url|note(?:s)?)\s*:/i.test(line);
  }

  function cleanLine(line) {
    let value = String(line || '').trim();
    const prefixes = [
      /^step\s*\d+\s*[:.)-]?\s*/i,
      /^\d+\s*[.)]\s*/,
      /^[-*•‣–—]\s*/,
      /^ingredient\s*[:.]?\s*/i,
      /^direction\s*[:.]?\s*/i
    ];

    for (const prefix of prefixes) value = value.replace(prefix, '');
    return value.trim();
  }

  function findMeta(lines, patterns) {
    for (const line of lines) {
      for (const pattern of patterns) {
        const match = line.match(pattern);
        if (match && match[1]) return match[1].trim();
      }
    }
    return '';
  }

  function findHeaderAfter(lines, kind, afterIndex) {
    for (let index = afterIndex + 1; index < lines.length; index += 1) {
      if (headerKind(lines[index]) === kind) return index;
    }
    return -1;
  }

  function collectSection(lines, startIndex) {
    const values = [];

    for (let index = startIndex; index < lines.length; index += 1) {
      const line = lines[index];
      if (headerKind(line) || isStopHeader(line)) break;
      if (looksLikeMeta(line) || isBoilerplate(line) || /^https?:\/\//i.test(line)) continue;

      const cleaned = cleanLine(line);
      if (cleaned) values.push(cleaned);
    }

    return values;
  }

  function looksLikeDirection(line) {
    return DIRECTION_STARTS.test(line) || line.length > 60;
  }

  function looksLikeIngredient(line) {
    return INGREDIENT_HINT.test(line) || (line.length <= 55 && !/[.!?]$/.test(line));
  }

  function heuristicSections(lines, startIndex) {
    const ingredients = [];
    const directions = [];

    for (let index = startIndex; index < lines.length; index += 1) {
      const line = lines[index];
      if (headerKind(line) || isStopHeader(line) || looksLikeMeta(line) || isBoilerplate(line) || /^https?:\/\//i.test(line)) continue;

      const cleaned = cleanLine(line);
      if (!cleaned) continue;

      if (looksLikeDirection(cleaned)) directions.push(cleaned);
      else if (looksLikeIngredient(cleaned)) ingredients.push(cleaned);
      else if (directions.length) directions.push(cleaned);
      else ingredients.push(cleaned);
    }

    return { ingredients, directions };
  }

  function parseRecipeText(text) {
    const lines = normalizeLines(text);
    const empty = {
      title: '',
      description: '',
      ingredients: [],
      directions: [],
      notes: '',
      prepTime: '',
      cookTime: '',
      servings: '',
      categories: [],
      sourceUrl: '',
      favorite: false,
      rating: 0
    };

    if (!lines.length) return empty;

    const headers = {};
    for (let index = 0; index < lines.length; index += 1) {
      const kind = headerKind(lines[index]);
      if (kind && headers[kind] === undefined) headers[kind] = index;
    }

    const ingredientsIndex = headers.ingredients !== undefined ? headers.ingredients : -1;
    let directionsIndex = headers.directions !== undefined ? headers.directions : -1;
    if (ingredientsIndex >= 0 && directionsIndex >= 0 && directionsIndex < ingredientsIndex) {
      directionsIndex = findHeaderAfter(lines, 'directions', ingredientsIndex);
    }
    const notesIndex = headers.notes !== undefined ? headers.notes : -1;

    const sectionIndexes = [ingredientsIndex, directionsIndex, notesIndex].filter((index) => index >= 0);
    const firstSectionIndex = sectionIndexes.length ? Math.min(...sectionIndexes) : lines.length;
    const preLines = lines.slice(0, firstSectionIndex);

    let title = '';
    let titleIndex = -1;

    for (let index = 0; index < preLines.length; index += 1) {
      const match = preLines[index].match(/^\s*(?:title|recipe)\s*:\s*(.+)$/i);
      if (match) {
        title = cleanLine(match[1]);
        titleIndex = index;
        break;
      }
    }

    if (titleIndex === -1) {
      for (let index = 0; index < preLines.length; index += 1) {
        const line = preLines[index];
        if (isBoilerplate(line) || looksLikeMeta(line) || headerKind(line) || /^https?:\/\//i.test(line)) continue;
        title = cleanLine(line);
        titleIndex = index;
        break;
      }
    }

    let heuristicStart = lines.length;
    if (!sectionIndexes.length) {
      for (let index = titleIndex + 1; index < lines.length; index += 1) {
        const line = lines[index];
        if (isBoilerplate(line) || looksLikeMeta(line) || headerKind(line) || /^https?:\/\//i.test(line)) continue;

        const cleaned = cleanLine(line);
        if (!cleaned) continue;
        if (looksLikeDirection(cleaned) || looksLikeIngredient(cleaned)) {
          heuristicStart = index;
          break;
        }
      }
    }

    const descriptionEnd = sectionIndexes.length ? preLines.length : heuristicStart;
    const descriptionLines = [];
    for (let index = titleIndex + 1; index < descriptionEnd; index += 1) {
      const line = preLines[index];
      if (isBoilerplate(line) || looksLikeMeta(line) || /^https?:\/\//i.test(line)) continue;

      const descriptionMatch = line.match(/^\s*(?:description|about|introduction)\s*:\s*(.+)$/i);
      if (descriptionMatch) {
        descriptionLines.push(cleanLine(descriptionMatch[1]));
        continue;
      }

      if (headerKind(line)) continue;
      descriptionLines.push(cleanLine(line));
    }

    const prepTime = findMeta(lines, [
      /^\s*(?:prep(?:\s*time)?|prepare)\s*:\s*(.+)$/i,
      /^\s*prep(?:\s*time)?\s+(\d+\s*(?:min|minutes|h|hr|hours).*)$/i
    ]);

    const cookTime = findMeta(lines, [
      /^\s*cook(?:\s*time)?\s*:\s*(.+)$/i,
      /^\s*cook(?:\s*time)?\s+(\d+\s*(?:min|minutes|h|hr|hours).*)$/i
    ]);

    const servings = findMeta(lines, [
      /^\s*(?:serves|servings|yield)\s*:\s*(.+)$/i,
      /^\s*(?:serves|servings|yield)\s+(\d+.*)$/i
    ]);

    const categoryText = findMeta(lines, [
      /^\s*(?:categories?|category|tags?)\s*:\s*(.+)$/i
    ]);

    const categories = categoryText
      .split(/[,|;]/)
      .map((value) => cleanLine(value).replace(/^#/, ''))
      .filter(Boolean)
      .slice(0, 8);

    const urlMatch = String(text || '').match(/https?:\/\/[^\s<>"']+/i);
    const sourceUrl = urlMatch
      ? urlMatch[0].replace(/[.,;)}\]]+$/, '')
      : '';

    let notes = '';
    if (notesIndex >= 0) {
      notes = collectSection(lines, notesIndex + 1).join('\n');
    } else {
      notes = findMeta(lines, [/^\s*note(?:s)?\s*:\s*(.+)$/i]);
    }

    let ingredients = ingredientsIndex >= 0 ? collectSection(lines, ingredientsIndex + 1) : [];
    let directions = directionsIndex >= 0 ? collectSection(lines, directionsIndex + 1) : [];

    if (!ingredients.length && !directions.length) {
      const guessed = heuristicSections(lines, Math.max(heuristicStart, titleIndex + 1));
      ingredients = guessed.ingredients;
      directions = guessed.directions;
    }

    return {
      title,
      description: descriptionLines.join('\n').trim(),
      ingredients,
      directions,
      notes,
      prepTime,
      cookTime,
      servings,
      categories,
      sourceUrl,
      favorite: false,
      rating: 0
    };
  }

  return { parseRecipeText };
});
