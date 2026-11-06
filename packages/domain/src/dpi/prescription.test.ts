import { parseCsv } from '@medhub/shared';
import { describe, expect, it } from 'vitest';
import {
  computeQuantity,
  newVerificationCode,
  parseDrugCatalog,
  parseInteractionRules,
  prescriptionCreatePayload,
  searchDrugs,
  VERIFICATION_PATTERN,
  type DrugInfo,
} from './prescription';
import { checkPrescription, unresolvedBlocking, type PatientFacts } from './prescription-checks';

/** Test catalogue: values chosen for the cases, not reference doses. */
const drug = (over: Partial<DrugInfo>): DrugInfo => ({
  code: 'X',
  inn: 'Produit test',
  atcCode: null,
  form: 'comprimé',
  strength: null,
  route: 'orale',
  doseUnit: 'mg',
  maxSingleDose: null,
  maxDailyDose: null,
  maxDailyDosePerKg: null,
  pregnancyCategory: null,
  minAgeMonths: null,
  geriatricCaution: false,
  renalCaution: false,
  hepaticCaution: false,
  isControlled: false,
  ...over,
});
const amoxicillin = drug({
  code: 'AMOX',
  inn: 'Amoxicilline',
  atcCode: 'J01CA04',
  maxDailyDosePerKg: 100,
});
const ampicillin = drug({ code: 'AMPI', inn: 'Ampicilline', atcCode: 'J01CA01' });
const azithro = drug({ code: 'AZI', inn: 'Azithromycine', atcCode: 'J01FA10' });
const warfarin = drug({
  code: 'WARF',
  inn: 'Warfarine',
  atcCode: 'B01AA03',
  pregnancyCategory: 'X',
});
const aspirin = drug({
  code: 'ASA',
  inn: 'Acide acétylsalicylique',
  atcCode: 'N02BA01',
  maxSingleDose: 1000,
  maxDailyDose: 3000,
});

const adult: PatientFacts = {
  ageMonths: 35 * 12,
  weightKg: 60,
  pregnant: false,
  allergies: [],
  problemCodes: [],
};
const line = (d: DrugInfo, doseValue: number, frequency: '1x/d' | '3x/d' | 'prn' = '3x/d') => ({
  label: d.inn,
  drug: d,
  atcCode: d.atcCode,
  doseValue,
  doseUnit: 'mg',
  frequency,
});
const codes = (alerts: { code: string; severity: string }[]) =>
  alerts.map((a) => `${a.code}:${a.severity}`);

describe('prescription checks', () => {
  it('blocks a drug the patient is allergic to, by name or by ATC class', () => {
    const byName = checkPrescription(
      [line(amoxicillin, 500)],
      {
        ...adult,
        allergies: [{ substance: 'Amoxicilline', atcCode: null }],
      },
      [],
    );
    expect(codes(byName)).toEqual(['ALLERGY:blocking']);
    const byClass = checkPrescription(
      [line(ampicillin, 500)],
      {
        ...adult,
        allergies: [{ substance: 'Pénicillines', atcCode: 'J01C' }],
      },
      [],
    );
    expect(codes(byClass)).toEqual(['ALLERGY:blocking']);
    expect(
      checkPrescription(
        [line(azithro, 500, '1x/d')],
        {
          ...adult,
          allergies: [{ substance: 'Pénicillines', atcCode: 'J01C' }],
        },
        [],
      ),
    ).toEqual([]);
  });

  it('warns on two drugs of the same class, in the prescription or already running', () => {
    expect(
      codes(checkPrescription([line(amoxicillin, 500), line(ampicillin, 500)], adult, [])),
    ).toEqual(['DUPLICATE_CLASS:warning']);
    expect(
      codes(
        checkPrescription(
          [line(ampicillin, 500)],
          adult,
          [],
          [{ label: 'Amoxicilline', atcCode: 'J01CA04' }],
        ),
      ),
    ).toEqual(['DUPLICATE_CLASS:warning']);
  });

  it('applies the imported interaction rules, class prefixes included', () => {
    const rules = [
      { atcA: 'B01AA', atcB: 'N02BA', severity: 'major' as const, message: 'Risque hémorragique' },
    ];
    const alerts = checkPrescription([line(warfarin, 5, '1x/d'), line(aspirin, 500)], adult, rules);
    expect(alerts).toEqual([
      {
        item: 1,
        code: 'INTERACTION',
        severity: 'blocking',
        params: { other: 'Warfarine', message: 'Risque hémorragique' },
      },
    ]);
  });

  it('checks the doses per intake, per day and per kilogram', () => {
    expect(codes(checkPrescription([line(aspirin, 1500, '1x/d')], adult, []))).toEqual([
      'MAX_SINGLE_DOSE:blocking',
    ]);
    expect(codes(checkPrescription([line(aspirin, 1000, '3x/d')], adult, []))).toEqual([]);
    expect(
      codes(checkPrescription([{ ...line(aspirin, 1000), frequency: '4x/d' as const }], adult, [])),
    ).toEqual(['MAX_DAILY_DOSE:blocking']);
    const child: PatientFacts = { ...adult, ageMonths: 36, weightKg: 14 };
    const alerts = checkPrescription([line(amoxicillin, 500)], child, []);
    expect(alerts).toEqual([
      {
        item: 0,
        code: 'MAX_DOSE_PER_KG',
        severity: 'blocking',
        params: { daily: 1500, limit: 1400, perKg: 100, unit: 'mg' },
      },
    ]);
    expect(checkPrescription([line(amoxicillin, 500, 'prn')], child, [])).toEqual([]);
  });

  it('accounts for pregnancy, age and organ failure', () => {
    expect(
      codes(checkPrescription([line(warfarin, 5, '1x/d')], { ...adult, pregnant: true }, [])),
    ).toEqual(['PREGNANCY:blocking']);
    const young = drug({ inn: 'Réservé adulte', minAgeMonths: 144 });
    expect(
      codes(checkPrescription([line(young, 1, '1x/d')], { ...adult, ageMonths: 60 }, [])),
    ).toEqual(['MIN_AGE:blocking']);
    const careful = drug({
      inn: 'Prudence',
      geriatricCaution: true,
      renalCaution: true,
      hepaticCaution: true,
    });
    expect(
      codes(
        checkPrescription(
          [line(careful, 1, '1x/d')],
          { ...adult, ageMonths: 70 * 12, problemCodes: ['N18.3', 'K74'] },
          [],
        ),
      ),
    ).toEqual(['GERIATRIC:warning', 'RENAL:warning', 'HEPATIC:warning']);
  });

  it('lists the blocking alerts not overridden yet', () => {
    const alerts = checkPrescription(
      [line(amoxicillin, 500)],
      {
        ...adult,
        allergies: [{ substance: 'Amoxicilline', atcCode: 'J01CA04' }],
      },
      [],
    );
    expect(unresolvedBlocking(alerts, 0, [])).toHaveLength(1);
    expect(unresolvedBlocking(alerts, 0, [{ code: 'ALLERGY' }])).toHaveLength(0);
  });
});

describe('prescription payload and helpers', () => {
  it('computes the quantity of the treatment', () => {
    expect(computeQuantity(500, '3x/d', 7)).toBe(10500);
    expect(computeQuantity(2, 'once', null)).toBe(2);
    expect(computeQuantity(1, 'prn', 5)).toBeNull();
  });

  it('generates verification codes without ambiguous characters', () => {
    const code = newVerificationCode((n) => Uint8Array.from({ length: n }, (_, i) => i * 37));
    expect(code).toMatch(VERIFICATION_PATTERN);
    expect(code).not.toMatch(/[01IO]/);
  });

  it('requires a justification for an overridden alert', () => {
    const base = {
      patientId: '0190a5e2-0000-7000-8000-000000000001',
      prescribedAt: '2026-11-06T09:00:00.000Z',
      verificationCode: 'ABCDEFGH23',
      items: [
        {
          label: 'Amoxicilline 500 mg',
          doseValue: 500,
          doseUnit: 'mg',
          frequency: '3x/d',
          durationDays: 7,
        },
      ],
    };
    expect(prescriptionCreatePayload.safeParse(base).success).toBe(true);
    const bad = {
      ...base,
      items: [
        {
          ...base.items[0],
          alertsAcknowledged: [{ code: 'ALLERGY', severity: 'blocking', justification: '' }],
        },
      ],
    };
    expect(prescriptionCreatePayload.safeParse(bad).success).toBe(false);
  });
});

describe('catalogue imports', () => {
  it('reads the drug list and reports bad lines', () => {
    const csv = [
      'code;dci;atc;forme;dosage;unite_dose;dose_max_prise;dose_max_kg_jour;grossesse;prudence_geriatrie',
      'AMOX500;Amoxicilline;J01CA04;gélule;500 mg;mg;;100;B;non',
      'BAD;Mauvais;XX;;;;;;;',
      'AMOX500;Doublon;;;;;;;;',
      ';Sans code;;;;;;;;',
      'PARA;Paracétamol;N02BE01;comprimé;500 mg;mg;1000;;;oui',
    ].join('\n');
    const { items, errors } = parseDrugCatalog(parseCsv(csv));
    expect(items.map((d) => d.code)).toEqual(['AMOX500', 'PARA']);
    expect(items[0]).toMatchObject({
      maxDailyDosePerKg: 100,
      pregnancyCategory: 'B',
      geriatricCaution: false,
    });
    expect(items[1]).toMatchObject({ maxSingleDose: 1000, geriatricCaution: true });
    expect(errors).toEqual([
      { line: 3, message: 'PRESC_IMPORT_VALUE' },
      { line: 4, message: 'PRESC_IMPORT_DUPLICATE' },
      { line: 5, message: 'PRESC_IMPORT_MISSING' },
    ]);
    expect(searchDrugs(items, 'parac').map((d) => d.code)).toEqual(['PARA']);
  });

  it('reads interaction rules in either order of the pair', () => {
    const csv =
      'atc_a;atc_b;gravite;message\nN02BA;B01AA;majeure;Risque hémorragique\nB01AA;N02BA;mineure;Doublon\nJ01;X;inconnue;?';
    const { items, errors } = parseInteractionRules(parseCsv(csv));
    expect(items).toEqual([
      { atcA: 'B01AA', atcB: 'N02BA', severity: 'major', message: 'Risque hémorragique' },
    ]);
    expect(errors.map((e) => e.message)).toEqual(['PRESC_IMPORT_DUPLICATE', 'PRESC_IMPORT_VALUE']);
  });
});
