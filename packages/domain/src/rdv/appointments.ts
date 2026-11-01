import { z } from 'zod';
import { RESOURCE_KINDS, minutesOf } from './config';

/**
 * Appointments (docs/modules/rdv.md, capabilities 1 to 4). Slots come from the
 * weekly template of the resource and its exceptions, in the site's time zone;
 * a slot holds one appointment plus the allowed overbooking. Two devices that
 * book the same slot offline: the first to reach the server wins.
 */
export const APPOINTMENT_STATUSES = [
  'booked',
  'confirmed',
  'arrived',
  'no_show',
  'cancelled',
  'completed',
] as const;
export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number];

/** Statuses that occupy a slot. */
export const SLOT_HOLDING_STATUSES: readonly AppointmentStatus[] = [
  'booked',
  'confirmed',
  'arrived',
  'completed',
];
export const UPCOMING_STATUSES = ['booked', 'confirmed'] as const;

export const appointmentBookPayload = z
  .object({
    patientId: z.uuid(),
    resourceKind: z.enum(RESOURCE_KINDS),
    resourceId: z.uuid(),
    appointmentTypeId: z.uuid().nullish(),
    startsAt: z.iso.datetime(),
    endsAt: z.iso.datetime(),
    source: z.enum(['front_desk', 'portal', 'recurring']).default('front_desk'),
    notes: z.string().trim().max(300).nullish(),
    status: z.literal('booked').default('booked'),
  })
  .refine((a) => Date.parse(a.endsAt) > Date.parse(a.startsAt), {
    message: 'RDV_SLOT_RANGE',
    path: ['endsAt'],
  });
export type AppointmentBookPayload = z.infer<typeof appointmentBookPayload>;

export const appointmentReschedulePayload = z
  .object({ startsAt: z.iso.datetime(), endsAt: z.iso.datetime() })
  .refine((a) => Date.parse(a.endsAt) > Date.parse(a.startsAt), {
    message: 'RDV_SLOT_RANGE',
    path: ['endsAt'],
  });
export const appointmentCancelPayload = z.object({
  cancelReason: z.string().trim().min(3).max(300),
});
export const appointmentMarkPayload = z.object({ at: z.iso.datetime() });

export type ScheduleRow = {
  resourceId: string;
  weekday: number;
  startTime: string;
  endTime: string;
  slotMin: number;
  overbookMax: number;
};
export type ExceptionRow = {
  resourceId: string;
  date: string;
  kind: 'closed' | 'extra';
  startTime: string | null;
  endTime: string | null;
  slotMin: number | null;
};
export type BookedRow = { id: string; startsAt: string; status: string };

export type Slot = {
  startsAt: string;
  endsAt: string;
  capacity: number;
  booked: number;
  free: boolean;
};

/** Offset of a time zone at an instant, in milliseconds (no DST assumption). */
function zoneOffsetMs(at: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(at));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const asUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour'),
    get('minute'),
    get('second'),
  );
  return asUtc - Math.floor(at / 1000) * 1000;
}

/** UTC instant of a local date and time in the site's time zone. */
export function zonedInstant(date: string, time: string, timeZone: string): Date {
  const [y, m, d] = date.split('-').map(Number);
  const guess = Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1, 0, minutesOf(time));
  let instant = guess - zoneOffsetMs(guess, timeZone);
  instant = guess - zoneOffsetMs(instant, timeZone);
  return new Date(instant);
}

/** Local calendar date of an instant in the site's time zone. */
export function zonedDate(at: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(at);
}

/** ISO weekday (Monday 1 to Sunday 7) of a calendar date. */
export function isoWeekday(date: string): number {
  const day = new Date(`${date}T12:00:00Z`).getUTCDay();
  return day === 0 ? 7 : day;
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Slots of a resource for one day: weekly hours plus extra hours, minus
 * closures, each with its capacity (one plus overbooking) and its bookings.
 */
export function daySlots(input: {
  resourceId: string;
  date: string;
  timeZone: string;
  schedules: readonly ScheduleRow[];
  exceptions: readonly ExceptionRow[];
  appointments: readonly BookedRow[];
}): Slot[] {
  const exceptions = input.exceptions.filter(
    (e) => e.resourceId === input.resourceId && e.date === input.date,
  );
  if (exceptions.some((e) => e.kind === 'closed' && !e.startTime)) return [];
  const weekday = isoWeekday(input.date);
  const ranges = [
    ...input.schedules
      .filter((s) => s.resourceId === input.resourceId && s.weekday === weekday)
      .map((s) => ({ ...s })),
    ...exceptions
      .filter((e) => e.kind === 'extra' && e.startTime && e.endTime && e.slotMin)
      .map((e) => ({
        startTime: e.startTime as string,
        endTime: e.endTime as string,
        slotMin: e.slotMin as number,
        overbookMax: 0,
      })),
  ];
  const closed = exceptions
    .filter((e) => e.kind === 'closed' && e.startTime && e.endTime)
    .map((e) => [minutesOf(e.startTime as string), minutesOf(e.endTime as string)] as const);
  const holding = new Map<number, number>();
  for (const a of input.appointments) {
    if (!SLOT_HOLDING_STATUSES.includes(a.status as AppointmentStatus)) continue;
    const at = Date.parse(a.startsAt);
    holding.set(at, (holding.get(at) ?? 0) + 1);
  }
  const slots: Slot[] = [];
  for (const range of ranges) {
    const end = minutesOf(range.endTime);
    for (
      let start = minutesOf(range.startTime);
      start + range.slotMin <= end;
      start += range.slotMin
    ) {
      const stop = start + range.slotMin;
      if (closed.some(([from, to]) => start < to && stop > from)) continue;
      const time = (m: number) =>
        `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
      const startsAt = zonedInstant(input.date, time(start), input.timeZone);
      const capacity = 1 + range.overbookMax;
      const booked = holding.get(startsAt.getTime()) ?? 0;
      slots.push({
        startsAt: startsAt.toISOString(),
        endsAt: zonedInstant(input.date, time(stop), input.timeZone).toISOString(),
        capacity,
        booked,
        free: booked < capacity,
      });
    }
  }
  return slots.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
}

/** Capacity of the slot starting at this instant (0 when no such slot exists). */
export function slotCapacity(
  input: Omit<Parameters<typeof daySlots>[0], 'appointments' | 'date'> & { startsAt: string },
): number {
  const date = zonedDate(new Date(input.startsAt), input.timeZone);
  const slot = daySlots({ ...input, date, appointments: [] }).find(
    (s) => Date.parse(s.startsAt) === Date.parse(input.startsAt),
  );
  return slot?.capacity ?? 0;
}

/** First free slot from a date on, within a horizon of days, not in the past. */
export function firstFreeSlot(
  input: Omit<Parameters<typeof daySlots>[0], 'date'> & { from: string; days: number; now: Date },
): Slot | null {
  for (let i = 0; i < input.days; i += 1) {
    const date = addDays(input.from, i);
    const slot = daySlots({ ...input, date }).find(
      (s) => s.free && Date.parse(s.startsAt) > input.now.getTime(),
    );
    if (slot) return slot;
  }
  return null;
}

/** Missed appointments, shown in the patient banner (capability 4). */
export function noShowCount(appointments: readonly { status: string }[]): number {
  return appointments.filter((a) => a.status === 'no_show').length;
}
