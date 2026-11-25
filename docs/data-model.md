# My Recipes data model

This project uses the Flutter app only as a structural reference.

The Flutter asset database at:

```text
R:\$OneDrive\OneDrive\Documents\Flutter\recipe_app\assets\recipe_database.db
```

has the correct schema but stale data. It is **not** the canonical data source.

## Flutter schema reference

The Flutter app stores everything in one `recipes` table:

```text
id
title
description
prepTime
cookTime
servings
favorite
rating
ingredients      CR-delimited text
directions       CR-delimited text
notes
categories       comma-delimited text
dateAdded
url
imageData        JPEG BLOB
dateModified
serverID
```

It also has a `settings` table with `last_sync`.

Important Flutter limitations found in the code:

- local integer IDs are generated with `maxId + 1`
- `serverID = -1` means “not on server”
- deletes are not synced
- favorites toggled from the grid do not update `dateModified`
- timestamps use inconsistent formats
- images are embedded as BLOBs and sent over JSON as arrays of integers
- sync uses plaintext HTTP, a hardcoded AES passphrase, and last-write-wins conflict handling

## New server schema

The Node server uses SQLite.

```text
recipes
  server_id     server-owned primary key
  client_id     stable client-generated UUID
  rev           server revision for conflict detection
  created_at
  updated_at
  deleted_at    tombstone for synced deletes
  title
  description
  prep_time
  cook_time
  servings
  favorite
  rating
  notes
  ingredients   JSON array
  directions    JSON array
  categories    JSON array
  source_url
  image_id      reference into images
```

Supporting tables:

```text
images
  image_id
  recipe_server_id
  mime
  size
  checksum
  file_name
  created_at

outbox_receipts
  client_id
  mutation_id
  server_id
  applied_at

settings
  name
  value
```

## Client IndexedDB schema

The PWA will keep a local copy in IndexedDB:

```text
recipes
images
outbox
syncState
settings
terms
```

Every local edit writes the recipe and an outbox mutation in one transaction.

## Sync model

- server is the source of truth
- client IDs are UUIDs
- server IDs and revisions are assigned by the server
- local changes are drained through an idempotent outbox
- pull uses a cursor/revision
- deletes use tombstones
- conflicts are detected with `rev`
- the client never advances its sync cursor past a failed batch

## Legacy export

Use the export script to inspect or migrate any legacy SQLite database:

```bash
npm run export:legacy -- --db "path/to/recipe_database.db" --out "data/legacy-export"
```

It writes:

```text
data/legacy-export/recipes.json
data/legacy-export/images.json
data/legacy-export/manifest.json
data/legacy-export/images/*
```

To import an export into the new server database:

```bash
npm run db:import -- --dir "data/legacy-export"
```

The export and import steps are separate on purpose. Do not import an export until you have confirmed it is from the current data source.

## Merging two device exports

Export each device database to its own folder first:

```bash
npm run export:legacy -- --db "<device-a-db>" --out "data/device-a"
npm run export:legacy -- --db "<device-b-db>" --out "data/device-b"
```

Then merge:

```bash
npm run merge:exports -- --a "data/device-a" --b "data/device-b" --out "data/merged-export" --sort title
```

Merge rules:

1. Match by legacy `serverID` first.
2. Then match by exact normalized source URL when unique on both devices.
3. Then match by exact normalized title when unique on both devices.
4. Use the record with the newest `dateModified` as the base.
5. Union categories.
6. OR favorites.
7. Keep the max rating.
8. Prefer the winner's image, but fall back to the loser's image if empty.

The merge writes `merge-report.json` with conflicts, device-only recipes, duplicate keys, and how many records matched by each rule. Review that report before importing.

## Diane + AL device combination

The two live device databases are:

```text
R:\$OneDrive\OneDrive\Documents\Flutter\recipe_app\recipedb\recipe_database-diane.db
R:\$OneDrive\OneDrive\Documents\Flutter\recipe_app\recipedb\recipe_database-al.db
```

Diane is authoritative for its entire database. AL contributes only its final four local-only recipes, counted as row numbers 889-892 in id order.

Export both first:

```bash
npm run export:legacy -- --db "R:\$OneDrive\OneDrive\Documents\Flutter\recipe_app\recipedb\recipe_database-diane.db" --out "data/device-diane"
npm run export:legacy -- --db "R:\$OneDrive\OneDrive\Documents\Flutter\recipe_app\recipedb\recipe_database-al.db" --out "data/device-al"
```

Then combine:

```bash
npm run combine:devices -- --diane "data/device-diane" --al "data/device-al" --out "data/combined-export" --sort title
```

The four AL rows added are:

```text
889  Cheese Sauce Cauliflower
890  Tapioca Pearls
891  Stuffed Peppers
892  Milk Tea
```

The combined export manifest records the exact rows selected and the final counts. Import it only after reviewing that manifest:

```bash
npm run db:import -- --dir "data/combined-export"
```
