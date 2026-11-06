import { VITAL_SIGN_CODES } from '@medhub/shared';
import { compile, evaluate, ExprError, type Compiled, type ExprEnv, type Value } from './expr';
import {
  allFields,
  NO_ANSWER,
  type FormDefinition,
  type FormField,
  type LocalizedText,
} from './schema';

/**
 * Headless form engine (docs/modules/form.md, Technique): from a definition,
 * the answers and the patient context it computes visibility, obligations,
 * calculated values and errors. The React renderer only displays its result;
 * the server runs it again on a received response.
 */
export type Answers = Record<string, unknown>;

export type FormContext = {
  /** YYYY-MM-DD, or null when unknown. */
  birthDate: string | null;
  sex: 'M' | 'F' | 'U';
  pregnant: boolean;
  /** Last known vitals in canonical units, by code. */
  vitals: Partial<Record<string, number>>;
  now: Date;
};

export type FieldError = { code: string; message?: LocalizedText };

export type FormState = {
  visible: Record<string, boolean>;
  sectionVisible: Record<string, boolean>;
  required: Record<string, boolean>;
  /** Answers of the visible fields and the calculated values: what is saved. */
  values: Answers;
  errors: Record<string, FieldError>;
  complete: boolean;
};

const cache = new Map<string, Compiled | null>();
function compiled(source: string): Compiled | null {
  let hit = cache.get(source);
  if (hit === undefined) {
    try {
      hit = compile(source);
    } catch {
      hit = null;
    }
    if (cache.size > 500) cache.clear();
    cache.set(source, hit);
  }
  return hit;
}

function run(source: string | undefined, env: ExprEnv): Value | undefined {
  if (!source) return undefined;
  const c = compiled(source);
  return c ? evaluate(c, env) : null;
}

const truthy = (v: Value | undefined) => v !== null && v !== undefined && v !== false && v !== 0;

export function isEmpty(v: unknown): boolean {
  return v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);
}

function ageIn(ctx: FormContext, unit: 'years' | 'months'): number | null {
  if (!ctx.birthDate || !/^\d{4}-\d{2}-\d{2}$/.test(ctx.birthDate)) return null;
  const [y, m, d] = ctx.birthDate.split('-').map(Number) as [number, number, number];
  const now = ctx.now;
  let months = (now.getUTCFullYear() - y) * 12 + (now.getUTCMonth() + 1 - m);
  if (now.getUTCDate() < d) months -= 1;
  if (months < 0) return null;
  return unit === 'months' ? months : Math.floor(months / 12);
}

const ICD10 = /^[A-Z]\d{2}(\.\d{1,2})?$/;

/** Shape of one answer against its field; null when valid. */
export function answerError(field: FormField, v: unknown): FieldError | null {
  const range = (n: number): FieldError | null =>
    (field.min !== undefined && n < field.min) || (field.max !== undefined && n > field.max)
      ? { code: 'FORM_RANGE', ...(field.rangeMessage ? { message: field.rangeMessage } : {}) }
      : null;
  switch (field.type) {
    case 'text':
    case 'textarea':
      if (typeof v !== 'string') return { code: 'FORM_TEXT' };
      return v.length > (field.type === 'text' ? 2_000 : 10_000) ? { code: 'FORM_TEXT' } : null;
    case 'number':
    case 'vital':
      if (typeof v !== 'number' || !Number.isFinite(v)) return { code: 'FORM_NUMBER' };
      return range(v);
    case 'scale':
      if (typeof v !== 'number' || !Number.isInteger(v)) return { code: 'FORM_NUMBER' };
      return range(v);
    case 'date': {
      if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return { code: 'FORM_DATE' };
      const t = Date.parse(`${v}T00:00:00Z`);
      return Number.isNaN(t) || new Date(t).toISOString().slice(0, 10) !== v
        ? { code: 'FORM_DATE' }
        : null;
    }
    case 'time':
      return typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v)
        ? null
        : { code: 'FORM_TIME' };
    case 'choice':
      return typeof v === 'string' && (field.options ?? []).some((o) => o.code === v)
        ? null
        : { code: 'FORM_CHOICE' };
    case 'multi_choice': {
      const codes = new Set((field.options ?? []).map((o) => o.code));
      return Array.isArray(v) &&
        v.every((c) => typeof c === 'string' && codes.has(c)) &&
        new Set(v).size === v.length
        ? null
        : { code: 'FORM_CHOICE' };
    }
    case 'yes_no':
      return typeof v === 'boolean' ? null : { code: 'FORM_CHOICE' };
    case 'coded': {
      if (typeof v !== 'object' || v === null || Array.isArray(v)) return { code: 'FORM_CODED' };
      const { code, label } = v as { code?: unknown; label?: unknown };
      if (typeof label !== 'string' || label.trim().length < 2 || label.length > 200) {
        return { code: 'FORM_CODED' };
      }
      if (code !== undefined && code !== null && (typeof code !== 'string' || !ICD10.test(code))) {
        return { code: 'FORM_CODED' };
      }
      return null;
    }
    default:
      return null;
  }
}

/**
 * Computes the state of a form. With `structural`, obligations and visibility
 * are not enforced (they depend on the workstation's context): only the shape
 * of each answer is checked, as the server does on a received response.
 */
export function evaluateForm(
  definition: FormDefinition,
  answers: Answers,
  ctx: FormContext,
  options: { structural?: boolean } = {},
): FormState {
  const fields = allFields(definition);
  const byId = new Map(fields.map((f) => [f.id, f]));
  const calcs: Answers = {};
  const env: ExprEnv = {
    value: (id) => (byId.get(id)?.type === 'calculation' ? calcs[id] : answers[id]) ?? null,
    vital: (code) => {
      const bound = fields.find((f) => f.type === 'vital' && f.vital === code);
      const own = bound ? answers[bound.id] : undefined;
      if (typeof own === 'number') return own;
      const known = ctx.vitals[code];
      return typeof known === 'number' ? known : null;
    },
    ageYears: () => ageIn(ctx, 'years'),
    ageMonths: () => ageIn(ctx, 'months'),
    sex: () => ctx.sex,
    isPregnant: () => ctx.pregnant,
  };

  // Calculations may read each other: a few passes settle forward references.
  for (let pass = 0; pass < 3; pass++) {
    for (const f of fields) {
      if (f.type !== 'calculation') continue;
      const v = run(f.expression, env);
      const n = typeof v === 'number' && Number.isFinite(v) ? v : v === undefined ? null : v;
      calcs[f.id] =
        typeof n === 'number' && f.decimals !== undefined
          ? Math.round(n * 10 ** f.decimals) / 10 ** f.decimals
          : n;
    }
  }

  const visible: Record<string, boolean> = {};
  const sectionVisible: Record<string, boolean> = {};
  const required: Record<string, boolean> = {};
  const values: Answers = {};
  const errors: Record<string, FieldError> = {};

  for (const section of definition.sections) {
    const shown = options.structural || !section.visibleIf || truthy(run(section.visibleIf, env));
    sectionVisible[section.id] = shown;
    for (const f of section.fields) {
      const isVisible =
        options.structural || (shown && (!f.visibleIf || truthy(run(f.visibleIf, env))));
      visible[f.id] = isVisible;
      const isRequired =
        !options.structural &&
        isVisible &&
        !NO_ANSWER.has(f.type) &&
        (f.required === true || truthy(run(f.requiredIf, env)));
      required[f.id] = isRequired;
      if (!isVisible) continue;
      if (f.type === 'calculation') {
        if (calcs[f.id] !== null && calcs[f.id] !== undefined) values[f.id] = calcs[f.id];
        continue;
      }
      if (f.type === 'info') continue;
      const v = answers[f.id];
      if (isEmpty(v)) {
        if (isRequired) errors[f.id] = { code: 'FORM_REQUIRED' };
        continue;
      }
      const error = answerError(f, v);
      if (error) errors[f.id] = error;
      values[f.id] = typeof v === 'string' ? v.trim() : v;
    }
  }

  if (options.structural) {
    for (const key of Object.keys(answers)) {
      const f = byId.get(key);
      if (!f) errors[key] = { code: 'FORM_UNKNOWN_FIELD' };
    }
  }
  return {
    visible,
    sectionVisible,
    required,
    values,
    errors,
    complete: Object.keys(errors).length === 0,
  };
}

/** Vital signs to record from a response: a bound field creates the measurement. */
export function vitalAnswers(
  definition: FormDefinition,
  values: Answers,
): { fieldId: string; code: string; value: number }[] {
  return allFields(definition)
    .filter((f) => f.type === 'vital' && f.vital && typeof values[f.id] === 'number')
    .map((f) => ({ fieldId: f.id, code: f.vital as string, value: values[f.id] as number }));
}

export type DefinitionIssue = { fieldId: string | null; code: string };

/**
 * Publication checks (docs/modules/form.md, règles de gestion): unique ids,
 * every expression valid and referring to known fields and vitals, no cycle
 * between calculations, no field whose type changed since the previous version.
 */
export function checkDefinition(
  definition: FormDefinition,
  previous?: FormDefinition | null,
): DefinitionIssue[] {
  const issues: DefinitionIssue[] = [];
  const fields = allFields(definition);
  const ids = new Set<string>();
  for (const f of fields) {
    if (ids.has(f.id)) issues.push({ fieldId: f.id, code: 'FORM_FIELD_DUPLICATE' });
    ids.add(f.id);
  }
  const sectionIds = new Set<string>();
  for (const s of definition.sections) {
    if (sectionIds.has(s.id)) issues.push({ fieldId: s.id, code: 'FORM_FIELD_DUPLICATE' });
    sectionIds.add(s.id);
  }
  const vitals = new Set<string>(VITAL_SIGN_CODES);
  const deps = new Map<string, Set<string>>();
  const checkExpr = (source: string | undefined, owner: string) => {
    if (!source) return;
    try {
      const c = compile(source);
      for (const ref of c.fields) {
        if (!ids.has(ref)) issues.push({ fieldId: owner, code: 'FORM_EXPR_UNKNOWN_FIELD' });
      }
      for (const code of c.vitals) {
        if (!vitals.has(code)) issues.push({ fieldId: owner, code: 'FORM_EXPR_UNKNOWN_VITAL' });
      }
      return c;
    } catch (err) {
      issues.push({
        fieldId: owner,
        code: err instanceof ExprError ? err.code : 'FORM_EXPR_SYNTAX',
      });
      return undefined;
    }
  };
  for (const s of definition.sections) checkExpr(s.visibleIf, s.id);
  for (const f of fields) {
    checkExpr(f.visibleIf, f.id);
    checkExpr(f.requiredIf, f.id);
    const c = checkExpr(f.expression, f.id);
    if (f.type === 'calculation' && c) deps.set(f.id, c.fields);
  }
  // A calculation must not depend on itself, directly or through others.
  const state = new Map<string, 'visiting' | 'done'>();
  const cyclic = new Set<string>();
  const walk = (id: string): boolean => {
    if (state.get(id) === 'done') return false;
    if (state.get(id) === 'visiting') return true;
    state.set(id, 'visiting');
    let cycle = false;
    for (const next of deps.get(id) ?? []) if (deps.has(next) && walk(next)) cycle = true;
    state.set(id, 'done');
    if (cycle) cyclic.add(id);
    return cycle;
  };
  for (const id of deps.keys()) walk(id);
  for (const id of cyclic) issues.push({ fieldId: id, code: 'FORM_EXPR_CYCLE' });

  if (previous) {
    const before = new Map(allFields(previous).map((f) => [f.id, f.type]));
    for (const f of fields) {
      const type = before.get(f.id);
      if (type && type !== f.type) issues.push({ fieldId: f.id, code: 'FORM_FIELD_TYPE_CHANGED' });
    }
  }
  return issues;
}

/** Text in the interface language, French when the translation is missing. */
export function localized(text: LocalizedText | undefined, locale: string): string {
  if (!text) return '';
  return locale === 'en' && text.en ? text.en : text.fr;
}
