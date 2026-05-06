/**
 * Smart art selector for TMDB images.
 *
 * Architecture:
 *   1. Hard filter: remove anything below minimum quality gates
 *   2. Score each image independently (no "relative to best" anchoring)
 *   3. Sort by score, take top 30%
 *   4. Pick randomly from that pool
 *   5. Progressive fallback if pool is empty
 */

// ─── Hard filter constants ───────────────────────────────────────────────────

const BACKDROP_MIN_WIDTH = 1280;
const POSTER_MIN_WIDTH = 500;
const MIN_VOTES_ABSOLUTE = 3; // ignored only if even the top image doesn't meet it

// ─── Scoring weights ─────────────────────────────────────────────────────────

const WEIGHTS = {
  backdrop: {
    voteAverage: 1.5,
    voteCount: 1.0,
    resolution: 0.5,
    textlessBonus: 2.0,
  },
  poster: {
    voteAverage: 1.2,
    voteCount: 1.0,
    resolution: 0.3,
    englishBonus: 3.0,
    nullLangBonus: 1.0,
  },
};

// ─── Scoring ──────────────────────────────────────────────────────────────────

function scoreBackdrop(img) {
  const w = WEIGHTS.backdrop;
  const avg = img.vote_average || 0;
  const cnt = img.vote_count || 0;
  const res = Math.log10((img.width || 0) * (img.height || 0) + 1);
  const textless = img.iso_639_1 === null ? w.textlessBonus : 0;
  return avg * w.voteAverage + Math.log10(cnt + 1) * w.voteCount + res * w.resolution + textless;
}

function scorePoster(img) {
  const w = WEIGHTS.poster;
  const avg = img.vote_average || 0;
  const cnt = img.vote_count || 0;
  const res = Math.log10((img.width || 0) * (img.height || 0) + 1);
  const langBonus = img.iso_639_1 === 'en'
    ? w.englishBonus
    : img.iso_639_1 === null
      ? w.nullLangBonus
      : 0;
  return avg * w.voteAverage + Math.log10(cnt + 1) * w.voteCount + res * w.resolution + langBonus;
}

// ─── Hard filters ─────────────────────────────────────────────────────────────

function hardFilterBackdrops(images) {
  // Check if even the best image fails the vote floor — if so, relax it
  const sorted = [...images].sort((a, b) => (b.vote_count || 0) - (a.vote_count || 0));
  const voteFloor = (sorted[0]?.vote_count || 0) >= MIN_VOTES_ABSOLUTE ? MIN_VOTES_ABSOLUTE : 1;

  return images.filter(img =>
    (img.width || 0) >= BACKDROP_MIN_WIDTH &&
    (img.vote_count || 0) >= voteFloor &&
    img.file_path
  );
}

function hardFilterPosters(images) {
  const sorted = [...images].sort((a, b) => (b.vote_count || 0) - (a.vote_count || 0));
  const voteFloor = (sorted[0]?.vote_count || 0) >= MIN_VOTES_ABSOLUTE ? MIN_VOTES_ABSOLUTE : 1;

  return images.filter(img =>
    (img.width || 0) >= POSTER_MIN_WIDTH &&
    (img.vote_count || 0) >= voteFloor &&
    img.file_path
  );
}

// ─── Pool selection ───────────────────────────────────────────────────────────

/**
 * Score, sort, and return the top 30% as the random pool.
 * Always guarantees at least 1 candidate (the best).
 */
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

// ─── Public selectors ─────────────────────────────────────────────────────────

/**
 * Select a backdrop. Prefers textless via scoring bonus, not hard filter,
 * so textless images naturally float to the top without excluding everything else.
 */
export function selectBackdrop(images) {
  if (!images || images.length === 0) return null;

  // Try with full hard filters
  let filtered = hardFilterBackdrops(images);

  // Fallback: relax resolution floor
  if (filtered.length === 0) {
    filtered = images.filter(img => img.file_path);
  }

  if (filtered.length === 0) return null;

  const pool = buildPool(filtered, scoreBackdrop);
  return pickRandom(pool);
}

/**
 * Select a poster. English is strongly preferred via scoring bonus.
 * Falls back through null-language, then anything valid.
 */
export function selectPoster(images, originalLanguage) {
  if (!images || images.length === 0) return null;

  // Try with full hard filters
  let filtered = hardFilterPosters(images);

  // Fallback: relax resolution floor
  if (filtered.length === 0) {
    filtered = images.filter(img => img.file_path);
  }

  if (filtered.length === 0) return null;

  // If there are English or null-lang posters, prefer that subset
  // but don't hard-exclude others — the scoring handles preference
  const pool = buildPool(filtered, scorePoster);
  return pickRandom(pool);
}
