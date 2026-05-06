const TMDB_BASE = 'https://api.themoviedb.org/3';

/**
 * Fetch the TVDB ID for a TV show (used for Fanart TV lookup).
 */
export async function fetchTvdbId(tmdbId, apiKey) {
  const res = await fetch(`${TMDB_BASE}/tv/${tmdbId}/external_ids?api_key=${apiKey}`);
  if (!res.ok) return null;
  const data = await res.json();
  return data.tvdb_id || null;
}

/**
 * Fetch images + original language from TMDB.
 * Used as fallback when Fanart has nothing.
 */
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

  // If original language isn't English, fetch those posters too for fallback
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

/**
 * TMDB fallback: pick the first textless backdrop.
 * No scoring, no filtering — just first available.
 */
export function tmdbFallbackBackdrop(backdrops) {
  if (!backdrops || backdrops.length === 0) return null;
  const textless = backdrops.filter(img => img.iso_639_1 === null);
  const chosen = textless[0] || backdrops[0];
  return chosen ? buildImageUrl(chosen.file_path, process.env.BACKDROP_SIZE || 'w1280') : null;
}

/**
 * TMDB fallback: pick the first English poster.
 * No scoring, no filtering — just first available.
 */
export function tmdbFallbackPoster(posters, originalLanguage) {
  if (!posters || posters.length === 0) return null;

  const english  = posters.filter(img => img.iso_639_1 === 'en');
  const origLang = originalLanguage && originalLanguage !== 'en'
    ? posters.filter(img => img.iso_639_1 === originalLanguage)
    : [];

  const chosen = english[0] || origLang[0] || posters[0];
  return chosen ? buildImageUrl(chosen.file_path, process.env.POSTER_SIZE || 'w780') : null;
}

export function buildImageUrl(filePath, size = 'original') {
  return `https://image.tmdb.org/t/p/${size}${filePath}`;
}
