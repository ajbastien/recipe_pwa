# My Recipes

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
- Add/edit/delete recipes with image selection from the device.
- Favorite toggle that queues a sync mutation.
- IndexedDB local store for recipes, images, outbox, settings, and sync state.
- Service worker app-shell caching and on-demand image caching.
- Outbox-based push with idempotency keys and conflict detection.
- Cursor-based pull with server revisions and delete tombstones.
- Image upload by content hash.
- Optional bearer-token authentication.

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
