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

  const imagesData = await imagesRes.json();
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

// ─── TMDB scoring ─────────────────────────────────────────────────────────────
// Resolution weighted highest, then vote count, vote average as tiebreaker only

const BACKDROP_MIN_WIDTH = 1280;
const POSTER_MIN_WIDTH   = 500;
const MIN_VOTES          = 3;

function scoreTmdbBackdrop(img) {
  const res   = Math.log10((img.width || 0) * (img.height || 0) + 1);
  const votes = Math.log10((img.vote_count || 0) + 1);
  const avg   = img.vote_average || 0;
  return votes * 3.0 + res * 2.0 + avg * 0.5;
}

function scoreTmdbPoster(img) {
  const res   = Math.log10((img.width || 0) * (img.height || 0) + 1);
  const votes = Math.log10((img.vote_count || 0) + 1);
  const avg   = img.vote_average || 0;
  return votes * 3.0 + res * 1.5 + avg * 0.5;
}

/**
 * Get scored + filtered TMDB backdrops, normalized to { url }
 * Textless only, min resolution, min votes.
 * Returns top 50% as candidate pool.
 */
export function getTmdbBackdropPool(backdrops, size) {
  if (!backdrops || backdrops.length === 0) return [];

  const voteFloor = backdrops.some(img => (img.vote_count || 0) >= MIN_VOTES) ? MIN_VOTES : 1;

  // Textless preferred, fallback to any if none pass filters
  let candidates = backdrops.filter(img =>
    img.iso_639_1 === null &&
    (img.width || 0) >= BACKDROP_MIN_WIDTH &&
    (img.vote_count || 0) >= voteFloor &&
    img.file_path
  );

  // If no textless pass, try textless with relaxed resolution
  if (candidates.length === 0) {
    candidates = backdrops.filter(img =>
      img.iso_639_1 === null && img.file_path
    );
  }

  if (candidates.length === 0) return [];

  const sorted   = [...candidates].sort((a, b) => scoreTmdbBackdrop(b) - scoreTmdbBackdrop(a));
  const poolSize = Math.max(1, Math.ceil(sorted.length * 0.50));
  return sorted
    .slice(0, poolSize)
    .map(img => ({ url: buildImageUrl(img.file_path, size) }));
}

/**
 * Get scored + filtered TMDB posters, normalized to { url }
 * English preferred, fallback to original language.
 * Returns top 50% as candidate pool.
 */
export function getTmdbPosterPool(posters, originalLanguage, size) {
  if (!posters || posters.length === 0) return [];

  const voteFloor = posters.some(img => (img.vote_count || 0) >= MIN_VOTES) ? MIN_VOTES : 1;

  const filterPosters = (imgs) => imgs.filter(img =>
    (img.width || 0) >= POSTER_MIN_WIDTH &&
    (img.vote_count || 0) >= voteFloor &&
    img.file_path
  );

  let candidates = filterPosters(posters.filter(img => img.iso_639_1 === 'en'));

  // Fallback to original language if no English pass filters
  if (candidates.length === 0 && originalLanguage && originalLanguage !== 'en') {
    candidates = filterPosters(posters.filter(img => img.iso_639_1 === originalLanguage));
  }

  // Relax resolution/vote filters on English only
  if (candidates.length === 0) {
    candidates = posters.filter(img => img.iso_639_1 === 'en' && img.file_path);
  }

  if (candidates.length === 0) return [];

  const sorted   = [...candidates].sort((a, b) => scoreTmdbPoster(b) - scoreTmdbPoster(a));
  const poolSize = Math.max(1, Math.ceil(sorted.length * 0.50));
  return sorted
    .slice(0, poolSize)
    .map(img => ({ url: buildImageUrl(img.file_path, size) }));
}

export function buildImageUrl(filePath, size = 'original') {
  return `https://image.tmdb.org/t/p/${size}${filePath}`;
}
