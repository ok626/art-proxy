import 'dotenv/config';
import express from 'express';
import { fetchTmdbImages, buildImageUrl } from './tmdb.js';
import { selectBackdrop, selectPoster } from './selector.js';

const app = express();
const PORT = process.env.PORT || 3000;
const TMDB_API_KEY = process.env.TMDB_API_KEY;
const CACHE_REDIRECT = process.env.CACHE_REDIRECT !== 'false'; // default true

if (!TMDB_API_KEY) {
  console.error('ERROR: TMDB_API_KEY is not set in environment.');
  process.exit(1);
}

/**
 * Parse the path param like "tmdb:movie:550" or "tmdb:tv:1396"
 * Returns { type, tmdbId } or null
 */
function parseParam(param) {
  // Strip trailing .jpg/.png/.webp if present
  const clean = param.replace(/\.(jpg|jpeg|png|webp)$/i, '');
  const parts = clean.split(':');
  if (parts.length !== 3 || parts[0] !== 'tmdb') return null;
  const [, type, tmdbId] = parts;
  if (!['movie', 'series'].includes(type)) return null;
  if (!/^\d+$/.test(tmdbId)) return null;
  return { type, tmdbId };
}

/**
 * GET /backdrop/:param
 * e.g. /backdrop/tmdb:tv:238.jpg
 */
app.get('/backdrop/:param', async (req, res) => {
  const parsed = parseParam(req.params.param);
  if (!parsed) return res.status(400).json({ error: 'Invalid param. Use format: tmdb:{movie|tv}:{id}.jpg' });

  try {
    const { backdrops } = await fetchTmdbImages(parsed.type, parsed.tmdbId, TMDB_API_KEY);
    const chosen = selectBackdrop(backdrops);

    if (!chosen) return res.status(404).json({ error: 'No backdrop found for this title.' });

    const imageUrl = buildImageUrl(chosen.file_path);

    // 302 redirect to TMDB CDN — clients cache the image themselves
    res.set('Cache-Control', CACHE_REDIRECT ? 'public, max-age=86400' : 'no-store');
    return res.redirect(302, imageUrl);
  } catch (err) {
    console.error(`[backdrop] ${parsed.type}:${parsed.tmdbId} — ${err.message}`);
    return res.status(502).json({ error: err.message });
  }
});

/**
 * GET /poster/:param
 * e.g. /poster/tmdb:movie:550.jpg
 */
app.get('/poster/:param', async (req, res) => {
  const parsed = parseParam(req.params.param);
  if (!parsed) return res.status(400).json({ error: 'Invalid param. Use format: tmdb:{movie|tv}:{id}.jpg' });

  try {
    const { posters, originalLanguage } = await fetchTmdbImages(parsed.type, parsed.tmdbId, TMDB_API_KEY);
    const chosen = selectPoster(posters, originalLanguage);

    if (!chosen) return res.status(404).json({ error: 'No poster found for this title.' });

    const imageUrl = buildImageUrl(chosen.file_path);

    res.set('Cache-Control', CACHE_REDIRECT ? 'public, max-age=86400' : 'no-store');
    return res.redirect(302, imageUrl);
  } catch (err) {
    console.error(`[poster] ${parsed.type}:${parsed.tmdbId} — ${err.message}`);
    return res.status(502).json({ error: err.message });
  }
});

/**
 * Health check
 */
app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.listen(PORT, () => {
  console.log(`tmdb-art-proxy running on port ${PORT}`);
});
