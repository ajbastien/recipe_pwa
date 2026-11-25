# Diane's Recipes data model

Diane's Recipes was built with OpenCode as an offline-first PWA. The server owns the shared dataset; each client keeps a local IndexedDB copy so recipes remain available offline.

## Server SQLite schema

### `recipes`

```text
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
favorite      compatibility mirror only
rating
notes
ingredients   JSON array
directions    JSON array
categories    JSON array
source_url
image_id      reference into images
```

### Supporting tables

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

app_users
  user_key
  display_name
  created_at
  updated_at

favorites
  scope             'global' or 'me'
  user_key          empty for global favorites
  recipe_client_id  stable recipe id
  favorite
  updated_at
  seq

favorite_receipts
  client_id
  mutation_id
  applied_at

user_rename_receipts
  mutation_id
  old_user_key
  new_user_key
  moved
  applied_at
```

## Client IndexedDB schema

```text
recipes
images
outbox
syncState
settings
favorites
favoriteOutbox
```

Every recipe edit writes the recipe and an outbox mutation together. Favorite changes write a separate favorite record and a favorite outbox mutation; they do not change recipe timestamps or revisions.

## Sync model

- The server is the source of truth.
- Client IDs are UUIDs and remain stable for the life of a recipe.
- Server IDs and revisions are assigned by the server.
- Local changes are drained through an idempotent outbox.
- Pull uses a cursor based on `updatedAt` and server ID.
- Deletes use tombstones so other devices receive them.
- Conflicts are detected with `rev`.
- The client never advances its sync cursor past a failed batch.

## Favorites

Favorites have two scopes:

- **Everyone** is a global favorite shared by all devices.
- **For Me** is keyed by the normalized user Name and only seen by that identity.

A recipe is considered favorited when either scope is On. Renaming a user moves personal favorites to the new user key. Deleting a recipe removes its global and personal favorite records.

## Images

Images are stored by SHA-256 content hash. The same `imageId` is used locally and on the server, so an image can be queued once and reused by any recipe that references it.

## Duplicate detection

Duplicate detection runs on demand in the browser using local IndexedDB data. It compares normalized titles, rare ingredient tokens, and weak signals such as prep time, cook time, servings, and categories. Suspected pairs can be ignored; ignored pairs are stored in client settings.

Merging keeps the chosen recipe's stable ID, combines selected fields, unions favorites, and removes the other recipe through the normal sync flow.
