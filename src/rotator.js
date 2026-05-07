/**
 * Per-title image rotator.
 * Shuffles the pool into a sequence and serves images in order.
 * Only reshuffles after all images have been served once.
 * Guarantees no repeats until the full pool is exhausted.
 */

function shuffleArray(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export class Rotator {
  constructor() {
    this.state = new Map();
  }

  next(key, pool) {
    if (!pool || pool.length === 0) return null;

    // Pool of 1 — nothing to rotate
    if (pool.length === 1) return pool[0];

    let entry = this.state.get(key);

    const poolChanged = !entry || entry.sequence.length !== pool.length;
    const exhausted   = entry && entry.index >= entry.sequence.length;

    if (poolChanged || exhausted) {
      let shuffled = shuffleArray(pool);

      // Avoid starting the new sequence with the last image shown
      if (entry && shuffled.length > 1) {
        const lastUrl = entry.sequence[entry.index - 1]?.url
          ?? entry.sequence[entry.sequence.length - 1]?.url;

        if (lastUrl && shuffled[0].url === lastUrl) {
          const swapIdx = Math.floor(Math.random() * (shuffled.length - 1)) + 1;
          [shuffled[0], shuffled[swapIdx]] = [shuffled[swapIdx], shuffled[0]];
        }
      }

      entry = { sequence: shuffled, index: 0 };
      this.state.set(key, entry);
    }

    const chosen = entry.sequence[entry.index];
    entry.index++;
    return chosen;
  }

  clear(key) {
    this.state.delete(key);
  }

  clearAll() {
    this.state.clear();
  }
}
