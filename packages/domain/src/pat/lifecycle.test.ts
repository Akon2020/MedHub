import { describe, expect, it } from 'vitest';
import { patientRegisterPayload } from './commands';
import { blockedByDeath, patientDeathPayload } from './lifecycle';

describe('provisional records and death', () => {
  it('requires the kind of a provisional record, and only then', () => {
    const base = { mrn: 'KIN-AA-26-00001', familyName: 'Inconnu homme', sex: 'M' };
    expect(patientRegisterPayload.safeParse({ ...base, isProvisional: true }).success).toBe(false);
    expect(
      patientRegisterPayload.safeParse({ ...base, isProvisional: true, provisionalKind: 'unknown' })
        .success,
    ).toBe(true);
    expect(patientRegisterPayload.safeParse({ ...base, provisionalKind: 'newborn' }).success).toBe(
      false,
    );
  });

  it('refuses acts dated after the death, accepts acts recorded late but done before', () => {
    const death = '2026-11-01T07:30:00.000Z';
    expect(blockedByDeath(death, '2026-11-01T07:29:00.000Z')).toBe(false);
    expect(blockedByDeath(death, '2026-11-01T07:31:00.000Z')).toBe(true);
    expect(blockedByDeath(null, '2026-11-01T07:31:00.000Z')).toBe(false);
  });

  it('withdraws a death declaration only with a reason', () => {
    expect(patientDeathPayload.safeParse({ deceasedAt: null }).success).toBe(false);
    expect(
      patientDeathPayload.safeParse({ deceasedAt: null, correctionReason: 'Mauvais dossier' })
        .success,
    ).toBe(true);
  });
});
