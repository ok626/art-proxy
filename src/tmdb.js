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

// ─── Scoring ──────────────────────────────────────────────────────────────────

const BACKDROP_MIN_WIDTH = 1280;
const POSTER_MIN_WIDTH   = 500;
const MIN_VOTES          = 3;

function scoreTmdbBackdrop(img) {
  const res   = Math.log10((img.width || 0) * (img.height || 0) + 1);
  const avg   = img.vote_average || 0;
  const votes = Math.log10((img.vote_count || 0) + 1);
  return avg * 3.0 + res * 2.0 + votes * 0.5;
}

function scoreTmdbPoster(img) {
  const res   = Math.log10((img.width || 0) * (img.height || 0) + 1);
  const avg   = img.vote_average || 0;
  const votes = Math.log10((img.vote_count || 0) + 1);
  return avg * 3.0 + res * 1.5 + votes * 0.5;
}

function buildScoredPool(candidates, scoreFn) {
  if (candidates.length === 0) return [];
  const sorted   = [...candidates].sort((a, b) => scoreFn(b) - scoreFn(a));
  const topScore = scoreFn(sorted[0]);
  const pool     = sorted.length <= 3
    ? sorted
    : sorted.filter(img => scoreFn(img) >= topScore * 0.60);
  return pool.length > 0 ? pool : [sorted[0]];
}

function getFloors(images) {
  const voteFloor = images.some(img => (img.vote_count || 0) >= MIN_VOTES) ? MIN_VOTES : 1;
  const maxAvg    = Math.max(...images.map(img => img.vote_average || 0));
  const avgFloor  = maxAvg >= 5.0 ? 5.0 : maxAvg * 0.75;
  return { voteFloor, avgFloor };
}

// ─── Backdrop pools ───────────────────────────────────────────────────────────

/**
 * Returns quality-filtered textless backdrops only.
 * Used for merging with Fanart when Fanart has textless but not enough.
 */
export function getTmdbTextlessBackdropPool(backdrops, size) {
  if (!backdrops || backdrops.length === 0) return [];

  const textless = backdrops.filter(img => img.iso_639_1 === null && img.file_path);
  if (textless.length === 0) return [];

  const { voteFloor, avgFloor } = getFloors(textless);

  // Step 1: full quality filters
  let candidates = textless.filter(img =>
    (img.width || 0) >= BACKDROP_MIN_WIDTH &&
    (img.vote_count || 0) >= voteFloor &&
    (img.vote_average || 0) >= avgFloor
  );

  // Step 2: relax resolution
  if (candidates.length === 0) {
    candidates = textless.filter(img =>
      (img.vote_count || 0) >= voteFloor &&
      (img.vote_average || 0) >= avgFloor
    );
  }

  // Step 3: relax all quality, keep textless
  if (candidates.length === 0) candidates = textless;

  return buildScoredPool(candidates, scoreTmdbBackdrop)
    .map(img => ({ url: buildImageUrl(img.file_path, size) }));
}

/**
 * Returns best available backdrops regardless of language.
 * Used only when Fanart has no textless at all.
 * Tries textless first, then any language.
 */
export function getTmdbAnyBackdropPool(backdrops, size) {
  if (!backdrops || backdrops.length === 0) return [];

  const textless = backdrops.filter(img => img.iso_639_1 === null && img.file_path);

  // Try textless with quality filters first
  const textlessPool = getTmdbTextlessBackdropPool(backdrops, size);
  if (textlessPool.length > 0) return textlessPool;

  // Textless exists but nothing passed quality — use all textless unfiltered
  if (textless.length > 0) {
    return buildScoredPool(textless, scoreTmdbBackdrop)
      .map(img => ({ url: buildImageUrl(img.file_path, size) }));
  }

  // No textless at all — use any backdrop
  const any = backdrops.filter(img => img.file_path);
  if (any.length === 0) return [];
  return buildScoredPool(any, scoreTmdbBackdrop)
    .map(img => ({ url: buildImageUrl(img.file_path, size) }));
}

// ─── Poster pools ─────────────────────────────────────────────────────────────

/**
 * Returns quality-filtered English posters only.
 * Used for merging with Fanart when Fanart has English but not enough.
 */
export function getTmdbEnglishPosterPool(posters, size) {
  if (!posters || posters.length === 0) return [];

  const english = posters.filter(img => img.iso_639_1 === 'en' && img.file_path);
  if (english.length === 0) return [];

  const { voteFloor, avgFloor } = getFloors(english);

  // Step 1: full quality filters
  let candidates = english.filter(img =>
    (img.width || 0) >= POSTER_MIN_WIDTH &&
    (img.vote_count || 0) >= voteFloor &&
    (img.vote_average || 0) >= avgFloor
  );

  // Step 2: relax resolution
  if (candidates.length === 0) {
    candidates = english.filter(img =>
      (img.vote_count || 0) >= voteFloor &&
      (img.vote_average || 0) >= avgFloor
    );
  }

  // Step 3: relax all quality, keep English
  if (candidates.length === 0) candidates = english;

  return buildScoredPool(candidates, scoreTmdbPoster)
    .map(img => ({ url: buildImageUrl(img.file_path, size) }));
}

/**
 * Returns best available posters regardless of language.
 * Used only when Fanart has no English at all.
 * Priority: English → original language → any language.
 */
export function getTmdbAnyPosterPool(posters, originalLanguage, size) {
  if (!posters || posters.length === 0) return [];

  const english  = posters.filter(img => img.iso_639_1 === 'en' && img.file_path);
  const origLang = originalLanguage && originalLanguage !== 'en'
    ? posters.filter(img => img.iso_639_1 === originalLanguage && img.file_path)
    : [];

  // Try English first (with quality filters)
  const englishPool = getTmdbEnglishPosterPool(posters, size);
  if (englishPool.length > 0) return englishPool;

  // English exists but nothing passed quality — use all English unfiltered
  if (english.length > 0) {
    return buildScoredPool(english, scoreTmdbPoster)
      .map(img => ({ url: buildImageUrl(img.file_path, size) }));
  }

  // No English at all — try original language with quality filters
  if (origLang.length > 0) {
    const { voteFloor, avgFloor } = getFloors(origLang);
    let candidates = origLang.filter(img =>
      (img.width || 0) >= POSTER_MIN_WIDTH &&
      (img.vote_count || 0) >= voteFloor &&
      (img.vote_average || 0) >= avgFloor
    );
    if (candidates.length === 0) candidates = origLang;
    return buildScoredPool(candidates, scoreTmdbPoster)
      .map(img => ({ url: buildImageUrl(img.file_path, size) }));
  }

  // Absolute last resort — any poster any language
  const any = posters.filter(img => img.file_path);
  if (any.length === 0) return [];
  return buildScoredPool(any, scoreTmdbPoster)
    .map(img => ({ url: buildImageUrl(img.file_path, size) }));
}

// ─── Utils ────────────────────────────────────────────────────────────────────

export function buildImageUrl(filePath, size = 'original') {
  return `https://image.tmdb.org/t/p/${size}${filePath}`;
}
