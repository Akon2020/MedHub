import { describe, expect, it } from 'vitest';
import { patientRegisterPayload } from '../pat/commands';
import { fictitiousPatients, trainingCode } from './training';

describe('training base', () => {
  it('derives the training code from the structure code', () => {
    expect(trainingCode('HOP-KIN-0042')).toBe('FOR-KIN-0042');
  });

  it('generates valid, repeatable fictitious patients without phone numbers', () => {
    const now = new Date('2026-10-31T00:00:00Z');
    const patients = fictitiousPatients(40, now);
    expect(patients).toHaveLength(40);
    expect(fictitiousPatients(40, now)).toEqual(patients);
    expect(new Set(patients.map((p) => p.mrn)).size).toBe(40);
    for (const p of patients) {
      expect(patientRegisterPayload.safeParse(p).success).toBe(true);
      expect(p.phone).toBeNull();
      expect(p.mrn).toMatch(/^FOR-26-\d{5}$/);
    }
  });
});
