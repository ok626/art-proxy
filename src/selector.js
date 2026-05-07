const MIN_LIKES     = parseInt(process.env.FANART_MIN_LIKES     || '1', 10);
const MIN_POOL_SIZE = parseInt(process.env.FANART_MIN_POOL_SIZE || '8', 10);

function isTextless(img) {
  return img.lang === '' || img.lang === '00';
}

/**
 * Build Fanart candidate pool from a language-filtered set.
 * Always includes all images in the correct language regardless of likes.
 * Likes used only for sorting preference.
 * Returns { pool, hasAnyMatch }
 */
function buildFanartPool(images) {
  if (images.length === 0) return { pool: [], hasAnyMatch: false };

  const sorted = [...images].sort((a, b) => b.likes - a.likes);
  const pool   = sorted.map(img => ({ url: img.url }));
  return { pool, hasAnyMatch: true };
}

function mergePools(fanartPool, tmdbPool) {
  if (fanartPool.length >= MIN_POOL_SIZE) return fanartPool;
  const seen   = new Set(fanartPool.map(img => img.url));
  const extras = tmdbPool.filter(img => !seen.has(img.url));
  return [...fanartPool, ...extras];
}

/**
 * Select backdrop pool.
 *
 * Fanart has textless:
 *   → merge with TMDB textless-only pool (never foreign from TMDB)
 * Fanart has no textless:
 *   → use TMDB any pool (textless → any language as last resort)
 */
export function selectBackdrop(fanartImages, tmdbTextlessPool, tmdbAnyPool) {
  const textless = (fanartImages || []).filter(isTextless);
  const { pool: fanartPool, hasAnyMatch } = buildFanartPool(textless);

  if (!hasAnyMatch) {
    // Fanart has no textless at all — TMDB handles everything including language fallback
    return tmdbAnyPool;
  }

  // Fanart has textless — only supplement with TMDB textless, never foreign
  return mergePools(fanartPool, tmdbTextlessPool);
}

/**
 * Select poster pool.
 *
 * Fanart has English:
 *   → merge with TMDB English-only pool (never foreign from TMDB)
 * Fanart has no English:
 *   → use TMDB any pool (English → original lang → any language as last resort)
 */
export function selectPoster(fanartImages, tmdbEnglishPool, tmdbAnyPool) {
  const english = (fanartImages || []).filter(img => img.lang === 'en');
  const { pool: fanartPool, hasAnyMatch } = buildFanartPool(english);

  if (!hasAnyMatch) {
    // Fanart has no English at all — TMDB handles everything including language fallback
    return tmdbAnyPool;
  }

  // Fanart has English — only supplement with TMDB English, never foreign
  return mergePools(fanartPool, tmdbEnglishPool);
}
