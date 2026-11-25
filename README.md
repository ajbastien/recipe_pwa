# Diane's Recipes

Offline-first recipe PWA built with Node.js, Express, SQLite, IndexedDB, and a service worker.

Built from scratch with OpenCode as an offline-first recipe app. It uses stable client IDs, server revisions, tombstones, an idempotent outbox, and cursor-based pulls.

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
- Clipboard import for website/Notes recipe text with review before saving. Photos can be added with **Choose photo** or an image URL.
- IndexedDB local store for recipes, images, outbox, settings, and sync state.
- Service worker app-shell caching and on-demand image caching.
- Outbox-based push with idempotency keys and conflict detection.
- Automatic sync after saves, favorite changes, and deletions when online.
- Automatic sync on open, when returning to the foreground, after reconnecting, and every 10 minutes.
- Cursor-based pull with server revisions and delete tombstones.
- Image upload by content hash.
- Optional bearer-token authentication.

## Usage

### Search

Type in the **Search** box to filter recipes by title. Search works together with the sort order and category filters, and the footer shows how many recipes are visible.

### Categories

Open **Categories** in the toolbar to select one or more categories. A recipe is shown only when it has all selected categories. Uncheck a category to remove it from the filter.

### Add or edit a recipe

Tap **+ Recipe** to create one, or open a recipe and tap **Edit** to change it. Fill in the title, ingredients, instructions, and any optional details such as prep time, categories, notes, source URL, and photo. Use the **Everyone** and **For Me** buttons to set favorites, then tap **Save**.

### Import

Tap **Import**, paste recipe text from a website or Apple Notes, then tap **Parse & review**. Parsed fields open in the normal editor so you can check them before saving. See [Clipboard import](#clipboard-import) for photo and image-URL details.

### Delete

Open a recipe and tap **Delete**. The in-app message box asks for confirmation with **No** as the default; tap **Yes** to delete. The recipe is removed locally and the deletion syncs to other devices. Recipes that were never synced are simply removed locally.

### Share

Open a recipe and tap **Share**. On iOS this opens the system share sheet with self-contained recipe text. If native sharing is unavailable or declined, the text is copied to the clipboard instead.

The shared text contains no app URL because the app is intended for private LAN/WireGuard use. Another person running the same app on their own server can paste the text into **Import** on their device.

## Clipboard import

Tap **Import** in the toolbar. Copy recipe text from a website or Apple Notes, then either tap **Paste from clipboard** or long-press the text box and paste normally.

The parser detects:

```text
title, description, ingredients, instructions, notes
prep time, cook/total time, servings, categories, source URL, image URL
```

Add a photo by tapping **Choose photo** or by pasting an image URL and tapping **Add from URL**. On iOS, manual paste into the text box is the most reliable path for recipe text.

The recipe editor also has an **Image from URL** row at the bottom, so a photo can be added to any recipe while editing.

Image URLs are fetched through `/api/fetch-image` so sites that block browser CORS still work. Private/localhost URLs are rejected. Fetched images use the same SHA-256 storage and sync outbox as chosen photos.

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

The project publishes a Docker image to GHCR and can be deployed with Docker Compose or any container management platform, including Portainer.

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

### Local DNS and HTTPS

Use the purchased domain name, for example `recipes.example.com`, but resolve it only on the local network. Cloudflare is a good low-cost registrar option because its DNS API works with Certbot DNS-01 challenges, allowing Let's Encrypt certificates without exposing the app publicly. If you create public DNS records there, leave them as DNS-only rather than proxied.

1. In Pi-hole, add a local DNS A record:

   ```text
   recipes.example.com -> <nginx-host-LAN-IP>
   ```

   Make sure LAN and WireGuard clients use the Pi-hole as their DNS server. If WireGuard clients need a different address, add a matching record for the nginx host address reachable over WireGuard.

2. Configure nginx as a reverse proxy to the container host port:

   ```nginx
   server {
     listen 80;
     server_name recipes.example.com;
     return 301 https://$host$request_uri;
   }

   server {
     listen 443 ssl http2;
     server_name recipes.example.com;

     ssl_certificate     /etc/letsencrypt/live/recipes.example.com/fullchain.pem;
     ssl_certificate_key /etc/letsencrypt/live/recipes.example.com/privkey.pem;

     location / {
       proxy_pass http://127.0.0.1:30002;
       proxy_set_header Host $host;
       proxy_set_header X-Forwarded-Proto $scheme;
       proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
     }
   }
   ```

   Change `127.0.0.1:30002` if nginx runs on another host.

3. Issue the Let's Encrypt certificate with the DNS-01 challenge so the app does not need to be publicly reachable:

   ```bash
   certbot certonly --dns-<provider> \
     --dns-<provider>-credentials /etc/letsencrypt/<provider>.ini \
     -d recipes.example.com
   ```

   Enable automatic renewal with `certbot renew`. HTTP-01 also works, but only if port 80 is temporarily reachable from the public internet during issuance and renewal.

4. Keep firewall rules limited to LAN and WireGuard clients. The service should not be exposed to the public internet.

After DNS, nginx, and TLS are working, install the PWA from:

```text
https://recipes.example.com
```

Use HTTPS for the installed app. The Share button, clipboard access, service worker caching, PWA installation, and several browser file/image APIs require a secure context. Plain HTTP on a LAN address is considered insecure by iOS and other browsers, so those features will not work reliably there. `localhost` is the only HTTP exception.

## Checks

```bash
npm run check
```
