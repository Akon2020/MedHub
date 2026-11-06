import { z } from 'zod';

/**
 * Opening a record is logged even offline (docs/modules/dpi.md section 1): the
 * device queues an access entry like any operation, the server stores it in
 * the access journal and the chained audit log.
 */
export const RECORD_SCREENS = ['patient_record', 'patient_summary', 'break_glass'] as const;

export const recordAccessPayload = z.object({
  patientId: z.uuid(),
  screen: z.enum(RECORD_SCREENS),
  at: z.iso.datetime(),
  reason: z.string().trim().max(300).nullish(),
});
export type RecordAccessPayload = z.infer<typeof recordAccessPayload>;

/** One entry per patient and user every ten minutes is enough to know who opened what. */
export const RECORD_ACCESS_INTERVAL_MS = 10 * 60_000;
