const FANART_BASE = 'https://webservice.fanart.tv/v3.2';

/**
 * Fanart image type mapping
 * Movies:  moviebackground = backdrops, movieposter = posters
 * TV:      showbackground  = backdrops, tvposter    = posters
 */
const TYPE_MAP = {
  movie: {
    backdrop: 'moviebackground',
    poster:   'movieposter',
  },
  series: {
    backdrop: 'showbackground',
    poster:   'tvposter',
  },
};

/**
 * Fetch the TVDB ID for a TV show via TMDB's external_ids endpoint.
 * Returns null if not found.
 */
export async function fetchTvdbId(tmdbId, tmdbApiKey) {
  const url = `https://api.themoviedb.org/3/tv/${tmdbId}/external_ids?api_key=${tmdbApiKey}`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const data = await res.json();
  return data.tvdb_id || null;
}

/**
 * Fetch images from Fanart for a movie or TV show.
 * For TV, fanartId should be the TVDB ID.
 * For movies, fanartId is the TMDB ID.
 *
 * Returns { backdrops, posters } as normalized arrays:
 * [{ url, likes, lang }]
 */
export async function fetchFanartImages(type, fanartId, fanartApiKey) {
  const url = `${FANART_BASE}/${type === 'series' ? 'tv' : 'movies'}/${fanartId}?api_key=${fanartApiKey}`;
  const res = await fetch(url);

  if (res.status === 404) return { backdrops: [], posters: [] };
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`Fanart error ${res.status}: ${err.error_message || 'unknown'}`);
  }

  const data = await res.json();
  const map = TYPE_MAP[type];

  const normalize = (arr) =>
    (arr || []).map(img => ({
      url:   img.url,
      likes: parseInt(img.likes || '0', 10),
      lang:  img.lang || '',   // '' or '00' = textless/language-neutral on Fanart
    }));

  return {
    backdrops: normalize(data[map.backdrop]),
    posters:   normalize(data[map.poster]),
  };
}
