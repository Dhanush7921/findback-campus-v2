import type { RateLimit } from './env';

/**
 * Per-isolate sliding-window limiter. Used as a fallback (and in tests) when the
 * Workers Rate Limiting binding is absent. Isolates are per-colo, so this is a
 * best-effort layer; durable brute-force protection is the per-complaint
 * lockout stored in Access_Credentials.
 */
export class LocalLimiter implements RateLimit {
  private hits = new Map<string, number[]>();
  constructor(private max: number, private windowMs: number) {}
  async limit({ key }: { key: string }) {
    const now = Date.now();
    const arr = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
    if (arr.length >= this.max) {
      this.hits.set(key, arr);
      return { success: false };
    }
    arr.push(now);
    this.hits.set(key, arr);
    if (this.hits.size > 50_000) this.hits.clear();
    return { success: true };
  }
}
