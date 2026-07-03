# art-proxy

A self-hostable Docker app that serves a smartly selected random pool of Fanart/TMDB Movie/TV posters and backdrops via simple redirect URLs — designed for use with Stremio addons and catalogs.

## URL Format

```
https://your-domain.com/backdrop/{tvdb_id}:tmdb:{movie|tv}:{tmdb_id}.jpg
https://your-domain.com/poster/{tvdb_id}:tmdb:{movie|tv}:{tmdb_id}.jpg
```
