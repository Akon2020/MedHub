import { describe, expect, it } from 'vitest';
import { activeBreakGlass, breakGlassPayload, recordAccess } from './break-glass';

const NOW = new Date('2026-11-02T10:00:00.000Z');
const grant = (startedAt: string, endsAt: string, userId = 'u1') => ({
  patientId: 'p1',
  userId,
  startedAt,
  endsAt,
});

describe('emergency access', () => {
  it('opens a record above the level only through a running access of the same user', () => {
    const grants = [
      grant('2026-11-02T04:00:00.000Z', '2026-11-02T08:00:00.000Z'),
      grant('2026-11-02T09:30:00.000Z', '2026-11-02T13:30:00.000Z', 'u2'),
    ];
    expect(activeBreakGlass(grants, 'u1', 'p1', NOW)).toBeNull();
    const running = activeBreakGlass(
      [...grants, grant('2026-11-02T09:50:00.000Z', '2026-11-02T13:50:00.000Z')],
      'u1',
      'p1',
      NOW,
    );
    expect(recordAccess('restricted', 'normal', null)).toBe('locked');
    expect(recordAccess('restricted', 'normal', running)).toBe('emergency');
    expect(recordAccess('vip', 'restricted', null)).toBe('open');
  });

  it('needs a reason and a duration of at most 24 hours', () => {
    const base = {
      patientId: '01a19830-805e-7768-a65f-140ecc61aab9',
      reasonCode: 'life_threatening',
      reasonText: 'Patient inconscient',
      startedAt: '2026-11-02T10:00:00.000Z',
    };
    expect(
      breakGlassPayload.safeParse({ ...base, endsAt: '2026-11-02T14:00:00.000Z' }).success,
    ).toBe(true);
    expect(
      breakGlassPayload.safeParse({ ...base, endsAt: '2026-11-03T14:00:00.000Z' }).success,
    ).toBe(false);
    expect(
      breakGlassPayload.safeParse({ ...base, reasonText: '', endsAt: '2026-11-02T14:00:00.000Z' })
        .success,
    ).toBe(false);
  });
});
