/**
 * Minimal five-field cron (minute hour day-of-month month day-of-week) used by
 * `job_schedule`. Supports `*`, numbers, lists, ranges and steps. Times are UTC.
 */
type Field = ReadonlySet<number>;

const RANGES: [number, number][] = [
  [0, 59],
  [0, 23],
  [1, 31],
  [1, 12],
  [0, 6],
];

function parseField(expr: string, [min, max]: [number, number]): Field {
  const values = new Set<number>();
  for (const part of expr.split(',')) {
    const [range, stepRaw] = part.split('/');
    const step = stepRaw ? Number(stepRaw) : 1;
    if (!Number.isInteger(step) || step < 1) throw new Error(`CRON_INVALID_STEP:${expr}`);
    let from = min;
    let to = max;
    if (range && range !== '*') {
      const [a, b] = range.split('-');
      from = Number(a);
      to = b === undefined ? (stepRaw ? max : from) : Number(b);
    }
    if (!Number.isInteger(from) || !Number.isInteger(to) || from < min || to > max || from > to) {
      throw new Error(`CRON_INVALID_FIELD:${expr}`);
    }
    for (let v = from; v <= to; v += step) values.add(v);
  }
  return values;
}

export function parseCron(expression: string): Field[] {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) throw new Error('CRON_INVALID_LENGTH');
  return parts.map((p, i) => parseField(p, RANGES[i] as [number, number]));
}

/** First minute strictly after `after` that matches the expression. */
export function nextRun(expression: string, after: Date): Date {
  const [minutes, hours, days, months, weekdays] = parseCron(expression) as [
    Field,
    Field,
    Field,
    Field,
    Field,
  ];
  const t = new Date(after.getTime());
  t.setUTCSeconds(0, 0);
  t.setUTCMinutes(t.getUTCMinutes() + 1);
  for (let i = 0; i < 366 * 24 * 60; i += 1) {
    if (
      months.has(t.getUTCMonth() + 1) &&
      days.has(t.getUTCDate()) &&
      weekdays.has(t.getUTCDay()) &&
      hours.has(t.getUTCHours()) &&
      minutes.has(t.getUTCMinutes())
    ) {
      return t;
    }
    t.setUTCMinutes(t.getUTCMinutes() + 1);
  }
  throw new Error('CRON_NO_MATCH');
}
