/**
 * Simple in-memory rate limiter using sliding window.
 */
export class RateLimiter {
  private windows: Map<string, number[]> = new Map();
  private maxRequests: number;
  private windowMs: number;

  constructor(maxRequests = 30, windowMs = 60000) {
    this.maxRequests = maxRequests;
    this.windowMs = windowMs;
  }

  /**
   * Check if a request is allowed. Returns true if allowed, false if rate limited.
   */
  check(key: string): boolean {
    const now = Date.now();
    const cutoff = now - this.windowMs;

    let timestamps = this.windows.get(key) ?? [];
    timestamps = timestamps.filter(t => t > cutoff);

    if (timestamps.length >= this.maxRequests) {
      this.windows.set(key, timestamps);
      return false;
    }

    timestamps.push(now);
    this.windows.set(key, timestamps);
    return true;
  }

  /**
   * Get remaining requests for a key.
   */
  remaining(key: string): number {
    const now = Date.now();
    const cutoff = now - this.windowMs;
    const timestamps = (this.windows.get(key) ?? []).filter(t => t > cutoff);
    return Math.max(0, this.maxRequests - timestamps.length);
  }

  /**
   * Clean up old entries (call periodically).
   */
  cleanup(): void {
    const cutoff = Date.now() - this.windowMs;
    for (const [key, timestamps] of this.windows) {
      const active = timestamps.filter(t => t > cutoff);
      if (active.length === 0) {
        this.windows.delete(key);
      } else {
        this.windows.set(key, active);
      }
    }
  }
}
