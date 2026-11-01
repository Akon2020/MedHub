import { describe, expect, it } from 'vitest';
import { hasOverlap, queueInput, scheduleExceptionInput, scheduleInput } from './config';

const resource = {
  resourceKind: 'practitioner',
  resourceId: '01a19830-805e-7768-a65f-140ecc61aab9',
};

describe('RDV configuration', () => {
  it('normalises queue codes and prefixes', () => {
    const queue = queueInput.parse({
      code: 'cons',
      name: 'Consultations',
      ticketPrefix: 'c',
      siteId: resource.resourceId,
    });
    expect(queue).toMatchObject({ code: 'CONS', ticketPrefix: 'C', isActive: true });
    expect(queueInput.safeParse({ ...queue, ticketPrefix: 'C1' }).success).toBe(false);
  });

  it('refuses overlapping hours on the same day and hours shorter than a slot', () => {
    const slot = { weekday: 1, startTime: '08:00', endTime: '12:00', slotMin: 15 };
    expect(scheduleInput.safeParse({ ...resource, slots: [slot] }).success).toBe(true);
    expect(
      scheduleInput.safeParse({
        ...resource,
        slots: [slot, { ...slot, startTime: '11:00', endTime: '13:00' }],
      }).success,
    ).toBe(false);
    expect(hasOverlap([slot, { ...slot, weekday: 2 }])).toBe(false);
    expect(
      scheduleInput.safeParse({ ...resource, slots: [{ ...slot, endTime: '08:10' }] }).success,
    ).toBe(false);
  });

  it('needs hours and a slot length for extra hours, none or both for a closure', () => {
    const base = { ...resource, date: '2026-12-24' };
    expect(scheduleExceptionInput.safeParse({ ...base, kind: 'closed' }).success).toBe(true);
    expect(
      scheduleExceptionInput.safeParse({ ...base, kind: 'closed', startTime: '08:00' }).success,
    ).toBe(false);
    expect(
      scheduleExceptionInput.safeParse({
        ...base,
        kind: 'extra',
        startTime: '14:00',
        endTime: '16:00',
        slotMin: 20,
      }).success,
    ).toBe(true);
  });
});
