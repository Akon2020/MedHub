'use client';

import {
  localized,
  type Answers,
  type FieldError,
  type FormDefinition,
  type FormField,
  type FormState,
} from '@medhub/forms';
import { useLocale, useTranslations } from 'next-intl';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

/**
 * Displays a form from the engine's state (docs/modules/form.md): visibility,
 * obligations, calculations and errors all come from @medhub/forms, this
 * component only renders them and reports the changes.
 */
export function FormRenderer({
  definition,
  answers,
  state,
  onChange,
  showErrors,
  readOnly = false,
}: {
  definition: FormDefinition;
  answers: Answers;
  state: FormState;
  onChange?: (answers: Answers) => void;
  showErrors: boolean;
  readOnly?: boolean;
}) {
  const locale = useLocale();
  return (
    <div className="grid gap-5">
      {definition.sections.map((section) =>
        state.sectionVisible[section.id] === false ? null : (
          <fieldset key={section.id} className="grid gap-3">
            <legend className="mb-1 text-sm font-semibold text-primary">
              {localized(section.title, locale)}
            </legend>
            {section.fields.map((field) =>
              state.visible[field.id] === false ? null : (
                <FieldView
                  key={field.id}
                  field={field}
                  value={field.type === 'calculation' ? state.values[field.id] : answers[field.id]}
                  required={state.required[field.id] === true}
                  error={showErrors ? state.errors[field.id] : undefined}
                  readOnly={readOnly}
                  onChange={(v) => onChange?.({ ...answers, [field.id]: v })}
                />
              ),
            )}
          </fieldset>
        ),
      )}
    </div>
  );
}

function FieldView({
  field,
  value,
  required,
  error,
  readOnly,
  onChange,
}: {
  field: FormField;
  value: unknown;
  required: boolean;
  error: FieldError | undefined;
  readOnly: boolean;
  onChange: (value: unknown) => void;
}) {
  const t = useTranslations('forms');
  const locale = useLocale();
  const id = `form-field-${field.id}`;
  const label = localized(field.label, locale);
  const unit = field.unit ? ` (${field.unit})` : '';

  if (field.type === 'info') {
    return <p className="rounded-lg bg-info-soft px-3 py-2 text-sm text-info">{label}</p>;
  }

  const message = error
    ? error.message
      ? localized(error.message, locale)
      : t.has(`errors.${error.code}`)
        ? t(`errors.${error.code}`)
        : error.code
    : null;

  const control = (() => {
    switch (field.type) {
      case 'calculation':
        return (
          <p id={id} className="font-mono text-base">
            {typeof value === 'number'
              ? `${value}${field.unit ? ` ${field.unit}` : ''}`
              : t('notComputed')}
          </p>
        );
      case 'textarea':
        return (
          <Textarea
            id={id}
            rows={3}
            disabled={readOnly}
            value={typeof value === 'string' ? value : ''}
            onChange={(e) => onChange(e.target.value)}
          />
        );
      case 'number':
      case 'vital':
      case 'scale':
        return (
          <Input
            id={id}
            type="number"
            inputMode="decimal"
            className="max-w-48"
            disabled={readOnly}
            min={field.min}
            max={field.max}
            step={field.type === 'scale' ? 1 : 'any'}
            value={typeof value === 'number' ? String(value) : ''}
            onChange={(e) => {
              const raw = e.target.value.replace(',', '.');
              onChange(raw === '' ? null : Number(raw));
            }}
          />
        );
      case 'date':
      case 'time':
        return (
          <Input
            id={id}
            type={field.type}
            className="max-w-48"
            disabled={readOnly}
            value={typeof value === 'string' ? value : ''}
            onChange={(e) => onChange(e.target.value || null)}
          />
        );
      case 'yes_no':
        return (
          <Choices
            options={[
              { code: 'true', label: t('yes') },
              { code: 'false', label: t('no') },
            ]}
            selected={value === true ? ['true'] : value === false ? ['false'] : []}
            disabled={readOnly}
            onToggle={(code) => onChange(code === 'true')}
          />
        );
      case 'choice':
        return field.display === 'list' ? (
          <NativeSelect
            id={id}
            className="max-w-80"
            disabled={readOnly}
            value={typeof value === 'string' ? value : ''}
            onChange={(e) => onChange(e.target.value || null)}
          >
            <option value="">{t('choose')}</option>
            {(field.options ?? []).map((o) => (
              <option key={o.code} value={o.code}>
                {localized(o.label, locale)}
              </option>
            ))}
          </NativeSelect>
        ) : (
          <Choices
            options={(field.options ?? []).map((o) => ({
              code: o.code,
              label: localized(o.label, locale),
            }))}
            selected={typeof value === 'string' ? [value] : []}
            disabled={readOnly}
            onToggle={(code) => onChange(value === code ? null : code)}
          />
        );
      case 'multi_choice': {
        const current = Array.isArray(value) ? (value as string[]) : [];
        return (
          <Choices
            options={(field.options ?? []).map((o) => ({
              code: o.code,
              label: localized(o.label, locale),
            }))}
            selected={current}
            disabled={readOnly}
            onToggle={(code) =>
              onChange(
                current.includes(code) ? current.filter((c) => c !== code) : [...current, code],
              )
            }
          />
        );
      }
      case 'coded': {
        const coded = (value ?? {}) as { code?: string | null; label?: string };
        return (
          <div className="flex flex-wrap gap-2">
            <Input
              aria-label={t('codedCode')}
              placeholder={t('codedCode')}
              className="max-w-32"
              disabled={readOnly}
              value={coded.code ?? ''}
              onChange={(e) => onChange({ ...coded, code: e.target.value.toUpperCase() || null })}
            />
            <Input
              id={id}
              placeholder={t('codedLabel')}
              className="min-w-0 flex-1"
              disabled={readOnly}
              value={coded.label ?? ''}
              onChange={(e) => onChange({ ...coded, label: e.target.value })}
            />
          </div>
        );
      }
      default:
        return (
          <Input
            id={id}
            disabled={readOnly}
            value={typeof value === 'string' ? value : ''}
            onChange={(e) => onChange(e.target.value)}
          />
        );
    }
  })();

  return (
    <div className="grid gap-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
        {unit}
        {required && (
          <span className="text-danger" aria-hidden>
            {' '}
            *
          </span>
        )}
      </label>
      {control}
      {field.help && (
        <p className="text-xs text-muted-foreground">{localized(field.help, locale)}</p>
      )}
      {message && (
        <p role="alert" className="text-xs text-danger">
          {message}
        </p>
      )}
    </div>
  );
}

function Choices({
  options,
  selected,
  disabled,
  onToggle,
}: {
  options: { code: string; label: string }[];
  selected: string[];
  disabled: boolean;
  onToggle: (code: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((o) => {
        const on = selected.includes(o.code);
        return (
          <button
            key={o.code}
            type="button"
            aria-pressed={on}
            disabled={disabled}
            onClick={() => onToggle(o.code)}
            className={cn(
              'min-h-10 rounded-full px-3.5 text-sm ring-1 transition-colors disabled:opacity-60',
              on ? 'bg-primary text-primary-foreground ring-primary' : 'ring-border hover:bg-muted',
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** Answer of a saved response as text, in its own form version. */
export function answerText(
  field: FormField,
  value: unknown,
  locale: string,
  yesNo: { yes: string; no: string },
): string {
  if (value === null || value === undefined) return '';
  switch (field.type) {
    case 'choice':
      return (
        localized(field.options?.find((o) => o.code === value)?.label, locale) || String(value)
      );
    case 'multi_choice':
      return (Array.isArray(value) ? value : [])
        .map((c) => localized(field.options?.find((o) => o.code === c)?.label, locale) || String(c))
        .join(', ');
    case 'yes_no':
      return value === true ? yesNo.yes : yesNo.no;
    case 'coded': {
      const c = value as { code?: string | null; label?: string };
      return [c.code, c.label].filter(Boolean).join(' · ');
    }
    default:
      return `${String(value)}${field.unit ? ` ${field.unit}` : ''}`;
  }
}
