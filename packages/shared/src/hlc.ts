import type { Clock } from './clock';

/**
 * Hybrid logical clock. Serialized as "physicalMs:counter:nodeId" with fixed-width
 * numeric parts so that plain string comparison matches logical ordering.
 */
export type HlcTimestamp = {
  physical: number;
  counter: number;
  node: string;
};

const PHYSICAL_WIDTH = 15;
const COUNTER_WIDTH = 6;
const MAX_COUNTER = 10 ** COUNTER_WIDTH - 1;

export function formatHlc(ts: HlcTimestamp): string {
  return `${String(ts.physical).padStart(PHYSICAL_WIDTH, '0')}:${String(ts.counter).padStart(COUNTER_WIDTH, '0')}:${ts.node}`;
}

export function parseHlc(value: string): HlcTimestamp {
  const first = value.indexOf(':');
  const second = value.indexOf(':', first + 1);
  if (first < 0 || second < 0) {
    throw new Error('HLC_INVALID_FORMAT');
  }
  const physical = Number(value.slice(0, first));
  const counter = Number(value.slice(first + 1, second));
  const node = value.slice(second + 1);
  if (!Number.isSafeInteger(physical) || !Number.isSafeInteger(counter) || node.length === 0) {
    throw new Error('HLC_INVALID_FORMAT');
  }
  return { physical, counter, node };
}

export function compareHlc(a: string, b: string): number {
  const x = parseHlc(a);
  const y = parseHlc(b);
  if (x.physical !== y.physical) return x.physical < y.physical ? -1 : 1;
  if (x.counter !== y.counter) return x.counter < y.counter ? -1 : 1;
  if (x.node === y.node) return 0;
  return x.node < y.node ? -1 : 1;
}

export class HybridLogicalClock {
  private last: HlcTimestamp;

  constructor(
    private readonly clock: Clock,
    private readonly node: string,
    initial?: string,
  ) {
    this.last = initial ? parseHlc(initial) : { physical: 0, counter: 0, node };
  }

  now(): string {
    const wall = this.clock.now();
    if (wall > this.last.physical) {
      this.last = { physical: wall, counter: 0, node: this.node };
    } else {
      this.last = {
        physical: this.last.physical,
        counter: this.bump(this.last.counter),
        node: this.node,
      };
    }
    return formatHlc(this.last);
  }

  receive(remote: string): string {
    const r = parseHlc(remote);
    const wall = this.clock.now();
    const physical = Math.max(wall, this.last.physical, r.physical);
    let counter: number;
    if (physical === this.last.physical && physical === r.physical) {
      counter = this.bump(Math.max(this.last.counter, r.counter));
    } else if (physical === this.last.physical) {
      counter = this.bump(this.last.counter);
    } else if (physical === r.physical) {
      counter = this.bump(r.counter);
    } else {
      counter = 0;
    }
    this.last = { physical, counter, node: this.node };
    return formatHlc(this.last);
  }

  current(): string {
    return formatHlc(this.last);
  }

  private bump(counter: number): number {
    if (counter >= MAX_COUNTER) {
      throw new Error('HLC_COUNTER_OVERFLOW');
    }
    return counter + 1;
  }
}
