import { z } from 'zod';

/**
 * Responses to configurable forms (docs/modules/form.md). The answers are
 * checked against their form version by the shared engine (@medhub/forms) on
 * the workstation, and again by the server on receipt. A response is never
 * changed: a correction supersedes it with a reason.
 */
const responseBase = {
  patientId: z.uuid(),
  encounterId: z.uuid().nullish(),
  formVersionId: z.uuid(),
  formCode: z.string().trim().min(1).max(40),
  data: z.record(z.string(), z.unknown()),
  completedAt: z.iso.datetime(),
  supersedesId: z.uuid().nullish(),
  correctionReason: z.string().trim().min(3).max(300).nullish(),
};

const reasonForCorrection = (r: {
  supersedesId?: string | null;
  correctionReason?: string | null;
}) => !r.supersedesId || Boolean(r.correctionReason);

export const formResponseCompletePayload = z
  .object({ ...responseBase, state: z.literal('completed').default('completed') })
  .refine(reasonForCorrection, {
    message: 'DPI_CORRECTION_REASON_REQUIRED',
    path: ['correctionReason'],
  });

export const formResponseSignPayload = z
  .object({ ...responseBase, state: z.literal('signed').default('signed') })
  .refine(reasonForCorrection, {
    message: 'DPI_CORRECTION_REASON_REQUIRED',
    path: ['correctionReason'],
  });
export type FormResponsePayload = z.infer<typeof formResponseCompletePayload>;
