import { z } from 'zod';

/**
 * Configuration of the RDV module (docs/modules/rdv.md): queues, appointment
 * types and weekly schedules. Edited online, distributed read-only to devices.
 */
export const RESOURCE_KINDS = ['practitioner', 'department', 'room', 'equipment'] as const;
export type ResourceKind = (typeof RESOURCE_KINDS)[number];

export const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
const time = z.string().regex(TIME_PATTERN, 'RDV_TIME_INVALID');
const code = z
  .string()
  .trim()
  .toUpperCase()
  .pipe(z.string().regex(/^[A-Z0-9]{2,12}$/));

/** Minutes since midnight of an "HH:MM" value. */
export function minutesOf(value: string): number {
  const [h, m] = value.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

export const queueInput = z.object({
  id: z.uuid().nullish(),
  code,
  name: z.string().trim().min(2).max(80),
  /** Printed before the ticket number: one to three letters. */
  ticketPrefix: z
    .string()
    .trim()
    .toUpperCase()
    .pipe(z.string().regex(/^[A-Z]{1,3}$/)),
  siteId: z.uuid(),
  departmentId: z.uuid().nullish(),
  isActive: z.boolean().default(true),
});
export type QueueInput = z.infer<typeof queueInput>;

export const appointmentTypeInput = z.object({
  id: z.uuid().nullish(),
  code,
  name: z.string().trim().min(2).max(80),
  durationMin: z.int().min(5).max(480),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .default('#0f6b6b'),
  departmentId: z.uuid().nullish(),
  isActive: z.boolean().default(true),
});
export type AppointmentTypeInput = z.infer<typeof appointmentTypeInput>;

export const scheduleSlotInput = z
  .object({
    weekday: z.int().min(1).max(7),
    startTime: time,
    endTime: time,
    slotMin: z.int().min(5).max(240),
    overbookMax: z.int().min(0).max(20).default(0),
  })
  .refine((s) => minutesOf(s.endTime) - minutesOf(s.startTime) >= s.slotMin, {
    message: 'RDV_SLOT_RANGE',
    path: ['endTime'],
  });
export type ScheduleSlotInput = z.infer<typeof scheduleSlotInput>;

/** The whole weekly template of one resource, replaced at once. */
export const scheduleInput = z
  .object({
    resourceKind: z.enum(RESOURCE_KINDS),
    resourceId: z.uuid(),
    slots: z.array(scheduleSlotInput).max(70),
  })
  .refine((s) => !hasOverlap(s.slots), { message: 'RDV_SLOT_OVERLAP', path: ['slots'] });
export type ScheduleInput = z.infer<typeof scheduleInput>;

export function hasOverlap(
  slots: readonly { weekday: number; startTime: string; endTime: string }[],
): boolean {
  const byDay = new Map<number, [number, number][]>();
  for (const s of slots) {
    const list = byDay.get(s.weekday) ?? [];
    list.push([minutesOf(s.startTime), minutesOf(s.endTime)]);
    byDay.set(s.weekday, list);
  }
  for (const list of byDay.values()) {
    list.sort((a, b) => a[0] - b[0]);
    for (let i = 1; i < list.length; i += 1) {
      if ((list[i]?.[0] ?? 0) < (list[i - 1]?.[1] ?? 0)) return true;
    }
  }
  return false;
}

/** Closed day or hours (leave, closure), or extra hours added to the template. */
export const scheduleExceptionInput = z
  .object({
    resourceKind: z.enum(RESOURCE_KINDS),
    resourceId: z.uuid(),
    date: z.iso.date(),
    kind: z.enum(['closed', 'extra']),
    startTime: time.nullish(),
    endTime: time.nullish(),
    slotMin: z.int().min(5).max(240).nullish(),
    reason: z.string().trim().max(200).nullish(),
  })
  .refine(
    (e) =>
      e.kind === 'closed'
        ? Boolean(e.startTime) === Boolean(e.endTime)
        : Boolean(e.startTime && e.endTime && e.slotMin),
    { message: 'RDV_EXCEPTION_HOURS', path: ['startTime'] },
  )
  .refine((e) => !e.startTime || !e.endTime || minutesOf(e.endTime) > minutesOf(e.startTime), {
    message: 'RDV_SLOT_RANGE',
    path: ['endTime'],
  });
export type ScheduleExceptionInput = z.infer<typeof scheduleExceptionInput>;
