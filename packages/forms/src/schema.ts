import { VITAL_SIGN_CODES } from '@medhub/shared';
import { z } from 'zod';

/**
 * Definition of a configurable clinical form (docs/modules/form.md). Stored as
 * JSON in `form_version.definition`, validated here on the client and on the
 * server. A published version never changes.
 */
export const FORM_SCHEMA_VERSION = 1;

/** Stable field identifier: snake_case, never reused for another meaning. */
export const FIELD_ID_PATTERN = /^[a-z][a-z0-9_]{0,39}$/;

export const FORM_STEPS = [
  'triage',
  'consultation',
  'chronic_followup',
  'discharge',
  'patient_profile',
  'laboratory',
] as const;
export type FormStep = (typeof FORM_STEPS)[number];

/**
 * Field types of the MVP. The table, anatomical drawing, image and signature
 * types of the specification come later (docs/avancement.md, S9 deviations).
 */
export const FIELD_TYPES = [
  'text',
  'textarea',
  'number',
  'date',
  'time',
  'choice',
  'multi_choice',
  'yes_no',
  'scale',
  'calculation',
  'vital',
  'coded',
  'info',
] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

export const localizedText = z.object({
  fr: z.string().trim().min(1).max(500),
  en: z.string().trim().max(500).optional(),
});
export type LocalizedText = z.infer<typeof localizedText>;

const expression = z.string().trim().min(1).max(500);

export const choiceOption = z.object({
  code: z
    .string()
    .trim()
    .regex(/^[a-z0-9_]{1,40}$/),
  label: localizedText,
});

export const formField = z
  .object({
    id: z.string().regex(FIELD_ID_PATTERN),
    type: z.enum(FIELD_TYPES),
    label: localizedText,
    help: localizedText.optional(),
    required: z.boolean().optional(),
    visibleIf: expression.optional(),
    requiredIf: expression.optional(),
    /** number, calculation */
    unit: z.string().trim().max(20).optional(),
    decimals: z.number().int().min(0).max(4).optional(),
    /** number and scale bounds; a value outside is refused with `rangeMessage`. */
    min: z.number().optional(),
    max: z.number().optional(),
    rangeMessage: localizedText.optional(),
    /** choice, multi_choice */
    options: z.array(choiceOption).max(60).optional(),
    display: z.enum(['buttons', 'list']).optional(),
    /** calculation */
    expression: expression.optional(),
    /** vital: the answer is also recorded as a vital sign (no double entry). */
    vital: z.enum(VITAL_SIGN_CODES).optional(),
    /** coded */
    codeSystem: z.enum(['ICD10']).optional(),
    /** Declared for reports: indexed apart from the response document. */
    reportable: z.boolean().optional(),
  })
  .superRefine((f, ctx) => {
    const need = (ok: boolean, path: string, message: string) => {
      if (!ok) ctx.addIssue({ code: 'custom', path: [path], message });
    };
    if (f.type === 'choice' || f.type === 'multi_choice') {
      need((f.options?.length ?? 0) > 0, 'options', 'FORM_OPTIONS_REQUIRED');
      const codes = (f.options ?? []).map((o) => o.code);
      need(new Set(codes).size === codes.length, 'options', 'FORM_OPTION_DUPLICATE');
    }
    if (f.type === 'calculation')
      need(Boolean(f.expression), 'expression', 'FORM_EXPRESSION_REQUIRED');
    if (f.type === 'vital') need(Boolean(f.vital), 'vital', 'FORM_VITAL_REQUIRED');
    if (f.type === 'scale') {
      need(f.min !== undefined && f.max !== undefined, 'max', 'FORM_SCALE_BOUNDS');
    }
    if (f.min !== undefined && f.max !== undefined) need(f.min < f.max, 'max', 'FORM_SCALE_BOUNDS');
  });
export type FormField = z.infer<typeof formField>;

export const formSection = z.object({
  id: z.string().regex(FIELD_ID_PATTERN),
  title: localizedText,
  visibleIf: expression.optional(),
  fields: z.array(formField).max(80),
});
export type FormSection = z.infer<typeof formSection>;

export const formDefinition = z.object({
  schemaVersion: z.literal(FORM_SCHEMA_VERSION).default(FORM_SCHEMA_VERSION),
  code: z
    .string()
    .trim()
    .regex(/^[a-z][a-z0-9_]{1,39}$/),
  title: localizedText,
  step: z.enum(FORM_STEPS),
  sections: z.array(formSection).min(1).max(30),
});
export type FormDefinition = z.infer<typeof formDefinition>;

export function allFields(definition: FormDefinition): FormField[] {
  return definition.sections.flatMap((s) => s.fields);
}

/** Types that hold no answer of their own. */
export const NO_ANSWER: ReadonlySet<FieldType> = new Set(['info', 'calculation']);
