import { describe, expect, it } from 'vitest';
import { followUpStatus } from './programs';

describe('chronic programme follow-up', () => {
  const base = { intervalDays: 30, graceDays: 14, enrolledAt: '2026-08-01T08:00:00.000Z' };

  it('expects the patient back one interval after the last contact', () => {
    const status = followUpStatus({
      ...base,
      lastContact: '2026-10-20T08:00:00.000Z',
      now: new Date('2026-11-02T08:00:00.000Z'),
    });
    expect(status).toEqual({ dueAt: '2026-11-19T08:00:00.000Z', lost: false, daysLate: 0 });
  });

  it('marks the patient lost beyond the interval plus the grace period (scenario P9)', () => {
    const late = followUpStatus({
      ...base,
      lastContact: '2026-09-01T08:00:00.000Z',
      now: new Date('2026-11-02T08:00:00.000Z'),
    });
    expect(late).toMatchObject({ lost: true, daysLate: 32 });
    const withinGrace = followUpStatus({
      ...base,
      lastContact: '2026-09-25T08:00:00.000Z',
      now: new Date('2026-11-02T08:00:00.000Z'),
    });
    expect(withinGrace).toMatchObject({ lost: false, daysLate: 8 });
  });

  it('counts from the enrolment when no contact is known', () => {
    expect(
      followUpStatus({ ...base, lastContact: null, now: new Date('2026-08-15T08:00:00.000Z') })
        .dueAt,
    ).toBe('2026-08-31T08:00:00.000Z');
  });
});
