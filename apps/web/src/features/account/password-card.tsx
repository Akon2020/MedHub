'use client';

import { KeyRound, Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState, type FormEvent } from 'react';
import { apiFetch } from '@/client/api';
import { useOnline } from '@/client/browser-state';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NewPasswordFields, usePasswordErrorMessage } from '@/features/auth/password-step';

/** The documented minimum; the server applies the structure's own value. */
const DISPLAYED_MIN_LENGTH = 10;

/** Password change from "Mon compte": the other sessions of the user end. */
export function PasswordCard() {
  const t = useTranslations('account.password');
  const online = useOnline();
  const describe = usePasswordErrorMessage();
  const [current, setCurrent] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (password !== confirmation) return;
    setBusy(true);
    setMessage(null);
    try {
      await apiFetch('/api/v1/account/password', {
        method: 'POST',
        body: JSON.stringify({ current, password }),
      });
      setCurrent('');
      setPassword('');
      setConfirmation('');
      setMessage({ ok: true, text: t('changed') });
    } catch (err) {
      setMessage({ ok: false, text: describe(err, DISPLAYED_MIN_LENGTH) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle className="flex items-center gap-2">
            <KeyRound className="size-4 text-primary" aria-hidden />
            {t('title')}
          </CardTitle>
          <CardDescription className="mt-1">{t('text')}</CardDescription>
        </div>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="grid gap-4" noValidate>
          <div className="grid gap-2">
            <Label htmlFor="account-password-current">{t('current')}</Label>
            <Input
              id="account-password-current"
              type="password"
              autoComplete="current-password"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
              required
            />
          </div>
          <NewPasswordFields
            idPrefix="account-password"
            minLength={DISPLAYED_MIN_LENGTH}
            password={password}
            confirmation={confirmation}
            onPassword={setPassword}
            onConfirmation={setConfirmation}
          />
          {message && (
            <p
              role={message.ok ? 'status' : 'alert'}
              className={
                message.ok
                  ? 'rounded-lg bg-success-soft px-3.5 py-2.5 text-sm text-success'
                  : 'rounded-lg bg-danger-soft px-3.5 py-2.5 text-sm text-danger'
              }
            >
              {message.text}
            </p>
          )}
          <Button
            type="submit"
            className="justify-self-start"
            disabled={
              busy || !online || !current || password.length === 0 || password !== confirmation
            }
          >
            {busy && <Loader2 className="animate-spin" />}
            {t('submit')}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
