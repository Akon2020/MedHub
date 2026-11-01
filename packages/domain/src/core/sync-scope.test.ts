import { describe, expect, it } from 'vitest';
import { currentFavorites } from '../pat/favorites';
import { DEFAULT_PATIENT_SCOPE, effectivePatientScope, inPatientScope } from './sync-scope';

const NOW = new Date('2026-11-01T12:00:00.000Z');
const none = { createdHere: false, favorite: false, pinned: false, lastActivity: null };

describe('synchronisation scope', () => {
  it('takes the most generous rule among the user roles, then the structure rule', () => {
    const rules = [
      { roleId: null, rule: { mode: 'scoped', recentDays: 30 } },
      { roleId: 'nurse', rule: { mode: 'scoped', recentDays: 7 } },
      { roleId: 'lab', rule: { mode: 'scoped', recentDays: 14 } },
      { roleId: 'pharmacy', rule: { mode: 'all' } },
    ];
    expect(effectivePatientScope(rules, ['nurse', 'lab'])).toEqual({
      mode: 'scoped',
      recentDays: 14,
    });
    expect(effectivePatientScope(rules, ['nurse', 'pharmacy']).mode).toBe('all');
    expect(effectivePatientScope(rules, ['reception'])).toEqual({ mode: 'scoped', recentDays: 30 });
    expect(effectivePatientScope([], ['reception'])).toEqual(DEFAULT_PATIENT_SCOPE);
  });

  it('keeps patients created here, favourites, pinned and recently active ones', () => {
    const rule = { mode: 'scoped' as const, recentDays: 30 };
    expect(inPatientScope(none, rule, NOW)).toBe(false);
    expect(inPatientScope({ ...none, favorite: true }, rule, NOW)).toBe(true);
    expect(inPatientScope({ ...none, createdHere: true }, rule, NOW)).toBe(true);
    expect(
      inPatientScope({ ...none, lastActivity: new Date('2026-10-10T00:00:00.000Z') }, rule, NOW),
    ).toBe(true);
    expect(
      inPatientScope({ ...none, lastActivity: new Date('2026-09-01T00:00:00.000Z') }, rule, NOW),
    ).toBe(false);
  });

  it('reads favourites from their latest toggle', () => {
    const favorites = currentFavorites([
      { id: '1', patientId: 'a', active: true, at: '2026-11-01T08:00:00.000Z' },
      { id: '2', patientId: 'a', active: false, at: '2026-11-01T09:00:00.000Z' },
      { id: '3', patientId: 'b', active: true, at: '2026-11-01T09:00:00.000Z' },
    ]);
    expect([...favorites]).toEqual(['b']);
  });
});
