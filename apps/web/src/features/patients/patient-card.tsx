'use client';

import { formatCardToken, type PatientUpdatePayload } from '@medhub/domain';
import { CreditCard, Loader2, RefreshCw } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { useState } from 'react';
import { useRuntime } from '@/client/runtime';
import { Button } from '@/components/ui/button';

type CardPatient = {
  id: string;
  name: string;
  mrn: string;
  sex: 'M' | 'F' | 'U';
  birthDate: string | null;
  birthDateEstimated: boolean;
};

/** ID-1 card (85.6 x 54 mm) in PDF points. */
const CARD_SIZE: [number, number] = [242.65, 153.07];

function newToken(): string {
  return formatCardToken(crypto.getRandomValues(new Uint8Array(20)));
}

/**
 * Builds the card on the device (works offline): the PDF library and the QR
 * encoder are only downloaded the first time a card is printed.
 */
async function cardPdf(input: {
  structure: string;
  name: string;
  mrn: string;
  details: string;
  token: string;
  note: string;
}): Promise<Blob> {
  const [{ Document, Page, Text, View, Image, StyleSheet, pdf }, QRCode] = await Promise.all([
    import('@react-pdf/renderer'),
    import('qrcode'),
  ]);
  // The QR stays black on white so that every camera and scanner reads it.
  const qr = await QRCode.toDataURL(input.token, {
    margin: 0,
    width: 240,
    errorCorrectionLevel: 'M',
  });
  const styles = StyleSheet.create({
    page: { padding: 12, fontFamily: 'Helvetica', fontSize: 8, color: '#0d1d1d' },
    band: {
      backgroundColor: '#0f6b6b',
      color: '#ffffff',
      padding: 5,
      fontSize: 8,
      marginBottom: 8,
    },
    row: { flexDirection: 'row', gap: 10 },
    text: { flexGrow: 1, flexShrink: 1, gap: 3 },
    name: { fontSize: 11, fontFamily: 'Helvetica-Bold' },
    mrn: { fontSize: 9, fontFamily: 'Courier-Bold', marginTop: 2 },
    qr: { width: 74, height: 74 },
    note: { position: 'absolute', bottom: 8, left: 12, right: 12, fontSize: 6, color: '#4a5c5c' },
  });
  const doc = (
    <Document title={input.mrn}>
      <Page size={CARD_SIZE} style={styles.page}>
        <Text style={styles.band}>{input.structure}</Text>
        <View style={styles.row}>
          <View style={styles.text}>
            <Text style={styles.name}>{input.name}</Text>
            <Text style={styles.mrn}>{input.mrn}</Text>
            <Text>{input.details}</Text>
          </View>
          {/* eslint-disable-next-line jsx-a11y/alt-text -- a PDF image has no alternative text */}
          <Image src={qr} style={styles.qr} />
        </View>
        <Text style={styles.note}>{input.note}</Text>
      </Page>
    </Document>
  );
  return pdf(doc).toBlob();
}

/**
 * "Imprimer la carte": the first print gives the patient an opaque card token
 * (synchronised like any identity field); a lost card gets a new token, which
 * makes the old card unreadable.
 */
export function PatientCardActions({
  patient,
  cardToken,
}: {
  patient: CardPatient;
  cardToken: string | null;
}) {
  const t = useTranslations('patient.card');
  const tp = useTranslations('patients');
  const format = useFormatter();
  const { dispatch, identity } = useRuntime();
  const [busy, setBusy] = useState<'print' | 'replace' | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function print(replace: boolean) {
    setBusy(replace ? 'replace' : 'print');
    setError(null);
    try {
      let token = cardToken;
      if (!token || replace) {
        token = newToken();
        await dispatch('patient.update', { cardToken: token } as PatientUpdatePayload, {
          entityId: patient.id,
        });
      }
      const birth = patient.birthDate
        ? patient.birthDateEstimated
          ? patient.birthDate.slice(0, 4)
          : format.dateTime(new Date(`${patient.birthDate}T00:00:00Z`), {
              dateStyle: 'medium',
              timeZone: 'UTC',
            })
        : '';
      const blob = await cardPdf({
        structure: identity?.tenantName ?? '',
        name: patient.name,
        mrn: patient.mrn,
        details: [tp(`sex.${patient.sex}`), birth ? t('born', { date: birth }) : '']
          .filter(Boolean)
          .join(' · '),
        token,
        note: t('note'),
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `carte-${patient.mrn}.pdf`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      setConfirming(false);
    } catch (err) {
      // The type only: the message could quote what was being printed.
      console.error('patient card', err instanceof Error ? err.name : 'unknown');
      setError(t('error'));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="grid justify-items-end gap-1.5">
      <div className="flex flex-wrap justify-end gap-2">
        <Button
          size="sm"
          variant="secondary"
          disabled={busy !== null}
          onClick={() => void print(false)}
        >
          {busy === 'print' ? <Loader2 className="animate-spin" /> : <CreditCard />}
          {t('print')}
        </Button>
        {cardToken && !confirming && (
          <Button
            size="sm"
            variant="ghost"
            disabled={busy !== null}
            onClick={() => setConfirming(true)}
          >
            <RefreshCw />
            {t('replace')}
          </Button>
        )}
      </div>
      {confirming && (
        <div className="grid max-w-sm gap-2 rounded-xl p-3 text-sm ring-1 ring-border">
          <p>{t('replaceConfirm')}</p>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="destructive"
              disabled={busy !== null}
              onClick={() => void print(true)}
            >
              {busy === 'replace' ? <Loader2 className="animate-spin" /> : <RefreshCw />}
              {t('replaceAction')}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
              {t('cancel')}
            </Button>
          </div>
        </div>
      )}
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
