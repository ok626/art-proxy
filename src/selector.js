/**
 * Art selector — operates on normalized Fanart image objects:
 * { url, likes, lang }
 *
 * Backdrops: textless only (lang === '' or '00') → fallback to all
 * Posters:   English only (lang === 'en')        → fallback to original lang → fallback to all
 *
 * Quality filter within each language pool:
 *   - minimum likes threshold (configurable, default 5)
 *   - if nothing clears the threshold, relax to 1 like
 *   - if still nothing, accept any
 *
 * Final selection: score by likes, take top 30%, pick randomly
 */

const MIN_LIKES = parseInt(process.env.FANART_MIN_LIKES || '5', 10);

// ─── Textless detection ───────────────────────────────────────────────────────
// Fanart uses '' (empty string) or '00' to indicate no language / textless

function isTextless(img) {
  return img.lang === '' || img.lang === '00';
}

// ─── Scoring (by likes only — Fanart's quality signal) ────────────────────────

function scoreImage(img) {
  return img.likes;
}

// ─── Pool builder ─────────────────────────────────────────────────────────────

function buildPool(images, minLikes) {
  if (images.length === 0) return [];

  let filtered = images.filter(img => img.likes >= minLikes);

  if (filtered.length === 0) {
    filtered = images.filter(img => img.likes >= 1);
  }

  if (filtered.length === 0) return [];

  const sorted = [...filtered].sort((a, b) => scoreImage(b) - scoreImage(a));
  const poolSize = Math.max(1, Math.ceil(sorted.length * 0.30));
  return sorted.slice(0, poolSize);
}

function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)] || null;
}

// ─── Public selectors ─────────────────────────────────────────────────────────

/**
 * Select a backdrop from Fanart images.
 * Prefers textless, falls back to any language.
 */
export function selectBackdrop(images) {
  if (!images || images.length === 0) return null;

  const textless = images.filter(isTextless);
  const pool = buildPool(textless, MIN_LIKES);
  if (pool.length > 0) return pickRandom(pool);

  // Fallback: any language
  const fallbackPool = buildPool(images, MIN_LIKES);
  return pickRandom(fallbackPool);
}

/**
 * Select a poster from Fanart images.
 * Prefers English, falls back to original language, then any.
 */
export function selectPoster(images, originalLanguage) {
  if (!images || images.length === 0) return null;

  const english  = images.filter(img => img.lang === 'en');
  const origLang = originalLanguage && originalLanguage !== 'en'
    ? images.filter(img => img.lang === originalLanguage)
    : [];

  return (
    pickRandom(buildPool(english, MIN_LIKES)) ||
    pickRandom(buildPool(origLang, MIN_LIKES)) ||
    pickRandom(buildPool(images, MIN_LIKES))
  );
}
