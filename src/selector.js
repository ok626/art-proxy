/**
 * Smart art selector for TMDB images.
 *
 * Strategy:
 *   1. Filter by language preference (textless for backdrops, "en" for posters)
 *   2. Among those, find the "best" image (highest score = weighted vote_average * log(vote_count+1) * resolution)
 *   3. Build a candidate pool: images that are "close enough" to the best
 *   4. Pick randomly from the pool
 *   5. If pool is empty, progressively relax filters and retry
 */

const MIN_ABSOLUTE_VOTES = 3;

/**
 * Resolution score: width * height (pixels)
 */
function resolutionScore(img) {
  return (img.width || 0) * (img.height || 0);
}

/**
 * Composite quality score used to rank images.
 * Weights: vote_average heavily, vote_count logarithmically, resolution as tiebreaker.
 */
function qualityScore(img) {
  const avg = img.vote_average || 0;
  const cnt = img.vote_count || 0;
  const res = resolutionScore(img);
  // log scale for vote count so 1000 votes isn't 1000x better than 1 vote
  return avg * Math.log10(cnt + 2) * Math.log10(res + 1);
}

/**
 * Determine the absolute minimum vote count to consider.
 * If even the best image doesn't hit MIN_ABSOLUTE_VOTES, we relax the floor to 1.
 */
function getVoteFloor(best) {
  return (best.vote_count || 0) >= MIN_ABSOLUTE_VOTES ? MIN_ABSOLUTE_VOTES : 1;
}

/**
 * Build a candidate pool from a sorted list of images.
 *
 * Thresholds (all relative to the best image):
 *   - vote_average >= 40% of best's average
 *   - vote_count   >= 30% of best's count  (and >= absolute floor)
 *   - resolution   >= 50% of best's resolution pixels
 *     (e.g. best is 4K → floor is ~2.8MP which is roughly 1920x1440,
 *      so 1080p still qualifies since 2.07M >= 50% of 8.29M? No — 1080p is 25%.)
 *
 * Resolution logic is deliberately generous:
 *   if best >= 4K (8.29MP), floor = 1080p (2.07MP) — roughly 25% floor
 *   we use a stepped floor instead of strict 50% to match your UX intent.
 */
function resolutionFloor(bestRes) {
  // Stepped resolution floors
  const p4k = 3840 * 2160; // 8,294,400
  const p1080 = 1920 * 1080; // 2,073,600
  const p720 = 1280 * 720; //   921,600

  if (bestRes >= p4k) return p1080;      // best is 4K → floor is 1080p
  if (bestRes >= p1080) return p720;     // best is 1080p → floor is 720p
  return Math.floor(bestRes * 0.5);      // best is low → floor is 50% of it
}

/**
 * Core filtering function.
 * @param {Array} images - TMDB image objects
 * @param {Object} opts
 * @param {boolean} opts.relaxVoteAverage
 * @param {boolean} opts.relaxVoteCount
 * @param {boolean} opts.relaxResolution
 */
function filterCandidates(images, best, opts = {}) {
  const bestRes = resolutionScore(best);
  const resFloor = resolutionFloor(bestRes);
  const voteFloor = getVoteFloor(best);

  const avgFloor = opts.relaxVoteAverage ? 0 : (best.vote_average || 0) * 0.40;
  const cntFloor = opts.relaxVoteCount ? voteFloor : Math.max(voteFloor, Math.floor((best.vote_count || 0) * 0.30));
  const rFloor = opts.relaxResolution ? 0 : resFloor;

  return images.filter(img => {
    if ((img.vote_count || 0) < voteFloor && !opts.relaxVoteCount) return false; // hard floor unless relaxed
    if ((img.vote_average || 0) < avgFloor) return false;
    if ((img.vote_count || 0) < cntFloor) return false;
    if (resolutionScore(img) < rFloor) return false;
    return true;
  });
}

/**
 * Pick a random element from an array.
 */
function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * Main selector for BACKDROP images.
 * Prefers textless (iso_639_1 === null), falls back to any.
 *
 * @param {Array} images - raw TMDB backdrops array
 * @returns {Object|null} chosen image object or null
 */
function selectBackdrop(images) {
  if (!images || images.length === 0) return null;

  // Separate textless vs. language-tagged
  const textless = images.filter(img => img.iso_639_1 === null);
  const anyLang = images;

  for (const pool of [textless, anyLang]) {
    if (pool.length === 0) continue;

    // Sort by quality score descending
    const sorted = [...pool].sort((a, b) => qualityScore(b) - qualityScore(a));
    const best = sorted[0];

    // Progressive relaxation: try strict → relax vote_average → relax vote_count → relax resolution
    const relaxationSteps = [
      {},
      { relaxVoteAverage: true },
      { relaxVoteAverage: true, relaxVoteCount: true },
      { relaxVoteAverage: true, relaxVoteCount: true, relaxResolution: true },
    ];

    for (const relaxOpts of relaxationSteps) {
      const candidates = filterCandidates(sorted, best, relaxOpts);
      if (candidates.length > 0) return pickRandom(candidates);
    }

    // Ultimate fallback: just return the best
    return best;
  }

  return null;
}

/**
 * Main selector for POSTER images.
 * Prefers English (iso_639_1 === "en"), falls back to original language, then any.
 *
 * @param {Array} images - raw TMDB posters array
 * @param {string} [originalLanguage] - e.g. "ko", "ja" — the show's original language
 * @returns {Object|null}
 */
function selectPoster(images, originalLanguage) {
  if (!images || images.length === 0) return null;

  const english = images.filter(img => img.iso_639_1 === 'en');
  const origLang = originalLanguage
    ? images.filter(img => img.iso_639_1 === originalLanguage)
    : [];
  const anyLang = images;

  for (const pool of [english, origLang, anyLang]) {
    if (pool.length === 0) continue;

    const sorted = [...pool].sort((a, b) => qualityScore(b) - qualityScore(a));
    const best = sorted[0];

    const relaxationSteps = [
      {},
      { relaxVoteAverage: true },
      { relaxVoteAverage: true, relaxVoteCount: true },
      { relaxVoteAverage: true, relaxVoteCount: true, relaxResolution: true },
    ];

    for (const relaxOpts of relaxationSteps) {
      const candidates = filterCandidates(sorted, best, relaxOpts);
      if (candidates.length > 0) return pickRandom(candidates);
    }

    return best;
  }

  return null;
}

export { selectBackdrop, selectPoster };
