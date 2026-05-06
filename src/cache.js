/**
 * Simple in-memory TTL cache.
 * No external dependencies — suitable for single-instance self-hosted use.
 */
export class TtlCache {
  constructor(ttlSeconds) {
    this.ttl = ttlSeconds * 1000;
    this.store = new Map();
  }

  get(key) {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return null;
    }
    return entry.value;
  }

  set(key, value) {
    this.store.set(key, {
      value,
      expiresAt: Date.now() + this.ttl,
    });
  }

  has(key) {
    return this.get(key) !== null;
  }

  /** Call periodically to prevent unbounded memory growth */
  purgeExpired() {
    const now = Date.now();
    for (const [key, entry] of this.store.entries()) {
      if (now > entry.expiresAt) this.store.delete(key);
    }
  }
}
