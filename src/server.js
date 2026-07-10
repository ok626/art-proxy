import 'dotenv/config';
import express from 'express';
import {
  fetchTmdbImages,
  fetchTvdbId,
  getTmdbTextlessBackdropPool,
  getTmdbTextlessBackdropPoolTrust,
  getTmdbAnyBackdropPool,
  getTmdbAnyBackdropPoolTrust,
  getTmdbEnglishPosterPool,
  getTmdbEnglishPosterPoolTrust,
  getTmdbAnyPosterPool,
  getTmdbAnyPosterPoolTrust,
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
const POOL_TTL      = parseInt(process.env.POOL_CACHE_TTL          || '604800', 10);
const POSTER_SEL_TTL   = parseInt(process.env.POSTER_SELECTION_TTL   || '604800', 10);
const BACKDROP_SEL_TTL = parseInt(process.env.BACKDROP_SELECTION_TTL || '43200',  10);

// Mode flags
const TMDB_ONLY  = process.env.TMDB_ONLY  === 'true';
const TMDB_TRUST = process.env.TMDB_TRUST === 'true';

if (!TMDB_KEY) { console.error('ERROR: TMDB_API_KEY not set.'); process.exit(1); }
if (!FANART_KEY && !TMDB_ONLY) { console.error('ERROR: FANART_API_KEY not set. Set TMDB_ONLY=true to run without Fanart.'); process.exit(1); }

const tmdbRawCache   = new TtlCache(parseInt(process.env.TMDB_CACHE_TTL   || '3600', 10));
const fanartRawCache = new TtlCache(parseInt(process.env.FANART_CACHE_TTL || '3600', 10));
const poolCache      = new TtlCache(POOL_TTL);

const posterSelCache   = POSTER_SEL_TTL   > 0 ? new TtlCache(POSTER_SEL_TTL)   : null;
const backdropSelCache = BACKDROP_SEL_TTL > 0 ? new TtlCache(BACKDROP_SEL_TTL) : null;

const backdropRotator = new Rotator();
const posterRotator   = new Rotator();

const inFlightPools = new Map();
const inFlightSel   = new Map();

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

  // Unified format: {tvdb_id}:tmdb:{type}:{tmdb_id}
  if (parts.length === 4 && parts[1] === 'tmdb') {
    const [tvdbId, , type, tmdbId] = parts;
    if (!['movie', 'series'].includes(type)) return null;
    if (!/^\d+$/.test(tmdbId)) return null;
    const resolvedTvdbId = type === 'series' && /^\d+$/.test(tvdbId) ? tvdbId : null;
    return { type, tmdbId, tvdbId: resolvedTvdbId };
  }

  return null;
}

async function getTmdbData(type, tmdbId) {
  const key    = `tmdb:${type}:${tmdbId}`;
  const cached = tmdbRawCache.get(key);
  if (cached) return cached;
  const data = await fetchTmdbImages(type, tmdbId, TMDB_KEY);
  tmdbRawCache.set(key, data);
  return data;
}

async function getFanartData(type, tmdbId, tvdbId) {
  const key    = `fanart:${type}:${tmdbId}`;
  const cached = fanartRawCache.get(key);
  if (cached) return cached;

  let fanartId = tmdbId;
  if (type === 'series') {
    if (tvdbId) {
      fanartId = tvdbId;
    } else {
      const tvdbKey = `tvdb:${tmdbId}`;
      let resolvedTvdbId = tmdbRawCache.get(tvdbKey);
      if (!resolvedTvdbId) {
        resolvedTvdbId = await fetchTvdbId(tmdbId, TMDB_KEY);
        if (resolvedTvdbId) tmdbRawCache.set(tvdbKey, resolvedTvdbId);
      }
      if (!resolvedTvdbId) return { backdrops: [], posters: [] };
      fanartId = resolvedTvdbId;
    }
  }

  const data = await fetchFanartImages(type, fanartId, FANART_KEY);
  fanartRawCache.set(key, data);
  return data;
}

async function getPool(type, tmdbId, artType, tvdbId) {
  const key    = `pool:${artType}:${type}:${tmdbId}`;
  const cached = poolCache.get(key);
  if (cached) return cached;

  // Always fetch TMDB — needed in all modes
  const tmdb = await getTmdbData(type, tmdbId);

  let pool;

  if (TMDB_ONLY) {
    // ── TMDB only mode ──────────────────────────────────────────────────────
    if (artType === 'backdrop') {
      pool = TMDB_TRUST
        ? getTmdbAnyBackdropPoolTrust(tmdb.backdrops, BACKDROP_SIZE)
        : getTmdbAnyBackdropPool(tmdb.backdrops, BACKDROP_SIZE);
    } else {
      pool = TMDB_TRUST
        ? getTmdbAnyPosterPoolTrust(tmdb.posters, tmdb.originalLanguage, POSTER_SIZE)
        : getTmdbAnyPosterPool(tmdb.posters, tmdb.originalLanguage, POSTER_SIZE);
    }
  } else {
    // ── Fanart + TMDB mode ───────────────────────────────────────────────────
    const fanart = await getFanartData(type, tmdbId, tvdbId);

    if (artType === 'backdrop') {
      const tmdbTextlessPool = TMDB_TRUST
        ? getTmdbTextlessBackdropPoolTrust(tmdb.backdrops, BACKDROP_SIZE)
        : getTmdbTextlessBackdropPool(tmdb.backdrops, BACKDROP_SIZE);
      const tmdbAnyPool = TMDB_TRUST
        ? getTmdbAnyBackdropPoolTrust(tmdb.backdrops, BACKDROP_SIZE)
        : getTmdbAnyBackdropPool(tmdb.backdrops, BACKDROP_SIZE);
      pool = selectBackdrop(fanart.backdrops, tmdbTextlessPool, tmdbAnyPool);
    } else {
      const tmdbEnglishPool = TMDB_TRUST
        ? getTmdbEnglishPosterPoolTrust(tmdb.posters, POSTER_SIZE)
        : getTmdbEnglishPosterPool(tmdb.posters, POSTER_SIZE);
      const tmdbAnyPool = TMDB_TRUST
        ? getTmdbAnyPosterPoolTrust(tmdb.posters, tmdb.originalLanguage, POSTER_SIZE)
        : getTmdbAnyPosterPool(tmdb.posters, tmdb.originalLanguage, POSTER_SIZE);
      pool = selectPoster(fanart.posters, tmdbEnglishPool, tmdbAnyPool);
    }
  }

  if (pool && pool.length > 0) poolCache.set(key, pool);
  return pool;
}

function getPoolDeduped(type, tmdbId, artType, tvdbId) {
  const key = `${artType}:${type}:${tmdbId}`;
  if (inFlightPools.has(key)) return inFlightPools.get(key);
  const promise = getPool(type, tmdbId, artType, tvdbId).finally(() => inFlightPools.delete(key));
  inFlightPools.set(key, promise);
  return promise;
}

function getSelectionDeduped(selKey, pool, rotator, selCache) {
  if (inFlightSel.has(selKey)) return inFlightSel.get(selKey);

  const promise = Promise.resolve().then(() => {
    const cached = selCache?.get(selKey);
    if (cached) return cached;
    const chosen = rotator.next(selKey, pool);
    if (!chosen) return null;
    selCache?.set(selKey, chosen.url);
    return chosen.url;
  }).finally(() => inFlightSel.delete(selKey));

  inFlightSel.set(selKey, promise);
  return promise;
}

// ─── Routes ───────────────────────────────────────────────────────────────────

app.get('/backdrop/:param', async (req, res) => {
  const parsed = parseParam(req.params.param);
  if (!parsed) return res.status(400).json({ error: 'Invalid param. Use: {tvdb_id}:tmdb:{movie|series}:{tmdb_id}.jpg' });

  const selKey = `backdrop:${parsed.type}:${parsed.tmdbId}`;

  try {
    let imageUrl = backdropSelCache?.get(selKey) || null;

    if (!imageUrl) {
      const pool = await getPoolDeduped(parsed.type, parsed.tmdbId, 'backdrop', parsed.tvdbId);
      if (!pool || pool.length === 0) return res.status(404).json({ error: 'No backdrop found.' });
      imageUrl = await getSelectionDeduped(selKey, pool, backdropRotator, backdropSelCache);
      if (!imageUrl) return res.status(404).json({ error: 'No backdrop found.' });
    }

    const ccTtl = BACKDROP_SEL_TTL > 0 ? BACKDROP_SEL_TTL : POOL_TTL;
    res.set('Cache-Control', `public, max-age=${ccTtl}`);
    return res.redirect(302, imageUrl);
  } catch (err) {
    console.error(`[backdrop] ${parsed.type}:${parsed.tmdbId} — ${err.message}`);
    return res.status(502).json({ error: err.message });
  }
});

app.get('/poster/:param', async (req, res) => {
  const parsed = parseParam(req.params.param);
  if (!parsed) return res.status(400).json({ error: 'Invalid param. Use: {tvdb_id}:tmdb:{movie|series}:{tmdb_id}.jpg' });

  const selKey = `poster:${parsed.type}:${parsed.tmdbId}`;

  try {
    let imageUrl = posterSelCache?.get(selKey) || null;

    if (!imageUrl) {
      const pool = await getPoolDeduped(parsed.type, parsed.tmdbId, 'poster', parsed.tvdbId);
      if (!pool || pool.length === 0) return res.status(404).json({ error: 'No poster found.' });
      imageUrl = await getSelectionDeduped(selKey, pool, posterRotator, posterSelCache);
      if (!imageUrl) return res.status(404).json({ error: 'No poster found.' });
    }

    const ccTtl = POSTER_SEL_TTL > 0 ? POSTER_SEL_TTL : POOL_TTL;
    res.set('Cache-Control', `public, max-age=${ccTtl}`);
    return res.redirect(302, imageUrl);
  } catch (err) {
    console.error(`[poster] ${parsed.type}:${parsed.tmdbId} — ${err.message}`);
    return res.status(502).json({ error: err.message });
  }
});

app.get('/health', (req, res) => res.json({
  status: 'ok',
  mode: TMDB_ONLY ? 'tmdb_only' : 'fanart+tmdb',
  scoring: TMDB_TRUST ? 'trust' : 'scored',
}));

app.listen(PORT, () => {
  console.log(`tmdb-art-proxy running on port ${PORT}`);
  console.log(`Mode: ${TMDB_ONLY ? 'TMDB only' : 'Fanart + TMDB'} | Scoring: ${TMDB_TRUST ? 'trust' : 'scored'}`);
  console.log(`Poster size: ${POSTER_SIZE} | Backdrop size: ${BACKDROP_SIZE}`);
  console.log(`Pool TTL: ${POOL_TTL}s | Poster sel TTL: ${POSTER_SEL_TTL}s | Backdrop sel TTL: ${BACKDROP_SEL_TTL === 0 ? 'always random' : BACKDROP_SEL_TTL + 's'}`);
});
