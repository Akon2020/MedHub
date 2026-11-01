import { z } from 'zod';
import { TICKET_PRIORITIES } from './visits';

/**
 * Triage (docs/modules/rdv.md, capability 10): main complaint, priority and
 * orientation, append-only; a correction is a new row that supersedes the
 * previous one. Vital signs are recorded with the DPI command and linked to
 * the same visit.
 */
export const triageRecordPayload = z.object({
  encounterId: z.uuid(),
  patientId: z.uuid(),
  priority: z.enum(TICKET_PRIORITIES),
  chiefComplaint: z.string().trim().min(2).max(300),
  notes: z.string().trim().max(2000).nullish(),
  /** Queue the patient is sent to next; a ticket is issued there with the triage priority. */
  orientationQueueId: z.uuid().nullish(),
  triagedAt: z.iso.datetime(),
  supersedesId: z.uuid().nullish(),
});
export type TriageRecordPayload = z.infer<typeof triageRecordPayload>;
