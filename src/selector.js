const MIN_LIKES     = parseInt(process.env.FANART_MIN_LIKES    || '5',  10);
const MIN_POOL_SIZE = parseInt(process.env.FANART_MIN_POOL_SIZE || '8',  10);

function isTextless(img) {
  return img.lang === '' || img.lang === '00';
}

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

function mergePools(fanartPool, tmdbPool) {
  if (fanartPool.length >= MIN_POOL_SIZE) return fanartPool;

  const seen   = new Set(fanartPool.map(img => img.url));
  const extras = tmdbPool.filter(img => !seen.has(img.url));
  return [...fanartPool, ...extras];
}

export function selectBackdrop(fanartImages, tmdbPool) {
  const fanartPool = buildFanartPool(
    (fanartImages || []).filter(isTextless)
  );
  return mergePools(fanartPool, tmdbPool || []);
}

export function selectPoster(fanartImages, tmdbPool) {
  const fanartPool = buildFanartPool(
    (fanartImages || []).filter(img => img.lang === 'en')
  );
  return mergePools(fanartPool, tmdbPool || []);
}
