/**
 * Business code never calls Date.now() directly so that tests can drive time
 * (subscription dunning cycles, offline token expiry, clock skew detection).
 */
export interface Clock {
  now(): number;
}

export const systemClock: Clock = {
  now: () => Date.now(),
};

export class ManualClock implements Clock {
  constructor(private current: number = Date.UTC(2026, 0, 1)) {}

  now(): number {
    return this.current;
  }

  set(ms: number): void {
    this.current = ms;
  }

  advance(ms: number): void {
    this.current += ms;
  }
}

export function toIso(ms: number): string {
  return new Date(ms).toISOString();
}
