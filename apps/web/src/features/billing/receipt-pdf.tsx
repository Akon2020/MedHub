'use client';

import { formatMoney } from '@medhub/shared';
import { useFormatter, useLocale, useTranslations } from 'next-intl';
import { useRuntime } from '@/client/runtime';
import type { InvoiceLineView, InvoiceView } from './billing-helpers';
import type { PaymentRow } from './cash-session';

/** Ticket 80 mm wide in PDF points; the height follows the content. */
const WIDTH = 226.77;

/**
 * Receipt printed on the workstation (docs/modules/fact.md 3), offline
 * included: structure, receipt and invoice numbers, lines, amount received,
 * rate used with its date, rounding, change and balance. Legal mentions come
 * from the configuration and stay empty by default.
 */
export function useReceiptPrint() {
  const t = useTranslations('billing.receipt');
  const tm = useTranslations('billing.session.methods');
  const format = useFormatter();
  const locale = useLocale();
  const { identity, catalogs } = useRuntime();
  const fmt = (amount: number, currency: string) =>
    formatMoney({ amount, currency }, locale === 'en' ? 'en-US' : 'fr-CD');

  return async (input: {
    payment: PaymentRow;
    invoice: InvoiceView;
    lines: InvoiceLineView[];
    patientName: string;
    remaining: number;
  }) => {
    const { payment, invoice } = input;
    const lines = input.lines.filter((l) => l.status !== 'superseded');
    const { Document, Page, Text, View, StyleSheet, pdf } = await import('@react-pdf/renderer');
    const styles = StyleSheet.create({
      page: { padding: 10, fontFamily: 'Helvetica', fontSize: 8, color: '#000000' },
      center: { textAlign: 'center' },
      bold: { fontFamily: 'Helvetica-Bold' },
      title: { fontSize: 10, fontFamily: 'Helvetica-Bold', textAlign: 'center', marginBottom: 4 },
      row: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 2 },
      rule: { borderBottomWidth: 0.5, borderBottomColor: '#000000', marginVertical: 4 },
      small: { fontSize: 7 },
    });
    const row = (label: string, value: string, bold = false) => (
      <View style={styles.row}>
        <Text style={bold ? styles.bold : {}}>{label}</Text>
        <Text style={bold ? styles.bold : {}}>{value}</Text>
      </View>
    );
    const height = 260 + lines.length * 12 + (payment.exchangeRate ? 24 : 0);
    const doc = (
      <Document title={payment.receiptNumber}>
        <Page size={[WIDTH, height]} style={styles.page}>
          <Text style={styles.title}>{identity?.tenantName ?? ''}</Text>
          <Text style={styles.center}>{t('title')}</Text>
          <Text style={[styles.center, styles.bold]}>{payment.receiptNumber}</Text>
          <Text style={styles.center}>
            {format.dateTime(new Date(payment.receivedAt), {
              dateStyle: 'short',
              timeStyle: 'short',
            })}
          </Text>
          <View style={styles.rule} />
          <Text>
            {t('patient')} : {input.patientName}
          </Text>
          <Text>
            {t('invoice')} : {invoice.number}
          </Text>
          <View style={styles.rule} />
          {lines.map((l) => (
            <View key={l.id}>
              {row(
                `${l.label}${l.quantity > 1 ? ` x${l.quantity}` : ''}`,
                l.unitPrice === null ? '-' : fmt(l.quantity * l.unitPrice, invoice.currency),
              )}
            </View>
          ))}
          <View style={styles.rule} />
          {row(t('method'), tm(payment.method))}
          {payment.reference ? row(t('reference'), payment.reference) : null}
          {row(t('settled'), fmt(payment.amountInInvoiceCurrency, invoice.currency))}
          {payment.exchangeRate
            ? row(
                t('rate', { date: payment.exchangeRateDate ?? '' }),
                payment.exchangeRateInverse
                  ? `1 ${payment.currency} = 1/${payment.exchangeRate} ${invoice.currency}`
                  : `1 ${invoice.currency} = ${payment.exchangeRate} ${payment.currency}`,
              )
            : null}
          {payment.roundingAdjustment !== 0
            ? row(t('rounding'), fmt(payment.roundingAdjustment, payment.currency))
            : null}
          {row(t('received'), fmt(payment.amount + payment.change, payment.currency), true)}
          {payment.change > 0 ? row(t('change'), fmt(payment.change, payment.currency)) : null}
          {row(t('remaining'), fmt(input.remaining, invoice.currency), true)}
          <View style={styles.rule} />
          {catalogs?.snapshot.legalMentions ? (
            <Text style={styles.small}>{catalogs.snapshot.legalMentions}</Text>
          ) : null}
          <Text style={[styles.center, styles.small]}>{t('thanks')}</Text>
        </Page>
      </Document>
    );
    const blob = await pdf(doc).toBlob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `recu-${payment.receiptNumber}.pdf`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };
}
