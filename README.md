# tmdb-art-proxy

A self-hostable Docker app that serves TMDB movie/TV posters and backdrops via simple redirect URLs — designed for use with Stremio addons and catalogs.

## URL Format

```
https://your-domain.com/backdrop/tmdb:{movie|tv}:{tmdb_id}.jpg
https://your-domain.com/poster/tmdb:{movie|tv}:{tmdb_id}.jpg
```

**Examples:**
```
https://your-domain.com/backdrop/tmdb:tv:1396.jpg     → Breaking Bad backdrop
https://your-domain.com/poster/tmdb:movie:550.jpg    → Fight Club poster
```

## Art Selection Logic

**Backdrops:** Prefers textless images (`iso_639_1: null`). From the preferred pool, ranks by a composite quality score (vote average × log(vote count) × log(resolution)), then randomly picks from all candidates that are "close enough" to the best — so you get variety without garbage. Falls back to language-tagged images if no textless exist.

**Posters:** Prefers English (`iso_639_1: "en"`), falls back to the show's original language, then any language. Same smart random pool selection applies.

**Progressive relaxation:** If strict filters leave an empty pool, the app progressively relaxes vote average → vote count → resolution floors before ultimately returning the single best image. You'll never get a 404 due to overly strict filtering.

## Quick Start (Docker)

```bash
# Pull and run
docker run -d \
  -p 3000:3000 \
  -e TMDB_API_KEY=your_api_key_here \
  --name tmdb-art-proxy \
  --restart unless-stopped \
  ghcr.io/ok626/art-proxy:latest
```

## Docker Compose

```bash
# 1. Copy the example env file
cp .env.example .env

# 2. Edit .env and add your TMDB API key

# 3. Start
docker compose up -d
```

## Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `TMDB_API_KEY` | ✅ Yes | — | Your TMDB API key |
| `PORT` | No | `3000` | Port to listen on |
| `CACHE_REDIRECT` | No | `true` | Send cache headers (24h) on redirects |

## Getting a TMDB API Key

1. Create an account at [themoviedb.org](https://www.themoviedb.org)
2. Go to Settings → API
3. Request an API key (free)

## Building Locally

```bash
npm install
cp .env.example .env   # fill in your key
npm run dev
```

## Health Check

```
GET /health → { "status": "ok" }
```
