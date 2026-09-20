# GRR Channel Routers — Enhanced Caching

Three Cloudflare Workers serving VOD content from R2, now using **Workers Caching** instead of the Cache API for global tiered caching, request collapsing, and accurate cache hit analytics.

## What changed

- **Removed all `caches.default` (Cache API) code** — Workers Caching handles caching automatically, *before* the Worker runs.
- **Added `cache.enabled: true`** in each `wrangler.jsonc` — enables the CDN-level cache.
- **Fixed `.ts` Content-Type** — overrides `application/dlna-mpeg-tts` → `video/mp2t` so the CDN caches video segments.
- **Set `.m3u8` Content-Type** to `application/vnd.apple.mpegurl` for consistency.
- **Added `Cache-Control` to the fallback path** so all responses are cacheable.

## Project structure

```
├── grr-channel-router/   # Channel 6 (channel01.grrchannel.com)
│   ├── src/index.js
│   ├── wrangler.jsonc
│   └── package.json
├── channel2-router/       # Channel 2 (channel02.grrchannel.com)
│   ├── src/index.js
│   ├── wrangler.jsonc
│   └── package.json
├── channel9-router/        # Channel 9 (channel09.grrchannel.com)
│   ├── src/index.js
│   ├── wrangler.jsonc
│   └── package.json
└── README.md
```

## Deploy via Workers Builds (GitHub integration)

Each Worker needs its own repository (or subdirectory) connected via Workers Builds.

### Option A: Separate repos (recommended)

1. Create three GitHub repos (e.g. `grr-channel-router`, `channel2-router`, `channel9-router`).
2. Copy each directory's contents into the corresponding repo.
3. In the Cloudflare dashboard, go to **Workers & Pages** → select the Worker → **Settings** → **Builds** → **Connect**.
4. Connect the GitHub repo, set deploy command to `npx wrangler deploy`.
5. Push a commit to trigger the first deploy.

### Option B: Monorepo with subdirectories

1. Push this entire repo to GitHub.
2. For each Worker, connect via Workers Builds and set the **root directory** to the Worker's folder (e.g. `grr-channel-router/`).
3. Deploy command: `npx wrangler deploy`.

## Deploy via local Wrangler (alternative)

```bash
cd grr-channel-router
npx wrangler deploy
```

Repeat for each Worker directory. Requires `npx wrangler login` first.

## Cache TTLs

| Content type | Cache-Control | TTL |
|---|---|---|
| `.m3u8` playlists | `public, max-age=604800` | 7 days |
| `.ts` segments | `public, max-age=2592000, immutable` | 30 days |
| Fallback (other files) | `public, max-age=86400` | 1 day |
| `/api/live-sync` | `no-store` | not cached |
| `/api/epg.xml` | `public, max-age=300` | 5 minutes |

## Requirements

- Wrangler 4.69.0+ (Workers Builds uses this automatically)
- `compatibility_date: 2026-07-06` or later
- R2 bucket `grr-channel` must exist on the account
