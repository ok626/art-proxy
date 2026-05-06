const MIN_LIKES     = parseInt(process.env.FANART_MIN_LIKES    || '5',  10);
const MIN_POOL_SIZE = parseInt(process.env.FANART_MIN_POOL_SIZE || '8',  10);

function isTextless(img) {
  return img.lang === '' || img.lang === '00';
}

/**
 * Build a pool of Fanart candidates.
 * Returns normalized { url } objects, sorted by likes, top 50%.
 * Returns empty array if nothing passes the likes floor.
 */
function buildFanartPool(images) {
  if (images.length === 0) return [];

  let filtered = images.filter(img => img.likes >= MIN_LIKES);
  if (filtered.length === 0) {
    filtered = images.filter(img => img.likes >= 1);
  }
  if (filtered.length === 0) return [];

  const sorted   = [...filtered].sort((a, b) => b.likes - a.likes);
  const poolSize = Math.max(1, Math.ceil(sorted.length * 0.50));
  return sorted.slice(0, poolSize).map(img => ({ url: img.url }));
}

function pickRandom(arr) {
  if (!arr || arr.length === 0) return null;
  return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * Merge Fanart pool with TMDB pool if Fanart doesn't have enough variety.
 * If Fanart pool >= MIN_POOL_SIZE, use Fanart only.
 * Otherwise supplement with TMDB candidates (deduped by url).
 */
function mergePools(fanartPool, tmdbPool) {
  if (fanartPool.length >= MIN_POOL_SIZE) return fanartPool;

  // Supplement with TMDB, deduping by url
  const seen = new Set(fanartPool.map(img => img.url));
  const extras = tmdbPool.filter(img => !seen.has(img.url));
  return [...fanartPool, ...extras];
}

/**
 * Select a backdrop.
 * Fanart textless pool — if < MIN_POOL_SIZE, supplement with TMDB pool.
 * tmdbPool should already be filtered/scored (from getTmdbBackdropPool).
 */
export function selectBackdrop(fanartImages, tmdbPool) {
  const fanartPool = buildFanartPool(
    (fanartImages || []).filter(isTextless)
  );
  const pool = mergePools(fanartPool, tmdbPool || []);
  return pickRandom(pool);
}

export function selectPoster(fanartImages, tmdbPool) {
  const fanartPool = buildFanartPool(
    (fanartImages || []).filter(img => img.lang === 'en')
  );
  const pool = mergePools(fanartPool, tmdbPool || []);
  return pickRandom(pool);
}
