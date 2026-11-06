'use client';

import type { LocalEntity } from '@medhub/sync/client';
import { useFormatter, useTranslations } from 'next-intl';
import { useRuntime } from '@/client/runtime';

export type PrintPatient = {
  name: string;
  mrn: string;
  details: string;
  weight: string | null;
};

type PdfInput = {
  structure: string;
  prescriber: string;
  date: string;
  patient: PrintPatient;
  lines: { label: string; posology: string; extra: string }[];
  code: string;
  url: string;
  texts: {
    title: string;
    patient: string;
    weight: string;
    verify: string;
    signature: string;
    legal: string;
  };
};

/**
 * A5 prescription built on the device (docs/07-ui-ux.md section 9), offline
 * included: the PDF engine and the QR encoder are only downloaded on the
 * first print. The QR leads to the public verification page.
 */
async function prescriptionPdf(input: PdfInput): Promise<Blob> {
  const [{ Document, Page, Text, View, Image, StyleSheet, pdf }, QRCode] = await Promise.all([
    import('@react-pdf/renderer'),
    import('qrcode'),
  ]);
  // Black on white so that every camera reads it.
  const qr = await QRCode.toDataURL(input.url, {
    margin: 0,
    width: 240,
    errorCorrectionLevel: 'M',
  });
  const styles = StyleSheet.create({
    page: { padding: 28, fontFamily: 'Helvetica', fontSize: 9.5, color: '#0d1d1d' },
    header: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      borderBottomWidth: 1.5,
      borderBottomColor: '#0f6b6b',
      paddingBottom: 8,
      marginBottom: 12,
    },
    structure: { fontSize: 12, fontFamily: 'Helvetica-Bold', color: '#0f6b6b' },
    muted: { color: '#4a5c5c' },
    title: { fontSize: 14, fontFamily: 'Helvetica-Bold', marginBottom: 10, textAlign: 'center' },
    box: {
      borderWidth: 0.75,
      borderColor: '#b4dadd',
      borderRadius: 4,
      padding: 8,
      marginBottom: 12,
    },
    bold: { fontFamily: 'Helvetica-Bold' },
    line: { flexDirection: 'row', gap: 6, marginBottom: 8 },
    index: { width: 14, fontFamily: 'Helvetica-Bold' },
    lineText: { flexGrow: 1, flexShrink: 1, gap: 2 },
    footer: {
      position: 'absolute',
      left: 28,
      right: 28,
      bottom: 24,
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'flex-end',
    },
    qrBlock: { alignItems: 'center', gap: 3 },
    qr: { width: 72, height: 72 },
    code: { fontFamily: 'Courier-Bold', fontSize: 9 },
    signature: { width: 160, borderTopWidth: 0.75, borderTopColor: '#4a5c5c', paddingTop: 4 },
    legal: {
      position: 'absolute',
      left: 28,
      right: 28,
      bottom: 8,
      fontSize: 6.5,
      color: '#4a5c5c',
    },
  });
  const doc = (
    <Document title={`${input.texts.title} ${input.code}`}>
      <Page size="A5" style={styles.page}>
        <View style={styles.header}>
          <View>
            <Text style={styles.structure}>{input.structure}</Text>
            <Text style={styles.muted}>{input.prescriber}</Text>
          </View>
          <Text style={styles.muted}>{input.date}</Text>
        </View>
        <Text style={styles.title}>{input.texts.title}</Text>
        <View style={styles.box}>
          <Text>
            <Text style={styles.bold}>{input.texts.patient} : </Text>
            {input.patient.name} · {input.patient.mrn}
          </Text>
          <Text style={styles.muted}>
            {input.patient.details}
            {input.patient.weight ? ` · ${input.texts.weight} ${input.patient.weight}` : ''}
          </Text>
        </View>
        {input.lines.map((l, i) => (
          <View key={i} style={styles.line} wrap={false}>
            <Text style={styles.index}>{i + 1}.</Text>
            <View style={styles.lineText}>
              <Text style={styles.bold}>{l.label}</Text>
              <Text>{l.posology}</Text>
              {l.extra ? <Text style={styles.muted}>{l.extra}</Text> : null}
            </View>
          </View>
        ))}
        <View style={styles.footer} fixed>
          <View style={styles.qrBlock}>
            {/* eslint-disable-next-line jsx-a11y/alt-text -- a PDF image has no alternative text */}
            <Image src={qr} style={styles.qr} />
            <Text style={styles.code}>{input.code}</Text>
            <Text style={styles.muted}>{input.texts.verify}</Text>
          </View>
          <Text style={styles.signature}>{input.texts.signature}</Text>
        </View>
        {input.texts.legal ? (
          <Text style={styles.legal} fixed>
            {input.texts.legal}
          </Text>
        ) : null}
      </Page>
    </Document>
  );
  return pdf(doc).toBlob();
}

/** Prints a signed prescription of the consultation screen. */
export function usePrescriptionPrint() {
  const t = useTranslations('prescription');
  const tPrint = useTranslations('prescription.printout');
  const format = useFormatter();
  const { identity, catalogs } = useRuntime();

  return async (prescription: LocalEntity, patient: PrintPatient) => {
    const d = prescription.data;
    const code = String(d.verificationCode ?? '');
    const author = catalogs?.snapshot.staff?.find(
      (s) => s.id === (d.prescriberId ?? prescription.createdBy),
    );
    const items = (Array.isArray(d.items) ? d.items : []) as Record<string, unknown>[];
    const blob = await prescriptionPdf({
      structure: identity?.tenantName ?? '',
      prescriber: [author?.title, author?.displayName].filter(Boolean).join(' '),
      date: format.dateTime(new Date(String(d.prescribedAt)), { dateStyle: 'long' }),
      patient,
      code,
      url: `${window.location.origin}/verifier?code=${code}`,
      lines: items.map((i) => ({
        label: String(i.label ?? ''),
        posology: t('posology', {
          dose: Number(i.doseValue),
          unit: String(i.doseUnit ?? ''),
          frequency: t(`frequencies.${String(i.frequency).replace('/', '_')}`),
          days: typeof i.durationDays === 'number' ? i.durationDays : 0,
        }),
        extra: [
          typeof i.quantity === 'number'
            ? t('quantity', { quantity: i.quantity, unit: String(i.doseUnit ?? '') })
            : '',
          typeof i.instructions === 'string' ? i.instructions : '',
          i.substitutionAllowed === false ? tPrint('noSubstitution') : '',
        ]
          .filter(Boolean)
          .join(' · '),
      })),
      texts: {
        title: tPrint('title'),
        patient: tPrint('patient'),
        weight: tPrint('weight'),
        verify: tPrint('verify'),
        signature: tPrint('signature'),
        legal: catalogs?.snapshot.legalMentions ?? '',
      },
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `ordonnance-${code}.pdf`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };
}
