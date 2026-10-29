'use client';

import { DEFAULT_MRN_TEMPLATE, birthDateFromEstimatedAge, formatNumber } from '@medhub/domain';
import { AppError, SEXES, type Sex } from '@medhub/shared';
import { Loader2, UserPlus, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState, type FormEvent } from 'react';
import { useRuntime } from '@/client/runtime';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

type Errors = Partial<Record<'familyName' | 'phone' | 'form', string>>;

/**
 * Quick registration (under a minute, docs/07-ui-ux.md 5.1). Works offline: the
 * record number embeds the workstation code, so two devices never collide.
 */
export function RegisterForm({
  onDone,
  onCancel,
}: {
  onDone: (id: string) => void;
  onCancel: () => void;
}) {
  const t = useTranslations('patients');
  const tErr = useTranslations('errors');
  const { dispatch, device, identity, nextCounter } = useRuntime();
  const [familyName, setFamilyName] = useState('');
  const [middleName, setMiddleName] = useState('');
  const [givenName, setGivenName] = useState('');
  const [sex, setSex] = useState<Sex>('F');
  const [birthDate, setBirthDate] = useState('');
  const [age, setAge] = useState('');
  const [phone, setPhone] = useState('');
  const [errors, setErrors] = useState<Errors>({});
  const [busy, setBusy] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const next: Errors = {};
    if (!familyName.trim()) next.familyName = t('form.required');
    if (phone.trim() && !/^\+?[0-9 ]{6,20}$/.test(phone.trim()))
      next.phone = t('form.phoneInvalid');
    if (!device) next.form = t('form.deviceMissing');
    setErrors(next);
    if (Object.keys(next).length > 0 || !device) return;

    setBusy(true);
    try {
      const now = new Date();
      const year = now.getFullYear();
      const seq = await nextCounter(`mrn:${year}`);
      const mrn = formatNumber(DEFAULT_MRN_TEMPLATE, {
        prefix: identity?.siteCode ?? 'PAT',
        device: device.deviceCode,
        year,
        seq,
      });
      const estimatedYears = age.trim() ? Number(age) : null;
      const { entityId } = await dispatch('patient.register', {
        mrn,
        familyName: familyName.trim(),
        middleName: middleName.trim() || null,
        givenName: givenName.trim() || null,
        sex,
        birthDate:
          birthDate ||
          (estimatedYears !== null ? birthDateFromEstimatedAge(estimatedYears, now) : null),
        birthDateEstimated: !birthDate && estimatedYears !== null,
        phone: phone.trim() || null,
        sensitivity: 'normal',
      });
      setSuccess(t('form.success', { mrn }));
      onDone(entityId);
    } catch (error) {
      const code = error instanceof AppError ? error.code : 'UNKNOWN';
      setErrors({ form: tErr.has(code) ? tErr(code) : tErr('UNKNOWN') });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>{t('form.title')}</CardTitle>
          <CardDescription className="mt-1">{t('form.subtitle')}</CardDescription>
        </div>
        <Button variant="ghost" size="icon-sm" onClick={onCancel} aria-label={t('form.title')}>
          <X />
        </Button>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="grid gap-4" noValidate>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="grid gap-2">
              <Label htmlFor="familyName">{t('form.familyName')}</Label>
              <Input
                id="familyName"
                value={familyName}
                onChange={(e) => setFamilyName(e.target.value)}
                aria-invalid={Boolean(errors.familyName)}
                autoFocus
                autoComplete="off"
              />
              {errors.familyName && <p className="text-xs text-danger">{errors.familyName}</p>}
            </div>
            <div className="grid gap-2">
              <Label htmlFor="middleName">{t('form.middleName')}</Label>
              <Input
                id="middleName"
                value={middleName}
                onChange={(e) => setMiddleName(e.target.value)}
                autoComplete="off"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="givenName">{t('form.givenName')}</Label>
              <Input
                id="givenName"
                value={givenName}
                onChange={(e) => setGivenName(e.target.value)}
                autoComplete="off"
              />
            </div>
          </div>

          <fieldset>
            <legend className="mb-2 text-sm font-medium text-slate-ink">{t('form.sex')}</legend>
            <div className="flex flex-wrap gap-2">
              {SEXES.map((value) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={sex === value}
                  onClick={() => setSex(value)}
                  className={cn(
                    'h-10 rounded-full px-4 text-sm ring-1 transition-colors',
                    sex === value
                      ? 'bg-primary text-primary-foreground ring-primary'
                      : 'bg-white ring-border hover:bg-muted',
                  )}
                >
                  {t(`sex.${value}`)}
                </button>
              ))}
            </div>
          </fieldset>

          <div className="grid gap-4 sm:grid-cols-3">
            <div className="grid gap-2">
              <Label htmlFor="birthDate">{t('form.birthDate')}</Label>
              <Input
                id="birthDate"
                type="date"
                value={birthDate}
                max={new Date().toISOString().slice(0, 10)}
                onChange={(e) => {
                  setBirthDate(e.target.value);
                  if (e.target.value) setAge('');
                }}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="age">{t('form.age')}</Label>
              <Input
                id="age"
                inputMode="numeric"
                value={age}
                disabled={Boolean(birthDate)}
                onChange={(e) => setAge(e.target.value.replace(/\D/g, '').slice(0, 3))}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="phone">{t('form.phone')}</Label>
              <Input
                id="phone"
                type="tel"
                inputMode="tel"
                value={phone}
                placeholder="+243 81 000 0000"
                onChange={(e) => setPhone(e.target.value)}
                aria-invalid={Boolean(errors.phone)}
              />
              {errors.phone && <p className="text-xs text-danger">{errors.phone}</p>}
            </div>
          </div>

          {errors.form && (
            <p role="alert" className="rounded-lg bg-danger-soft px-3.5 py-2.5 text-sm text-danger">
              {errors.form}
            </p>
          )}
          {success && (
            <p
              role="status"
              className="rounded-lg bg-success-soft px-3.5 py-2.5 text-sm text-success"
            >
              {success}
            </p>
          )}
          <div className="flex justify-end">
            <Button type="submit" disabled={busy}>
              {busy ? <Loader2 className="animate-spin" /> : <UserPlus />}
              {t('form.submit')}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
