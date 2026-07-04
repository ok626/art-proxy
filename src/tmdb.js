const TMDB_BASE = 'https://api.themoviedb.org/3';

export async function fetchTvdbId(tmdbId, apiKey) {
  const res = await fetch(`${TMDB_BASE}/tv/${tmdbId}/external_ids?api_key=${apiKey}`);
  if (!res.ok) return null;
  const data = await res.json();
  return data.tvdb_id || null;
}

export async function fetchTmdbImages(type, tmdbId, apiKey) {
  const mediaType = type === 'series' ? 'tv' : 'movie';

  const [imagesRes, detailsRes] = await Promise.all([
    fetch(`${TMDB_BASE}/${mediaType}/${tmdbId}/images?api_key=${apiKey}&include_image_language=en,null`),
    fetch(`${TMDB_BASE}/${mediaType}/${tmdbId}?api_key=${apiKey}`),
  ]);

  if (!imagesRes.ok) {
    const err = await imagesRes.json().catch(() => ({}));
    throw new Error(`TMDB error ${imagesRes.status}: ${err.status_message || 'unknown'}`);
  }

  const imagesData  = await imagesRes.json();
  const detailsData = detailsRes.ok ? await detailsRes.json() : {};
  const originalLanguage = detailsData.original_language || null;

  let backdrops = imagesData.backdrops || [];
  let posters   = imagesData.posters   || [];

  if (originalLanguage && originalLanguage !== 'en') {
    const extRes = await fetch(
      `${TMDB_BASE}/${mediaType}/${tmdbId}/images?api_key=${apiKey}&include_image_language=en,null,${originalLanguage}`
    );
    if (extRes.ok) {
      const extData = await extRes.json();
      const seen = new Set(posters.map(p => p.file_path));
      for (const p of (extData.posters || [])) {
        if (!seen.has(p.file_path)) {
          posters.push(p);
          seen.add(p.file_path);
        }
      }
    }
  }

  return { backdrops, posters, originalLanguage };
}

// ─── Quality scoring ──────────────────────────────────────────────────────────
// Bayesian-aware: vote_average weighted by log of vote_count
// More votes = average is more trustworthy = counts more in the score
// A high avg with few votes scores less than a high avg with many votes
// A low avg with many votes is correctly penalized (people actively disliked it)

const BACKDROP_MIN_WIDTH = 1280;
const POSTER_MIN_WIDTH   = 500;
const MIN_VOTES          = 1;   // at least 1 vote — filters truly unvetted art
const SCORE_FLOOR_PCT    = 0.25; // candidates must score >= 25% of top scorer

function qualityScore(img) {
  const avg   = img.vote_average || 0;
  const votes = img.vote_count   || 0;
  return avg * Math.log10(votes + 2);
}

function getVoteFloor(images) {
  return images.some(img => (img.vote_count || 0) >= MIN_VOTES) ? MIN_VOTES : 0;
}

/**
 * Score, filter by relative floor, return pool.
 * Never cuts pools of <= 3 images.
 * Always guarantees at least 1 result (the top scorer).
 */
function buildScoredPool(candidates) {
  if (candidates.length === 0) return [];

  const scored   = [...candidates]
    .map(img => ({ img, score: qualityScore(img) }))
    .sort((a, b) => b.score - a.score);

  const topScore   = scored[0].score;
  const scoreFloor = topScore * SCORE_FLOOR_PCT;

  const pool = scored.length <= 3
    ? scored.map(s => s.img)
    : scored.filter(s => s.score >= scoreFloor).map(s => s.img);

  return pool.length > 0 ? pool : [scored[0].img];
}

// ─── Backdrop pools ───────────────────────────────────────────────────────────

/**
 * Textless backdrops only, quality filtered.
 * Used for merging with Fanart when Fanart has textless but not enough.
 */
export function getTmdbTextlessBackdropPool(backdrops, size) {
  if (!backdrops || backdrops.length === 0) return [];

  const textless = backdrops.filter(img => img.iso_639_1 === null && img.file_path);
  if (textless.length === 0) return [];

  const voteFloor = getVoteFloor(textless);

  // Step 1: min width + min votes
  let candidates = textless.filter(img =>
    (img.width || 0) >= BACKDROP_MIN_WIDTH &&
    (img.vote_count || 0) >= voteFloor
  );

  // Step 2: relax resolution, keep vote floor
  if (candidates.length === 0) {
    candidates = textless.filter(img => (img.vote_count || 0) >= voteFloor);
  }

  // Step 3: relax everything, keep textless
  if (candidates.length === 0) candidates = textless;

  return buildScoredPool(candidates)
    .map(img => ({ url: buildImageUrl(img.file_path, size) }));
}

/**
 * Best available backdrops regardless of language.
 * Used when Fanart has no textless at all.
 * Tries textless first, then any language.
 */
export function getTmdbAnyBackdropPool(backdrops, size) {
  if (!backdrops || backdrops.length === 0) return [];

  // Try textless with quality filters first
  const textlessPool = getTmdbTextlessBackdropPool(backdrops, size);
  if (textlessPool.length > 0) return textlessPool;

  // Textless exists but nothing passed — use all textless unfiltered
  const textless = backdrops.filter(img => img.iso_639_1 === null && img.file_path);
  if (textless.length > 0) {
    return buildScoredPool(textless)
      .map(img => ({ url: buildImageUrl(img.file_path, size) }));
  }

  // No textless at all — any backdrop
  const any = backdrops.filter(img => img.file_path);
  if (any.length === 0) return [];
  return buildScoredPool(any)
    .map(img => ({ url: buildImageUrl(img.file_path, size) }));
}

// ─── Poster pools ─────────────────────────────────────────────────────────────

/**
 * English posters only, quality filtered.
 * Used for merging with Fanart when Fanart has English but not enough.
 */
export function getTmdbEnglishPosterPool(posters, size) {
  if (!posters || posters.length === 0) return [];

  const english = posters.filter(img => img.iso_639_1 === 'en' && img.file_path);
  if (english.length === 0) return [];

  const voteFloor = getVoteFloor(english);

  // Step 1: min width + min votes
  let candidates = english.filter(img =>
    (img.width || 0) >= POSTER_MIN_WIDTH &&
    (img.vote_count || 0) >= voteFloor
  );

  // Step 2: relax resolution, keep vote floor
  if (candidates.length === 0) {
    candidates = english.filter(img => (img.vote_count || 0) >= voteFloor);
  }

  // Step 3: relax everything, keep English
  if (candidates.length === 0) candidates = english;

  return buildScoredPool(candidates)
    .map(img => ({ url: buildImageUrl(img.file_path, size) }));
}

/**
 * Best available posters regardless of language.
 * Used when Fanart has no English at all.
 * Priority: English → original language → any language.
 */
export function getTmdbAnyPosterPool(posters, originalLanguage, size) {
  if (!posters || posters.length === 0) return [];

  const english  = posters.filter(img => img.iso_639_1 === 'en' && img.file_path);
  const origLang = originalLanguage && originalLanguage !== 'en'
    ? posters.filter(img => img.iso_639_1 === originalLanguage && img.file_path)
    : [];

  // Try English with quality filters
  const englishPool = getTmdbEnglishPosterPool(posters, size);
  if (englishPool.length > 0) return englishPool;

  // English exists but nothing passed quality — use all English unfiltered
  if (english.length > 0) {
    return buildScoredPool(english)
      .map(img => ({ url: buildImageUrl(img.file_path, size) }));
  }

  // No English — try original language
  if (origLang.length > 0) {
    const voteFloor = getVoteFloor(origLang);
    let candidates = origLang.filter(img =>
      (img.width || 0) >= POSTER_MIN_WIDTH &&
      (img.vote_count || 0) >= voteFloor
    );
    if (candidates.length === 0) {
      candidates = origLang.filter(img => (img.vote_count || 0) >= voteFloor);
    }
    if (candidates.length === 0) candidates = origLang;
    return buildScoredPool(candidates)
      .map(img => ({ url: buildImageUrl(img.file_path, size) }));
  }

  // Absolute last resort — any poster any language
  const any = posters.filter(img => img.file_path);
  if (any.length === 0) return [];
  return buildScoredPool(any)
    .map(img => ({ url: buildImageUrl(img.file_path, size) }));
}

// ─── Utils ────────────────────────────────────────────────────────────────────

export function buildImageUrl(filePath, size = 'original') {
  return `https://image.tmdb.org/t/p/${size}${filePath}`;
}
