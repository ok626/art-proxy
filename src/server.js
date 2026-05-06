import 'dotenv/config';
import express from 'express';
import { fetchTmdbImages, fetchTvdbId, tmdbFallbackBackdrop, tmdbFallbackPoster } from './tmdb.js';
import { fetchFanartImages } from './fanart.js';
import { selectBackdrop, selectPoster } from './selector.js';
import { TtlCache } from './cache.js';

const app = express();
const PORT         = process.env.PORT            || 3000;
const TMDB_KEY     = process.env.TMDB_API_KEY;
const FANART_KEY   = process.env.FANART_API_KEY;
const POSTER_SIZE  = process.env.POSTER_SIZE     || 'w780';
const BACKDROP_SIZE= process.env.BACKDROP_SIZE   || 'w1280';
const SEL_TTL      = parseInt(process.env.SELECTION_CACHE_TTL || '86400', 10);
const TMDB_TTL     = parseInt(process.env.TMDB_CACHE_TTL      || '3600',  10);
const FANART_TTL   = parseInt(process.env.FANART_CACHE_TTL    || '3600',  10);

if (!TMDB_KEY)   { console.error('ERROR: TMDB_API_KEY not set.');   process.exit(1); }
if (!FANART_KEY) { console.error('ERROR: FANART_API_KEY not set.'); process.exit(1); }

const tmdbCache     = new TtlCache(TMDB_TTL);
const fanartCache   = new TtlCache(FANART_TTL);
const selectionCache= new TtlCache(SEL_TTL);

setInterval(() => {
  tmdbCache.purgeExpired();
  fanartCache.purgeExpired();
  selectionCache.purgeExpired();
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
  const cached = tmdbCache.get(key);
  if (cached) return cached;
  const data = await fetchTmdbImages(type, tmdbId, TMDB_KEY);
  tmdbCache.set(key, data);
  return data;
}

async function getFanartData(type, tmdbId) {
  const key = `fanart:${type}:${tmdbId}`;
  const cached = fanartCache.get(key);
  if (cached) return cached;

  // TV needs TVDB ID — look it up (also cached via tmdb external_ids)
  let fanartId = tmdbId;
  if (type === 'series') {
    const tvdbKey = `tvdb:${tmdbId}`;
    let tvdbId = tmdbCache.get(tvdbKey);
    if (!tvdbId) {
      tvdbId = await fetchTvdbId(tmdbId, TMDB_KEY);
      if (tvdbId) tmdbCache.set(tvdbKey, tvdbId);
    }
    if (!tvdbId) return { backdrops: [], posters: [] }; // can't look up without TVDB ID
    fanartId = tvdbId;
  }

  const data = await fetchFanartImages(type, fanartId, FANART_KEY);
  fanartCache.set(key, data);
  return data;
}

// ─── Routes ───────────────────────────────────────────────────────────────────

app.get('/backdrop/:param', async (req, res) => {
  const parsed = parseParam(req.params.param);
  if (!parsed) return res.status(400).json({ error: 'Invalid param. Use: tmdb:{movie|series}:{id}.jpg' });

  const selKey = `backdrop:${parsed.type}:${parsed.tmdbId}`;

  try {
    let imageUrl = selectionCache.get(selKey);

    if (!imageUrl) {
      // 1. Try Fanart first
      const fanart = await getFanartData(parsed.type, parsed.tmdbId);
      const chosen = selectBackdrop(fanart.backdrops);

      if (chosen) {
        imageUrl = chosen.url;
      } else {
        // 2. Fallback to TMDB — first textless, then any
        const tmdb = await getTmdbData(parsed.type, parsed.tmdbId);
        imageUrl = tmdbFallbackBackdrop(tmdb.backdrops);
      }

      if (!imageUrl) return res.status(404).json({ error: 'No backdrop found.' });
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
  if (!parsed) return res.status(400).json({ error: 'Invalid param. Use: tmdb:{movie|series}:{id}.jpg' });

  const selKey = `poster:${parsed.type}:${parsed.tmdbId}`;

  try {
    let imageUrl = selectionCache.get(selKey);

    if (!imageUrl) {
      // 1. Try Fanart first
      const fanart = await getFanartData(parsed.type, parsed.tmdbId);
      const { originalLanguage } = await getTmdbData(parsed.type, parsed.tmdbId);
      const chosen = selectPoster(fanart.posters, originalLanguage);

      if (chosen) {
        imageUrl = chosen.url;
      } else {
        // 2. Fallback to TMDB — first English, then original lang, then any
        const tmdb = await getTmdbData(parsed.type, parsed.tmdbId);
        imageUrl = tmdbFallbackPoster(tmdb.posters, tmdb.originalLanguage);
      }

      if (!imageUrl) return res.status(404).json({ error: 'No poster found.' });
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
  console.log(`Fanart → TMDB fallback enabled`);
});
