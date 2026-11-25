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
    'recipe',
    'review',
    'reviews'
  ]);

  const PROMO_PATTERNS = [
    /^top of form$/i,
    /^bottom of form$/i,
    /save this recipe/i,
    /get this sent to your inbox/i,
    /new recipes from us/i,
    /newsletter/i,
    /^email\s*\*?$/i,
    /\b\d+(?:\.\d+)?\s+from\s+\d+\s+votes?\b/i,
    /^\d+(?:\.\d+)?\s*from\s*\d+\s*votes?$/i
  ];

  const CATEGORY_KEYWORDS = [
    'appetizer', 'appetizers', 'breakfast', 'brunch', 'lunch', 'dinner', 'supper',
    'dessert', 'desserts', 'sweet', 'sweets', 'snack', 'snacks',
    'side dish', 'side dishes', 'salad', 'salads', 'soup', 'soups', 'stew', 'stews',
    'beverage', 'beverages', 'drink', 'drinks', 'cocktail', 'cocktails',
    'main dish', 'main dishes', 'mains', 'entree', 'entrees',
    'bread', 'breads', 'cake', 'cakes', 'cookie', 'cookies', 'pie', 'pies',
    'pasta', 'seafood', 'chicken', 'beef', 'pork', 'vegetarian', 'vegan',
    'gluten-free', 'quick', 'easy', 'holiday',
    'american', 'italian', 'mexican', 'chinese', 'japanese', 'indian', 'thai',
    'french', 'mediterranean', 'greek', 'spanish', 'korean', 'vietnamese',
    'cajun', 'southern'
  ];

  const DIRECTION_STARTS = /^(preheat|heat|mix|stir|combine|add|bake|cook|simmer|bring|pour|whisk|beat|chop|slice|place|remove|serve|let|cover|reduce|season|sprinkle|layer|fold|knead|refrigerate|chill|garnish|transfer|drain|rinse|spread|roll|cut|sauté|saute|fry|boil|blend|process|dissolve|melt|cool|set aside|prepare|make|arrange|top|finish|enjoy|peel|drizzle)\b/i;

  const INGREDIENT_HINT = /^(?:\d|½|¼|¾|⅓|⅔|⅛|[.,])|\b(?:cup|cups|tsp|tbsp|teaspoon|teaspoons|tablespoon|tablespoons|oz|ounce|ounces|lb|lbs|pound|pounds|g|kg|ml|l|clove|cloves|can|cans|pinch|dash|handful|slice|slices)\b/i;

  const FIELD_PATTERN = /^\s*(description|about|introduction|image(?:\s*url)?|photo|picture|prep(?:\s*time)?|prepare|cook\s*\/\s*total(?:\s*time)?|total(?:\s*time)?|overall(?:\s*time)?|cook(?:\s*time)?|serves|servings|yield|makes|categor(?:y|ies)|tags?|tag|cuisine|source(?:\s*url)?|url|equipment|notes?)\s*:?\s*(.*)$/i;

  function normalizeLines(text) {
    return String(text || '')
      .replace(/\r\n?/g, '\n')
      .replace(/\u00a0/g, ' ')
      .split('\n')
      .map((line) => line.replace(/\s+$/, '').trim())
      .filter(Boolean);
  }

  function cleanLine(line) {
    let value = String(line || '').trim();
    const prefixes = [
      /^step\s*\d+\s*[:.)-]?\s*/i,
      /^\d+\s*[.)]\s*/,
      /^[-*•‣–—]\s*/,
      /^ingredients?\s*[:.]\s*/i,
      /^directions?\s*[:.]\s*/i
    ];

    for (const prefix of prefixes) value = value.replace(prefix, '');
    return value.trim();
  }

  function isPromo(line) {
    const value = String(line || '').trim();
    return PROMO_PATTERNS.some((pattern) => pattern.test(value));
  }

  function isBoilerplate(line) {
    const value = cleanLine(line).toLowerCase().replace(/[.:!*]+$/, '').trim();
    return BOILERPLATE.has(value) || isPromo(line);
  }

  function headerKind(line) {
    const value = cleanLine(line).toLowerCase().replace(/[:\s]+$/, '');
    if (/^(ingredients?|what you(?:'|’)ll need|what you need|shopping list)$/.test(value)) return 'ingredients';
    if (/^(directions?|instructions?|method|steps?|preparation)$/.test(value)) return 'directions';
    if (/^(notes?|tips?|chef(?:'|’)s notes?)$/.test(value)) return 'notes';
    if (/^(equipment|tools?)$/.test(value)) return 'equipment';
    if (/^(about|introduction)$/.test(value)) return 'description';
    return null;
  }

  function isStopHeader(line) {
    const value = cleanLine(line).toLowerCase().replace(/[:\s]+$/, '');
    return /^(nutrition(al)?( facts| information)?|reviews?|comments?|related|you might also like|more recipes|rate this recipe|print recipe|save recipe|share|subscribe|advertisement|equipment|tools?|ingredients?|directions?|instructions?|method|steps?|preparation|notes?|about|introduction)$/.test(value);
  }

  function fieldMatch(line) {
    const match = String(line || '').match(FIELD_PATTERN);
    if (!match) return null;

    const label = match[1].toLowerCase().replace(/\s+/g, ' ').trim();
    const inline = match[2].trim();
    let key = 'other';

    if (/^description|^about|^introduction/.test(label)) key = 'description';
    else if (/^image|^photo|^picture/.test(label)) key = 'image';
    else if (/^prep|^prepare/.test(label)) key = 'prepTime';
    else if (/^total|^overall|^cook\s*\/\s*total/.test(label)) key = 'totalTime';
    else if (/^cook/.test(label)) key = 'cookTime';
    else if (/^(serves|servings|yield|makes)$/.test(label)) key = 'servings';
    else if (/^categor|^tag|^cuisine/.test(label)) key = 'categories';
    else if (/^source|^url/.test(label)) key = 'source';
    else if (/^equipment|^tools?$/.test(label)) key = 'equipment';
    else if (/^note/.test(label)) key = 'notes';

    return { key, label, inline };
  }

  function looksLikeMeta(line) {
    return Boolean(fieldMatch(line)) || /^\s*(image|photo|picture|prep|prepare|cook|total|serves|servings|yield|categor|tags?|cuisine|source|url|equipment)\b/i.test(line);
  }

  function isCategoryLine(line) {
    const value = cleanLine(line).toLowerCase().replace(/[.:!*]+$/, '');
    return CATEGORY_KEYWORDS.includes(value);
  }

  function isJunkLine(line) {
    const value = String(line || '').trim();
    if (!value) return true;
    if (/^\d+\s*[xX]\s*$/.test(value)) return true;
    if (/^[\u00c2\u00a0\ufffd]+$/.test(value)) return true;
    if (/^[^\p{L}\p{N}]+$/u.test(value)) return true;
    return false;
  }

  function isFieldValueLine(lines, index) {
    if (index <= 0) return false;
    const previous = fieldMatch(lines[index - 1]);
    if (!previous || previous.inline || ['description', 'notes'].includes(previous.key)) return false;

    const current = lines[index];
    if (fieldMatch(current) || headerKind(current) || isStopHeader(current)) return false;
    if (isBoilerplate(current) || isCategoryLine(current) || isJunkLine(current)) return false;
    return true;
  }

  function normalizeTime(value) {
    let text = String(value || '').replace(/\s+/g, ' ').trim();
    let match = text.match(/^(\d+)\s*(hours?|hrs?|h)\s+(\d+)\s*(minutes?|mins?)$/i);
    if (match) {
      const hours = Number(match[1]) === 1 ? 'hour' : 'hours';
      const minutes = Number(match[3]) === 1 ? 'minute' : 'minutes';
      return `${match[1]} ${hours} ${match[3]} ${minutes}`;
    }

    match = text.match(/^(\d+)\s*(minutes?|mins?)(?:\s*(?:minutes?|mins?))?$/i);
    if (match) return `${match[1]} ${Number(match[1]) === 1 ? 'minute' : 'minutes'}`;

    match = text.match(/^(\d+)\s*(hours?|hrs?|h)(?:\s*(?:hours?|hrs?|h))?$/i);
    if (match) return `${match[1]} ${Number(match[1]) === 1 ? 'hour' : 'hours'}`;

    return text;
  }

  function extractField(lines, keys) {
    const values = [];

    for (let index = 0; index < lines.length; index += 1) {
      const field = fieldMatch(lines[index]);
      if (!field || !keys.includes(field.key)) continue;

      let value = field.inline;
      if (!value && index + 1 < lines.length && isFieldValueLine(lines, index + 1)) {
        value = lines[index + 1];
      }
      if (!value) continue;

      value = cleanLine(value).replace(/\s+/g, ' ').trim();
      if (['prepTime', 'cookTime', 'totalTime'].includes(field.key)) value = normalizeTime(value);
      values.push(value);
    }

    return values;
  }

  function splitList(value) {
    return String(value || '')
      .split(/[,|;]/)
      .map((item) => cleanLine(item).replace(/^#/, ''))
      .filter(Boolean);
  }

  function cleanUrl(value) {
    return String(value || '').trim().replace(/[.,;)}\]]+$/, '');
  }

  function isImageFileUrl(value) {
    return /\.(?:jpe?g|png|webp|gif|avif)(?:[?#]|$)/i.test(value);
  }

  function findImageUrl(text) {
    const matches = String(text || '').match(/https?:\/\/[^\s<>"']+/gi) || [];
    return cleanUrl(matches.find(isImageFileUrl) || '');
  }

  function extractCategories(lines) {
    const candidates = [];

    for (let index = 0; index < lines.length; index += 1) {
      const field = fieldMatch(lines[index]);

      if (field && field.key === 'categories') {
        let value = field.inline;
        if (!value && isFieldValueLine(lines, index + 1)) value = lines[index + 1];
        for (const item of splitList(value)) candidates.push({ index, value: item });
      } else if (!field && isCategoryLine(lines[index])) {
        const value = cleanLine(lines[index]);
        if (value) candidates.push({ index, value });
      }
    }

    candidates.sort((a, b) => a.index - b.index);
    const categories = [];
    for (const candidate of candidates) {
      if (!categories.includes(candidate.value)) categories.push(candidate.value);
    }

    return categories.slice(0, 10);
  }

  function findHeaderAfter(lines, kind, afterIndex) {
    for (let index = afterIndex + 1; index < lines.length; index += 1) {
      if (headerKind(lines[index]) === kind) return index;
    }
    return -1;
  }

  function shouldSkipContentLine(lines, index) {
    const line = lines[index];
    return isBoilerplate(line)
      || looksLikeMeta(line)
      || isFieldValueLine(lines, index)
      || isCategoryLine(line)
      || isJunkLine(line)
      || headerKind(line)
      || isStopHeader(line)
      || /^https?:\/\//i.test(line);
  }

  function collectSection(lines, startIndex) {
    const values = [];

    for (let index = startIndex; index < lines.length; index += 1) {
      const line = lines[index];
      if (headerKind(line) || isStopHeader(line)) break;
      if (shouldSkipContentLine(lines, index)) continue;

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
      if (shouldSkipContentLine(lines, index)) continue;

      const cleaned = cleanLine(lines[index]);
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
      totalTime: '',
      servings: '',
      categories: [],
      sourceUrl: '',
      imageUrl: '',
      favorite: false,
      rating: 0
    };

    if (!lines.length) return empty;

    const headers = {};
    for (let index = 0; index < lines.length; index += 1) {
      const kind = headerKind(lines[index]);
      if (kind && headers[kind] === undefined) headers[kind] = index;
    }

    const equipmentIndex = headers.equipment !== undefined ? headers.equipment : -1;
    const ingredientsIndex = headers.ingredients !== undefined ? headers.ingredients : -1;
    let directionsIndex = headers.directions !== undefined ? headers.directions : -1;
    if (ingredientsIndex >= 0 && directionsIndex >= 0 && directionsIndex < ingredientsIndex) {
      directionsIndex = findHeaderAfter(lines, 'directions', ingredientsIndex);
    }
    const notesIndex = headers.notes !== undefined ? headers.notes : -1;

    const sectionIndexes = [equipmentIndex, ingredientsIndex, directionsIndex, notesIndex]
      .filter((index) => index >= 0);
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
        if (shouldSkipContentLine(preLines, index)) continue;

        const cleaned = cleanLine(line);
        if (!cleaned || cleaned.length < 3 || cleaned.length > 120) continue;
        if (/^[\d.,:;!?\s]+$/.test(cleaned)) continue;

        title = cleaned;
        titleIndex = index;
        break;
      }
    }

    let heuristicStart = lines.length;
    if (!sectionIndexes.length) {
      for (let index = titleIndex + 1; index < lines.length; index += 1) {
        if (shouldSkipContentLine(lines, index)) continue;

        const cleaned = cleanLine(lines[index]);
        if (!cleaned) continue;
        if (looksLikeDirection(cleaned) || looksLikeIngredient(cleaned)) {
          heuristicStart = index;
          break;
        }
      }
    }

    const descriptionEnd = sectionIndexes.length ? preLines.length : heuristicStart;
    const descriptionLines = [];
    for (let index = Math.max(0, titleIndex + 1); index < descriptionEnd; index += 1) {
      if (shouldSkipContentLine(preLines, index)) continue;

      const line = preLines[index];
      const descriptionMatch = line.match(/^\s*(?:description|about|introduction)\s*:\s*(.+)$/i);
      descriptionLines.push(cleanLine(descriptionMatch ? descriptionMatch[1] : line));
    }

    const prepTime = extractField(lines, ['prepTime'])[0] || '';
    const totalTime = extractField(lines, ['totalTime'])[0] || '';
    const explicitCookTime = extractField(lines, ['cookTime'])[0] || '';
    const cookTime = explicitCookTime || totalTime;
    const servings = extractField(lines, ['servings'])[0] || '';
    const categories = extractCategories(lines);

    const imageUrl = cleanUrl(extractField(lines, ['image'])[0] || '') || findImageUrl(text);
    const allUrls = (String(text || '').match(/https?:\/\/[^\s<>"']+/gi) || [])
      .map(cleanUrl);
    const sourceUrl = allUrls.find((url) => url !== imageUrl && !isImageFileUrl(url)) || '';

    let notes = '';
    if (notesIndex >= 0) {
      notes = collectSection(lines, notesIndex + 1).join('\n');
    } else {
      notes = extractField(lines, ['notes'])[0] || '';
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
      totalTime,
      servings,
      categories,
      sourceUrl,
      imageUrl,
      favorite: false,
      rating: 0
    };
  }

  return { parseRecipeText };
});
