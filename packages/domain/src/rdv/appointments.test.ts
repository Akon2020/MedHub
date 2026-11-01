import { describe, expect, it } from 'vitest';
import { daySlots, firstFreeSlot, isoWeekday, slotCapacity, zonedInstant } from './appointments';

const resourceId = 'r1';
const timeZone = 'Africa/Kinshasa';
const schedules = [
  { resourceId, weekday: 1, startTime: '08:00', endTime: '09:00', slotMin: 20, overbookMax: 1 },
];

describe('agenda slots', () => {
  it('reads local hours in the time zone of the structure', () => {
    expect(zonedInstant('2026-11-02', '08:00', timeZone).toISOString()).toBe(
      '2026-11-02T07:00:00.000Z',
    );
    expect(zonedInstant('2026-11-02', '08:00', 'Africa/Lubumbashi').toISOString()).toBe(
      '2026-11-02T06:00:00.000Z',
    );
    expect(isoWeekday('2026-11-02')).toBe(1);
  });

  it('cuts weekly hours into slots holding one booking plus overbooking', () => {
    const slots = daySlots({
      resourceId,
      date: '2026-11-02',
      timeZone,
      schedules,
      exceptions: [],
      appointments: [
        { id: 'a', startsAt: '2026-11-02T07:00:00.000Z', status: 'booked' },
        { id: 'b', startsAt: '2026-11-02T07:00:00.000Z', status: 'arrived' },
        { id: 'c', startsAt: '2026-11-02T07:20:00.000Z', status: 'cancelled' },
      ],
    });
    expect(slots.map((s) => [s.startsAt.slice(11, 16), s.booked, s.free])).toEqual([
      ['07:00', 2, false],
      ['07:20', 0, true],
      ['07:40', 0, true],
    ]);
    expect(
      daySlots({
        resourceId,
        date: '2026-11-03',
        timeZone,
        schedules,
        exceptions: [],
        appointments: [],
      }),
    ).toEqual([]);
  });

  it('applies closures and extra hours, and finds the first free slot', () => {
    const exceptions = [
      {
        resourceId,
        date: '2026-11-02',
        kind: 'closed' as const,
        startTime: null,
        endTime: null,
        slotMin: null,
      },
      {
        resourceId,
        date: '2026-11-03',
        kind: 'extra' as const,
        startTime: '14:00',
        endTime: '14:30',
        slotMin: 30,
      },
    ];
    expect(
      slotCapacity({
        resourceId,
        startsAt: '2026-11-02T07:00:00.000Z',
        timeZone,
        schedules,
        exceptions,
      }),
    ).toBe(0);
    const slot = firstFreeSlot({
      resourceId,
      from: '2026-11-02',
      days: 7,
      now: new Date('2026-11-01T00:00:00.000Z'),
      timeZone,
      schedules,
      exceptions,
      appointments: [],
    });
    expect(slot?.startsAt).toBe('2026-11-03T13:00:00.000Z');
  });
});
