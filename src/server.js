import 'dotenv/config';
import express from 'express';
import { fetchTmdbImages, buildImageUrl } from './tmdb.js';
import { selectBackdrop, selectPoster } from './selector.js';
import { TtlCache } from './cache.js';

const app = express();
const PORT = process.env.PORT || 3000;
const TMDB_API_KEY = process.env.TMDB_API_KEY;
const POSTER_SIZE = process.env.POSTER_SIZE || 'w780';
const BACKDROP_SIZE = process.env.BACKDROP_SIZE || 'w1280';
const SELECTION_CACHE_TTL = parseInt(process.env.SELECTION_CACHE_TTL || '86400', 10);
const TMDB_CACHE_TTL = parseInt(process.env.TMDB_CACHE_TTL || '3600', 10);

if (!TMDB_API_KEY) {
  console.error('ERROR: TMDB_API_KEY is not set in environment.');
  process.exit(1);
}

// Cache for raw TMDB API responses (shared between backdrop + poster routes)
const tmdbCache = new TtlCache(TMDB_CACHE_TTL);

// Cache for final selected image per title+type (ensures same art on refresh)
const selectionCache = new TtlCache(SELECTION_CACHE_TTL);

// Purge expired cache entries every 30 minutes
setInterval(() => {
  tmdbCache.purgeExpired();
  selectionCache.purgeExpired();
}, 30 * 60 * 1000);

function parseParam(param) {
  const clean = param.replace(/\.(jpg|jpeg|png|webp)$/i, '');
  const parts = clean.split(':');
  if (parts.length !== 3 || parts[0] !== 'tmdb') return null;
  const [, type, tmdbId] = parts;
  if (!['movie', 'series'].includes(type)) return null;
  if (!/^\d+$/.test(tmdbId)) return null;
  return { type, tmdbId };
}

async function getTmdbImages(type, tmdbId) {
  const cacheKey = `tmdb:${type}:${tmdbId}`;
  const cached = tmdbCache.get(cacheKey);
  if (cached) return cached;

  const data = await fetchTmdbImages(type, tmdbId, TMDB_API_KEY);
  tmdbCache.set(cacheKey, data);
  return data;
}

app.get('/backdrop/:param', async (req, res) => {
  const parsed = parseParam(req.params.param);
  if (!parsed) return res.status(400).json({ error: 'Invalid param. Use format: tmdb:{movie|series}:{id}.jpg' });

  const selKey = `backdrop:${parsed.type}:${parsed.tmdbId}`;

  try {
    // Return cached selection if available
    let imageUrl = selectionCache.get(selKey);

    if (!imageUrl) {
      const { backdrops } = await getTmdbImages(parsed.type, parsed.tmdbId);
      const chosen = selectBackdrop(backdrops);
      if (!chosen) return res.status(404).json({ error: 'No backdrop found for this title.' });

      imageUrl = buildImageUrl(chosen.file_path, BACKDROP_SIZE);
      selectionCache.set(selKey, imageUrl);
    }

    res.set('Cache-Control', 'public, max-age=86400');
    return res.redirect(302, imageUrl);
  } catch (err) {
    console.error(`[backdrop] ${parsed.type}:${parsed.tmdbId} — ${err.message}`);
    return res.status(502).json({ error: err.message });
  }
});

app.get('/poster/:param', async (req, res) => {
  const parsed = parseParam(req.params.param);
  if (!parsed) return res.status(400).json({ error: 'Invalid param. Use format: tmdb:{movie|series}:{id}.jpg' });

  const selKey = `poster:${parsed.type}:${parsed.tmdbId}`;

  try {
    let imageUrl = selectionCache.get(selKey);

    if (!imageUrl) {
      const { posters, originalLanguage } = await getTmdbImages(parsed.type, parsed.tmdbId);
      const chosen = selectPoster(posters, originalLanguage);
      if (!chosen) return res.status(404).json({ error: 'No poster found for this title.' });

      imageUrl = buildImageUrl(chosen.file_path, POSTER_SIZE);
      selectionCache.set(selKey, imageUrl);
    }

    res.set('Cache-Control', 'public, max-age=86400');
    return res.redirect(302, imageUrl);
  } catch (err) {
    console.error(`[poster] ${parsed.type}:${parsed.tmdbId} — ${err.message}`);
    return res.status(502).json({ error: err.message });
  }
});

app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.listen(PORT, () => {
  console.log(`tmdb-art-proxy running on port ${PORT}`);
  console.log(`Poster size: ${POSTER_SIZE} | Backdrop size: ${BACKDROP_SIZE}`);
  console.log(`Selection cache TTL: ${SELECTION_CACHE_TTL}s | TMDB cache TTL: ${TMDB_CACHE_TTL}s`);
});
