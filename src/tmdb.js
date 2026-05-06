import fetch from 'node-fetch';

const BASE = 'https://api.themoviedb.org/3';
const IMG_BASE = 'https://image.tmdb.org/t/p/original';

/**
 * Fetch images + basic info for a movie or TV show.
 * Returns { backdrops, posters, originalLanguage }
 */
export async function fetchTmdbImages(type, tmdbId, apiKey) {
  // type is "movie" or "tv"
  const mediaType = type === 'tv' ? 'tv' : 'movie';

  // Fetch images (include all languages via include_image_language)
  const imagesUrl = `${BASE}/${mediaType}/${tmdbId}/images?api_key=${apiKey}&include_image_language=en,null`;

  // Also fetch details to get original_language for poster fallback
  const detailsUrl = `${BASE}/${mediaType}/${tmdbId}?api_key=${apiKey}`;

  const [imagesRes, detailsRes] = await Promise.all([
    fetch(imagesUrl),
    fetch(detailsUrl),
  ]);

  if (!imagesRes.ok) {
    const err = await imagesRes.json().catch(() => ({}));
    throw new Error(`TMDB images error ${imagesRes.status}: ${err.status_message || 'unknown'}`);
  }

  const imagesData = await imagesRes.json();
  const detailsData = detailsRes.ok ? await detailsRes.json() : {};

  // If the show's original language isn't English and isn't already in our fetch,
  // we need to re-fetch images with that language included too.
  const originalLanguage = detailsData.original_language || null;

  let backdrops = imagesData.backdrops || [];
  let posters = imagesData.posters || [];

  // If original language is something other than 'en' and 'null',
  // do a second fetch to include those posters as fallback candidates
  if (originalLanguage && originalLanguage !== 'en') {
    const extendedUrl = `${BASE}/${mediaType}/${tmdbId}/images?api_key=${apiKey}&include_image_language=en,null,${originalLanguage}`;
    const extRes = await fetch(extendedUrl);
    if (extRes.ok) {
      const extData = await extRes.json();
      // Merge posters, deduplicating by file_path
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
 * Build the full TMDB image URL from a file_path.
 */
export function buildImageUrl(filePath, size = 'original') {
  const base = size === 'original' ? IMG_BASE : `https://image.tmdb.org/t/p/${size}`;
  return `${base}${filePath}`;
}
