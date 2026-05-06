/**
 * Smart art selector for TMDB images.
 *
 * Language handling:
 *   Backdrops — hard filter textless only, fallback to any if none exist
 *   Posters   — hard filter English only, fallback to original language, then any
 *
 * Within the language-filtered pool:
 *   1. Hard filter: remove below minimum quality gates (resolution, vote count)
 *   2. Score each image independently
 *   3. Take top 30% as random pool
 *   4. Pick randomly
 *   5. Progressive fallback if pool is empty
 */

const BACKDROP_MIN_WIDTH = 1280;
const POSTER_MIN_WIDTH = 500;
const MIN_VOTES_ABSOLUTE = 3;

// ─── Scoring (within an already language-filtered pool) ───────────────────────

function scoreBackdrop(img) {
  const avg = img.vote_average || 0;
  const cnt = img.vote_count || 0;
  const res = Math.log10((img.width || 0) * (img.height || 0) + 1);
  return avg * 1.5 + Math.log10(cnt + 1) * 1.0 + res * 0.5;
}

function scorePoster(img) {
  const avg = img.vote_average || 0;
  const cnt = img.vote_count || 0;
  const res = Math.log10((img.width || 0) * (img.height || 0) + 1);
  return avg * 1.2 + Math.log10(cnt + 1) * 1.0 + res * 0.3;
}

// ─── Hard quality filters ─────────────────────────────────────────────────────

function getVoteFloor(images) {
  const maxVotes = Math.max(...images.map(img => img.vote_count || 0));
  return maxVotes >= MIN_VOTES_ABSOLUTE ? MIN_VOTES_ABSOLUTE : 1;
}

function applyQualityFilter(images, minWidth) {
  const voteFloor = getVoteFloor(images);
  return images.filter(img =>
    (img.width || 0) >= minWidth &&
    (img.vote_count || 0) >= voteFloor &&
    img.file_path
  );
}

// ─── Pool + random selection ──────────────────────────────────────────────────

function buildPool(images, scoreFn) {
  if (images.length === 0) return [];
  const scored = images
    .map(img => ({ img, score: scoreFn(img) }))
    .sort((a, b) => b.score - a.score);
  const poolSize = Math.max(1, Math.ceil(scored.length * 0.30));
  return scored.slice(0, poolSize).map(s => s.img);
}

function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function selectFromPool(images, scoreFn, minWidth) {
  if (images.length === 0) return null;

  // Try with full quality filter
  let filtered = applyQualityFilter(images, minWidth);

  // Relax: drop resolution floor
  if (filtered.length === 0) {
    filtered = applyQualityFilter(images, 0);
  }

  // Ultimate fallback: anything with a file_path
  if (filtered.length === 0) {
    filtered = images.filter(img => img.file_path);
  }

  if (filtered.length === 0) return null;

  return pickRandom(buildPool(filtered, scoreFn));
}

// ─── Public selectors ─────────────────────────────────────────────────────────

/**
 * Backdrops: textless only → fallback to all
 */
export function selectBackdrop(images) {
  if (!images || images.length === 0) return null;

  const textless = images.filter(img => img.iso_639_1 === null);

  return (
    selectFromPool(textless, scoreBackdrop, BACKDROP_MIN_WIDTH) ||
    selectFromPool(images, scoreBackdrop, BACKDROP_MIN_WIDTH)
  );
}

/**
 * Posters: English only → original language → all
 */
export function selectPoster(images, originalLanguage) {
  if (!images || images.length === 0) return null;

  const english = images.filter(img => img.iso_639_1 === 'en');
  const origLang = originalLanguage && originalLanguage !== 'en'
    ? images.filter(img => img.iso_639_1 === originalLanguage)
    : [];

  return (
    selectFromPool(english, scorePoster, POSTER_MIN_WIDTH) ||
    selectFromPool(origLang, scorePoster, POSTER_MIN_WIDTH) ||
    selectFromPool(images, scorePoster, POSTER_MIN_WIDTH)
  );
}
