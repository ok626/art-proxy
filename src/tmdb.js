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

// ─── Constants ────────────────────────────────────────────────────────────────

const BACKDROP_MIN_WIDTH  = 1280;
const POSTER_MIN_WIDTH    = 500;
const MIN_VOTES           = 1;
const SCORE_FLOOR_PCT     = 0.25;
const TRUST_POOL_SIZE     = parseInt(process.env.TMDB_TRUST_POOL_SIZE || '6', 10);

// ─── Scoring (standard mode) ──────────────────────────────────────────────────

function qualityScore(img) {
  const avg   = img.vote_average || 0;
  const votes = img.vote_count   || 0;
  return avg * Math.log10(votes + 2);
}

function getVoteFloor(images) {
  return images.some(img => (img.vote_count || 0) >= MIN_VOTES) ? MIN_VOTES : 0;
}

function buildScoredPool(candidates) {
  if (candidates.length === 0) return [];

  const scored = [...candidates]
    .map(img => ({ img, score: qualityScore(img) }))
    .sort((a, b) => b.score - a.score);

  const topScore   = scored[0].score;
  const scoreFloor = topScore * SCORE_FLOOR_PCT;

  const pool = scored.length <= 3
    ? scored.map(s => s.img)
    : scored.filter(s => s.score >= scoreFloor).map(s => s.img);

  return pool.length > 0 ? pool : [scored[0].img];
}

// ─── Trust mode pool builder ──────────────────────────────────────────────────

/**
 * Resolution floor for trust mode — stepped, relative to first image.
 * Accepts anything that isn't obviously garbage compared to the best.
 */
function trustResFloor(firstImg) {
  const w = firstImg.width || 0;
  if (w >= 3840) return 1920; // best is 4K → floor is 1080p
  if (w >= 1920) return 1280; // best is 1080p → floor is 720p
  if (w >= 1280) return 1280; // best is 720p → floor is 720p
  return 0;                   // best is below 720p → no floor
}

/**
 * Trust mode: take top N from TMDB's own ordering.
 * Language filtering still applies before counting.
 * Resolution check relative to first qualifying image.
 */
function buildTrustPool(images, size) {
  if (images.length === 0) return [];

  const resFloor = trustResFloor(images[0]);

  // Apply resolution floor relative to first image
  // If nothing passes, relax and take all
  let candidates = images.filter(img => (img.width || 0) >= resFloor);
  if (candidates.length === 0) candidates = images;

  // Take top N by TMDB order (already in TMDB's ranked order)
  return candidates
    .slice(0, TRUST_POOL_SIZE)
    .map(img => ({ url: buildImageUrl(img.file_path, size) }));
}

// ─── Backdrop pools ───────────────────────────────────────────────────────────

/**
 * Textless backdrops, standard scoring mode.
 * Used for merging with Fanart.
 */
export function getTmdbTextlessBackdropPool(backdrops, size) {
  if (!backdrops || backdrops.length === 0) return [];

  const textless = backdrops.filter(img => img.iso_639_1 === null && img.file_path);
  if (textless.length === 0) return [];

  const voteFloor = getVoteFloor(textless);

  let candidates = textless.filter(img =>
    (img.width || 0) >= BACKDROP_MIN_WIDTH &&
    (img.vote_count || 0) >= voteFloor
  );
  if (candidates.length === 0) {
    candidates = textless.filter(img => (img.vote_count || 0) >= voteFloor);
  }
  if (candidates.length === 0) candidates = textless;

  return buildScoredPool(candidates)
    .map(img => ({ url: buildImageUrl(img.file_path, size) }));
}

/**
 * Textless backdrops, trust mode.
 */
export function getTmdbTextlessBackdropPoolTrust(backdrops, size) {
  if (!backdrops || backdrops.length === 0) return [];

  const textless = backdrops.filter(img => img.iso_639_1 === null && img.file_path);
  if (textless.length === 0) return [];

  return buildTrustPool(textless, size);
}

/**
 * Any backdrop, standard scoring mode.
 * Used when Fanart has no textless.
 */
export function getTmdbAnyBackdropPool(backdrops, size) {
  if (!backdrops || backdrops.length === 0) return [];

  const textlessPool = getTmdbTextlessBackdropPool(backdrops, size);
  if (textlessPool.length > 0) return textlessPool;

  const textless = backdrops.filter(img => img.iso_639_1 === null && img.file_path);
  if (textless.length > 0) {
    return buildScoredPool(textless)
      .map(img => ({ url: buildImageUrl(img.file_path, size) }));
  }

  const any = backdrops.filter(img => img.file_path);
  if (any.length === 0) return [];
  return buildScoredPool(any)
    .map(img => ({ url: buildImageUrl(img.file_path, size) }));
}

/**
 * Any backdrop, trust mode.
 * Used when Fanart has no textless and trust mode is on.
 */
export function getTmdbAnyBackdropPoolTrust(backdrops, size) {
  if (!backdrops || backdrops.length === 0) return [];

  const textlessPool = getTmdbTextlessBackdropPoolTrust(backdrops, size);
  if (textlessPool.length > 0) return textlessPool;

  const textless = backdrops.filter(img => img.iso_639_1 === null && img.file_path);
  if (textless.length > 0) return buildTrustPool(textless, size);

  const any = backdrops.filter(img => img.file_path);
  if (any.length === 0) return [];
  return buildTrustPool(any, size);
}

// ─── Poster pools ─────────────────────────────────────────────────────────────

/**
 * English posters, standard scoring mode.
 */
export function getTmdbEnglishPosterPool(posters, size) {
  if (!posters || posters.length === 0) return [];

  const english = posters.filter(img => img.iso_639_1 === 'en' && img.file_path);
  if (english.length === 0) return [];

  const voteFloor = getVoteFloor(english);

  let candidates = english.filter(img =>
    (img.width || 0) >= POSTER_MIN_WIDTH &&
    (img.vote_count || 0) >= voteFloor
  );
  if (candidates.length === 0) {
    candidates = english.filter(img => (img.vote_count || 0) >= voteFloor);
  }
  if (candidates.length === 0) candidates = english;

  return buildScoredPool(candidates)
    .map(img => ({ url: buildImageUrl(img.file_path, size) }));
}

/**
 * English posters, trust mode.
 */
export function getTmdbEnglishPosterPoolTrust(posters, size) {
  if (!posters || posters.length === 0) return [];

  const english = posters.filter(img => img.iso_639_1 === 'en' && img.file_path);
  if (english.length === 0) return [];

  return buildTrustPool(english, size);
}

/**
 * Any poster, standard scoring mode.
 */
export function getTmdbAnyPosterPool(posters, originalLanguage, size) {
  if (!posters || posters.length === 0) return [];

  const english  = posters.filter(img => img.iso_639_1 === 'en' && img.file_path);
  const origLang = originalLanguage && originalLanguage !== 'en'
    ? posters.filter(img => img.iso_639_1 === originalLanguage && img.file_path)
    : [];

  const englishPool = getTmdbEnglishPosterPool(posters, size);
  if (englishPool.length > 0) return englishPool;

  if (english.length > 0) {
    return buildScoredPool(english)
      .map(img => ({ url: buildImageUrl(img.file_path, size) }));
  }

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

  const any = posters.filter(img => img.file_path);
  if (any.length === 0) return [];
  return buildScoredPool(any)
    .map(img => ({ url: buildImageUrl(img.file_path, size) }));
}

/**
 * Any poster, trust mode.
 */
export function getTmdbAnyPosterPoolTrust(posters, originalLanguage, size) {
  if (!posters || posters.length === 0) return [];

  const english  = posters.filter(img => img.iso_639_1 === 'en' && img.file_path);
  const origLang = originalLanguage && originalLanguage !== 'en'
    ? posters.filter(img => img.iso_639_1 === originalLanguage && img.file_path)
    : [];

  const englishPool = getTmdbEnglishPosterPoolTrust(posters, size);
  if (englishPool.length > 0) return englishPool;

  if (english.length > 0) return buildTrustPool(english, size);

  if (origLang.length > 0) return buildTrustPool(origLang, size);

  const any = posters.filter(img => img.file_path);
  if (any.length === 0) return [];
  return buildTrustPool(any, size);
}

// ─── Utils ────────────────────────────────────────────────────────────────────

export function buildImageUrl(filePath, size = 'original') {
  return `https://image.tmdb.org/t/p/${size}${filePath}`;
}
