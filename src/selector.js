const MIN_LIKES = parseInt(process.env.FANART_MIN_LIKES || '5', 10);

function isTextless(img) {
  return img.lang === '' || img.lang === '00';
}

function scoreImage(img) {
  return img.likes;
}

function buildPool(images, minLikes) {
  if (images.length === 0) return [];

  let filtered = images.filter(img => img.likes >= minLikes);

  if (filtered.length === 0) {
    filtered = images.filter(img => img.likes >= 1);
  }

  if (filtered.length === 0) return [];

  const sorted = [...filtered].sort((a, b) => scoreImage(b) - scoreImage(a));
  const poolSize = Math.max(1, Math.ceil(sorted.length * 0.80));
  return sorted.slice(0, poolSize);
}

function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)] || null;
}

/**
 * Backdrops: textless only, no Fanart fallback to other languages.
 * Returns null if nothing good → server falls back to TMDB.
 */
export function selectBackdrop(images) {
  if (!images || images.length === 0) return null;
  const textless = images.filter(isTextless);
  return pickRandom(buildPool(textless, MIN_LIKES));
}

/**
 * Posters: English only, no Fanart fallback to other languages.
 * Returns null if nothing good → server falls back to TMDB.
 */
export function selectPoster(images) {
  if (!images || images.length === 0) return null;
  const english = images.filter(img => img.lang === 'en');
  return pickRandom(buildPool(english, MIN_LIKES));
}
