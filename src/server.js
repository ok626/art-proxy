import 'dotenv/config';
import express from 'express';
import {
  fetchTmdbImages,
  fetchTvdbId,
  getTmdbBackdropPool,
  getTmdbPosterPool,
} from './tmdb.js';
import { fetchFanartImages } from './fanart.js';
import { selectBackdrop, selectPoster } from './selector.js';
import { TtlCache } from './cache.js';
import { Rotator } from './rotator.js';

const app           = express();
const PORT          = process.env.PORT                       || 3000;
const TMDB_KEY      = process.env.TMDB_API_KEY;
const FANART_KEY    = process.env.FANART_API_KEY;
const POSTER_SIZE   = process.env.POSTER_SIZE                || 'w780';
const BACKDROP_SIZE = process.env.BACKDROP_SIZE              || 'w1280';
const POOL_TTL      = parseInt(process.env.POOL_CACHE_TTL       || '21600', 10);
const POSTER_SEL_TTL    = parseInt(process.env.POSTER_SELECTION_TTL    || '86400', 10);
const BACKDROP_SEL_TTL  = parseInt(process.env.BACKDROP_SELECTION_TTL  || '0',     10);

if (!TMDB_KEY)   { console.error('ERROR: TMDB_API_KEY not set.');   process.exit(1); }
if (!FANART_KEY) { console.error('ERROR: FANART_API_KEY not set.'); process.exit(1); }

// Raw API response caches
const tmdbRawCache   = new TtlCache(parseInt(process.env.TMDB_CACHE_TTL   || '3600', 10));
const fanartRawCache = new TtlCache(parseInt(process.env.FANART_CACHE_TTL || '3600', 10));

// Pool cache — stores the combined filtered candidate URL list per title
const poolCache = new TtlCache(POOL_TTL);

// Selection caches — null if TTL is 0 (always pick fresh)
const posterSelCache   = POSTER_SEL_TTL   > 0 ? new TtlCache(POSTER_SEL_TTL)   : null;
const backdropSelCache = BACKDROP_SEL_TTL > 0 ? new TtlCache(BACKDROP_SEL_TTL) : null;

// Rotators — guarantee no repeats until full pool is exhausted
const backdropRotator = new Rotator();
const posterRotator   = new Rotator();

setInterval(() => {
  tmdbRawCache.purgeExpired();
  fanartRawCache.purgeExpired();
  poolCache.purgeExpired();
  posterSelCache?.purgeExpired();
  backdropSelCache?.purgeExpired();
}, 30 * 60 * 1000);

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseParam(param) {
  const clean = param.replace(/\.(jpg|jpeg|png|webp)$/i, '');
  const parts = clean.split(':');
  if (parts.length !== 3 || parts[0] !== 'tmdb') return null;
  const [, type, tmdbId] = parts;
  if (!['movie', 'series'].includes(type)) return null;
  if (!/^\d+$/.test(tmdbId)) return null;
  return { type, tmdbId };
}

async function getTmdbData(type, tmdbId) {
  const key = `tmdb:${type}:${tmdbId}`;
  const cached = tmdbRawCache.get(key);
  if (cached) return cached;
  const data = await fetchTmdbImages(type, tmdbId, TMDB_KEY);
  tmdbRawCache.set(key, data);
  return data;
}

async function getFanartData(type, tmdbId) {
  const key = `fanart:${type}:${tmdbId}`;
  const cached = fanartRawCache.get(key);
  if (cached) return cached;

  let fanartId = tmdbId;
  if (type === 'series') {
    const tvdbKey = `tvdb:${tmdbId}`;
    let tvdbId = tmdbRawCache.get(tvdbKey);
    if (!tvdbId) {
      tvdbId = await fetchTvdbId(tmdbId, TMDB_KEY);
      if (tvdbId) tmdbRawCache.set(tvdbKey, tvdbId);
    }
    if (!tvdbId) return { backdrops: [], posters: [] };
    fanartId = tvdbId;
  }

  const data = await fetchFanartImages(type, fanartId, FANART_KEY);
  fanartRawCache.set(key, data);
  return data;
}

async function getPool(type, tmdbId, artType) {
  const key = `pool:${artType}:${type}:${tmdbId}`;
  const cached = poolCache.get(key);
  if (cached) return cached;

  const [fanart, tmdb] = await Promise.all([
    getFanartData(type, tmdbId),
    getTmdbData(type, tmdbId),
  ]);

  let pool;
  if (artType === 'backdrop') {
    const tmdbPool = getTmdbBackdropPool(tmdb.backdrops, BACKDROP_SIZE);
    pool = selectBackdrop(fanart.backdrops, tmdbPool);
  } else {
    const tmdbPool = getTmdbPosterPool(tmdb.posters, tmdb.originalLanguage, POSTER_SIZE);
    pool = selectPoster(fanart.posters, tmdbPool);
  }

  if (pool && pool.length > 0) poolCache.set(key, pool);
  return pool;
}

// ─── Routes ───────────────────────────────────────────────────────────────────

app.get('/backdrop/:param', async (req, res) => {
  const parsed = parseParam(req.params.param);
  if (!parsed) return res.status(400).json({ error: 'Invalid param. Use: tmdb:{movie|series}:{id}.jpg' });

  const selKey = `backdrop:${parsed.type}:${parsed.tmdbId}`;

  try {
    let imageUrl = backdropSelCache?.get(selKey) || null;

    if (!imageUrl) {
      const pool = await getPool(parsed.type, parsed.tmdbId, 'backdrop');
      if (!pool || pool.length === 0) return res.status(404).json({ error: 'No backdrop found.' });

      const chosen = backdropRotator.next(selKey, pool);
      if (!chosen) return res.status(404).json({ error: 'No backdrop found.' });

      imageUrl = chosen.url;
      backdropSelCache?.set(selKey, imageUrl);
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
  if (!parsed) return res.status(400).json({ error: 'Invalid param. Use: tmdb:{movie|series}:{id}.jpg' });

  const selKey = `poster:${parsed.type}:${parsed.tmdbId}`;

  try {
    let imageUrl = posterSelCache?.get(selKey) || null;

    if (!imageUrl) {
      const pool = await getPool(parsed.type, parsed.tmdbId, 'poster');
      if (!pool || pool.length === 0) return res.status(404).json({ error: 'No poster found.' });

      const chosen = posterRotator.next(selKey, pool);
      if (!chosen) return res.status(404).json({ error: 'No poster found.' });

      imageUrl = chosen.url;
      posterSelCache?.set(selKey, imageUrl);
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
  console.log(`Pool cache TTL: ${POOL_TTL}s`);
  console.log(`Poster selection TTL: ${POSTER_SEL_TTL}s | Backdrop selection TTL: ${BACKDROP_SEL_TTL === 0 ? 'always random' : BACKDROP_SEL_TTL + 's'}`);
});
