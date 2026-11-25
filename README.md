# Diane's Recipes

Offline-first recipe PWA built with Node.js, Express, SQLite, IndexedDB, and a service worker.

The Flutter app is reference only. Its DB schema was correct, but its data was stale and its sync protocol was unreliable. This rewrite uses stable client IDs, server revisions, tombstones, an idempotent outbox, and cursor-based pulls.

## Run locally

```bash
npm install
npm run db:init
npm start
```

Open <http://localhost:3000>.

Environment variables:

```text
PORT        default 3000
DB_PATH     default data/recipes.db
SYNC_TOKEN  optional bearer token required for /api/* requests
```

If `SYNC_TOKEN` is set, enter it in the PWA toolbar under **Sync token**.

## Current features

- Responsive recipe grid with search, sort, and multi-select category filters.
- Recipe detail view with ingredients, instructions, metadata, and source URL.
- Add/edit/delete recipes with image selection from the device or an image URL.
- Two-scope favorites: Everyone (shared) and For Me (per name), keyed by stable recipe ID.
- Clipboard import for website/Notes recipe text, with optional pasted photo and review before saving.
- IndexedDB local store for recipes, images, outbox, settings, and sync state.
- Service worker app-shell caching and on-demand image caching.
- Outbox-based push with idempotency keys and conflict detection.
- Automatic sync after saves, favorite changes, and deletions when online.
- Automatic sync on open, when returning to the foreground, after reconnecting, and every 10 minutes.
- Cursor-based pull with server revisions and delete tombstones.
- Image upload by content hash.
- Optional bearer-token authentication.

## Clipboard import

Tap **Import** in the toolbar. Copy recipe text from a website or Apple Notes, then either tap **Paste from clipboard** or long-press the text box and paste normally.

The parser detects:

```text
title, description, ingredients, instructions, notes
prep time, cook/total time, servings, categories, source URL, image URL
```

A copied image from the clipboard is attached if the browser exposes it. You can also paste an image URL and tap **Add from URL**, or use **Choose photo** as a fallback. On iOS, manual paste into the text box is the most reliable path for text.

The recipe editor also has an **Image from URL** row at the bottom, so a photo can be added to any recipe while editing.

Image URLs are fetched through `/api/fetch-image` so sites that block browser CORS still work. Private/localhost URLs are rejected. Fetched images use the same SHA-256 storage and sync outbox as pasted or chosen photos.

Parsed values open in the normal editor for review. Nothing is saved until you tap **Save**, and imported recipes use the same offline outbox and sync flow as manually entered recipes.

Parser tests:

```bash
npm test
```

## Users and favorites

On first launch the app asks for a Name. This is an identity label, not a password. Devices using the same Name share **For Me** favorites; **Everyone** favorites are shared by all devices.

Tap the heart on a recipe to open the favorite popup, or use the two favorite buttons in the editor. A recipe is shown as favorited when either scope is On.

Favorites are stored separately from recipes and keyed by the recipe's stable internal ID. Checking or unchecking a favorite does not change the recipe's `dateAdded`, `dateModified`, `updatedAt`, or server revision. Renaming a user moves personal favorites to the new Name while keeping them attached to the same recipes.

The Settings button changes the Name. Deleting a recipe removes its favorite records on the server too.

At startup, SQLite schema version 2 creates `app_users`, `favorites`, `favorite_receipts`, and `user_rename_receipts`, then migrates existing `recipes.favorite = 1` values into global favorites. The migration is idempotent and does not change recipe rows.

## Data migration

The two current device databases are:

```text
R:\$OneDrive\OneDrive\Documents\Flutter\recipe_app\recipedb\recipe_database-diane.db
R:\$OneDrive\OneDrive\Documents\Flutter\recipe_app\recipedb\recipe_database-al.db
```

Diane is authoritative for its entire database. AL contributes only its final four local-only recipes, counted as row numbers 889-892 in id order.

```bash
npm run export:legacy -- --db "R:\$OneDrive\OneDrive\Documents\Flutter\recipe_app\recipedb\recipe_database-diane.db" --out "data/device-diane"
npm run export:legacy -- --db "R:\$OneDrive\OneDrive\Documents\Flutter\recipe_app\recipedb\recipe_database-al.db" --out "data/device-al"
npm run combine:devices -- --diane "data/device-diane" --al "data/device-al" --out "data/combined-export" --sort title
npm run db:import -- --dir "data/combined-export"
```

The combined dataset contains:

```text
1102 recipes
1096 images
```

The four AL rows added are:

```text
Cheese Sauce Cauliflower
Tapioca Pearls
Stuffed Peppers
Milk Tea
```

See `docs/data-model.md` for the full schema mapping and sync design.

## API

```text
GET    /api/health
GET    /api/config
GET    /api/sync/pull?cursor=<cursor>&limit=500
POST   /api/sync/push
GET    /api/recipes
GET    /api/recipes/:serverId
POST   /api/recipes
PUT    /api/recipes/:serverId
DELETE /api/recipes/:serverId
POST   /api/images/:imageId
GET    /api/images/:imageId
```

Recipe mutations use `Idempotency-Key` and `rev` to prevent duplicate writes and detect conflicts.

## Deployment

The project uses the same GHCR + Portainer pattern as MjHS.

```bash
docker compose up -d
```

Portainer details:

```text
Registry: Custom registry
Registry URL: ghcr.io
Username: ajbastien
Image: ghcr.io/ajbastien/recipe_pwa:latest
Host port: 30002
Container port: 3000
Volume: ./data:/app/data
```

Publish HTTPS through the existing nginx/Cloudflare pattern before installing the PWA on iOS. Service workers require HTTPS or localhost.

## Checks

```bash
npm run check
```
